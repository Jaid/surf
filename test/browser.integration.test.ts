import {expect, test} from 'bun:test'
import {tmpdir} from 'node:os'

import {join} from 'forward-slash-path'
import fs from 'fs-extra'
import puppeteer from 'puppeteer-core'

import {BrowserSession} from '../src/browser/BrowserSession.ts'
import {launchBackground} from '../src/browser/launchBackground.ts'

const executableFile = Bun.env.SURF_TEST_BROWSER
const integration = test.skipIf(!executableFile)
integration('real browser lifecycle removes only throwaway data', async () => {
  let path = ''
  {
    await using session = await BrowserSession.launch({
      executableFile,
      url: 'about:blank',
      args: ['--headless=new'],
    })
    path = session.userData.path
    expect(session.info.webSocketDebuggerUrl).toStartWith('ws://127.0.0.1:')
    const page = await session.browser.newPage()
    await page.goto('data:text/html,<title>Surf</title>')
    expect(await page.title()).toBe('Surf')
  }
  expect(await fs.stat(path).catch(() => null)).toBeNull()
}, 30_000)
integration('granted permissions are in place before the page’s first script runs', async () => {
  using server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: () => new Response('<script>document.title = Notification.permission</script>', {headers: {'content-type': 'text/html'}}),
  })
  await using session = await BrowserSession.launch({
    executableFile,
    url: server.url.href,
    grant: ['notifications'],
    args: ['--headless=new'],
  })
  const target = await session.browser.waitForTarget(candidate => candidate.url().startsWith(server.url.origin))
  const page = await target.page()
  await page!.waitForFunction('document.title !== ""')
  expect(await page!.title()).toBe('granted')
}, 30_000)
/** Closes a session whose page sends a keepalive request on pagehide and returns what the collector received. */
async function closeWithExitRequest() {
  const exits: Array<string> = []
  // Like telemetry to a collector: cross-origin JSON, so the request waits for a CORS preflight first.
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type',
  }
  using collector = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async request => {
      if (request.method === 'POST') {
        exits.push(await request.text())
      } else {
        await Bun.sleep(150)
      }
      return new Response(null, {
        status: 204,
        headers: cors,
      })
    },
  })
  using server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: () => new Response(`<script>addEventListener("pagehide", () => fetch(${JSON.stringify(collector.url.href)}, {method: "POST", body: "pagehide", headers: {"content-type": "application/json"}, keepalive: true}))</script>`, {headers: {'content-type': 'text/html'}}),
  })
  const session = await BrowserSession.launch({
    executableFile,
    url: server.url.href,
    args: ['--headless=new'],
  })
  const target = await session.browser.waitForTarget(candidate => candidate.url().startsWith(server.url.origin))
  await (await target.page())!.waitForNetworkIdle()
  await session.close()
  await Bun.sleep(500)
  return exits
}
integration('closing the session gives pages their pagehide, so its keepalive requests still arrive', async () => {
  expect(await closeWithExitRequest()).toEqual(['pagehide'])
}, 30_000)
integration('persistent profile survives and duplicate launch does not own the original browser', async () => {
  const userDataDir = await fs.mkdtemp(join(tmpdir(), 'surf-persistent-test-'))
  try {
    await using session = await BrowserSession.launch({
      executableFile,
      userDataDir,
      url: 'about:blank',
      args: ['--headless=new'],
    })
    await expect(BrowserSession.launch({
      executableFile,
      userDataDir,
      url: 'about:blank',
      args: ['--headless=new'],
      timeout: 3000,
    })).rejects.toThrow('Browser launch failed')
    expect(session.browser.connected).toBe(true)
  } finally {
    const info = await fs.stat(userDataDir)
    expect(info.isDirectory()).toBe(true)
    await fs.rm(userDataDir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  }
}, 30_000)
integration('background worker reports readiness and cleans its profile after browser close', async () => {
  const cacheFolder = await fs.mkdtemp(join(tmpdir(), 'surf-background-test-'))
  try {
    const info = await launchBackground({
      executableFile,
      cacheFolder,
      url: 'about:blank',
      args: ['--headless=new'],
    })
    {
      const browser = await puppeteer.connect({browserWSEndpoint: info.webSocketDebuggerUrl})
      // Connected Browser async disposal only disconnects; this test must close it.
      await using closing = {[Symbol.asyncDispose]: () => browser.close()}
      expect(await browser.version()).toContain('/')
    }
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline && await fs.stat(info.userDataDir).catch(() => null)) {
      await Bun.sleep(100)
    }
    expect(await fs.stat(info.userDataDir).catch(() => null)).toBeNull()
  } finally {
    await Bun.sleep(500)
    await fs.rm(cacheFolder, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  }
}, 45_000)
integration('background CLI exits while its browser remains usable', async () => {
  const cacheFolder = await fs.mkdtemp(join(tmpdir(), 'surf-background-cli-test-'))
  try {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, '../src/main.ts'), 'about:blank', '--background', '--cache-folder', cacheFolder, '--executable-file', executableFile!, '--', '--headless=new'], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = new Response(child.stdout)
    const stderr = new Response(child.stderr)
    const [code, output, errors] = await Promise.all([child.exited, stdout.text(), stderr.text()])
    expect(errors).toBe('')
    expect(code).toBe(0)
    const info = JSON.parse(output) as {
      userDataDir: string
      webSocketDebuggerUrl: string
    }
    await Bun.sleep(200)
    const browser = await puppeteer.connect({browserWSEndpoint: info.webSocketDebuggerUrl})
    await browser.close()
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline && await fs.pathExists(info.userDataDir)) {
      await Bun.sleep(50)
    }
    expect(await fs.pathExists(info.userDataDir)).toBe(false)
  } finally {
    await Bun.sleep(500)
    await fs.rm(cacheFolder, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    })
  }
}, 45_000)
integration('coupled CLI handles interruption, closes its browser, and removes its profile', async () => {
  const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/coupled.ts'), 'launch', JSON.stringify(['about:blank', '--executable-file', executableFile!, '--', '--headless=new'])], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stdout = new Response(child.stdout)
  const stderr = new Response(child.stderr)
  const [code, output, errors] = await Promise.all([child.exited, stdout.text(), stderr.text()])
  expect(errors).toBe('')
  expect(code).toBe(130)
  const info = JSON.parse(output) as {userDataDir: string}
  expect(await fs.pathExists(info.userDataDir)).toBe(false)
}, 30_000)
