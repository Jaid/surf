import {expect, test} from 'bun:test'

import fs from 'fs-extra'

import {SurfControls} from '../src/controls/SurfControls.ts'

const nextMessage = (socket: WebSocket) => new Promise<unknown>(resolve => {
  socket.addEventListener('message', event => resolve(JSON.parse(String(event.data))), {once: true})
})
test('controls extension appends to user extensions and is removed on disposal', async () => {
  let folder: string
  {
    await using controls = await SurfControls.create()
    folder = controls.folder
    expect(await fs.readJson(`${folder}/manifest.json`)).toMatchObject({manifest_version: 3})
    expect(await Bun.file(`${folder}/config.js`).text()).toContain(controls.endpoint)
    expect(controls.browserArguments(['--mute-audio'])).toEqual(['--mute-audio', `--load-extension=${folder}`])
    expect(controls.browserArguments(['--load-extension=a', '--mute-audio'])).toEqual([`--load-extension=a,${folder}`, '--mute-audio'])
  }
  expect(await fs.pathExists(folder)).toBe(false)
})
test('menu state is pushed to the extension and clicks act like Enter', async () => {
  await using controls = await SurfControls.create()
  const rejected = await fetch(controls.endpoint.replace(/^ws/, 'http').replace(/\/[^/]+$/, '/wrong'))
  expect(rejected.status).toBe(404)
  const socket = new WebSocket(controls.endpoint)
  expect(await nextMessage(socket)).toEqual({visible: false})
  const shown = nextMessage(socket)
  controls.show('stop')
  expect(await shown).toEqual({
    title: 'Stop trace',
    visible: true,
  })
  const entered = Promise.withResolvers<void>()
  using _listener = controls.onEnter(entered.resolve)
  socket.send('keepalive')
  socket.send('enter')
  await entered.promise
  socket.close()
})
