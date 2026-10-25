import type {TraceOptions} from './TraceRecorder.ts'
import type {TraceStartOptions} from './waitForTraceStart.ts'

import puppeteer from 'puppeteer-core'

import {integer} from '../browser/options.ts'
import {StopRequest} from '../lib/StopRequest.ts'
import {resolveTraceCategories} from './categories.ts'
import {resolveTraceStopTimeout} from './finishTracing.ts'
import {recordTraceSeries} from './recordTraceSeries.ts'
import {requireTraceInput, validateTraceStart} from './waitForTraceStart.ts'

export const recordBrowserTrace = async (options: TraceOptions & TraceStartOptions & {
  duration?: number
  port?: number
  repeat?: boolean
} = {}) => {
  const port = integer(options.port ?? 9222, 'port', 1, 65_535)
  if (options.duration !== undefined) {
    integer(options.duration, 'duration', 1, 2_147_483_647)
  }
  resolveTraceCategories(options.tracePreset, options.traceCategory, options.traceExclude)
  resolveTraceStopTimeout(options.traceStopTimeout)
  validateTraceStart(options)
  requireTraceInput(options)
  using stop = new StopRequest
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, {signal: AbortSignal.timeout(10_000)})
  if (!response.ok) {
    throw new Error(`CDP endpoint returned HTTP ${response.status}.`)
  }
  const version = await response.json() as {webSocketDebuggerUrl?: string}
  if (!version.webSocketDebuggerUrl) {
    throw new Error('CDP endpoint returned no browser WebSocket URL.')
  }
  const browser = await puppeteer.connect({
    browserWSEndpoint: version.webSocketDebuggerUrl,
    defaultViewport: null,
    protocolTimeout: 30_000,
  })
  const disconnected = Promise.withResolvers<number>()
  const onDisconnect = () => disconnected.resolve(1)
  browser.on('disconnected', onDisconnect)
  try {
    const result = await recordTraceSeries(browser, {
      ...options,
      traceOptions: index => ({
        ...options,
        numberOutput: index > 0 || options.numberOutput,
      }),
    }, Promise.race([stop.promise, disconnected.promise]))
    if (result.code !== undefined && result.output === undefined) {
      process.exitCode = result.code
    }
    return result.output
  } finally {
    browser.off('disconnected', onDisconnect)
    await browser.disconnect()
  }
}
