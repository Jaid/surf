import {expect, test} from 'bun:test'
import {tmpdir} from 'node:os'

import {join} from 'forward-slash-path'
import fs from 'fs-extra'
import puppeteer from 'puppeteer-core'

import {BrowserSession} from '../src/browser/BrowserSession.ts'
import {launchDetached} from '../src/browser/launchDetached.ts'

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
integration('detached worker reports readiness and cleans its profile after browser close', async () => {
  const cacheFolder = await fs.mkdtemp(join(tmpdir(), 'surf-detached-test-'))
  try {
    const info = await launchDetached({
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
integration('detached CLI exits while its browser remains usable', async () => {
  const cacheFolder = await fs.mkdtemp(join(tmpdir(), 'surf-detached-cli-test-'))
  try {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, '../src/main.ts'), 'about:blank', '--detached', '--cache-folder', cacheFolder, '--executable-file', executableFile!, '--', '--headless=new'], {
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
