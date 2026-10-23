import makeCli from '../../src/makeCli.ts'

const mode = process.argv[2]
const options = JSON.parse(process.argv[3]) as Array<string>
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
  if (mode === 'trace' && String(args[0]).startsWith('Recording ')) {
    schedule()
  }
}
await makeCli(options)()
