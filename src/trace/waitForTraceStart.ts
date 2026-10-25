import {integer} from '../browser/options.ts'

export type TraceStartOptions = {
  traceDelay?: number
  traceStart?: 'immediate' | 'manual'
}

export const parseTraceStart = (value: string): 'immediate' | 'manual' => {
  if (value !== 'immediate' && value !== 'manual') {
    throw new Error('--trace-start must be immediate or manual.')
  }
  return value
}

export const validateTraceStart = (options: TraceStartOptions) => {
  if (options.traceStart !== undefined) {
    parseTraceStart(options.traceStart)
  }
  integer(options.traceDelay ?? 0, 'trace-delay', 0, 2_147_483_647)
}

export const requireTraceInput = (options: TraceStartOptions, input: NodeJS.ReadStream = process.stdin) => {
  if (options.traceStart === 'manual' && !input.isTTY) {
    throw new Error('--trace-start manual requires an interactive terminal.')
  }
}

/** Returns an interruption exit code, or undefined when recording may begin. */
export const waitForTraceStart = async (
  options: TraceStartOptions,
  interrupted: Promise<number>,
  input: NodeJS.ReadStream = process.stdin,
): Promise<number | undefined> => {
  validateTraceStart(options)
  requireTraceInput(options, input)
  if (options.traceStart === 'manual') {
    const ready = Promise.withResolvers<undefined>()
    const onInput = (data: Buffer) => {
      if (data.includes(10) || data.includes(13)) {
        ready.resolve(undefined)
      }
    }
    const onEnd = () => ready.reject(new Error('Terminal input closed before trace recording started.'))
    const wasPaused = input.readableFlowing !== true
    input.on('data', onInput)
    input.on('end', onEnd)
    input.on('error', ready.reject)
    input.resume()
    try {
      console.error('Press Enter to start tracing, or Ctrl+C to cancel without recording.')
      const code = await Promise.race([interrupted, ready.promise])
      if (code !== undefined) {
        return code
      }
    } finally {
      input.off('data', onInput)
      input.off('end', onEnd)
      input.off('error', ready.reject)
      if (wasPaused) {
        input.pause()
      }
    }
  }
  if (options.traceDelay) {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const ready = new Promise<undefined>(resolve => {
        timer = setTimeout(() => resolve(undefined), options.traceDelay)
      })
      console.error(`Waiting ${options.traceDelay} ms before tracing. Ctrl+C cancels without recording.`)
      return await Promise.race([interrupted, ready])
    } finally {
      clearTimeout(timer)
    }
  }
  return undefined
}
