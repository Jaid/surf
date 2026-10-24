import type {BrowserConsoleEvent, TraceSidecar} from '../src/trace/writeTracePair.ts'

import {afterAll, expect, test} from 'bun:test'
import {tmpdir} from 'node:os'
import {brotliDecompressSync} from 'node:zlib'

import {join} from 'forward-slash-path'
import fs from 'fs-extra'
import {unpack} from 'msgpackr'

import {TraceOutput, traceOutputPaths} from '../src/trace/TraceOutput.ts'
import {writeTracePair} from '../src/trace/writeTracePair.ts'

const folder = await fs.mkdtemp(join(tmpdir(), 'surf-pair-test-'))
afterAll(() => fs.remove(folder))
test('both recognized suffixes and a bare stem select the same pair', () => {
  const expected = {
    path: join(folder, 'same.msgpack.br'),
    perfettoPath: join(folder, 'same.pftrace.br'),
  }
  for (const suffix of ['', '.msgpack.br', '.pftrace.br', '.PFTRACE.BR']) {
    expect(traceOutputPaths(join(folder, `same${suffix}`))).toEqual(expected)
  }
})
test('streams byte-identical Perfetto with a versioned, integrity-linked sidecar', async () => {
  const root = await fs.mkdtemp(join(folder, 'success-'))
  await using output = await TraceOutput.create(join(root, 'trace.pftrace.br'))
  const proto = output.temporary('pftrace')
  const bytes = Buffer.from('native protobuf bytes\0'.repeat(200_000))
  await fs.writeFile(proto, bytes)
  const events: Array<BrowserConsoleEvent> = Array.from({length: 10_000}, (_, index) => ({
    cat: 'surf.console',
    method: 'Runtime.consoleAPICalled',
    params: {
      timestamp: index,
      message: 'example',
    },
  }))
  await writeTracePair(proto, output, events, {
    RecordingId: 'test',
    omitted: undefined,
  })
  expect(brotliDecompressSync(await fs.readFile(output.perfettoPath))).toEqual(bytes)
  const sidecar = unpack(brotliDecompressSync(await fs.readFile(output.path))) as TraceSidecar
  expect(sidecar).toEqual({
    formatVersion: 1,
    consoleEvents: events,
    metadata: {RecordingId: 'test'},
    perfetto: {
      file: 'trace.pftrace.br',
      compression: 'brotli',
      sha256: Bun.CryptoHasher.hash('sha256', bytes, 'hex'),
      uncompressedBytes: bytes.length,
    },
  })
  await output[Symbol.asyncDispose]()
  expect(await fs.readdir(root)).toEqual(['trace.msgpack.br', 'trace.pftrace.br'])
})
test('an orphaned Perfetto file blocks reservation through either name', async () => {
  const path = join(folder, 'orphan.pftrace.br')
  await fs.writeFile(path, 'keep')
  await expect(TraceOutput.create(path)).rejects.toThrow('overwrite')
  await expect(TraceOutput.create(traceOutputPaths(path).path)).rejects.toThrow('overwrite')
  expect(await fs.readFile(path, 'utf8')).toBe('keep')
  expect(await fs.pathExists(`${traceOutputPaths(path).path}.lock`)).toBe(false)
})
test('a competing Perfetto publication is never overwritten or removed', async () => {
  const root = await fs.mkdtemp(join(folder, 'competitor-'))
  await using output = await TraceOutput.create(join(root, 'trace'))
  const temporary = output.temporary('br')
  await fs.writeFile(temporary, 'new')
  await fs.writeFile(output.perfettoPath, 'keep')
  await expect(output.publish(temporary, temporary)).rejects.toThrow()
  await output[Symbol.asyncDispose]()
  expect(await fs.readFile(output.perfettoPath, 'utf8')).toBe('keep')
  expect(await fs.pathExists(output.path)).toBe(false)
  expect(await fs.readdir(root)).toEqual(['trace.pftrace.br'])
})
test('a failed sidecar publication rolls back the published Perfetto', async () => {
  const root = await fs.mkdtemp(join(folder, 'rollback-'))
  await using output = await TraceOutput.create(join(root, 'trace'))
  const temporary = output.temporary('br')
  await fs.writeFile(temporary, 'new')
  await expect(output.publish(temporary, join(root, 'missing'))).rejects.toThrow()
  expect(await fs.pathExists(output.perfettoPath)).toBe(false)
  await output[Symbol.asyncDispose]()
  expect(await fs.readdir(root)).toEqual([])
})
for (const mode of ['empty', 'missing', 'invalid-sidecar']) {
  test(`failed pair writing leaves no published output: ${mode}`, async () => {
    const root = await fs.mkdtemp(join(folder, 'failed-'))
    await using output = await TraceOutput.create(join(root, 'trace'))
    const proto = output.temporary('pftrace')
    if (mode !== 'missing') {
      await fs.writeFile(proto, mode === 'empty' ? '' : 'protobuf')
    }
    const metadata = mode === 'invalid-sidecar' ? Object.defineProperty({}, 'invalid', {
      enumerable: true,
      get() {
        throw new Error('Sidecar serialization failed')
      },
    }) : {}
    await expect(writeTracePair(proto, output, [], metadata)).rejects.toThrow()
    await output[Symbol.asyncDispose]()
    expect(await fs.readdir(root)).toEqual([])
  })
}
