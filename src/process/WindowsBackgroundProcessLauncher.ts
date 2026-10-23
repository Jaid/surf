import {dlopen} from 'bun:ffi'

import {quoteWindowsArgument} from './commandLine.ts'
import {toWideString} from './text.ts'

const CREATE_NEW_PROCESS_GROUP = 0x00_00_02_00
const CREATE_UNICODE_ENVIRONMENT = 0x00_00_04_00
const CREATE_BREAKAWAY_FROM_JOB = 0x01_00_00_00
const CREATE_NO_WINDOW = 0x08_00_00_00
const STARTUP_INFO_SIZE = 104
const PROCESS_INFORMATION_SIZE = 24

type SpawnOptions = {
  cwd?: string
  env?: Record<string, string | undefined>
}

const loadKernel32 = () => dlopen('kernel32.dll', {
  CloseHandle: {
    args: ['u64'],
    returns: 'i32',
  },
  CreateProcessW: {
    args: ['ptr', 'ptr', 'ptr', 'ptr', 'i32', 'u32', 'ptr', 'ptr', 'ptr', 'ptr'],
    returns: 'i32',
  },
  GetLastError: {returns: 'u32'},
}).symbols
const toEnvironmentBlock = (env: Record<string, string | undefined>) => {
  const entries = Object.entries(env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .toSorted(([left], [right]) => left.toLowerCase().localeCompare(right.toLowerCase()))
  return toWideString(`${entries.map(([key, value]) => `${key}=${value}`).join('\0')}\0`)
}

export class WindowsBackgroundProcessLauncher {
  readonly #kernel32 = loadKernel32()

  spawn(command: Array<string>, options: SpawnOptions = {}) {
    if (!command.length) {
      throw new Error('Cannot spawn an empty command.')
    }
    const pathValue = Object.entries(options.env ?? {}).find(([key]) => key.toLowerCase() === 'path')?.[1]
    const executable = Bun.which(command[0], {
      PATH: pathValue,
      cwd: options.cwd,
    }) ?? command[0]
    const resolvedCommand = [executable, ...command.slice(1)]
    const applicationName = toWideString(executable)
    const commandLine = toWideString(resolvedCommand.map(quoteWindowsArgument).join(' '))
    const environment = options.env ? toEnvironmentBlock(options.env) : null
    const cwd = options.cwd ? toWideString(options.cwd) : null
    const startupInfo = new Uint8Array(STARTUP_INFO_SIZE)
    const startupView = new DataView(startupInfo.buffer)
    startupView.setUint32(0, STARTUP_INFO_SIZE, true)
    const processInformation = new Uint8Array(PROCESS_INFORMATION_SIZE)
    const created = this.#kernel32.CreateProcessW(applicationName, commandLine, null, null, 0, CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT | CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW, environment, cwd, startupInfo, processInformation)
    if (!created) {
      throw new Error(`CreateProcessW failed with Windows error ${this.getLastError()} for ${JSON.stringify(command)}.`)
    }
    const information = new DataView(processInformation.buffer)
    const processHandle = information.getBigUint64(0, true)
    const threadHandle = information.getBigUint64(8, true)
    const pid = information.getUint32(16, true)
    this.#kernel32.CloseHandle(threadHandle)
    this.#kernel32.CloseHandle(processHandle)
    return pid
  }

  private getLastError() {
    const getLastError = this.#kernel32.GetLastError
    return getLastError()
  }
}
