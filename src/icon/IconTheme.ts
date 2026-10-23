import type {Browser, Page} from 'puppeteer-core'

import puppeteer from 'puppeteer-core'

import {resolveExecutable} from '../browser/resolveExecutable.ts'

export type IconTheme = 'dark' | 'light'

export const getTaskbarTheme = async (): Promise<IconTheme> => {
  if (process.platform !== 'win32') {
    return 'dark'
  }
  const child = Bun.spawn(['reg.exe', 'query', String.raw`HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize`, '/v', 'SystemUsesLightTheme'], {
    windowsHide: true,
    stdout: 'pipe',
    stderr: 'ignore',
  })
  const response = new Response(child.stdout)
  const output = await response.text()
  return await child.exited === 0 && /systemuseslighttheme\s+reg_dword\s+0x1\b/i.test(output) ? 'light' : 'dark'
}

// A separate, temporary browser profile: never attach to the user's browser.
export class IconThemeRenderer {
  browser?: Browser
  page?: Page

  constructor(readonly theme: IconTheme, readonly executable?: string) {}

  async getPage() {
    if (!this.page) {
      const executablePath = await resolveExecutable(this.executable)
      this.browser = await puppeteer.launch({
        executablePath,
        headless: true,
        handleSIGINT: false,
        handleSIGTERM: false,
        handleSIGHUP: false,
        timeout: 10_000,
        protocolTimeout: 10_000,
      })
      this.page = await this.browser.newPage()
      this.page.setDefaultTimeout(10_000)
      await this.page.emulateMediaFeatures([
        {
          name: 'prefers-color-scheme',
          value: this.theme,
        },
      ])
      await this.page.setContent(`<meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; img-src data:; style-src &apos;unsafe-inline&apos;"><style>html,body{margin:0;background:transparent;color-scheme:${this.theme}}img{display:block;width:100vw;height:100vh;object-fit:contain}</style><img>`)
    }
    return this.page
  }

  async matches(media: string) {
    const page = await this.getPage()
    return page.evaluate(query => {
      const browser = globalThis as unknown as {matchMedia: (query: string) => {matches: boolean}}
      return browser.matchMedia(query).matches
    }, media)
  }

  async render(svg: Buffer, sizes: Array<number>) {
    const page = await this.getPage()
    await page.evaluate(async source => {
      const browser = globalThis as unknown as {document: {querySelector: (selector: string) => {
        decode: () => Promise<void>
        src: string
      }}}
      const img = browser.document.querySelector('img')
      img.src = source
      await img.decode()
    }, `data:image/svg+xml;base64,${svg.toBase64()}`)
    const frames: Array<{
      png: Buffer
      size: number
    }> = []
    for (const size of sizes) {
      await page.setViewport({
        width: size,
        height: size,
        deviceScaleFactor: 1,
      })
      frames.push({
        size,
        png: Buffer.from(await page.screenshot({omitBackground: true})),
      })
    }
    return frames
  }

  async [Symbol.asyncDispose]() {
    await this.browser?.close()
  }
}
