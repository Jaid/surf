import {expect, test} from 'bun:test'
import {tmpdir} from 'node:os'
import {brotliDecompressSync} from 'node:zlib'

import {join} from 'forward-slash-path'
import fs from 'fs-extra'
import {unpack} from 'msgpackr'

import {BrowserSession} from '../src/browser/BrowserSession.ts'
import {resolveTraceCategories} from '../src/trace/categories.ts'
import {recordBrowserTrace} from '../src/trace/recordBrowserTrace.ts'
import {TraceRecorder} from '../src/trace/TraceRecorder.ts'

const executableFile = Bun.env.SURF_TEST_BROWSER
const integration = test.skipIf(!executableFile)
integration('records and converts a real Perfetto trace with console events', async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), 'surf-trace-test-'))
  try {
    await using session = await BrowserSession.launch({
      executableFile,
      url: 'about:blank',
      args: ['--headless=new'],
    })
    const [page] = await session.browser.pages()
    const recorder = new TraceRecorder(session.browser, {
      output: join(folder, 'trace.msgpack.br'),
      buffer: 16_000_000,
    })
    await using recording = await recorder.start()
    await page.evaluate(() => console.log('surf trace test'))
    await Bun.sleep(100)
    const output = await recorder.stop()
    expect(await recorder.finished).toBe(output)
    expect(await recorder.stop()).toBe(output)
    const trace = unpack(brotliDecompressSync(await fs.readFile(output))) as {
      consoleEvents: Array<unknown>
      metadata: {TraceStreamFormat: string}
      traceEvents: Array<unknown>
    }
    expect(trace.traceEvents.length).toBeGreaterThan(0)
    expect(JSON.stringify(trace.consoleEvents)).toContain('surf trace test')
    expect(trace.metadata.TraceStreamFormat).toBe('proto')
    expect(await fs.readdir(folder)).toEqual(['trace.msgpack.br'])
    const duplicate = new TraceRecorder(session.browser, {output})
    await expect(duplicate.start()).rejects.toThrow('overwrite')
    expect(await fs.readdir(folder)).toEqual(['trace.msgpack.br'])
  } finally {
    await fs.remove(folder)
  }
}, 120_000)
integration('standalone timed recording disconnects without closing the browser', async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), 'surf-trace-attach-test-'))
  try {
    await using session = await BrowserSession.launch({
      executableFile,
      url: 'about:blank',
      args: ['--headless=new'],
    })
    const endpoint = new URL(session.info.webSocketDebuggerUrl)
    const port = Number(endpoint.port)
    const output = await recordBrowserTrace({
      port,
      duration: 100,
      output: join(folder, 'trace.msgpack.br'),
      buffer: 16_000_000,
    })
    expect(await Bun.file(output).exists()).toBe(true)
    expect(session.browser.connected).toBe(true)
  } finally {
    await fs.remove(folder)
  }
}, 120_000)
integration('closing a recording browser rejects promptly and removes partial outputs', async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), 'surf-trace-disconnect-test-'))
  try {
    await using session = await BrowserSession.launch({
      executableFile,
      url: 'about:blank',
      args: ['--headless=new'],
    })
    const recorder = new TraceRecorder(session.browser, {
      output: join(folder, 'trace.msgpack.br'),
      buffer: 16_000_000,
    })
    await recorder.start()
    await session.close()
    await expect(recorder.finished).rejects.toThrow('disconnected')
    await expect(recorder.stop()).rejects.toThrow()
    expect(await fs.readdir(folder)).toEqual([])
  } finally {
    await fs.remove(folder)
  }
}, 120_000)
integration('coupled CLI saves its trace before closing on interruption', async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), 'surf-trace-cli-test-'))
  try {
    const trace = join(folder, 'trace.msgpack.br')
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/coupled.ts'), 'trace', JSON.stringify(['about:blank', '--executable-file', executableFile!, '--trace', trace, '--trace-preset', 'webgpu_game', '--buffer', '16000000', '--', '--headless=new'])], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = new Response(child.stdout)
    const stderr = new Response(child.stderr)
    const [code, output, errors] = await Promise.all([child.exited, stdout.text(), stderr.text()])
    expect(errors).toContain('Saved ')
    expect(code).toBe(130)
    const info = JSON.parse(output) as {userDataDir: string}
    expect(await fs.pathExists(info.userDataDir)).toBe(false)
    expect(await Bun.file(trace).exists()).toBe(true)
    const saved = unpack(brotliDecompressSync(await fs.readFile(trace))) as {metadata: {TraceCategories: Array<string>}}
    expect(saved.metadata.TraceCategories).toEqual(resolveTraceCategories(['webgpu_game']))
  } finally {
    await fs.remove(folder)
  }
}, 120_000)
integration('network preset captures API requests and NetLog without the standard fallback', async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), 'surf-network-trace-test-'))
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      return url.pathname === '/api' ? Response.json({ok: true}) : new Response('<title>Network trace test</title>', {headers: {'content-type': 'text/html'}})
    },
  })
  try {
    await using session = await BrowserSession.launch({
      executableFile,
      url: server.url.href,
      args: ['--headless=new'],
    })
    const [page] = await session.browser.pages()
    const recorder = new TraceRecorder(session.browser, {
      tracePreset: ['network'],
      output: join(folder, 'network.msgpack.br'),
      buffer: 16_000_000,
    })
    await using recording = await recorder.start()
    expect(await page.evaluate(async () => {
      const response = await fetch('/api')
      return response.status
    })).toBe(200)
    const output = await recorder.stop()
    const trace = unpack(brotliDecompressSync(await fs.readFile(output))) as {
      metadata: {
        TraceCategories: Array<string>
        TracePresets: Array<string>
      }
      traceEvents: Array<{
        cat?: string
        name?: string
      }>
    }
    expect(trace.metadata.TracePresets).toEqual(['network'])
    expect(trace.metadata.TraceCategories).toEqual(resolveTraceCategories(['network']))
    expect(trace.metadata.TraceCategories).not.toContain('toplevel')
    expect(trace.traceEvents.some(event => event.cat?.split(',').includes('netlog'))).toBe(true)
  } finally {
    await server.stop(true)
    await fs.remove(folder)
  }
}, 120_000)
integration('attach CLI merges repeated trace presets', async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), 'surf-trace-preset-cli-test-'))
  try {
    await using session = await BrowserSession.launch({
      executableFile,
      url: 'about:blank',
      args: ['--headless=new'],
    })
    const endpoint = new URL(session.info.webSocketDebuggerUrl)
    const outputFile = join(folder, 'trace.msgpack.br')
    const child = Bun.spawn([
      process.execPath,
      join(import.meta.dir, '../src/main.ts'),
      'trace',
      '--port',
      endpoint.port,
      '--output',
      outputFile,
      '--duration',
      '100',
      '--buffer',
      '16000000',
      '--trace-preset',
      'network',
      '--trace-preset',
      'webgpu_game',
      '--trace-preset',
      'network',
    ], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
    })
    const stdout = new Response(child.stdout)
    const stderr = new Response(child.stderr)
    const [code, , errors] = await Promise.all([child.exited, stdout.text(), stderr.text()])
    expect(code).toBe(0)
    expect(errors).toContain('Saved ')
    const trace = unpack(brotliDecompressSync(await fs.readFile(outputFile))) as {
      metadata: {
        TraceCategories: Array<string>
        TracePresets: Array<string>
      }
    }
    expect(trace.metadata.TracePresets).toEqual(['network', 'webgpu_game'])
    expect(trace.metadata.TraceCategories).toEqual(resolveTraceCategories(['network', 'webgpu_game']))
    expect(session.browser.connected).toBe(true)
  } finally {
    await fs.remove(folder)
  }
}, 120_000)
