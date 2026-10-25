import {expect, test} from 'bun:test'
import {tmpdir} from 'node:os'

import {join} from 'forward-slash-path'
import fs from 'fs-extra'

import {BrowserSession} from '../src/browser/BrowserSession.ts'
import {BrowserLog} from '../src/log/BrowserLog.ts'
import {recordBrowserTrace} from '../src/trace/recordBrowserTrace.ts'

const executableFile = Bun.env.SURF_TEST_BROWSER
const integration = test.skipIf(!executableFile)
integration('prints initial navigation, console messages, responses and failures to stdout', async () => {
  const lines: Array<string> = []
  const originalLog = console.log
  console.log = (...args: Array<unknown>) => {
    lines.push(args.join(' '))
  }
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === '/api') {
        return Response.json({ok: true})
      }
      if (url.pathname === '/redirect') {
        const destination = new URL('/api', request.url)
        return Response.redirect(destination.href)
      }
      if (url.pathname === '/fail') {
        return new Response('missing', {status: 404})
      }
      return new Response('<script>console.log("initial console", 42, {answer: 42})</script>', {headers: {'content-type': 'text/html'}})
    },
  })
  try {
    await using session = await BrowserSession.launch({
      executableFile,
      url: server.url.href,
      printLog: ['console', 'network', 'console'],
      args: ['--headless=new'],
    })
    const [page] = await session.browser.pages()
    await page.waitForFunction('document.readyState === "complete"')
    await page.evaluate(async () => {
      console.warn('warning')
      console.error('error')
      console.log('escape', '\u{1B}]2;fake\u{7}')
      await fetch('/redirect')
      await fetch('/fail')
      await fetch('http://127.0.0.1:1/failure').catch(() => {})
      queueMicrotask(() => {
        throw new Error('uncaught log test')
      })
    })
    await Bun.sleep(200)
    const output = lines.join('\n')
    expect(output).toContain(`[network] GET ${server.url.href}`)
    expect(output).toContain('[console] log: initial console 42')
    expect(lines.filter(line => line.includes('initial console'))).toHaveLength(1)
    expect(output).toContain('[console] warning: warning')
    expect(output).toContain('[console] error: error')
    expect(output).toContain('uncaught log test')
    expect(output).toContain(String.raw`\u001b]2;fake\u0007`)
    expect(output).toContain('[network] 302')
    expect(output).toContain('[network] 200 GET')
    expect(output).toContain('[network] 404 GET')
    expect(output).toContain('[network] FAILED')
    expect(session.info.url).toBe(server.url.href)
  } finally {
    console.log = originalLog
    await server.stop(true)
  }
}, 60_000)
integration('logging categories are independent and detach stops printing without closing the browser', async () => {
  const lines: Array<string> = []
  const originalLog = console.log
  console.log = (...args: Array<unknown>) => {
    lines.push(args.join(' '))
  }
  try {
    await using session = await BrowserSession.launch({
      executableFile,
      url: 'about:blank',
      args: ['--headless=new'],
    })
    const [page] = await session.browser.pages()
    await using log = await BrowserLog.attach(session.browser, ['console'])
    {
      await page.evaluate(() => console.log('selected'))
      await Bun.sleep(50)
      expect(lines.join('\n')).toContain('[console] log: selected')
      expect(lines.some(line => line.startsWith('[network]'))).toBe(false)
    }
    await log[Symbol.asyncDispose]()
    lines.length = 0
    await page.evaluate(() => console.log('after detach'))
    await Bun.sleep(50)
    expect(lines).toEqual([])
    expect(session.browser.connected).toBe(true)
  } finally {
    console.log = originalLog
  }
}, 60_000)
integration('print-log works in app mode without tracing', async () => {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response('<script>console.log("app startup")</script>', {headers: {'content-type': 'text/html'}}),
  })
  try {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/coupled.ts'), 'launch', JSON.stringify([
      server.url.href,
      '--app',
      '--executable-file',
      executableFile!,
      '--print-log',
      'console',
      '--print-log',
      'network',
      '--',
      '--headless=new',
    ])], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
    })
    const stdoutResponse = new Response(child.stdout)
    const stderrResponse = new Response(child.stderr)
    const [code, stdout, stderr] = await Promise.all([child.exited, stdoutResponse.text(), stderrResponse.text()])
    expect(code).toBe(130)
    expect(stdout).toContain('[console] log: app startup')
    expect(stdout).toContain(`[network] GET ${server.url.href}`)
    expect(stderr).not.toContain('Recording ')
  } finally {
    await server.stop(true)
  }
}, 90_000)
integration('attached network printing remains independent of trace console collection', async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), 'surf-log-attach-'))
  const lines: Array<string> = []
  const originalLog = console.log
  console.log = (...args: Array<unknown>) => {
    lines.push(args.join(' '))
  }
  const server = Bun.serve({
    port: 0,
    fetch: () => new Response('<script>console.log("not printed")</script>', {headers: {'content-type': 'text/html'}}),
  })
  try {
    await using browser = await BrowserSession.launch({
      executableFile,
      url: server.url.href,
      args: ['--headless=new'],
    })
    const endpoint = new URL(browser.info.webSocketDebuggerUrl)
    const output = await recordBrowserTrace({
      port: Number(endpoint.port),
      printLog: ['network'],
      reload: true,
      duration: 200,
      buffer: 16_000_000,
      output: join(folder, 'trace.msgpack.br'),
    })
    expect(output).toBeDefined()
    expect(lines.some(line => line.startsWith('[network] GET'))).toBe(true)
    expect(lines.some(line => line.startsWith('[console]'))).toBe(false)
    expect(browser.browser.connected).toBe(true)
  } finally {
    console.log = originalLog
    await server.stop(true)
    await fs.remove(folder)
  }
}, 90_000)
