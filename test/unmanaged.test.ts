import {expect, test} from 'bun:test'
import {tmpdir} from 'node:os'

import {join} from 'forward-slash-path'
import fs from 'fs-extra'

import {launchUnmanaged, resolveUnmanagedOptions, unmanagedArguments} from '../src/browser/launchUnmanaged.ts'

test('unmanaged apps use the normal browser profile without management switches', () => {
  const options = resolveUnmanagedOptions({
    app: true,
    url: 'github.com/repos?q=sort%3Aupdated+owner%3Ajaid,jaidlab',
  })
  expect(options.userDataDir).toBeUndefined()
  expect(unmanagedArguments(options)).toEqual([
    '--new-window',
    '--profile-directory=Default',
    '--app=https://github.com/repos?q=sort%3Aupdated+owner%3Ajaid,jaidlab',
  ])
})
test('unmanaged launches preserve profile, performance, and passthrough options', () => {
  const options = resolveUnmanagedOptions({
    app: true,
    profile: 'profile_jaid',
    userDataDir: './data with spaces',
    performance: true,
    url: 'https://discord.com/channels/@me',
    args: ['--enable-features=JXLImageFormat'],
  })
  const args = unmanagedArguments(options)
  expect(args).toContain('--profile-directory=profile_jaid')
  expect(args).toContain(`--user-data-dir=${options.userDataDir}`)
  expect(args).toContain('--force-high-performance-gpu')
  expect(args).toContain('--enable-features=JXLImageFormat')
  expect(args.at(-1)).toBe('--app=https://discord.com/channels/@me')
  expect(args.some(arg => arg.startsWith('--remote-debugging'))).toBe(false)
})
test('unmanaged launches reject management-only options even from JavaScript callers', () => {
  for (const input of [
    {
      app: true,
      betterIcon: true,
    },
  ]) {
    expect(() => resolveUnmanagedOptions(input)).toThrow('Unmanaged launches')
  }
})
test('failed executable resolution does not create a persistent profile', async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), 'surf-unmanaged-failure-'))
  const userDataDir = join(folder, 'profile')
  try {
    await expect(launchUnmanaged({
      executableFile: join(folder, 'missing-browser.exe'),
      userDataDir,
    })).rejects.toThrow()
    expect(await fs.pathExists(userDataDir)).toBe(false)
  } finally {
    await fs.remove(folder)
  }
})
test('unmanaged debugging is opt-in and never requires a worker', () => {
  for (const port of [0, 9223]) {
    const options = resolveUnmanagedOptions({port})
    expect(unmanagedArguments(options, true)).toContain(`--remote-debugging-port=${port}`)
    expect(unmanagedArguments(options, true)).toContain('--remote-debugging-address=127.0.0.1')
  }
})
