import type mainCommand from './mainCommand.ts'
import type {CommandHandler} from '@clerc/core'

import {temporaryFile} from 'tempy'

import {BrowserSession} from '../browser/BrowserSession.ts'
import {launchDetached} from '../browser/launchDetached.ts'
import {launchUnmanaged, resolveUnmanagedOptions, unmanagedArguments} from '../browser/launchUnmanaged.ts'
import {browserArguments, integer, resolveOptions} from '../browser/options.ts'
import {resolveExecutable} from '../browser/resolveExecutable.ts'
import {resolvePath} from '../lib/paths.ts'
import {StopRequest} from '../lib/StopRequest.ts'
import {resolveTraceCategories} from '../trace/categories.ts'
import {TraceRecorder} from '../trace/TraceRecorder.ts'
import {requireTraceInput, validateTraceStart, waitForTraceStart} from '../trace/waitForTraceStart.ts'

// eslint-disable-next-line typescript/no-misused-promises
export const run: CommandHandler<typeof mainCommand> = async context => {
  const {flags, parameters} = context
  if (context.rawParsed.parameters.length > 1 || flags.url !== undefined && parameters.url !== undefined) {
    throw new Error('Supply one URL, either positionally or with --url.')
  }
  const traceOutput = flags.trace === undefined ? undefined : resolvePath(flags.trace || temporaryFile({extension: 'msgpack.br'}))
  if (flags.unmanaged && traceOutput) {
    throw new Error('--trace cannot be combined with --unmanaged.')
  }
  if (flags.detached && traceOutput) {
    throw new Error('--trace cannot be combined with --detached. Use surf trace --port <port> to record a detached browser.')
  }
  if (!traceOutput && flags.tracePreset.length) {
    throw new Error('--trace-preset requires --trace.')
  }
  if (!traceOutput && (flags.traceCategory.length || flags.traceExclude.length || flags.traceStart !== undefined || flags.traceDelay !== undefined || flags.exitAfterTrace)) {
    throw new Error('Trace category, start, delay, and exit options require --trace.')
  }
  validateTraceStart(flags)
  const traceCategories = traceOutput ? resolveTraceCategories(flags.tracePreset, flags.traceCategory, flags.traceExclude) : undefined
  if (!traceOutput && (flags.reload || flags.duration !== undefined)) {
    throw new Error('--reload and --duration require --trace.')
  }
  if (flags.duration !== undefined) {
    integer(flags.duration, 'duration', 1, 2_147_483_647)
  }
  integer(flags.buffer, 'buffer', 1, 2_147_483_647 * 1024)
  const input = {
    ...flags,
    url: flags.url ?? parameters.url,
    args: parameters.browserArguments,
  }
  const options = flags.unmanaged ? resolveUnmanagedOptions(input) : resolveOptions(input)
  if (flags.dump) {
    const executable = await resolveExecutable(options.executableFile)
    console.log(JSON.stringify({
      executable,
      args: flags.unmanaged ? unmanagedArguments(options, input.port !== undefined) : browserArguments(options, options.userDataDir ?? '<temporary-user-data-dir>'),
      temporary: !flags.unmanaged && !options.userDataDir,
      detached: flags.detached || flags.unmanaged,
      unmanaged: flags.unmanaged,
      betterIcon: options.betterIcon,
      trace: traceOutput,
      traceCategories,
      traceStart: traceOutput ? flags.traceStart ?? 'immediate' : undefined,
      traceDelay: traceOutput ? flags.traceDelay ?? 0 : undefined,
      exitAfterTrace: flags.exitAfterTrace,
    }, null, 2))
    return
  }
  if (flags.unmanaged) {
    console.log(JSON.stringify(await launchUnmanaged(input)))
    return
  }
  if (flags.detached) {
    console.log(JSON.stringify(await launchDetached(options)))
    return
  }
  requireTraceInput(flags)
  using stop = new StopRequest
  await using session = await BrowserSession.launch(options)
  console.log(JSON.stringify(session.info))
  if (stop.code !== undefined) {
    process.exitCode = stop.code
    return
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (traceOutput) {
      const cancelled = await waitForTraceStart(flags, Promise.race([session.exited, stop.promise]))
      if (cancelled !== undefined) {
        process.exitCode = cancelled
        return
      }
      const recorder = new TraceRecorder(session.browser, {
        output: traceOutput,
        tracePreset: flags.tracePreset,
        traceCategory: flags.traceCategory,
        traceExclude: flags.traceExclude,
        buffer: flags.buffer,
        reload: flags.reload,
        cacheFolder: options.cacheFolder,
        userDataDir: session.userData.path,
        metadata: {SurfArguments: [session.executable, ...session.args]},
      })
      await using recording = await recorder.start()
      // Enter finishes only the trace; signals finish the whole coupled session.
      const onInput = (data: Buffer) => {
        if (data.includes(10) || data.includes(13)) {
          void recorder.stop().catch(() => {})
        }
      }
      if (process.stdin.isTTY) {
        process.stdin.on('data', onInput)
        process.stdin.resume()
      }
      if (flags.duration) {
        timer = setTimeout(() => {
          void recorder.stop().catch(() => {})
        }, flags.duration)
      }
      console.error(flags.exitAfterTrace ? 'Press Enter or Ctrl+C to save the trace and close the browser.' : 'Press Enter to save the trace, or Ctrl+C to save and close the browser.')
      try {
        const result = await Promise.race([
          session.exited.then(code => ({code})),
          stop.promise.then(code => ({code})),
          recorder.finished.then(() => {}),
        ])
        await recorder.stop()
        if (flags.exitAfterTrace && !result) {
          return
        }
        if (result) {
          process.exitCode = result.code
          return
        }
      } finally {
        process.stdin.off('data', onInput)
        if (process.stdin.isTTY) {
          process.stdin.pause()
        }
      }
    }
    process.exitCode = await Promise.race([session.exited, stop.promise])
  } finally {
    clearTimeout(timer)
  }
}
