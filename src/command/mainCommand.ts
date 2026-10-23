import {defineCommand} from '@clerc/core'

const mainCommand = defineCommand({
  name: '',
  description: 'Launch a dedicated Chromium browser session',
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
      description: 'Existing or new persistent user data directory; omitted means temporary',
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
      default: 0,
      description: 'Loopback CDP port; 0 chooses a free port',
    },
    betterIcon: {
      type: Boolean,
      default: false,
      description: 'Theme-aware, high-resolution app icon (Windows, HTTP(S), --app)',
    },
    cacheFolder: {
      type: String,
      description: 'Cache for icons, traceconv, and detached session logs',
    },
    timeout: {
      type: Number,
      default: 30_000,
      description: 'Browser startup timeout in milliseconds',
    },
    trace: {
      type: String,
      description: 'Record to this .msgpack.br file; Enter saves, Ctrl+C saves and closes',
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
