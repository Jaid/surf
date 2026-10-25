export class TraceTitle {
  private active = false
  private disposed = false
  private fill = 0
  private hostname = ''
  private previous?: string
  private startedAt?: number
  private timer?: ReturnType<typeof setInterval>

  constructor(
    private readonly enabled = true,
    private readonly terminal: Pick<NodeJS.WriteStream, 'isTTY' | 'write'> = process.stderr,
  ) {}

  buffer(value: number) {
    if (Number.isFinite(value)) {
      this.fill = Math.min(1, Math.max(0, value))
      if (this.timer) {
        this.render()
      }
    }
  }

  saving() {
    clearInterval(this.timer)
    this.timer = undefined
    if (this.startedAt !== undefined) {
      this.render()
    }
  }

  start(url: string) {
    if (!this.enabled || !this.terminal.isTTY || this.disposed || this.startedAt !== undefined) {
      return
    }
    this.hostname = URL.parse(url)?.hostname ?? ''
    this.startedAt = performance.now()
    this.render()
    this.timer = setInterval(() => this.render(), 1000)
    this.timer.unref()
  }

  [Symbol.dispose]() {
    clearInterval(this.timer)
    this.timer = undefined
    if (this.active) {
      // Restore the title saved on the terminal's title stack.
      this.terminal.write('\u{1B}[23;2t')
      this.active = false
    }
    this.disposed = true
  }

  private elapsed() {
    const seconds = Math.floor((performance.now() - this.startedAt!) / 1000)
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  }

  private render() {
    this.update([`${(this.fill * 100).toFixed(1)}%`, this.elapsed(), this.hostname].filter(Boolean).join(' '))
  }

  private update(title: string) {
    if (!this.enabled || !this.terminal.isTTY || this.disposed || title === this.previous) {
      return
    }
    if (!this.active) {
      this.terminal.write('\u{1B}[22;2t')
      this.active = true
    }
    this.terminal.write(`\u{1B}]2;${title}\u{1B}\\`)
    this.previous = title
  }
}
