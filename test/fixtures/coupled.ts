import type {CDPSession} from 'puppeteer-core'

import {PassThrough} from 'node:stream'

import makeCli from '../../src/makeCli.ts'
import {TraceRecorder} from '../../src/trace/TraceRecorder.ts'

const mode = process.argv[2]
const options = JSON.parse(process.argv[3]) as Array<string>
if (mode.includes('manual') || mode.startsWith('series')) {
  const input = new PassThrough
  Object.defineProperty(input, 'isTTY', {value: true})
  Object.defineProperty(process, 'stdin', {value: input})
}
let finalizing = 0
let saved = 0
if (mode.startsWith('series')) {
  // eslint-disable-next-line typescript/unbound-method
  const originalStart = TraceRecorder.prototype.start
  TraceRecorder.prototype.start = async function () {
    const result = await originalStart.call(this)
    const session = (this as unknown as {session: CDPSession}).session
    const send = session.send.bind(session)
    session.send = async (...args: Parameters<CDPSession['send']>) => {
      if (args[0] === 'IO.read') {
        await Bun.sleep(500)
      }
      return send(...args)
    }
    return result
  }
}
const originalLog = console.log
const originalError = console.error
let scheduled = false
const schedule = () => {
  if (!scheduled) {
    scheduled = true
    setTimeout(() => process.emit('SIGINT'), 200)
  }
}
console.log = (...args: Array<unknown>) => {
  originalLog(...args)
  if (mode === 'launch') {
    schedule()
  }
}
console.error = (...args: Array<unknown>) => {
  originalError(...args)
  const message = String(args[0])
  if (mode.startsWith('series')) {
    if (message.startsWith('Recording ')) {
      if (mode !== 'series-duration') {
        setTimeout(() => process.stdin.emit('data', Buffer.from('\n')), 50)
      }
    }
    if (message.startsWith('Finalizing trace')) {
      finalizing++
      if (finalizing === 1 && mode !== 'series-idle') {
        // Queue during finalization; repeated Enters must not create extra traces.
        process.stdin.emit('data', Buffer.from('\n'))
        process.stdin.emit('data', Buffer.from('\n'))
        if (mode === 'series-cancel') {
          process.emit('SIGINT')
        }
      }
    }
    if (message.startsWith('Saved ')) {
      saved++
      if (mode === 'series-idle' && saved === 1) {
        process.stdin.emit('data', Buffer.from('\n'))
      } else if (saved === 2 || mode === 'series-cancel') {
        process.emit('SIGINT')
      }
    }
  }
  if (message.startsWith('Press Enter to start')) {
    if (mode === 'manual') {
      setTimeout(() => process.stdin.emit('data', Buffer.from('\n')), 20)
    } else if (mode === 'cancel-manual') {
      schedule()
    }
  }
  if (mode === 'cancel-delay' && message.startsWith('Waiting ')) {
    schedule()
  }
  if (mode === 'trace' && String(args[0]).startsWith('Recording ')) {
    schedule()
  }
}
await makeCli(options)()
