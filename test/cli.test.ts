import {expect, test} from 'bun:test'

import {resolve} from 'forward-slash-path'

const cli = async (...args: Array<string>) => {
  const process = Bun.spawn([Bun.argv[0], resolve(import.meta.dir, '../src/main.ts'), ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const output = new Response(process.stdout)
  const errors = new Response(process.stderr)
  const [code, stdout, stderr] = await Promise.all([process.exited, output.text(), errors.text()])
  return {
    code,
    stdout,
    stderr,
  }
}
test('help and version work without a browser', async () => {
  const help = await cli('--help')
  const traceHelp = await cli('trace', '--help')
  const version = await cli('--version')
  expect(help.stdout).toContain('--user-data-dir')
  expect(traceHelp.stdout).toContain('--target-id')
  expect(version.code).toBe(0)
})
test('dump supports URL placement, spaces, app mode, and browser passthrough', async () => {
  for (const args of [
    ['example.com', '--app'],
    ['--app', 'example.com'],
    ['--app', '--url', 'example.com'],
  ]) {
    const result = await cli(...args, '--dump', '--executable-file', Bun.argv[0], '--user-data-dir', 'profile with spaces', '--', '--enable-features=OverlayScrollbar')
    expect(result.code).toBe(0)
    const dump = JSON.parse(result.stdout) as {
      args: Array<string>
      temporary: boolean
    }
    expect(dump.args).toContain('--app=https://example.com/')
    expect(dump.args).toContain('--enable-features=OverlayScrollbar')
    expect(dump.temporary).toBe(false)
  }
})
test('invalid inputs fail without launching', async () => {
  for (const args of [
    ['--unknown'],
    ['first.com', 'second.com'],
    ['first.com', '--url', 'second.com'],
    ['--port', '65536'],
    ['--port', 'nan'],
    ['--app', '--kiosk'],
    ['--trace', 'out.msgpack.br', '--detached'],
    ['--duration', '10'],
    ['--unmanaged', '--trace', 'out.msgpack.br'],
    ['--unmanaged', '--app', '--better-icon'],
    ['--unmanaged', '--port', '-1'],
    ['--trace', ''],
    ['--', '--user-data-dir=elsewhere'],
    ['trace', 'unexpected'],
    ['trace', '--duration', '0'],
  ]) {
    const result = await cli(...args[0] === 'trace' ? args : ['--dump', ...args])
    expect(result.code).not.toBe(0)
  }
})
test('explicit false booleans stay false', async () => {
  const result = await cli('--dump', '--executable-file', Bun.argv[0], '--app=false', '--better-icon=false', '--detached=false')
  expect(result.code).toBe(0)
  const dump = JSON.parse(result.stdout) as {
    args: Array<string>
    betterIcon: boolean
    detached: boolean
  }
  expect(dump.detached).toBe(false)
  expect(dump.betterIcon).toBe(false)
  expect(dump.args.some(arg => arg.startsWith('--app='))).toBe(false)
})
test('unmanaged CLI dump uses native profiles and implies detachment', async () => {
  const result = await cli('pro.x.com', '--app', '--unmanaged', '--dump', '--executable-file', Bun.argv[0])
  expect(result.code).toBe(0)
  const dump = JSON.parse(result.stdout) as {
    args: Array<string>
    detached: boolean
    temporary: boolean
    unmanaged: boolean
  }
  expect(dump.unmanaged).toBe(true)
  expect(dump.detached).toBe(true)
  expect(dump.temporary).toBe(false)
  expect(dump.args).toEqual(['--new-window', '--profile-directory=Default', '--app=https://pro.x.com/'])
})
test('unmanaged CLI passes an explicitly requested debugging port without management flags', async () => {
  const result = await cli('about:blank', '--unmanaged', '--port', '9223', '--dump', '--executable-file', Bun.argv[0])
  expect(result.code).toBe(0)
  const dump = JSON.parse(result.stdout) as {
    args: Array<string>
    unmanaged: boolean
  }
  expect(dump.unmanaged).toBe(true)
  expect(dump.args).toContain('--remote-debugging-port=9223')
  expect(dump.args).not.toContain('--disable-background-mode')
  expect(dump.args.some(arg => arg.startsWith('--user-data-dir='))).toBe(false)
})
