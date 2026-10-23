import type {IconTheme} from './IconTheme.ts'
import type {Sharp} from 'sharp'

import {createHash} from 'node:crypto'
import {join} from 'node:path'

import {load} from 'cheerio'
import fs from 'fs-extra'
import sharp from 'sharp'
import ico from 'sharp-ico'

import {IconThemeRenderer} from './IconTheme.ts'

export const iconSizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]

export const encodeIco = (frames: Array<{
  png: Buffer
  size: number
}>) => {
  const header = Buffer.alloc(6 + frames.length * 16)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)
  let offset = header.length
  for (const [index, {size, png}] of frames.entries()) {
    if (!Number.isInteger(size) || size < 1 || size > 256) {
      throw new Error('ICO frame size must be between 1 and 256.')
    }
    const entry = 6 + index * 16
    header[entry] = size === 256 ? 0 : size
    header[entry + 1] = header[entry]
    header.writeUInt16LE(1, entry + 4)
    header.writeUInt16LE(32, entry + 6)
    header.writeUInt32LE(png.length, entry + 8)
    header.writeUInt32LE(offset, entry + 12)
    offset += png.length
  }
  return Buffer.concat([header, ...frames.map(frame => frame.png)])
}

export const discoverIcons = (html: string, pageUrl: string, theme: IconTheme = 'dark') => {
  const $ = load(html)
  const page = new URL(pageUrl)
  const fallback = new URL('/favicon.ico', page)
  let base = pageUrl
  try {
    const baseUrl = new URL($('base[href]').first().attr('href') || pageUrl, pageUrl)
    base = baseUrl.href
  } catch {}
  const icons: Array<{
    media?: string
    priority: number
    url: string
  }> = []
  let manifest: string | undefined
  $('link[href]').each((_index, element) => {
    const link = $(element)
    const rel = new Set((link.attr('rel') || '').toLowerCase().split(/\s+/))
    try {
      const source = new URL(link.attr('href')!, base)
      const url = source.href
      if (rel.has('manifest')) {
        manifest ||= url
      }
      if (rel.has('icon') || rel.has('apple-touch-icon')) {
        const svg = link.attr('type') === 'image/svg+xml' || source.pathname.endsWith('.svg')
        const size = Math.max(0, ...(link.attr('sizes') || '').match(/\d+/g)?.map(Number) || [])
        // GitHub switches these URLs in JavaScript, not via SVG media queries.
        const baseHref = link.attr('data-base-href')
        if (theme === 'dark' && page.hostname === 'github.com' && baseHref && link.hasClass('js-site-favicon') && svg) {
          const themed = new URL(`${baseHref}-dark.svg`, base)
          icons.push({
            url: themed.href,
            priority: 200_000,
          })
        }
        icons.push({
          ...link.attr('media') ? {media: link.attr('media')} : {},
          url,
          priority: svg ? 100_000 : size,
        })
      }
    } catch {}
  })
  icons.push({
    url: fallback.href,
    priority: -1,
  })
  return {
    icons,
    manifest,
  }
}

export class WebIcon {
  constructor(readonly cacheFolder: string, readonly theme: IconTheme = 'dark', readonly executable?: string) {}

