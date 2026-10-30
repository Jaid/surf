import type {SurfControls} from '../controls/SurfControls.ts'
import type {TraceOptions} from './TraceRecorder.ts'
import type {TraceStartOptions} from './waitForTraceStart.ts'
import type {Browser} from 'puppeteer-core'

import {TraceInput} from './TraceInput.ts'
import {TraceRecorder} from './TraceRecorder.ts'
import {waitForTraceStart} from './waitForTraceStart.ts'

export const recordTraceSeries = async (
  browser: Browser,
  options: TraceStartOptions & {
    controls?: SurfControls
    duration?: number
    exitAfterTrace?: boolean
    owned?: boolean
    repeat?: boolean
    traceOptions: (index: number) => TraceOptions
  },
  interrupted: Promise<number>,
): Promise<{
  code?: number
  output?: string
}> => {
  const state: {code?: number} = {}
  const getCode = (): number | undefined => state.code
  const stopped = interrupted.then(value => {
    state.code = value
    return value
  })
  const {controls} = options
  const requested = Promise.withResolvers<void>()
  const startListener = controls?.onEnter(requested.resolve)
  if (options.traceStart === 'manual') {
    controls?.show('start')
  }
  const cancelled = await waitForTraceStart(options, stopped, process.stdin, requested.promise).finally(() => {
    startListener?.[Symbol.dispose]()
    controls?.show('hidden')
  })
  if (cancelled !== undefined || getCode() !== undefined) {
    return {
      code: cancelled ?? state.code,
      output: undefined,
    }
  }
  using input = new TraceInput
  using _enterListener = controls?.onEnter(() => input.request())
  const repeat = options.repeat && (process.stdin.isTTY || Boolean(controls)) && !options.exitAfterTrace
  const failed = Promise.withResolvers<never>()
  void failed.promise.catch(() => {})
  const jobs: Array<Promise<string>> = []
  let active: TraceRecorder | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const save = () => {
    const recorder = active!
    active = undefined
    const job = recorder.stop().finally(() => recorder[Symbol.asyncDispose]())
    jobs.push(job)
    void job.catch(failed.reject)
    return recorder
  }
  try {
    for (let index = 0; getCode() === undefined; index++) {
      if (index > 0) {
        const delayedCancellation = await waitForTraceStart({traceDelay: options.traceDelay}, Promise.race([stopped, failed.promise]))
        if (delayedCancellation !== undefined || getCode() !== undefined) {
          break
        }
      }
      active = new TraceRecorder(browser, options.traceOptions(index))
      await active.start()
      controls?.show('stop')
      const recorder = active
      if (options.duration) {
        timer = setTimeout(() => {
          void recorder.stop().catch(failed.reject)
        }, options.duration)
      }
      console.error(options.owned ? (options.exitAfterTrace ? 'Press Enter or Ctrl+C to save the trace and close the browser.' : 'Press Enter to save the trace, or Ctrl+C to save and close the browser.') : 'Press Enter to save the trace, or Ctrl+C to save and detach. The browser stays open.')
      const action = await input.wait(Promise.race([stopped, failed.promise, recorder.readyForNext]))
      // An Enter after automatic finalization began requests the next recording.
      if (action.kind === 'enter' && recorder.isStopping) {
        input.request()
      }
      clearTimeout(timer)
      timer = undefined
      save()
      if (getCode() !== undefined || !repeat || action.kind === 'end') {
        break
      }
      controls?.show('start')
      await Promise.race([recorder.readyForNext, failed.promise])
      if (getCode() !== undefined) {
        break
      }
      console.error('Press Enter to start another trace (also while saving); Ctrl+C exits.')
      const next = await input.wait(Promise.race([stopped, failed.promise]))
      controls?.show('hidden')
      if (next.kind !== 'enter' || getCode() !== undefined) {
        break
      }
    }
    await Promise.all(jobs)
    return {
      code: state.code,
      output: await jobs.at(-1),
    }
  } finally {
    controls?.show('hidden')
    clearTimeout(timer)
    if (active) {
      if (active.isStopping) {
        save()
      } else {
        // start() can fail before recording begins; it already cleaned up.
        await active[Symbol.asyncDispose]().catch(() => {})
      }
    }
    // Do not close/disconnect the browser while older recordings still download.
    await Promise.allSettled(jobs)
  }
}
