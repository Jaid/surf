import type {TraceSidecar} from '../src/trace/writeTracePair.ts'

import {expect, test} from 'bun:test'
import {tmpdir} from 'node:os'
import {brotliDecompressSync} from 'node:zlib'

import {join} from 'forward-slash-path'
import fs from 'fs-extra'
import {unpack} from 'msgpackr'

import {BrowserSession} from '../src/browser/BrowserSession.ts'
import {resolveTraceCategories, splitTraceCategories} from '../src/trace/categories.ts'
import {recordBrowserTrace} from '../src/trace/recordBrowserTrace.ts'
import {traceOutputPaths} from '../src/trace/TraceOutput.ts'
import {TraceRecorder} from '../src/trace/TraceRecorder.ts'
import {convertProtoTraceToJson, ensureTraceconv} from './fixtures/perfetto.ts'

const readPerfettoEvents = async (sidecarPath: string) => {
  const folder = await fs.mkdtemp(join(tmpdir(), 'surf-perfetto-validation-'))
  try {
    const sidecar = unpack(brotliDecompressSync(await fs.readFile(sidecarPath))) as TraceSidecar
    const bytes = brotliDecompressSync(await fs.readFile(traceOutputPaths(sidecarPath).perfettoPath))
    expect(sidecar.formatVersion).toBe(1)
    expect(sidecar.perfetto.uncompressedBytes).toBe(bytes.length)
    expect(sidecar.perfetto.sha256).toBe(Bun.CryptoHasher.hash('sha256', bytes, 'hex'))
    expect(sidecar.metadata.RecordingId).toBeString()
    const proto = join(folder, 'trace.pftrace')
    const json = join(folder, 'trace.json')
    await fs.writeFile(proto, bytes)
    const converter = await ensureTraceconv(join(tmpdir(), 'surf-test-traceconv'))
    await convertProtoTraceToJson(converter, proto, json)
    const converted = await fs.readJson(json) as {traceEvents: Array<{cat?: string}>}
    return converted.traceEvents
  } finally {
    await fs.remove(folder)
  }
}
const executableFile = Bun.env.SURF_TEST_BROWSER
const integration = test.skipIf(!executableFile)
integration('records a native Perfetto trace and a matching console sidecar', async () => {
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
      consoleEvents: Array<{cat?: string}>
      metadata: {
        ChromiumTraceCategories: Array<string>
        CommandLine?: string
        TraceCategories: Array<string>
        TraceStreamFormat: string
      }
      traceEvents: Array<unknown>
    }
    const events = await readPerfettoEvents(output)
    expect(events.length).toBeGreaterThan(0)
    expect(trace).not.toHaveProperty('traceEvents')
    expect(JSON.stringify(trace.consoleEvents)).toContain('surf trace test')
    expect(trace.metadata.TraceStreamFormat).toBe('proto')
    expect(trace.metadata.TraceCategories).toContain('surf.console')
    expect(trace.metadata.TraceCategories).toContain('surf.browser_metadata')
    expect(trace.metadata.ChromiumTraceCategories).toEqual(splitTraceCategories(resolveTraceCategories()).chromiumCategories)
    expect(trace.consoleEvents.every(event => event.cat === 'surf.console')).toBe(true)
    if (['linux', 'win32'].includes(process.platform)) {
      expect(trace.metadata.CommandLine).toBeString()
    }
    expect(await fs.readdir(folder)).toEqual(['trace.msgpack.br', 'trace.pftrace.br'])
    const duplicate = new TraceRecorder(session.browser, {output})
    await expect(duplicate.start()).rejects.toThrow('overwrite')
    expect(await fs.readdir(folder)).toEqual(['trace.msgpack.br', 'trace.pftrace.br'])
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
    expect(await Bun.file(output!).exists()).toBe(true)
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
    const events = await readPerfettoEvents(output)
    expect(events.some(event => event.cat?.split(',').includes('netlog'))).toBe(true)
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
integration('bare --trace saves to a tempy file and retains the recording after shutdown', async () => {
  let traceFile: string | undefined
  try {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/coupled.ts'), 'trace', JSON.stringify([
      '--url',
      'about:blank',
      '--executable-file',
      executableFile!,
      '--buffer',
      '16000000',
      '--trace-preset',
      'webgpu_game',
      '--trace',
      '--',
      '--headless=new',
    ])], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 90_000,
    })
    const stdout = new Response(child.stdout)
    const stderr = new Response(child.stderr)
    const [code, output, errors] = await Promise.all([child.exited, stdout.text(), stderr.text()])
    traceFile = /Recording [^\n]+ → ([^\n\r]+)/u.exec(errors)?.[1]
    expect(code).toBe(130)
    expect(traceFile).toBeDefined()
    expect(errors).toContain(`Saved ${traceFile}`)
    expect(traceFile!.startsWith(`${tmpdir().replaceAll('\\', '/')}/`)).toBe(true)
    expect(traceFile).toEndWith('.msgpack.br')
    const events = await readPerfettoEvents(traceFile!)
    expect(events.length).toBeGreaterThan(0)
    expect(await fs.pathExists(`${traceFile}.lock`)).toBe(false)
    const info = JSON.parse(output) as {userDataDir: string}
    expect(await fs.pathExists(info.userDataDir)).toBe(false)
  } finally {
    if (traceFile) {
      await fs.rm(traceFile, {force: true})
      await fs.rm(traceOutputPaths(traceFile).perfettoPath, {force: true})
    }
  }
}, 120_000)
for (const mode of ['delayed', 'manual', 'cancel-manual', 'cancel-delay']) {
  integration(`trace start lifecycle: ${mode}`, async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), 'surf-trace-start-'))
    try {
      const outputFile = join(folder, 'trace.msgpack.br')
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/coupled.ts'), mode, JSON.stringify([
        'about:blank',
        '--executable-file',
        executableFile!,
        '--trace',
        outputFile,
        '--buffer',
        '16000000',
        '--duration',
        '100',
        '--exit-after-trace',
        '--trace-exclude',
        'surf.console',
        '--trace-exclude',
        'surf.browser_metadata',
        '--trace-category',
        'netlog',
        ...mode.includes('manual') ? ['--trace-start', 'manual'] : [],
        '--trace-delay',
        mode === 'cancel-delay' ? '60000' : '100',
        '--',
        '--headless=new',
      ])], {
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 90_000,
      })
      const stdout = new Response(child.stdout)
      const stderr = new Response(child.stderr)
      const [code, output, errors] = await Promise.all([child.exited, stdout.text(), stderr.text()])
      const cancelled = mode.startsWith('cancel-')
      expect(code).toBe(cancelled ? 130 : 0)
      const info = JSON.parse(output) as {userDataDir: string}
      expect(await fs.pathExists(info.userDataDir)).toBe(false)
      if (cancelled) {
        expect(errors).not.toContain('Recording ')
        expect(await fs.readdir(folder)).toEqual([])
      } else {
        expect(errors).toContain('Waiting 100 ms')
        expect(errors).toContain('Saved ')
        const trace = unpack(brotliDecompressSync(await fs.readFile(outputFile))) as {
          consoleEvents: Array<unknown>
          metadata: {
            BraveFlags?: unknown
            CommandLine?: string
            TraceCategories: Array<string>
          }
        }
        expect(trace.consoleEvents).toEqual([])
        expect(trace.metadata.CommandLine).toBeUndefined()
        expect(trace.metadata.BraveFlags).toBeUndefined()
        expect(trace.metadata.TraceCategories).toContain('netlog')
        expect(trace.metadata.TraceCategories).not.toContain('surf.console')
      }
    } finally {
      await fs.remove(folder)
    }
  }, 120_000)
}
for (const mode of ['series-queued', 'series-idle', 'series-cancel', 'series-duration']) {
  integration(`Enter starts another recording: ${mode}`, async () => {
    const folder = await fs.mkdtemp(join(tmpdir(), 'surf-trace-series-'))
    try {
      const output = join(folder, 'trace.msgpack.br')
      // A pre-existing sibling must be skipped, not overwritten.
      await fs.writeFile(join(folder, 'trace2.pftrace.br'), 'existing')
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/coupled.ts'), mode, JSON.stringify([
        'about:blank',
        '--executable-file',
        executableFile!,
        '--trace',
        output,
        '--buffer',
        '16000000',
        ...mode === 'series-duration' ? ['--duration', '50'] : [],
        '--',
        '--headless=new',
      ])], {
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 90_000,
      })
      const stdoutResponse = new Response(child.stdout)
      const stderrResponse = new Response(child.stderr)
      const [code, stdout, stderr] = await Promise.all([child.exited, stdoutResponse.text(), stderrResponse.text()])
      expect(code).toBe(130)
      expect(stderr.match(/Recording /gu)).toHaveLength(mode === 'series-cancel' ? 1 : 2)
      expect(stderr.match(/Saved /gu)).toHaveLength(mode === 'series-cancel' ? 1 : 2)
      if (mode === 'series-queued') {
        const secondRecording = stderr.indexOf('Recording ', stderr.indexOf('Recording ') + 1)
        expect(secondRecording).toBeLessThan(stderr.indexOf('Saved '))
      }
      const first = unpack(brotliDecompressSync(await fs.readFile(output))) as TraceSidecar
      expect(first.metadata.RecordingId).toBeString()
      if (mode !== 'series-cancel') {
        const second = unpack(brotliDecompressSync(await fs.readFile(join(folder, 'trace3.msgpack.br')))) as TraceSidecar
        expect(second.metadata.RecordingId).not.toBe(first.metadata.RecordingId)
        expect(second.perfetto.file).toBe('trace3.pftrace.br')
      }
      expect(await fs.readFile(join(folder, 'trace2.pftrace.br'), 'utf8')).toBe('existing')
      const info = JSON.parse(stdout) as {userDataDir: string}
      expect(await fs.pathExists(info.userDataDir)).toBe(false)
      const files = await fs.readdir(folder)
      expect(files.some(file => /lock|partial/u.test(file))).toBe(false)
    } finally {
      await fs.remove(folder)
    }
  }, 120_000)
}
integration('attached CLI can queue a second recording without owning the browser', async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), 'surf-attach-series-'))
  try {
    await using session = await BrowserSession.launch({
      executableFile,
      url: 'about:blank',
      args: ['--headless=new'],
    })
    const endpoint = new URL(session.info.webSocketDebuggerUrl)
    const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/coupled.ts'), 'series-queued', JSON.stringify([
      'trace',
      '--port',
      endpoint.port,
      '--output',
      join(folder, 'trace.msgpack.br'),
      '--buffer',
      '16000000',
    ])], {
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 90_000,
    })
    const stdoutResponse = new Response(child.stdout)
    const stderrResponse = new Response(child.stderr)
    const [code, , stderr] = await Promise.all([child.exited, stdoutResponse.text(), stderrResponse.text()])
    expect(code).toBe(0)
    expect(stderr.match(/Saved /gu)).toHaveLength(2)
    expect(session.browser.connected).toBe(true)
    expect(await fs.readdir(folder)).toEqual(['trace.msgpack.br', 'trace.pftrace.br', 'trace2.msgpack.br', 'trace2.pftrace.br'])
  } finally {
    await fs.remove(folder)
  }
}, 120_000)
for (const exitAfterTrace of [false, true]) {
  integration(`repeated tempy recordings respect exit-after-trace=${exitAfterTrace}`, async () => {
    const files: Array<string> = []
    try {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/coupled.ts'), 'series-queued', JSON.stringify([
        'about:blank',
        '--executable-file',
        executableFile!,
        '--trace',
        '--buffer',
        '16000000',
        ...exitAfterTrace ? ['--exit-after-trace'] : [],
        '--',
        '--headless=new',
      ])], {
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 90_000,
      })
      const stdoutResponse = new Response(child.stdout)
      const stderrResponse = new Response(child.stderr)
      const [code, , stderr] = await Promise.all([child.exited, stdoutResponse.text(), stderrResponse.text()])
      for (const match of stderr.matchAll(/Recording [^\n]+ → ([^\n\r]+)/gu)) {
        files.push(match[1])
      }
      expect(code).toBe(exitAfterTrace ? 0 : 130)
      expect(files).toHaveLength(exitAfterTrace ? 1 : 2)
      const uniqueFiles = new Set(files)
      expect(uniqueFiles.size).toBe(files.length)
      for (const output of files) {
        expect(output.startsWith(`${tmpdir().replaceAll('\\', '/')}/`)).toBe(true)
        const events = await readPerfettoEvents(output)
        expect(events.length).toBeGreaterThan(0)
      }
    } finally {
      for (const output of files) {
        await fs.rm(output, {force: true})
        await fs.rm(traceOutputPaths(output).perfettoPath, {force: true})
      }
    }
  }, 120_000)
}
