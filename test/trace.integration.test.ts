import {expect, test} from 'bun:test'
import {tmpdir} from 'node:os'
import {brotliDecompressSync} from 'node:zlib'

import {join} from 'forward-slash-path'
import fs from 'fs-extra'
import {unpack} from 'msgpackr'

import {BrowserSession} from '../src/browser/BrowserSession.ts'
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
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/coupled.ts'), 'trace', JSON.stringify(['about:blank', '--executable-file', executableFile!, '--trace', trace, '--buffer', '16000000', '--', '--headless=new'])], {
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
  } finally {
    await fs.remove(folder)
  }
}, 120_000)
