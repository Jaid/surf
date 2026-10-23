import type {CDPSession} from 'puppeteer-core'

import {execFile} from 'node:child_process'
import {promisify} from 'node:util'

import fs from 'fs-extra'

import {readBrowserFlags} from './browserFlags.ts'

const execFileAsync = promisify(execFile)

export const userDataFromCommandLine = (commandLine: string) => {
  const match = /(?:^|\s)(?:"--user-data-dir=([^"]*)"|--user-data-dir="([^"]*)"|--user-data-dir=([^\s"]+))/i.exec(commandLine)
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

export const readBrowserMetadata = async (session: CDPSession, userDataDir?: string) => {
  let commandLine: string | undefined
  try {
    const {processInfo} = await session.send('SystemInfo.getProcessInfo')
    const pid = processInfo.find(process => process.type === 'browser')?.id
    if (!Number.isSafeInteger(pid) || !pid || pid < 1) {
      throw new Error('CDP returned no browser process.')
    }
    if (process.platform === 'win32') {
      const {stdout} = await execFileAsync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`], {
        windowsHide: true,
        timeout: 10_000,
      })
      commandLine = stdout.trim() || undefined
      userDataDir ??= commandLine ? userDataFromCommandLine(commandLine) : undefined
    } else if (process.platform === 'linux') {
      const cmdline = await fs.readFile(`/proc/${pid}/cmdline`, 'utf8')
      const args = cmdline.split('\0').filter(Boolean)
      commandLine = args.map(arg => JSON.stringify(arg)).join(' ')
      userDataDir ??= args.find(arg => arg.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length)
    }
  } catch (error) {
    console.error(`Browser command line unavailable: ${String(error)}`)
  }
  return {
    CommandLine: commandLine,
    BraveFlags: userDataDir ? await readBrowserFlags(userDataDir).catch(() => {}) : undefined,
  }
}
