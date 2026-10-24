import {defineCommand} from '@clerc/core'

import {traceControlFlags} from './traceControlFlags.ts'
import {tracePresetFlag} from './tracePresetFlag.ts'

const mainCommand = defineCommand({
  name: '',
  description: 'Launch Chromium windows or managed browser sessions',
  parameters: ['[url]', '--', '[browser arguments...]'],
  flags: {
    url: {
      type: String,
      description: 'URL (alternative to the positional URL)',
    },
    executableFile: {
      type: String,
      short: 'e',
      description: 'Browser executable; otherwise BROWSER or auto-detection',
    },
    detached: {
      type: Boolean,
      short: 'd',
      default: false,
      description: 'Return after startup; a background worker owns cleanup',
    },
    unmanaged: {
      type: Boolean,
      default: false,
      description: 'Spawn and exit without a worker; uses the browser’s normal data directory unless specified',
    },
    app: {
      type: Boolean,
      default: false,
      description: 'Chromeless app window (--app), not fullscreen',
    },
    kiosk: {
      type: Boolean,
      default: false,
      description: 'Fullscreen kiosk window',
    },
    userDataDir: {
      type: String,
      short: 'u',
      description: 'Persistent data directory; omitted means temporary, or browser default with --unmanaged',
    },
    profile: {
      type: String,
      default: 'Default',
      description: 'Profile directory name within the user data directory',
    },
    performance: {
      type: Boolean,
      default: false,
      description: 'High-performance GPU/rasterization and foreground scheduling flags',
    },
    port: {
      type: Number,
      description: 'Loopback CDP port; managed default 0, unmanaged disabled unless supplied',
    },
    betterIcon: {
      type: Boolean,
      default: false,
      description: 'Theme-aware, high-resolution app icon (Windows, HTTP(S), --app)',
    },
    cacheFolder: {
      type: String,
      description: 'Cache for icons and detached session logs',
    },
    timeout: {
      type: Number,
      default: 30_000,
      description: 'Managed browser startup timeout in milliseconds',
    },
    trace: {
      type: String,
      description: 'Record a .pftrace.br + .msgpack.br pair; optional path/stem, otherwise tempy',
    },
    tracePreset: tracePresetFlag,
    ...traceControlFlags,
    exitAfterTrace: {
      type: Boolean,
      default: false,
      description: 'After saving the trace, close the owned browser and exit',
    },
    buffer: {
      type: Number,
      default: 4_000_000_000,
      description: 'Trace buffer size in bytes',
    },
    reload: {
      type: Boolean,
      default: false,
      description: 'Reload the page after tracing begins',
    },
    duration: {
      type: Number,
      description: 'Stop tracing after this many milliseconds',
    },
    dump: {
      type: Boolean,
      default: false,
      description: 'Print launch plan as JSON without launching or creating profiles',
    },
  },
// eslint-disable-next-line typescript/no-misused-promises
}, async context => {
  const {run} = await import('./main.ts')
  await run(context)
})

export default mainCommand
