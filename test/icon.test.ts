import {afterAll, expect, test} from 'bun:test'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import fs from 'fs-extra'
import sharp from 'sharp'

import {discoverIcons, encodeIco, iconSizes, WebIcon} from '../src/icon/WebIcon.ts'

const temporary = await fs.mkdtemp(join(tmpdir(), 'kiosk-icon-test-'))
afterAll(() => fs.rm(temporary, {
  recursive: true,
  force: true,
}))
test('discovers icons using redirects/base URL and rel tokens', () => {
  const result = discoverIcons('<base href="/assets/"><link rel="shortcut ICON" href="logo.svg"><link rel="manifest" href="../app.json">', 'https://example.com/page')
  expect(result.icons[0]).toEqual({
    url: 'https://example.com/assets/logo.svg',
    priority: 100_000,
  })
  expect(result.manifest).toBe('https://example.com/app.json')
})
test('ICO rejects unsupported frame dimensions', () => {
  expect(() => encodeIco([
    {
      size: 257,
      png: Buffer.alloc(1),
    },
  ])).toThrow()
})
test.skipIf(!Bun.env.SURF_TEST_BROWSER)('fetches SVG over low-resolution favicon, rasterizes each size and caches', async () => {
  const requests: Array<string> = []
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><path fill="red" d="M0 0h16v16H0z"/></svg>'
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const requestUrl = new URL(request.url)
      const path = requestUrl.pathname
      requests.push(path)
      if (path === '/') {
        return new Response('<link rel="icon" href="/bad.png" sizes="16x16"><link rel="manifest" href="/manifest.json">')
      }
      if (path === '/manifest.json') {
        return Response.json({
          icons: [
            {
              src: 'logo.svg',
              type: 'image/svg+xml',
              sizes: 'any',
            },
          ],
        })
      }
      if (path === '/logo.svg') {
        return new Response(svg)
      }
      return new Response('not an image', {status: 404})
    },
  })
  try {
    const source = new WebIcon(temporary, 'dark', Bun.env.SURF_TEST_BROWSER)
    const url = server.url.href
    const file = await source.prepare(url)
    const buffer = Buffer.from(await Bun.file(file).arrayBuffer())
    expect(buffer.readUInt16LE(2)).toBe(1)
    expect(buffer.readUInt16LE(4)).toBe(iconSizes.length)
    for (const [i, iconSize] of iconSizes.entries()) {
      const entry = 6 + i * 16
      const length = buffer.readUInt32LE(entry + 8)
      const offset = buffer.readUInt32LE(entry + 12)
      const metadata = await sharp(buffer.subarray(offset, offset + length)).metadata()
      expect(metadata.width).toBe(iconSize)
      expect(metadata.height).toBe(iconSize)
    }
    expect(requests).toEqual(['/', '/manifest.json', '/logo.svg'])
    await source.prepare(url)
    expect(requests.length).toBe(3)
    // ICO input can also be decoded and regenerated.
    const regenerated = await source.render(buffer)
    expect(regenerated.readUInt16LE(4)).toBe(iconSizes.length)
  } finally {
    await server.stop(true)
  }
})
test('falls back to favicon when the page cannot be fetched', async () => {
  const png = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: 'blue',
    },
  }).png().toBuffer()
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const requestUrl = new URL(request.url)
      return requestUrl.pathname === '/favicon.ico' ? new Response(new Uint8Array(png)) : new Response('Denied', {status: 403})
    },
  })
  try {
    const webIcon = new WebIcon(temporary, 'dark', Bun.env.SURF_TEST_BROWSER)
    const file = await webIcon.prepare(server.url.href)
    expect(await Bun.file(file).exists()).toBe(true)
    await expect(webIcon.download(`${server.url.href}favicon.ico`, 1)).rejects.toThrow('limit')
  } finally {
    await server.stop(true)
  }
})
