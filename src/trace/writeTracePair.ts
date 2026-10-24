import type {TraceOutput} from './TraceOutput.ts'

import {createHash} from 'node:crypto'
import {createReadStream, createWriteStream} from 'node:fs'
import {Readable, Transform} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {constants, createBrotliCompress} from 'node:zlib'

import {basename} from 'forward-slash-path'
import {Packr} from 'msgpackr'

export type BrowserConsoleEvent = {
  cat: 'surf.console'
  method: 'Log.entryAdded' | 'Runtime.consoleAPICalled' | 'Runtime.exceptionThrown'
  params: unknown
}

export type TraceSidecar = {
  consoleEvents: Array<BrowserConsoleEvent>
  formatVersion: 1
  metadata: Record<string, unknown>
  perfetto: {
    compression: 'brotli'
    file: string
    sha256: string
    uncompressedBytes: number
  }
}

const compressor = () => createBrotliCompress({params: {[constants.BROTLI_PARAM_QUALITY]: 6}})

/** Compress both outputs concurrently, then publish the sidecar as the completion marker. */
export const writeTracePair = async (proto: string, output: TraceOutput, consoleEvents: ReadonlyArray<BrowserConsoleEvent>, metadata: Record<string, unknown>) => {
  const compressed = output.temporary('pftrace.br')
  const sidecar = output.temporary('msgpack.br')
  const hash = createHash('sha256')
  let bytes = 0
  const compression = pipeline(createReadStream(proto), new Transform({
    transform(chunk: Buffer, encoding, callback) {
      bytes += chunk.length
      hash.update(chunk)
      callback(null, chunk)
    },
  }), compressor(), createWriteStream(compressed)).then(() => {
    if (!bytes) {
      throw new Error('The browser returned an empty Perfetto trace.')
    }
    return {
      file: basename(output.perfettoPath),
      compression: 'brotli' as const,
      sha256: hash.digest('hex'),
      uncompressedBytes: bytes,
    }
  })
  // A sidecar write may fail before the generator reaches the compression promise.
  void compression.catch(() => {})
  async function *sidecarChunks() {
    const packer = new Packr({
      useRecords: false,
      variableMapSize: true,
    })
    yield Buffer.from([0x84]) // Four top-level fields.
    yield packer.pack('formatVersion')
    yield packer.pack(1)
    yield packer.pack('consoleEvents')
    const header = Buffer.allocUnsafe(5)
    header[0] = 0xDD
    header.writeUInt32BE(consoleEvents.length, 1)
    yield header
    for (const event of consoleEvents) {
      yield packer.pack(event)
    }
    yield packer.pack('metadata')
    yield packer.pack(Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== undefined)))
    yield packer.pack('perfetto')
    yield packer.pack(await compression)
  }
  // Wait for both writers even on failure before the caller removes partial files.
  const results = await Promise.allSettled([
    compression,
    pipeline(Readable.from(sidecarChunks()), compressor(), createWriteStream(sidecar)),
  ])
  for (const result of results) {
    if (result.status === 'rejected') {
      throw result.reason
    }
  }
  await output.publish(compressed, sidecar)
}
