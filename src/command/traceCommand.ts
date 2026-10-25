import {defineCommand} from '@clerc/core'

import {printLogFlag} from './printLogFlag.ts'
import {traceControlFlags} from './traceControlFlags.ts'
import {tracePresetFlag} from './tracePresetFlag.ts'

const traceCommand = defineCommand({
  name: 'trace',
  description: 'Record an existing browser through its loopback CDP endpoint',
  flags: {
    port: {
      type: Number,
      default: 9222,
      description: 'Browser CDP port',
    },
    output: {
      type: String,
      short: 'o',
      description: 'Output stem or .msgpack.br/.pftrace.br path; otherwise numbered trace pairs',
    },
    printLog: printLogFlag,
    tracePreset: tracePresetFlag,
    ...traceControlFlags,
    buffer: {
      type: Number,
      default: 4_000_000_000,
      description: 'Trace buffer size in bytes',
    },
    reload: {
      type: Boolean,
      default: false,
      description: 'Reload the selected page after tracing begins',
    },
    duration: {
      type: Number,
      description: 'Stop after this many milliseconds; otherwise Enter/Ctrl+C',
    },
    targetId: {
      type: String,
      description: 'Page target ID for console capture/reload; otherwise the first page',
    },
    userDataDir: {
      type: String,
      description: 'Read persisted experimental flags from this directory for metadata',
    },
  },
// eslint-disable-next-line typescript/no-misused-promises
}, async context => {
  if (context.rawParsed.parameters.length || context.rawParsed.doubleDash.length) {
    throw new Error('surf trace accepts flags only.')
  }
  const {recordBrowserTrace} = await import('../trace/recordBrowserTrace.ts')
  await recordBrowserTrace({
    ...context.flags,
    repeat: true,
  })
})

export default traceCommand