  async download(url: string, limit = 8 * 1024 * 1024, signal?: AbortSignal) {
    const parsedUrl = new URL(url)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Only HTTP(S) icon resources are supported.')
    }
    const response = await fetch(url, {signal: AbortSignal.any([AbortSignal.timeout(10_000), ...signal ? [signal] : []])})
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status} for ${url}`)
    }
    const chunks: Array<Uint8Array> = []
    let length = 0
    const reader = (response.body as ReadableStream<Uint8Array>).getReader()
    try {
      while (true) {
        const {done, value} = await reader.read()
        if (done) {
          break
        }
        length += value.length
        if (length > limit) {
          throw new Error('Icon resource exceeds download limit.')
        }
        chunks.push(value)
      }
    } finally {
      await reader.cancel()
    }
    return {
      body: Buffer.concat(chunks),
      url: response.url,
    }
  }

  async prepare(url: string) {
    await fs.mkdir(this.cacheFolder, {recursive: true})
    const key = createHash('sha256').update(JSON.stringify(['theme-v2', this.theme, url])).digest('hex')
    const file = join(this.cacheFolder, `${key}.ico`)
    if (await fs.stat(file).then(info => Date.now() - info.mtimeMs < 86_400_000).catch(() => false)) {
      return file
    }
    await using renderer = new IconThemeRenderer(this.theme, this.executable)
    const signal = AbortSignal.timeout(20_000)
    const fallback = new URL('/favicon.ico', url)
    let icons: ReturnType<typeof discoverIcons>['icons'] = [
      {
        url: fallback.href,
        priority: -1,
      },
    ]
    try {
      const page = await this.download(url, 4 * 1024 * 1024, signal)
      const discovered = discoverIcons(page.body.toString(), page.url, this.theme)
      icons = discovered.icons
      if (discovered.manifest) {
        try {
          const resource = await this.download(discovered.manifest, 1024 * 1024, signal)
          const manifest = JSON.parse(resource.body.toString()) as {icons?: Array<{
            purpose?: string
            sizes?: string
            src?: string
            type?: string
          }>}
          for (const icon of Array.isArray(manifest.icons) ? manifest.icons : []) {
            if (typeof icon.src !== 'string' || icon.purpose && !icon.purpose.split(/\s+/).includes('any')) {
              continue
            }
            const source = new URL(icon.src, resource.url)
            icons.push({
              url: source.href,
              priority: icon.type === 'image/svg+xml' || source.pathname.endsWith('.svg') ? 100_000 : Math.max(0, ...(icon.sizes || '').match(/\d+/g)?.map(Number) || []),
            })
          }
        } catch {}
      }
    } catch {}
    const eligible: typeof icons = []
    for (const icon of icons) {
      if (!icon.media || await renderer.matches(icon.media)) {
        eligible.push({
          ...icon,
          priority: icon.priority + (icon.media ? 300_000 : 0),
        })
      }
    }
    const errors: Array<string> = []
    const candidates = new Map(eligible.toSorted((a, b) => b.priority - a.priority).map(icon => [icon.url, icon]))
    for (const candidate of candidates.values().take(8)) {
      try {
        const {body} = await this.download(candidate.url, 8 * 1024 * 1024, signal)
        const result = await this.render(body, renderer)
        const temporary = `${file}.${crypto.randomUUID()}.tmp`
        try {
          await Bun.write(temporary, result)
          await fs.rename(temporary, file)
        } finally {
          await fs.rm(temporary, {force: true})
        }
        return file
      } catch (error) {
        errors.push(String(error))
      }
    }
    throw new Error(`No usable web icon for ${url}: ${errors.join('; ')}`)
  }

  async render(input: Buffer, renderer?: IconThemeRenderer): Promise<Buffer> {
    if (!renderer) {
      await using ownedRenderer = new IconThemeRenderer(this.theme, this.executable)
      return await this.render(input, ownedRenderer)
    }
    // Sharp cannot decode ICO directly. Select its largest embedded source.
    if (input.length >= 4 && input.readUInt32LE(0) === 0x00_01_00_00) {
      const images = ico.sharpsFromIco(input, {}, true) as Array<{
        height: number
        image: Sharp
        width: number
      }>
      const largest = images.toSorted((a, b) => b.width * b.height - a.width * a.height)[0]
      if (!images.length || largest.width * largest.height > 16_777_216) {
        throw new Error('ICO has no usable source within the pixel limit.')
      }
      input = await largest.image.png().toBuffer()
    }
    const metadata = await sharp(input, {limitInputPixels: 16_777_216}).metadata()
    if (!metadata.width || !metadata.height) {
      throw new Error('Icon has no dimensions.')
    }
    if (metadata.format === 'svg') {
      return encodeIco(await renderer.render(input, iconSizes))
    }
    const frames = await Promise.all(iconSizes.map(async size => {
      const png = await sharp(input, {
        limitInputPixels: 16_777_216,
      })
        .resize(size, size, {
          fit: 'contain',
          background: {
            r: 0,
            g: 0,
            b: 0,
            alpha: 0,
          },
        })
        .png()
        .toBuffer()
      return {
        size,
        png,
      }
    }))
    return encodeIco(frames)
  }
}
