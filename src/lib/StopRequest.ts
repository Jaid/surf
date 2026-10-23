export class StopRequest {
  code?: number
  readonly promise: Promise<number>
  readonly stop: (code?: number) => void
  private readonly onHangup = () => this.stop(129)
  private readonly onInput = (data: Buffer) => {
    if (data.includes(10) || data.includes(13)) {
      this.stop(0)
    }
  }
  private readonly onInterrupt = () => this.stop(130)
  private readonly onTerminate = () => this.stop(143)

  constructor(readonly interactive = false) {
    const {promise, resolve} = Promise.withResolvers<number>()
    this.promise = promise
    this.stop = (code = 0) => {
      this.code ??= code
      resolve(code)
    }
    process.on('SIGINT', this.onInterrupt)
    process.on('SIGTERM', this.onTerminate)
    process.on('SIGHUP', this.onHangup)
    if (interactive && process.stdin.isTTY) {
      process.stdin.on('data', this.onInput)
      process.stdin.resume()
    }
  }

  [Symbol.dispose]() {
    process.off('SIGINT', this.onInterrupt)
    process.off('SIGTERM', this.onTerminate)
    process.off('SIGHUP', this.onHangup)
    if (this.interactive && process.stdin.isTTY) {
      process.stdin.off('data', this.onInput)
      process.stdin.pause()
    }
  }
}
