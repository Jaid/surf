import type {BrowserSession} from '../browser/BrowserSession.ts'

import {join} from 'forward-slash-path'
import fs from 'fs-extra'

import {getTaskbarTheme} from './IconTheme.ts'
import {WebIcon} from './WebIcon.ts'

export class IconOverride {
  static async start(session: BrowserSession) {
    const override = new IconOverride
    if (!session.options.betterIcon) {
      return override
    }
    try {
      const iconFolder = join(session.options.cacheFolder, 'icons')
      const webIcon = new WebIcon(iconFolder, await getTaskbarTheme(), session.executable)
      const file = await webIcon.prepare(session.options.url)
      const child = session.browser.process()!
      if (child.exitCode !== null || child.signalCode !== null) {
        return override
      }
      override.stopFile = join(iconFolder, `${crypto.randomUUID()}.stop`)
      override.child = Bun.spawn([
        'pwsh',
        '-NoProfile',
        '-NonInteractive',
        '-File',
        join(import.meta.dir, 'watchIcon.ps1'),
        '-BrowserProcessId',
        String(session.pid),
        '-IconFile',
        file,
        '-StopFile',
        override.stopFile,
      ], {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'pipe',
        windowsHide: true,
      })
      const response = new Response(override.child.stderr)
      override.errors = response.text().then(text => {
        if (text.trim()) {
          console.error(`Icon helper: ${text.trim()}`)
        }
      }).catch(error => console.error('Icon helper output failed:', error))
    } catch (error) {
      console.error(`Custom icon unavailable; keeping the browser icon: ${String(error)}`)
    }
    return override
  }
  private child?: Bun.Subprocess<'ignore', 'ignore', 'pipe'>
  private errors?: Promise<void>

  private stopFile = ''

  async [Symbol.asyncDispose]() {
    if (this.child) {
      await Bun.write(this.stopFile, '')
      const timer = setTimeout(() => this.child?.kill(), 5000)
      try {
        await this.child.exited
        await this.errors
      } finally {
        clearTimeout(timer)
        await fs.rm(this.stopFile, {force: true})
      }
    }
  }
}
