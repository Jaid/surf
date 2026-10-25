import type {LaunchOptions} from './options.ts'

import {join} from 'forward-slash-path'
import fs from 'fs-extra'

import {StopRequest} from '../lib/StopRequest.ts'
import {spawnDetached} from '../process/spawnDetached.ts'
import {resolveOptions} from './options.ts'
import {resolveExecutable} from './resolveExecutable.ts'

export type DetachedInfo = {
  executable: string
  logFile: string
  pid: number
  temporary: boolean
  url: string
  userDataDir: string
  webSocketDebuggerUrl: string
}

export const launchDetached = async (input: LaunchOptions = {}): Promise<DetachedInfo> => {
  const options = resolveOptions(input)
  if (options.printLog.length) {
    throw new Error('--print-log requires a coupled browser.')
  }
  options.executableFile = await resolveExecutable(options.executableFile)
  const folder = join(options.cacheFolder, 'sessions', crypto.randomUUID())
  await fs.mkdir(folder, {recursive: true})
  const config = join(folder, 'options.json')
  const status = join(folder, 'status.json')
  await Bun.write(config, JSON.stringify(options))
  using stop = new StopRequest
  try {
    const command = [process.execPath, join(import.meta.dir, 'worker.ts'), folder]
    await spawnDetached(command)
    const deadline = Date.now() + options.timeout + 60_000
    while (Date.now() < deadline && stop.code === undefined) {
      if (await Bun.file(status).exists()) {
        const result = await Bun.file(status).json() as {
          error?: string
          info?: DetachedInfo
        }
        if (result.error) {
          throw new Error(result.error)
        }
        if (result.info) {
          return result.info
        }
      }
      await Bun.sleep(50)
    }
    throw new Error(stop.code !== undefined ? 'Detached launch cancelled.' : `Detached worker did not become ready. See ${join(folder, 'session.log')}`)
  } catch (error) {
    await Bun.write(join(folder, 'stop'), '')
    await fs.rm(config, {force: true})
    throw error
  }
}
