import type {IconOverride} from '../icon/IconOverride.ts'
import type {LaunchOptions, ResolvedLaunchOptions} from './options.ts'
import type {Browser} from 'puppeteer-core'

import {join} from 'forward-slash-path'
import puppeteer from 'puppeteer-core'

import {BrowserLog} from '../log/BrowserLog.ts'
import {browserArguments, resolveOptions} from './options.ts'
import {resolveExecutable} from './resolveExecutable.ts'
import {UserData} from './UserData.ts'

export class BrowserSession {
  static async launch(input: LaunchOptions = {}) {
    const options = resolveOptions(input)
    const executable = await resolveExecutable(options.executableFile)
    const userData = await UserData.create(options.userDataDir)
    const args = browserArguments(options, userData.path)
    let browser: Browser | undefined
    let log: BrowserLog | undefined
    try {
      browser = await puppeteer.launch({
        executablePath: executable,
        args,
        ignoreDefaultArgs: true,
        headless: false,
        defaultViewport: null,
        timeout: options.timeout,
        protocolTimeout: options.timeout,
        waitForInitialPage: true,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
      })
      const session = new BrowserSession(browser, userData, options, executable, args)
      if (options.printLog.length) {
        log = await BrowserLog.attach(browser, options.printLog)
        session.log = log
        await log.navigate(options.url)
      }
      if (options.betterIcon) {
        try {
          const {IconOverride} = await import('../icon/IconOverride.ts')
          session.icon = await IconOverride.start(session)
        } catch (error) {
          console.error('Custom icon support unavailable; keeping the browser icon:', error)
        }
      }
      return session
    } catch (error) {
      try {
        await log?.[Symbol.asyncDispose]()
        await browser?.close()
      } finally {
        await userData.dispose()
      }
      throw new Error(`Browser launch failed. The user data directory must not already be in use; Chrome also requires a non-default data directory for remote debugging.\n${String(error)}`, {cause: error})
    }
  }
  readonly exited: Promise<number>
  readonly pid: number

  private closing?: Promise<void>
  private icon?: IconOverride
  private log?: BrowserLog

  private constructor(
    readonly browser: Browser,
    readonly userData: UserData,
    readonly options: ResolvedLaunchOptions,
    readonly executable: string,
    readonly args: Array<string>,
  ) {
    const child = browser.process()!
    this.pid = child.pid!
    this.exited = new Promise<number>(resolve => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve(child.exitCode ?? 1)
      } else {
        child.once('exit', code => resolve(code ?? 1))
      }
    })
  }

  get info() {
    return {
      pid: this.pid,
      executable: this.executable,
      userDataDir: this.userData.path,
      temporary: this.userData.temporary,
      url: this.options.url,
      webSocketDebuggerUrl: this.browser.wsEndpoint(),
    }
  }

  close() {
    this.closing ??= this.dispose()
    return this.closing
  }

  async [Symbol.asyncDispose]() {
    await this.close()
  }

  private async dispose() {
    try {
      await this.log?.[Symbol.asyncDispose]()
      await this.icon?.[Symbol.asyncDispose]()
    } finally {
      const timer = setTimeout(() => {
        void this.forceClose().catch(error => console.error('Could not terminate browser:', error))
      }, 10_000)
      try {
        await this.browser.close()
      } finally {
        try {
          await this.exited
          await this.userData.dispose()
        } finally {
          clearTimeout(timer)
        }
      }
    }
  }

  private async forceClose() {
    const child = this.browser.process()!
    if (child.exitCode !== null || child.signalCode !== null) {
      return
    }
    if (process.platform === 'win32') {
      const killer = Bun.spawn([join(Bun.env.SystemRoot || 'C:/Windows', 'System32/taskkill.exe'), '/PID', String(this.pid), '/T', '/F'], {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
        windowsHide: true,
      })
      if (await killer.exited !== 0) {
        child.kill('SIGKILL')
      }
    } else {
      // Puppeteer starts POSIX browsers in their own process group.
      try {
        process.kill(-this.pid, 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
    }
  }
}
