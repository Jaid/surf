import type {CDPSession, Protocol} from 'puppeteer-core'

import {integer} from '../browser/options.ts'

export const resolveTraceStopTimeout = (value = 300_000) => integer(value, 'trace-stop-timeout', 0, 2_147_483_647)

// The command acknowledgement is not the trace: Chromium emits tracingComplete
// separately, after finalizing its stream. Bound both with one deadline.
export const finishTracing = async (
  session: Pick<CDPSession, 'send'>,
  complete: Promise<Protocol.Tracing.TracingCompleteEvent>,
  timeout: number,
) => {
  const started = performance.now()
  const deadline = Promise.withResolvers<never>()
  const timer = timeout ? setTimeout(() => deadline.reject(new Error(`Chromium did not finish tracing within ${timeout} ms. Increase --trace-stop-timeout, or use 0 to wait without a deadline.`)), timeout) : undefined
  console.error('Finalizing trace in Chromium; keep the browser open…')
  const progress = setInterval(() => {
    console.error(`Still waiting for Chromium to finalize the trace (${Math.floor((performance.now() - started) / 1000)}s)…`)
  }, 10_000)
  progress.unref()
  try {
    const [, event] = await Promise.race([
      Promise.all([session.send('Tracing.end', undefined, {timeout}), complete]),
      deadline.promise,
    ])
    return event
  } finally {
    clearTimeout(timer)
    clearInterval(progress)
  }
}
