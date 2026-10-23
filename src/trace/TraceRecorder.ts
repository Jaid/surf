import type {TracePreset} from './categories.ts'
import type {BrowserConsoleEvent} from './encodeTrace.ts'
import type {Browser, CDPSession, Protocol} from 'puppeteer-core'

import {createReadStream, createWriteStream} from 'node:fs'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import {constants, createBrotliCompress, createGunzip} from 'node:zlib'

import {join} from 'forward-slash-path'
import {TargetType} from 'puppeteer-core'

import {integer} from '../browser/options.ts'
import {defaultCacheFolder, resolvePath} from '../lib/paths.ts'
import {readBrowserMetadata} from './browserMetadata.ts'
import {resolveTraceCategories, splitTraceCategories} from './categories.ts'
import {encodeTraceJsonAsMessagePack} from './encodeTrace.ts'
import {convertProtoTraceToJson, ensureTraceconv, perfettoVersion} from './perfetto.ts'
import {TraceOutput} from './TraceOutput.ts'

export type TraceOptions = {
  buffer?: number
  cacheFolder?: string
  metadata?: Record<string, unknown>
  output?: string
  reload?: boolean
  targetId?: string
  tracePreset?: ReadonlyArray<TracePreset>
  userDataDir?: string
}

export class TraceRecorder {
  readonly finished: Promise<string>
  private capturing = false
  private readonly complete = Promise.withResolvers<Protocol.Tracing.TracingCompleteEvent>()
  private consoleEvents: Array<BrowserConsoleEvent> = []
  private downloaded = false
  private droppedConsoleEvents = 0
  private readonly fail: (error: unknown) => void
  private readonly finish: (output: string) => void
  private initialized = false
  private metadata: Record<string, unknown> = {}
  private readonly onBuffer = (event: Protocol.Tracing.BufferUsageEvent) => {
    if ((event.percentFull ?? event.value ?? 0) >= 0.995) {
      void this.stop().catch(this.fail)
    }
  }
  private readonly onComplete = (event: Protocol.Tracing.TracingCompleteEvent) => this.complete.resolve(event)
  private readonly onDisconnect = () => {
    if (this.downloaded) {
      return
    }
    const error = new Error('Browser disconnected before the trace was saved. Stop recording before closing the browser.')
    this.complete.reject(error)
    this.fail(error)
    if (this.started) {
      void this.stop().catch(() => {})
    }
  }
  private output?: TraceOutput
  private pageSession?: CDPSession
  private session?: CDPSession

  private started = false
  private stopping?: Promise<string>
  private traceconv = ''

  constructor(readonly browser: Browser, readonly options: TraceOptions = {}) {
    const {promise, resolve, reject} = Promise.withResolvers<string>()
    this.finished = promise
    this.finish = resolve
    this.fail = reject
    // Events can arrive before a consumer starts awaiting these promises.
    void promise.catch(() => {})
    void this.complete.promise.catch(() => {})
  }

  async start() {
    if (this.initialized) {
      throw new Error('A trace recorder can only be started once.')
    }
    this.initialized = true
    const presets = [...new Set(this.options.tracePreset)]
    const categories = resolveTraceCategories(presets)
    const selection = splitTraceCategories(categories)
    const buffer = integer(this.options.buffer ?? 4_000_000_000, 'buffer', 1, 2_147_483_647 * 1024)
    this.output = await TraceOutput.create(this.options.output)
    try {
      this.traceconv = await ensureTraceconv(join(resolvePath(this.options.cacheFolder ?? defaultCacheFolder()), 'perfetto'))
      this.session = await this.browser.target().createCDPSession()
      this.browser.on('disconnected', this.onDisconnect)
      this.session.on('Tracing.tracingComplete', this.onComplete)
      this.session.on('Tracing.bufferUsage', this.onBuffer)
      const version = await this.session.send('Browser.getVersion')
      this.metadata = {
        ...selection.collectBrowserMetadata ? await readBrowserMetadata(this.session, this.options.userDataDir === undefined ? undefined : resolvePath(this.options.userDataDir)) : {},
        Browser: version.product,
        'V8-Version': version.jsVersion,
        TraceStreamFormat: 'proto',
        Traceconv: perfettoVersion,
        ...this.options.metadata,
        TracePresets: presets,
        TraceCategories: categories,
        ChromiumTraceCategories: selection.chromiumCategories,
      }
      if (selection.collectConsole || this.options.reload || this.options.targetId) {
        await this.browser.waitForTarget(target => target.type() === TargetType.PAGE, {timeout: 10_000})
        for (const target of this.browser.targets()) {
          if (target.type() !== TargetType.PAGE) {
            continue
          }
          const candidate = await target.createCDPSession()
          try {
            const {targetInfo} = await candidate.send('Target.getTargetInfo')
            if (!this.options.targetId || targetInfo.targetId === this.options.targetId) {
              this.pageSession = candidate
              if (selection.collectConsole) {
                this.metadata.ConsoleTarget = targetInfo
              }
              break
            }
          } finally {
            if (this.pageSession !== candidate) {
              await candidate.detach().catch(() => {})
            }
          }
        }
        if (!this.pageSession) {
          throw new Error('No matching page target found for trace console capture/reload.')
        }
        if (selection.collectConsole) {
          this.pageSession.on('Runtime.consoleAPICalled', event => this.capture('Runtime.consoleAPICalled', event))
          this.pageSession.on('Runtime.exceptionThrown', event => this.capture('Runtime.exceptionThrown', event))
          this.pageSession.on('Log.entryAdded', event => this.capture('Log.entryAdded', event))
          await Promise.all([this.pageSession.send('Runtime.enable'), this.pageSession.send('Log.enable')])
        }
      }
      await this.session.send('Tracing.start', {
        transferMode: 'ReturnAsStream',
        streamFormat: 'proto',
        streamCompression: 'gzip',
        bufferUsageReportingInterval: 5000,
        traceConfig: {
          recordMode: 'recordUntilFull',
          traceBufferSizeInKb: Math.ceil(buffer / 1024),
          includedCategories: selection.chromiumCategories,
        },
      })
      this.started = true
      this.capturing = true
      if (this.options.reload) {
        await this.pageSession!.send('Page.reload')
      }
      console.error(`Recording ${version.product} → ${this.output.path}`)
      return this
    } catch (error) {
      if (this.started) {
        await this.stop().catch(() => {})
      } else {
        await this.cleanup()
      }
      throw error
    }
  }

