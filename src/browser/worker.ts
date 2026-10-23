import type {LaunchOptions} from './options.ts'

import {join} from 'forward-slash-path'
import fs from 'fs-extra'

import {StopRequest} from '../lib/StopRequest.ts'
import {BrowserSession} from './BrowserSession.ts'

if (import.meta.main) {
  const folder = process.argv[2]
  if (!folder) {
    throw new Error('Missing Surf worker configuration directory.')
  }
  const logFile = join(folder, 'session.log')
  const log = (message: unknown) => {
    const timestamp = new Date
    return fs.appendFile(logFile, `${timestamp.toISOString()} ${String(message)}\n`)
  }
  const originalError = console.error
  let logging = Promise.resolve()
  console.error = (...messages: Array<unknown>) => {
    logging = logging.then(() => log(messages.join(' '))).catch(originalError)
  }
  const status = async (value: unknown) => {
    await Bun.write(join(folder, 'status.partial'), JSON.stringify(value))
    await fs.rename(join(folder, 'status.partial'), join(folder, 'status.json'))
  }
  using stop = new StopRequest
  const poll = setInterval(() => {
    void Bun.file(join(folder, 'stop')).exists().then(exists => {
      if (exists) {
        stop.stop()
      }
    }).catch(error => {
      console.error('Cancellation check failed:', error)
      stop.stop(1)
    })
  }, 250)
  try {
    const options = await Bun.file(join(folder, 'options.json')).json() as LaunchOptions
    await fs.rm(join(folder, 'options.json'), {force: true})
    await using session = await BrowserSession.launch(options)
    await status({info: {
      ...session.info,
      logFile,
    }})
    await log(`Browser ${session.pid} started; user data: ${session.userData.path}`)
    await Promise.race([session.exited, stop.promise])
  } catch (error) {
    await log(Error.isError(error) ? error.stack : error)
    await status({error: String(error)})
    process.exitCode = 1
  } finally {
    clearInterval(poll)
    await fs.rm(join(folder, 'stop'), {force: true})
    await logging
    await log('Session finished.')
  }
}
