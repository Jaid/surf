import {afterAll, expect, test} from 'bun:test'
import {tmpdir} from 'node:os'

import {join} from 'forward-slash-path'
import fs from 'fs-extra'

import {UserData} from '../src/browser/UserData.ts'

const root = await fs.mkdtemp(join(tmpdir(), 'surf-profile-test-'))
afterAll(() => fs.rm(root, {
  recursive: true,
  force: true,
}))
test('throwaway profiles are seeded and removed', async () => {
  const data = await UserData.create()
  expect(data.temporary).toBe(true)
  expect(await Bun.file(join(data.path, 'Local State')).json()).toEqual({brave: {p3a: {
    enabled: false,
    notice_acknowledged: true,
  }}})
  await data.dispose()
  expect(await fs.stat(data.path).catch(() => null)).toBeNull()
  await data.dispose()
})
test('explicit new directories are kept', async () => {
  const path = join(root, 'new profile')
  const data = await UserData.create(path)
  expect(data.temporary).toBe(false)
  await data.dispose()
  const info = await fs.stat(path)
  expect(info.isDirectory()).toBe(true)
})
test('existing profile bytes are never rewritten', async () => {
  const path = join(root, 'existing')
  await fs.mkdir(path)
  const state = '{ "brave": { "p3a": {"enabled": true} }, "other": 123 }'
  await fs.writeFile(join(path, 'Local State'), state)
  await fs.writeFile(join(path, 'keep.txt'), 'keep')
  const data = await UserData.create(path)
  await data.dispose()
  expect(await Bun.file(join(path, 'Local State')).text()).toBe(state)
  expect(await Bun.file(join(path, 'keep.txt')).text()).toBe('keep')
})
test('nonempty existing directories without Local State are not seeded', async () => {
  const path = join(root, 'no-state')
  await fs.mkdir(path)
  await fs.writeFile(join(path, 'keep.txt'), 'keep')
  const data = await UserData.create(path)
  expect(await Bun.file(join(path, 'Local State')).exists()).toBe(false)
  await data.dispose()
})
