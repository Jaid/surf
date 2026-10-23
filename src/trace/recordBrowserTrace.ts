import type {TraceOptions} from './TraceRecorder.ts'

import puppeteer from 'puppeteer-core'

import {integer} from '../browser/options.ts'
import {StopRequest} from '../lib/StopRequest.ts'
import {resolveTraceCategories} from './categories.ts'
import {TraceRecorder} from './TraceRecorder.ts'

export const recordBrowserTrace = async (options: TraceOptions & {
  duration?: number
  port?: number
} = {}) => {
  const port = integer(options.port ?? 9222, 'port', 1, 65_535)
  if (options.duration !== undefined) {
    integer(options.duration, 'duration', 1, 2_147_483_647)
  }
  resolveTraceCategories(options.tracePreset)
  using stop = new StopRequest(true)
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
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const recorder = new TraceRecorder(browser, options)
    await using recording = await recorder.start()
    if (options.duration) {
      timer = setTimeout(() => stop.stop(), options.duration)
    }
    console.error('Press Enter or Ctrl+C to stop and save. The browser stays open.')
    await Promise.race([stop.promise, recorder.finished])
    return await recorder.stop()
  } finally {
    clearTimeout(timer)
    await browser.disconnect()
  }
}
