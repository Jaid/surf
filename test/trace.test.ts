import {beforeAll, expect, test} from 'bun:test'
import {resolve} from 'node:path'
import {Readable} from 'node:stream'
import {createGunzip, gzipSync} from 'node:zlib'

import fs from 'fs-extra'
import {unpack} from 'msgpackr'

import {readBrowserFlags} from '../src/trace/browserFlags.ts'
import {encodeTraceJsonAsMessagePack} from '../src/trace/encodeTrace.ts'

// temp/ is gitignored, so a fresh checkout doesn’t have it yet
beforeAll(() => fs.ensureDir(resolve(import.meta.dir, '../temp')))
test('reads persisted browser flag selections and custom values', async () => {
  const root = await fs.mkdtemp(resolve(import.meta.dir, '../temp/browser-flags-test-'))
  try {
    await fs.writeJson(resolve(root, 'Local State'), {
      browser: {
        enabled_labs_experiments: ['enable-gpu-rasterization', 'some-choice@2', 123],
        enabled_labs_experiments_origin_lists: {
          'origin-list-flag': 'https://example.com,https://example.org',
          ignored: 123,
        },
      },
    })
    expect(await readBrowserFlags(root)).toEqual({
      customValues: {
        'origin-list-flag': 'https://example.com,https://example.org',
      },
      entries: ['enable-gpu-rasterization', 'some-choice@2'],
    })
  } finally {
    await fs.remove(root)
  }
})
test('encodes Chromium compact metadata footers without mistaking event metadata for the footer', async () => {
  const root = await fs.mkdtemp(resolve(import.meta.dir, '../temp/browser-trace-test-'))
  const input = resolve(root, 'trace.json')
  const output = resolve(root, 'trace.msgpack')
  try {
    await fs.writeFile(input, '{"traceEvents":[{"name":"first","args":{"items":[],"metadata":{"nested":true}}},\n{"name":"second","args":{}}],"metadata":{"clock-domain":"MONOTONIC","perfetto_trace_stats":{"total_buffers":1}}}')
    const consoleEvents = [{
      method: 'Runtime.consoleAPICalled' as const,
      params: {
        type: 'error',
        args: [{
          type: 'string',
          value: 'boom',
        }],
        timestamp: 1234,
      },
      sessionId: 'page-session',
    }]
    const eventCount = await encodeTraceJsonAsMessagePack(input, output, consoleEvents, {
      Browser: 'Chrome/153.0.8010.37',
      BraveFlags: {
        customValues: {'origin-list-flag': 'https://example.com'},
        entries: ['enable-gpu-rasterization'],
      },
      CommandLine: String.raw`"C:\portable\brave\brave.exe" --remote-debugging-port=9222`,
      'V8-Version': '15.3.76.10',
    })
    expect(eventCount).toBe(2)
    expect(unpack(await fs.readFile(output))).toEqual({
      traceEvents: [
        {
          name: 'first',
          args: {
            items: [],
            metadata: {nested: true},
          },
        },
        {
          name: 'second',
          args: {},
        },
      ],
      metadata: {
        'clock-domain': 'MONOTONIC',
        perfetto_trace_stats: {total_buffers: 1},
        Browser: 'Chrome/153.0.8010.37',
        BraveFlags: {
          customValues: {'origin-list-flag': 'https://example.com'},
          entries: ['enable-gpu-rasterization'],
        },
        CommandLine: String.raw`"C:\portable\brave\brave.exe" --remote-debugging-port=9222`,
        'V8-Version': '15.3.76.10',
      },
      consoleEvents,
    })
  } finally {
    await fs.remove(root)
  }
})
test('accepts Chromium footers without metadata and preserves extra top-level fields', async () => {
  const root = await fs.mkdtemp(resolve(import.meta.dir, '../temp/browser-trace-footer-test-'))
  const input = resolve(root, 'trace.json')
  const output = resolve(root, 'trace.msgpack')
  try {
    await fs.writeFile(input, '{"traceEvents":[{"name":"final","args":{"nested":[1,{"closingBracket":"]"}]}}],"systemTraceEvents":{"source":"etw"}}')
    expect(await encodeTraceJsonAsMessagePack(input, output)).toBe(1)
    expect(unpack(await fs.readFile(output))).toEqual({
      traceEvents: [{
        name: 'final',
        args: {
          nested: [1, {closingBracket: ']'}],
        },
      }],
      systemTraceEvents: {source: 'etw'},
      consoleEvents: [],
    })
  } finally {
    await fs.remove(root)
  }
})
test('encodes traceconv JSON with a metadata footer after the last event line', async () => {
  const root = await fs.mkdtemp(resolve(import.meta.dir, '../temp/browser-trace-traceconv-test-'))
  const input = resolve(root, 'trace.json')
  const output = resolve(root, 'trace.msgpack')
  try {
    await fs.writeFile(input, '{"traceEvents":[\n{"args":{"name":"CrBrowserMain"},"cat":"__metadata","name":"thread_name","ph":"M","pid":1,"tid":2,"ts":0},\n{"ph":"e","pid":1,"tid":2,"ts":3}],"metadata":\n{"clock-domain":"WIN_QPC"},\n"androidProcessDump": "PROCESS DUMP\\nroot 1",\n  "controllerTraceDataKey": "systraceController"\n}')
    expect(await encodeTraceJsonAsMessagePack(input, output, [], {TraceStreamFormat: 'proto'})).toBe(2)
    expect(unpack(await fs.readFile(output))).toEqual({
      traceEvents: [
        {
          args: {name: 'CrBrowserMain'},
          cat: '__metadata',
          name: 'thread_name',
          ph: 'M',
          pid: 1,
          tid: 2,
          ts: 0,
        },
        {
          ph: 'e',
          pid: 1,
          tid: 2,
          ts: 3,
        },
      ],
      metadata: {
        'clock-domain': 'WIN_QPC',
        TraceStreamFormat: 'proto',
      },
      androidProcessDump: 'PROCESS DUMP\nroot 1',
      controllerTraceDataKey: 'systraceController',
      consoleEvents: [],
    })
  } finally {
    await fs.remove(root)
  }
})
test('encodes a gzip Chromium trace stream across chunk boundaries', async () => {
  const root = await fs.mkdtemp(resolve(import.meta.dir, '../temp/browser-trace-gzip-test-'))
  const output = resolve(root, 'trace.msgpack')
  const json = '{"traceEvents":[{"name":"streamed","args":{}}],"metadata":{"clock-domain":"MONOTONIC"}}'
  try {
    const compressed = gzipSync(json)
    const gunzip = createGunzip()
    const encoding = encodeTraceJsonAsMessagePack(gunzip, output)
    const split = Math.floor(compressed.length / 2)
    gunzip.write(compressed.subarray(0, split))
    gunzip.end(compressed.subarray(split))
    expect(await encoding).toBe(1)
    expect(unpack(await fs.readFile(output))).toEqual({
      traceEvents: [{
        name: 'streamed',
        args: {},
      }],
      metadata: {'clock-domain': 'MONOTONIC'},
      consoleEvents: [],
    })
  } finally {
    await fs.remove(root)
  }
})
test('recovers complete streamed trace events when Chromium omits the JSON footer', async () => {
  const root = await fs.mkdtemp(resolve(import.meta.dir, '../temp/browser-trace-recovery-test-'))
  const output = resolve(root, 'trace.msgpack')
  try {
    const gunzip = createGunzip()
    const encoding = encodeTraceJsonAsMessagePack(gunzip, output, [], {
      Browser: 'Chrome/153.0.8010.37',
    }, {allowMissingFooter: true})
    gunzip.end(gzipSync('{"traceEvents":[{"name":"first"},\n{"name":"last-complete"}'))
    expect(await encoding).toBe(2)
    expect(unpack(await fs.readFile(output))).toEqual({
      traceEvents: [
        {name: 'first'},
        {name: 'last-complete'},
      ],
      metadata: {
        Browser: 'Chrome/153.0.8010.37',
        TraceJsonFooterMissing: true,
      },
      consoleEvents: [],
    })
  } finally {
    await fs.remove(root)
  }
})
test('still rejects a missing Chromium trace footer by default', async () => {
  const root = await fs.mkdtemp(resolve(import.meta.dir, '../temp/browser-trace-strict-footer-test-'))
  const input = resolve(root, 'trace.json')
  const output = resolve(root, 'trace.msgpack')
  try {
    await fs.writeFile(input, '{"traceEvents":[{"name":"complete"}')
    await expect(encodeTraceJsonAsMessagePack(input, output)).rejects.toThrow('Chromium trace JSON ended before the traceEvents array closed.')
  } finally {
    await fs.remove(root)
  }
})
test('supports compact events and rejects missing event separators', async () => {
  const root = await fs.mkdtemp(resolve(import.meta.dir, '../temp/browser-trace-compact-test-'))
  const input = resolve(root, 'trace.json')
  const output = resolve(root, 'trace.msgpack')
  try {
    await fs.writeFile(input, '{"traceEvents":[{"name":"first"},{"name":"second"}]}')
    expect(await encodeTraceJsonAsMessagePack(input, output)).toBe(2)
    await fs.writeFile(input, '{"traceEvents":[{"name":"first"}{"name":"second"}]}')
    await expect(encodeTraceJsonAsMessagePack(input, output)).rejects.toThrow('separator')
    await expect(encodeTraceJsonAsMessagePack(input, resolve(root, 'missing/output'))).rejects.toThrow()
  } finally {
    await fs.remove(root)
  }
})
function *bufferedTraceLines() {
  yield '{"traceEvents":[\n'
  for (let index = 0; index < 10_000; index++) {
    yield JSON.stringify({
      name: String(index),
      args: {payload: 'x'.repeat(1024)},
    }) + (index < 9999 ? ',\n' : ']}')
  }
}
test('streams beyond the encoder buffer and patches counts correctly', async () => {
  const root = await fs.mkdtemp(resolve(import.meta.dir, '../temp/browser-trace-buffer-test-'))
  const output = resolve(root, 'trace.msgpack')
  try {
    expect(await encodeTraceJsonAsMessagePack(Readable.from(bufferedTraceLines()), output)).toBe(10_000)
    const result = unpack(await fs.readFile(output)) as {traceEvents: Array<{name: string}>}
    expect(result.traceEvents).toHaveLength(10_000)
    expect(result.traceEvents.at(-1)?.name).toBe('9999')
  } finally {
    await fs.remove(root)
  }
})