  stop() {
    if (!this.started) {
      return Promise.reject(new Error('Trace recording has not started.'))
    }
    this.stopping ??= this.save().then(output => {
      this.finish(output)
      return output
    }, (error: unknown) => {
      this.fail(error)
      throw error
    })
    return this.stopping
  }

  async [Symbol.asyncDispose]() {
    if (this.stopping) {
      // stop()/finished already expose this result; do not mask a caller's error
      // with a duplicate SuppressedError during scope unwinding.
      await this.stopping.catch(() => {})
    } else if (this.started) {
      await this.stop()
    } else {
      await this.cleanup()
    }
  }

  private capture(method: BrowserConsoleEvent['method'], params: unknown) {
    if (!this.capturing) {
      return
    }
    if (this.consoleEvents.length < 100_000) {
      this.consoleEvents.push({
        cat: 'surf.console',
        method,
        params,
      })
    } else {
      this.droppedConsoleEvents++
    }
  }

  private async cleanup() {
    this.browser.off('disconnected', this.onDisconnect)
    if (this.session) {
      this.session.off('Tracing.tracingComplete', this.onComplete)
      this.session.off('Tracing.bufferUsage', this.onBuffer)
    }
    await this.pageSession?.detach().catch(() => {})
    await this.session?.detach().catch(() => {})
    this.consoleEvents = []
    await this.output?.[Symbol.asyncDispose]()
  }

  private async save() {
    if (!this.started || !this.session || !this.output) {
      throw new Error('Trace recording has not started.')
    }
    this.capturing = false
    const session = this.session
    const proto = this.output.temporary('pftrace')
    const json = this.output.temporary('json')
    const messagePack = this.output.temporary('msgpack')
    const compressed = this.output.temporary('br')
    let stream: string | undefined
    try {
      await session.send('Tracing.end')
      const timeout = setTimeout(() => this.complete.reject(new Error('Timed out waiting for the browser to finish tracing.')), 30_000)
      let event: Protocol.Tracing.TracingCompleteEvent
      try {
        event = await this.complete.promise
      } finally {
        clearTimeout(timeout)
      }
      stream = event.stream
      if (!stream || event.traceFormat !== 'proto' || event.streamCompression !== 'gzip') {
        throw new Error('Browser did not return the requested gzip Perfetto stream.')
      }
      const handle = stream
      async function *chunks() {
        while (true) {
          const chunk = await session.send('IO.read', {
            handle,
            size: 16 * 1024 * 1024,
          })
          yield Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8')
          if (chunk.eof) {
            return
          }
        }
      }
      await pipeline(Readable.from(chunks()), createGunzip(), createWriteStream(proto))
      this.downloaded = true
      await convertProtoTraceToJson(this.traceconv, proto, json)
      const eventCount = await encodeTraceJsonAsMessagePack(json, messagePack, this.consoleEvents, {
        ...this.metadata,
        TraceDataLossOccurred: event.dataLossOccurred,
        DroppedConsoleEvents: this.droppedConsoleEvents,
      })
      if (!eventCount) {
        throw new Error('The browser returned no trace events.')
      }
      await pipeline(createReadStream(messagePack), createBrotliCompress({
        params: {[constants.BROTLI_PARAM_QUALITY]: 6},
      }), createWriteStream(compressed))
      // Atomic, no-clobber publication, even if another writer ignores our lock.
      await this.output.publish(compressed)
      console.error(`Saved ${this.output.path} (${eventCount.toLocaleString()} trace events)`)
      return this.output.path
    } finally {
      if (stream) {
        await session.send('IO.close', {handle: stream}).catch(() => {})
      }
      await this.cleanup()
    }
  }
}
