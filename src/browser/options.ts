import {defaultCacheFolder, resolvePath} from '../lib/paths.ts'

export type LaunchOptions = {
  app?: boolean
  args?: Array<string>
  betterIcon?: boolean
  cacheFolder?: string
  executableFile?: string
  kiosk?: boolean
  performance?: boolean
  port?: number
  profile?: string
  timeout?: number
  url?: string
  userDataDir?: string
}

export const normalizeUrl = (input = 'https://google.com') => {
  const value = input.trim()
  if (!value || /[\u{0}-\u{1F}]/u.test(value)) {
    throw new Error('URL must be nonempty and contain no control characters.')
  }
  const hasScheme = /^[a-z][\d+\-.a-z]*:/i.test(value)
  const hostWithPort = /^(?:localhost|[^/:]+\.[^/:]+):\d+(?:[#/?]|$)/i.test(value)
  const localHost = /^(?:localhost|127\.\d+\.\d+\.\d+|\[::1\])(?::\d+)?(?:[#/?]|$)/i.test(value)
  const url = new URL(hasScheme && !hostWithPort ? value : `${localHost ? 'http' : 'https'}://${value}`)
  if (!['about:', 'brave:', 'chrome:', 'data:', 'edge:', 'file:', 'http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Unsupported browser URL protocol: ${url.protocol}`)
  }
  return url.href
}

export const integer = (value: number, name: string, min: number, max = Number.MAX_SAFE_INTEGER) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`)
  }
  return value
}

// These switches would invalidate ownership, window mode, or endpoint discovery.
const reservedArguments = /^(?:--?|\/)(?:user-data-dir|profile-directory|remote-debugging[^=]*|app|app-id|enable-background-mode|kiosk|new-window|no-startup-window|restore-last-session)(?:=|$)/i
export const resolveOptions = (options: LaunchOptions = {}) => {
  const url = normalizeUrl(options.url)
  const profile = options.profile ?? 'Default'
  if (!profile.trim() || profile !== profile.trim() || /[\u{0}-\u{1F}"*/:<>?\\|]/u.test(profile) || profile.endsWith('.')) {
    throw new Error('profile must be a directory name within the user data directory.')
  }
  if (options.app && options.kiosk) {
    throw new Error('Choose --app (chromeless window) or --kiosk (fullscreen), not both.')
  }
  if (options.betterIcon && (!options.app || process.platform !== 'win32' || !/^https?:/.test(url))) {
    throw new Error('--better-icon requires Windows, --app, and an HTTP(S) URL.')
  }
  const args = options.args ?? []
  for (const arg of args) {
    if (!arg.startsWith('--') || /[\u{0}-\u{1F}]/u.test(arg) || reservedArguments.test(arg)) {
      throw new Error(`Unsupported browser argument ${JSON.stringify(arg)}. Use Surf options for lifecycle, profile, and window settings.`)
    }
  }
  return {
    ...options,
    url,
    profile,
    app: options.app ?? false,
    kiosk: options.kiosk ?? false,
    performance: options.performance ?? false,
    betterIcon: options.betterIcon ?? false,
    port: integer(options.port ?? 0, 'port', 0, 65_535),
    timeout: integer(options.timeout ?? 30_000, 'timeout', 1, 2_147_483_647),
    args,
    userDataDir: options.userDataDir === undefined ? undefined : resolvePath(options.userDataDir),
    cacheFolder: resolvePath(options.cacheFolder ?? defaultCacheFolder()),
  }
}

export type ResolvedLaunchOptions = ReturnType<typeof resolveOptions>

export const performanceArguments = (options: ResolvedLaunchOptions) => (options.performance ? [
  '--force-high-performance-gpu',
  '--force-gpu-rasterization',
  '--enable-zero-copy',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
] : [])

export const browserArguments = (options: ResolvedLaunchOptions, userDataDir: string) => [
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-mode',
  '--new-window',
  `--user-data-dir=${userDataDir}`,
  `--profile-directory=${options.profile}`,
  `--remote-debugging-port=${options.port}`,
  '--remote-debugging-address=127.0.0.1',
  ...performanceArguments(options),
  ...options.args,
  ...options.kiosk ? ['--kiosk'] : [],
  options.app ? `--app=${options.url}` : options.url,
]
