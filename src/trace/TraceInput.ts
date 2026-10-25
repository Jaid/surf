export class TraceInput {
  private afterCarriageReturn = false
  private readonly ended = Promise.withResolvers<void>()
  private enter = Promise.withResolvers<void>()
  private readonly onData = (data: Buffer) => {
    for (const byte of data) {
      if (byte === 13 || byte === 10 && !this.afterCarriageReturn) {
        this.request()
      }
      this.afterCarriageReturn = byte === 13
    }
  }
  private readonly onEnd = () => this.ended.resolve()
  private readonly onError = (error: Error) => this.ended.reject(error)
  private readonly wasPaused: boolean

  constructor(readonly input: NodeJS.ReadStream = process.stdin) {
    this.wasPaused = input.readableFlowing !== true
    void this.ended.promise.catch(() => {})
    if (input.isTTY) {
      input.on('data', this.onData)
      input.on('end', this.onEnd)
      input.on('error', this.onError)
      if (input.readableEnded || input.destroyed) {
        this.onEnd()
      }
      input.resume()
    }
  }

  request() {
    this.enter.resolve()
  }

  [Symbol.dispose]() {
    this.input.off('data', this.onData)
    this.input.off('end', this.onEnd)
    this.input.off('error', this.onError)
    if (this.input.isTTY && this.wasPaused) {
      this.input.pause()
    }
  }

  async wait<T>(other: Promise<T>) {
    const result = await Promise.race([
      other.then(value => ({
        kind: 'other' as const,
        value,
      })),
      this.ended.promise.then(() => ({kind: 'end' as const})),
      this.enter.promise.then(() => ({kind: 'enter' as const})),
    ])
    if (result.kind === 'enter') {
      this.enter = Promise.withResolvers<void>()
    }
    return result
  }
}
