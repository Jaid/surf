import type {PrintLogCategory} from './categories.ts'
import type {Browser, CDPSession, Protocol} from 'puppeteer-core'

import {TargetType} from 'puppeteer-core'

import {resolvePrintLog} from './categories.ts'
import {logText, remoteText} from './format.ts'

export class BrowserLog {
  static async attach(browser: Browser, categories: ReadonlyArray<PrintLogCategory> = [], targetId?: string) {
    const log = new BrowserLog(resolvePrintLog(categories))
    if (!log.categories.length) {
      return log
    }
    try {
      await browser.waitForTarget(target => target.type() === TargetType.PAGE, {timeout: 10_000})
      for (const target of browser.targets()) {
        if (target.type() !== TargetType.PAGE) {
          continue
        }
        const session = await target.createCDPSession()
        log.session = session
        const {targetInfo} = await session.send('Target.getTargetInfo')
        if (!targetId || targetInfo.targetId === targetId) {
          await log.start()
          return log
        }
        await session.detach()
        log.session = undefined
      }
      throw new Error('No matching page target found for --print-log.')
    } catch (error) {
      await log[Symbol.asyncDispose]()
      throw error
    }
  }

  private readonly onConsole = (event: Protocol.Runtime.ConsoleAPICalledEvent) => {
    this.print('console', `${event.type}: ${event.args.map(remoteText).join(' ')}`)
  }
  private readonly onException = (event: Protocol.Runtime.ExceptionThrownEvent) => {
    const details = event.exceptionDetails
    this.print('console', `error: ${details.exception ? remoteText(details.exception) : details.text}`)
  }
  private readonly onFailed = (event: Protocol.Network.LoadingFailedEvent) => {
    this.print('network', `FAILED ${this.requests.get(event.requestId) ?? event.requestId}: ${event.errorText}`)
    this.requests.delete(event.requestId)
  }
  private readonly onFinished = (event: Protocol.Network.LoadingFinishedEvent) => {
    this.requests.delete(event.requestId)
  }
  private readonly onRequest = (event: Protocol.Network.RequestWillBeSentEvent) => {
    if (event.redirectResponse) {
      this.print('network', `${event.redirectResponse.status} ${event.redirectResponse.url}`)
    }
    const request = `${event.request.method} ${event.request.url}`
    this.requests.set(event.requestId, request)
    this.print('network', request)
  }
  private readonly onResponse = (event: Protocol.Network.ResponseReceivedEvent) => {
    this.print('network', `${event.response.status} ${this.requests.get(event.requestId) ?? event.response.url}`)
  }
  private readonly onWebSocket = (event: Protocol.Network.WebSocketCreatedEvent) => {
    this.print('network', `WS ${event.url}`)
  }
  private readonly requests = new Map<string, string>
  private session?: CDPSession

  private constructor(readonly categories: ReadonlyArray<PrintLogCategory>) {}

  async navigate(url: string) {
    if (!this.session) {
      throw new Error('Cannot navigate without an attached logging session.')
    }
    await this.session.send('Page.navigate', {url})
  }

  async [Symbol.asyncDispose]() {
    const session = this.session
    this.session = undefined
    if (session) {
      session.off('Runtime.consoleAPICalled', this.onConsole)
      session.off('Runtime.exceptionThrown', this.onException)
      session.off('Network.requestWillBeSent', this.onRequest)
      session.off('Network.responseReceived', this.onResponse)
      session.off('Network.loadingFinished', this.onFinished)
      session.off('Network.loadingFailed', this.onFailed)
      session.off('Network.webSocketCreated', this.onWebSocket)
      await session.detach().catch(() => {})
    }
    this.requests.clear()
  }

  private print(category: PrintLogCategory, text: string) {
    console.log(`[${category}] ${logText(text)}`)
  }

  private async start() {
    const session = this.session!
    if (this.categories.includes('console')) {
      session.on('Runtime.consoleAPICalled', this.onConsole)
      session.on('Runtime.exceptionThrown', this.onException)
      await session.send('Runtime.enable')
    }
    if (this.categories.includes('network')) {
      session.on('Network.requestWillBeSent', this.onRequest)
      session.on('Network.responseReceived', this.onResponse)
      session.on('Network.loadingFinished', this.onFinished)
      session.on('Network.loadingFailed', this.onFailed)
      session.on('Network.webSocketCreated', this.onWebSocket)
      await session.send('Network.enable')
    }
  }
}
