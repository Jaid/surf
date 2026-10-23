import type {UnmanagedInfo} from '../src/browser/launchUnmanaged.ts'

import {expect, test} from 'bun:test'
import {tmpdir} from 'node:os'

import {join} from 'forward-slash-path'
import fs from 'fs-extra'

const executableFile = Bun.env.SURF_TEST_BROWSER
const integration = test.skipIf(!executableFile)
const nativeIntegration = test.skipIf(!executableFile || !Bun.env.SURF_TEST_NATIVE)
const launch = async (url: string, folder: string, headless: boolean) => {
  const child = Bun.spawn([
    process.execPath,
    join(import.meta.dir, '../src/main.ts'),
    url,
    '--app',
    '--unmanaged',
    '--executable-file',
    executableFile!,
    '--user-data-dir',
    join(folder, 'profile'),
    '--cache-folder',
    join(folder, 'cache'),
    ...headless ? ['--', '--headless=new'] : [],
  ], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const timer = setTimeout(() => child.kill(), 15_000)
  try {
    const output = new Response(child.stdout)
    const errors = new Response(child.stderr)
    const [code, stdout, stderr] = await Promise.all([child.exited, output.text(), errors.text()])
    expect(stderr).toBe('')
    expect(code).toBe(0)
    return JSON.parse(stdout) as UnmanagedInfo
  } finally {
    clearTimeout(timer)
  }
}
const alive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const waitFor = async (check: () => boolean) => {
  const deadline = Date.now() + 15_000
  while (!check() && Date.now() < deadline) {
    await Bun.sleep(100)
  }
  expect(check()).toBe(true)
}
const closeBrowser = async (pid: number) => {
  if (!alive(pid)) {
    return
  }
  if (process.platform === 'win32') {
    const child = Bun.spawn(['taskkill.exe', '/PID', String(pid), '/T', '/F'], {
      stdout: 'ignore',
      stderr: 'ignore',
      windowsHide: true,
    })
    await child.exited
  } else {
    process.kill(-pid, 'SIGKILL')
  }
  await waitFor(() => !alive(pid))
}
const removeFolder = async (folder: string) => {
  // Windows browser descendants can release profile locks shortly after the root exits.
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rm(folder, {
        recursive: true,
        force: true,
      })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt >= 50 || !['EBUSY', 'ENOTEMPTY', 'EPERM'].includes(code ?? '')) {
        throw error
      }
      await Bun.sleep(100)
    }
  }
}
integration('unmanaged CLI exits without a worker, profile cleanup, or CDP endpoint', async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), 'surf-unmanaged-test-'))
  let info: UnmanagedInfo | undefined
  let loaded = false
  const server = Bun.serve({
    port: 0,
    fetch() {
      loaded = true
      return new Response('<title>Surf unmanaged test</title>', {headers: {'content-type': 'text/html'}})
    },
  })
  try {
    info = await launch(server.url.href, folder, true)
    expect(info.mode).toBe('unmanaged')
    expect(info.temporary).toBe(false)
    expect(info).not.toHaveProperty('webSocketDebuggerUrl')
    expect(info).not.toHaveProperty('logFile')
    await waitFor(() => loaded)
    expect(alive(info.spawnedPid)).toBe(true)
    expect(await fs.pathExists(join(folder, 'cache'))).toBe(false)
    expect(await fs.pathExists(join(folder, 'profile/DevToolsActivePort'))).toBe(false)
    await closeBrowser(info.spawnedPid)
    expect(await fs.pathExists(join(folder, 'profile'))).toBe(true)
  } finally {
    await server.stop(true)
    if (info) {
      await closeBrowser(info.spawnedPid)
    }
    await removeFolder(folder)
  }
}, 45_000)
nativeIntegration('unmanaged app launches hand off to the same running persistent browser', async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), 'surf-unmanaged-handoff-'))
  const requests = new Set<string>
  const launches: Array<UnmanagedInfo> = []
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const requestUrl = new URL(request.url)
      const path = requestUrl.pathname
      requests.add(path)
      return new Response('<title>Surf unmanaged handoff test</title>', {headers: {'content-type': 'text/html'}})
    },
  })
  try {
    const firstUrl = new URL('/first', server.url)
    const first = await launch(firstUrl.href, folder, false)
    launches.push(first)
    await waitFor(() => requests.has('/first'))
    const secondUrl = new URL('/second', server.url)
    const second = await launch(secondUrl.href, folder, false)
    launches.push(second)
    await waitFor(() => requests.has('/second'))
    await waitFor(() => !alive(second.spawnedPid))
    expect(alive(first.spawnedPid)).toBe(true)
    expect(await fs.pathExists(join(folder, 'cache'))).toBe(false)
  } finally {
    await server.stop(true)
    for (const info of launches.toReversed()) {
      await closeBrowser(info.spawnedPid)
    }
    await removeFolder(folder)
  }
}, 60_000)
