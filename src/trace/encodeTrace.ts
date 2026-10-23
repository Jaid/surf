import {createReadStream} from 'node:fs'
import {createInterface} from 'node:readline'
import type {Readable} from 'node:stream'

import fs from 'fs-extra'
import {Packr} from 'msgpackr'

const traceEventsPrefixPattern = /^\s*\{\s*"traceEvents"\s*:\s*\[/
const messagePack = new Packr({
  useRecords: false,
  variableMapSize: true,
})
export type BrowserConsoleEvent = {
  // Optional when encoding legacy console records. New recordings always include it.
  cat?: 'surf.console'
  method: 'Log.entryAdded' | 'Runtime.consoleAPICalled' | 'Runtime.exceptionThrown'
  params: unknown
  sessionId?: string
}
const findJsonValueEnd = (json: string) => {
  const first = json[0]
  if (first !== '{' && first !== '[') {
    return -1
  }
  const stack = [first]
  let inString = false
  let escaped = false
  for (let index = 1; index < json.length; index++) {
    const character = json[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (character === '\\') {
        escaped = true
      } else if (character === '"') {
        inString = false
      }
      continue
    }
    if (character === '"') {
      inString = true
    } else if (character === '{' || character === '[') {
      stack.push(character)
    } else if (character === '}' || character === ']') {
      const opener = stack.pop()
      if (character === '}' && opener !== '{' || character === ']' && opener !== '[') {
        return -1
      }
      if (!stack.length) {
        return index + 1
      }
    }
  }
  return -1
}
export async function encodeTraceJsonAsMessagePack(input: Readable | string, output: string, consoleEvents: ReadonlyArray<BrowserConsoleEvent> = [], metadataAdditions: Readonly<Record<string, unknown>> = {}, {allowMissingFooter = false}: {allowMissingFooter?: boolean} = {}) {
  await using sink = await fs.promises.open(output, 'w')
  const source = typeof input === 'string' ? createReadStream(input, {encoding: 'utf8'}) : input
  const lines = createInterface({
    input: source,
    crlfDelay: Infinity,
  })
  let position = 0
  let bufferedBytes = 0
  let buffers: Array<Uint8Array> = []
  const flush = async () => {
    if (!bufferedBytes) {
      return
    }
    const data = Buffer.concat(buffers, bufferedBytes)
    let offset = 0
    while (offset < data.length) {
      const {bytesWritten} = await sink.write(data.subarray(offset))
      if (!bytesWritten) {
        throw new Error('Trace output write made no progress.')
      }
      offset += bytesWritten
    }
    buffers = []
    bufferedBytes = 0
  }
  const write = async (data: Uint8Array) => {
    buffers.push(data)
    bufferedBytes += data.byteLength
    position += data.byteLength
    if (bufferedBytes >= 4 * 1024 * 1024) {
      await flush()
    }
  }
  let eventCount = 0
  let mapCount = 1
  let sawHeader = false
  let sawFooter = false
  const footerLines: Array<string> = []
  let mapCountOffset = 0
  let eventCountOffset = 0
  try {
    mapCountOffset = position + 1
    await write(Uint8Array.of(0xDF, 0, 0, 0, 0))
    await write(messagePack.pack('traceEvents'))
    eventCountOffset = position + 1
    await write(Uint8Array.of(0xDD, 0, 0, 0, 0))
    const writeEvent = async (json: string) => {
      await write(messagePack.pack(JSON.parse(json) as unknown))
      eventCount++
    }
    for await (let line of lines) {
      if (!sawHeader) {
        const header = traceEventsPrefixPattern.exec(line)
        if (header) {
          line = line.slice(header[0].length)
        } else if (!line.trim()) {
          continue
        } else {
          throw new Error(`Unexpected Chromium trace JSON header: ${JSON.stringify(line.slice(0, 200))}`)
        }
        sawHeader = true
      }
      if (sawFooter) {
        footerLines.push(line)
        continue
      }
      let json = line.trim()
      while (json) {
        if (json.startsWith(',')) {
          json = json.slice(1).trimStart()
          if (!json) {
            break
          }
        }
        if (json.startsWith(']')) {
          sawFooter = true
          footerLines.push(json)
          break
        }
        const eventEnd = findJsonValueEnd(json)
        if (eventEnd === -1) {
          throw new Error(`Unexpected multiline Chromium trace event: ${JSON.stringify(json.slice(0, 200))}`)
        }
        await writeEvent(json.slice(0, eventEnd))
        json = json.slice(eventEnd).trim()
        if (json && !json.startsWith(',') && !json.startsWith(']')) {
          throw new Error('Missing separator after Chromium trace event.')
        }
      }
    }
    if (!sawFooter && !allowMissingFooter) {
      throw new Error('Chromium trace JSON ended before the traceEvents array closed.')
    }
    let extraFields: Record<string, unknown> = {}
    if (sawFooter) {
      const footer = footerLines.join('\n').trim()
      if (!footer.startsWith(']')) {
        throw new Error('Unexpected Chromium trace JSON footer.')
      }
      const objectTail = footer.slice(1).trim()
      if (objectTail !== '}') {
        if (!objectTail.startsWith(',')) {
          throw new Error('Unexpected Chromium trace JSON footer.')
        }
        extraFields = JSON.parse(`{${objectTail.slice(1)}`) as Record<string, unknown>
      }
    } else {
      console.error(`Chromium trace stream ended after ${eventCount.toLocaleString()} complete events without a JSON footer; saving the recoverable trace.`)
    }
    const definedMetadataAdditions = Object.fromEntries(Object.entries<unknown>({
      ...metadataAdditions,
      ...sawFooter ? {} : {TraceJsonFooterMissing: true},
    }).filter(([, value]) => value !== undefined))
    if (Object.keys(definedMetadataAdditions).length) {
      const metadata = extraFields.metadata
      const existingMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}
      extraFields.metadata = {
        ...existingMetadata,
        ...definedMetadataAdditions,
      }
    }
    for (const [key, value] of Object.entries(extraFields)) {
      await write(messagePack.pack(key))
      await write(messagePack.pack(value))
      mapCount++
    }
    await write(messagePack.pack('consoleEvents'))
    const consoleEventHeader = Buffer.allocUnsafe(5)
    consoleEventHeader[0] = 0xDD
    consoleEventHeader.writeUInt32BE(consoleEvents.length, 1)
    await write(consoleEventHeader)
    for (const consoleEvent of consoleEvents) {
      await write(messagePack.pack(consoleEvent))
    }
    mapCount++
    await flush()
  } finally {
    lines.close()
    source.destroy()
  }
  const count = Buffer.allocUnsafe(4)
  count.writeUInt32BE(mapCount)
  const mapWrite = await sink.write(count, 0, count.byteLength, mapCountOffset)
  if (mapWrite.bytesWritten !== count.byteLength) {
    throw new Error('Could not finish the MessagePack map header.')
  }
  count.writeUInt32BE(eventCount)
  const eventWrite = await sink.write(count, 0, count.byteLength, eventCountOffset)
  if (eventWrite.bytesWritten !== count.byteLength) {
    throw new Error('Could not finish the MessagePack event header.')
  }
  return eventCount
}
