import type mainCommand from './mainCommand.ts'
import type {CommandHandler} from '@clerc/core'

import {temporaryFile} from 'tempy'

import {BrowserSession} from '../browser/BrowserSession.ts'
import {launchDetached} from '../browser/launchDetached.ts'
import {launchUnmanaged, resolveUnmanagedOptions, unmanagedArguments} from '../browser/launchUnmanaged.ts'
import {browserArguments, integer, resolveOptions} from '../browser/options.ts'
import {resolveExecutable} from '../browser/resolveExecutable.ts'
import {SurfControls} from '../controls/SurfControls.ts'
import {StopRequest} from '../lib/StopRequest.ts'
import {resolveTraceCategories} from '../trace/categories.ts'
import {resolveTraceStopTimeout} from '../trace/finishTracing.ts'
import {recordTraceSeries} from '../trace/recordTraceSeries.ts'
import {traceOutputPaths} from '../trace/TraceOutput.ts'
import {requireTraceInput, validateTraceStart} from '../trace/waitForTraceStart.ts'

// eslint-disable-next-line typescript/no-misused-promises
export const run: CommandHandler<typeof mainCommand> = async context => {
  const {flags, parameters} = context
  if (context.rawParsed.parameters.length > 1 || flags.url !== undefined && parameters.url !== undefined) {
    throw new Error('Supply one URL, either positionally or with --url.')
  }
  if (flags.printLog.length && (flags.detached || flags.unmanaged)) {
    throw new Error('--print-log requires a coupled browser, not --detached or --unmanaged.')
  }
  const traceOutput = flags.trace === undefined ? undefined : traceOutputPaths(flags.trace || temporaryFile({extension: 'msgpack.br'})).path
  if (flags.unmanaged && traceOutput) {
    throw new Error('--trace cannot be combined with --unmanaged.')
  }
  if (flags.detached && traceOutput) {
    throw new Error('--trace cannot be combined with --detached. Use surf trace --port <port> to record a detached browser.')
  }
  if (!traceOutput && flags.tracePreset.length) {
    throw new Error('--trace-preset requires --trace.')
  }
  if (!traceOutput && (flags.traceCategory.length || flags.traceExclude.length || flags.traceStart !== undefined || flags.traceDelay !== undefined || flags.traceStopTimeout !== undefined || flags.exitAfterTrace || flags.surfControls)) {
    throw new Error('Trace category, start, delay, stop timeout, exit, and Surf controls options require --trace.')
  }
  const traceStopTimeout = resolveTraceStopTimeout(flags.traceStopTimeout)
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
      args: flags.unmanaged ? unmanagedArguments(options, input.port !== undefined) : browserArguments({
        ...options,
        args: flags.surfControls ? [...options.args, '--load-extension=<surf-controls-extension>'] : options.args,
      }, options.userDataDir ?? '<temporary-user-data-dir>'),
      temporary: !flags.unmanaged && !options.userDataDir,
      detached: flags.detached || flags.unmanaged,
      unmanaged: flags.unmanaged,
      betterIcon: options.betterIcon,
      printLog: options.printLog,
      navigateTo: options.printLog.length ? options.url : undefined,
      trace: traceOutput,
      tracePerfetto: traceOutput ? traceOutputPaths(traceOutput).perfettoPath : undefined,
      traceCategories,
      titleUpdates: flags.titleUpdates,
      traceStopTimeout: traceOutput ? traceStopTimeout : undefined,
      traceStart: traceOutput ? flags.traceStart ?? 'immediate' : undefined,
      traceDelay: traceOutput ? flags.traceDelay ?? 0 : undefined,
      exitAfterTrace: flags.exitAfterTrace,
      surfControls: flags.surfControls,
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
  await using controls = flags.surfControls ? await SurfControls.create() : undefined
  await using session = await BrowserSession.launch(controls ? {
    ...options,
    args: controls.browserArguments(options.args),
  } : options)
  console.log(JSON.stringify(session.info))
  if (stop.code !== undefined) {
    process.exitCode = stop.code
    return
  }
  if (traceOutput) {
    const result = await recordTraceSeries(session.browser, {
      ...flags,
      controls,
      owned: true,
      repeat: true,
      traceOptions: index => ({
        output: index > 0 && !flags.trace ? temporaryFile({extension: 'msgpack.br'}) : traceOutput,
        numberOutput: index > 0 && Boolean(flags.trace),
        tracePreset: flags.tracePreset,
        traceCategory: flags.traceCategory,
        traceExclude: flags.traceExclude,
        buffer: flags.buffer,
        titleUpdates: flags.titleUpdates,
        traceStopTimeout,
        reload: flags.reload,
        userDataDir: session.userData.path,
        metadata: {SurfArguments: [session.executable, ...session.args]},
      }),
    }, Promise.race([session.exited, stop.promise]))
    if (result.code !== undefined || flags.exitAfterTrace) {
      process.exitCode = result.code ?? 0
      return
    }
  }
  process.exitCode = await Promise.race([session.exited, stop.promise])
}
