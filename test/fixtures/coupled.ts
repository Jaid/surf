import {PassThrough} from 'node:stream'

import makeCli from '../../src/makeCli.ts'

const mode = process.argv[2]
const options = JSON.parse(process.argv[3]) as Array<string>
if (mode.includes('manual')) {
  const input = new PassThrough
  Object.defineProperty(input, 'isTTY', {value: true})
  Object.defineProperty(process, 'stdin', {value: input})
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
