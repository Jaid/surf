import type {LaunchOptions, ResolvedLaunchOptions} from './options.ts'

import fs from 'fs-extra'

import {spawnDetached} from '../process/spawnDetached.ts'
import {performanceArguments, resolveOptions} from './options.ts'
import {resolveExecutable} from './resolveExecutable.ts'

export type UnmanagedLaunchOptions = Omit<LaunchOptions, 'betterIcon' | 'cacheFolder' | 'timeout'>

export const resolveUnmanagedOptions = (input: UnmanagedLaunchOptions = {}) => {
  // Also reject incompatible options from JavaScript callers rather than ignoring them.
  const options = input as LaunchOptions
  if (options.betterIcon) {
    throw new Error('Unmanaged launches do not support --better-icon. Use a managed session instead.')
  }
  return resolveOptions(input)
}

export const unmanagedArguments = (options: ResolvedLaunchOptions, enableDebugging = false) => [
  '--new-window',
  ...options.userDataDir ? [`--user-data-dir=${options.userDataDir}`] : [],
  `--profile-directory=${options.profile}`,
  ...enableDebugging ? [`--remote-debugging-port=${options.port}`, '--remote-debugging-address=127.0.0.1'] : [],
  ...performanceArguments(options),
  ...options.args,
  ...options.kiosk ? ['--kiosk'] : [],
  options.app ? `--app=${options.url}` : options.url,
]

export type UnmanagedInfo = {
  executable: string
  mode: 'unmanaged'
  spawnedPid: number
  temporary: false
  url: string
  userDataDir?: string
}

/** Submit a launch request; Chromium may hand it off to an existing browser. */
export const launchUnmanaged = async (input: UnmanagedLaunchOptions = {}): Promise<UnmanagedInfo> => {
  const options = resolveUnmanagedOptions(input)
  const executable = await resolveExecutable(options.executableFile)
  if (options.userDataDir) {
    await fs.mkdir(options.userDataDir, {recursive: true})
  }
  const spawnedPid = await spawnDetached([executable, ...unmanagedArguments(options, input.port !== undefined)])
  return {
    mode: 'unmanaged',
    executable,
    spawnedPid,
    temporary: false,
    url: options.url,
    userDataDir: options.userDataDir,
  }
}
