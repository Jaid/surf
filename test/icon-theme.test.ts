import {afterAll, expect, test} from 'bun:test'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import fs from 'fs-extra'
import sharp from 'sharp'

import {IconThemeRenderer} from '../src/icon/IconTheme.ts'
import {discoverIcons, WebIcon} from '../src/icon/WebIcon.ts'

const folder = await fs.mkdtemp(join(tmpdir(), 'kiosk-theme-test-'))
afterAll(() => fs.rm(folder, {
  recursive: true,
  force: true,
}))
const pixel = async (ico: Buffer) => {
  const offset = ico.readUInt32LE(18)
  const length = ico.readUInt32LE(14)
  const {data} = await sharp(ico.subarray(offset, offset + length)).ensureAlpha().raw().toBuffer({resolveWithObject: true})
  return [...data.subarray(0, 4)]
}
test('GitHub JavaScript-selected dark favicon has priority, without changing other sites', () => {
  const html = '<link rel="icon" class="js-site-favicon" type="image/svg+xml" href="https://github.githubassets.com/favicons/favicon.svg" data-base-href="https://github.githubassets.com/favicons/favicon">'
  expect(discoverIcons(html, 'https://github.com').icons[0].url).toEndWith('/favicon-dark.svg')
  expect(discoverIcons(html, 'https://github.com', 'light').icons[0].url).toEndWith('/favicon.svg')
  expect(discoverIcons(html, 'https://example.com').icons[0].url).toEndWith('/favicon.svg')
})
test.skipIf(!Bun.env.SURF_TEST_BROWSER)('SVG embedded theme rules render with the selected color scheme', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><style>rect{fill:black}@media(prefers-color-scheme:dark){rect{fill:white}}</style><rect width="16" height="16"/></svg>')
  const dark = new WebIcon(folder, 'dark', Bun.env.SURF_TEST_BROWSER)
  const light = new WebIcon(folder, 'light', Bun.env.SURF_TEST_BROWSER)
  expect(await pixel(await dark.render(svg))).toEqual([255, 255, 255, 255])
  expect(await pixel(await light.render(svg))).toEqual([0, 0, 0, 255])
}, 20_000)
test.skipIf(!Bun.env.SURF_TEST_BROWSER)('media selection precedes format preference and cache entries are theme-specific', async () => {
  const requests: Array<string> = []
  const png = await sharp({
    create: {
      width: 32,
      height: 32,
      channels: 4,
      background: 'white',
    },
  }).png().toBuffer()
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const requestUrl = new URL(request.url)
      const path = requestUrl.pathname
      requests.push(path)
      if (path === '/') {
        return new Response('<link rel="icon" href="/light.svg" media="(prefers-color-scheme: light)"><link rel="icon" href="/dark.png" media="(prefers-color-scheme: dark)">')
      }
      if (path === '/dark.png') {
        return new Response(new Uint8Array(png))
      }
      if (path === '/light.svg') {
        return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>')
      }
      return new Response('', {status: 404})
    },
  })
  try {
    const darkIcon = new WebIcon(folder, 'dark', Bun.env.SURF_TEST_BROWSER)
    const lightIcon = new WebIcon(folder, 'light', Bun.env.SURF_TEST_BROWSER)
    const dark = await darkIcon.prepare(server.url.href)
    expect(requests).toEqual(['/', '/dark.png'])
    const light = await lightIcon.prepare(server.url.href)
    expect(dark).not.toBe(light)
    expect(requests).toEqual(['/', '/dark.png', '/', '/light.svg'])
    expect(await pixel(Buffer.from(await Bun.file(dark).arrayBuffer()))).toEqual([255, 255, 255, 255])
    expect(await pixel(Buffer.from(await Bun.file(light).arrayBuffer()))).toEqual([0, 0, 0, 255])
    await darkIcon.prepare(server.url.href)
    expect(requests.length).toBe(4)
  } finally {
    await server.stop(true)
  }
}, 20_000)
test.skipIf(!Bun.env.SURF_TEST_BROWSER)('icon renderer does not install process-terminating signal handlers', async () => {
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const
  const before = signals.map(signal => process.listenerCount(signal))
  await using renderer = new IconThemeRenderer('dark', Bun.env.SURF_TEST_BROWSER)
  await renderer.getPage()
  expect(signals.map(signal => process.listenerCount(signal))).toEqual(before)
}, 20_000)
