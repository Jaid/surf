import {expect, test} from 'bun:test'
import {tmpdir} from 'node:os'

import {join} from 'forward-slash-path'
import fs from 'fs-extra'

import {detachedArguments, launchDetached, resolveDetachedOptions} from '../src/browser/launchDetached.ts'

test('detached apps use the normal browser profile without management switches', () => {
  const options = resolveDetachedOptions({
    app: true,
    url: 'github.com/repos?q=sort%3Aupdated+owner%3Ajaid,jaidlab',
  })
  expect(options.userDataDir).toBeUndefined()
  expect(detachedArguments(options)).toEqual([
    '--new-window',
    '--profile-directory=Default',
    '--app=https://github.com/repos?q=sort%3Aupdated+owner%3Ajaid,jaidlab',
  ])
})
test('detached launches preserve profile, performance, and passthrough options', () => {
  const options = resolveDetachedOptions({
    app: true,
    profile: 'profile_jaid',
    userDataDir: './data with spaces',
    performance: true,
    url: 'https://discord.com/channels/@me',
    args: ['--enable-features=JXLImageFormat'],
  })
  const args = detachedArguments(options)
  expect(args).toContain('--profile-directory=profile_jaid')
  expect(args).toContain(`--user-data-dir=${options.userDataDir}`)
  expect(args).toContain('--force-high-performance-gpu')
  expect(args).toContain('--enable-features=JXLImageFormat')
  expect(args.at(-1)).toBe('--app=https://discord.com/channels/@me')
  expect(args.some(arg => arg.startsWith('--remote-debugging'))).toBe(false)
})
test('detached launches reject management-only options even from JavaScript callers', () => {
  for (const input of [
    {
      app: true,
      betterIcon: true,
    },
  ]) {
    expect(() => resolveDetachedOptions(input)).toThrow('Detached launches')
  }
})
test('failed executable resolution does not create a persistent profile', async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), 'surf-detached-failure-'))
  const userDataDir = join(folder, 'profile')
  try {
    await expect(launchDetached({
      executableFile: join(folder, 'missing-browser.exe'),
      userDataDir,
    })).rejects.toThrow()
    expect(await fs.pathExists(userDataDir)).toBe(false)
  } finally {
    await fs.remove(folder)
  }
})
test('detached debugging is opt-in and never requires a worker', () => {
  for (const port of [0, 9223]) {
    const options = resolveDetachedOptions({port})
    expect(detachedArguments(options, true)).toContain(`--remote-debugging-port=${port}`)
    expect(detachedArguments(options, true)).toContain('--remote-debugging-address=127.0.0.1')
  }
})
