import {expect, test} from 'bun:test'
import {tmpdir} from 'node:os'

import {resolve} from 'forward-slash-path'

import {resolveTraceCategories} from '../src/trace/categories.ts'

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
    ['--print-log', 'unknown'],
    ['--print-log', 'console', '--background'],
    ['--print-log', 'network', '--detached'],
    ['--background', '--detached'],
    ['-b', '-d'],
    ['trace', '--print-log', 'unknown'],
    ['first.com', 'second.com'],
    ['first.com', '--url', 'second.com'],
    ['--port', '65536'],
    ['--port', 'nan'],
    ['--app', '--kiosk'],
    ['--trace', 'out.msgpack.br', '--background'],
    ['--trace', '--background'],
    ['--trace', '--detached'],
    ['--duration', '10'],
    ['--trace-category', 'gpu'],
    ['--trace-exclude', 'surf.console'],
    ['--trace-start', 'manual'],
    ['--trace-delay', '0'],
    ['--exit-after-trace'],
    ['--trace-stop-timeout', '0'],
    ['--trace', '--trace-stop-timeout', '-1'],
    ['trace', '--trace-stop-timeout', 'NaN'],
    ['--trace', '--trace-start', 'invalid'],
    ['--trace', '--trace-delay', '-1'],
    ['trace', '--trace-delay', '-1'],
    ['trace', '--exit-after-trace'],
    ['--trace', '--trace-category', 'surf.typo'],
    ['--trace-preset', 'network'],
    ['--trace', 'out.msgpack.br', '--trace-preset', 'missing'],
    ['trace', '--trace-preset', 'missing'],
    ['trace', '--trace-preset'],
    ['--detached', '--trace', 'out.msgpack.br'],
    ['--detached', '--app', '--better-icon'],
    ['--detached', '--grant', 'local-network', 'example.com'],
    ['--grant', 'local-network', 'about:blank'],
    ['--grant', 'Local_Network', 'example.com'],
    ['--detached', '--port', '-1'],
    ['--unmanaged'],
    ['--', '--user-data-dir=elsewhere'],
    ['trace', 'unexpected'],
    ['trace', '--duration', '0'],
  ]) {
    const result = await cli(...args[0] === 'trace' ? args : ['--dump', ...args])
    expect(result.code).not.toBe(0)
  }
})
test('explicit false booleans stay false', async () => {
  const result = await cli('--dump', '--executable-file', Bun.argv[0], '--app=false', '--better-icon=false', '--background=false', '--detached=false')
  expect(result.code).toBe(0)
  const dump = JSON.parse(result.stdout) as {
    args: Array<string>
    background: boolean
    betterIcon: boolean
    detached: boolean
  }
  expect(dump.background).toBe(false)
  expect(dump.detached).toBe(false)
  expect(dump.betterIcon).toBe(false)
  expect(dump.args.some(arg => arg.startsWith('--app='))).toBe(false)
})
test('background CLI dump keeps a managed, temporary profile', async () => {
  for (const flag of ['--background', '-b']) {
    const result = await cli('example.com', flag, '--dump', '--executable-file', Bun.argv[0])
    expect(result.code).toBe(0)
    const dump = JSON.parse(result.stdout) as {
      args: Array<string>
      background: boolean
      detached: boolean
      temporary: boolean
    }
    expect(dump.background).toBe(true)
    expect(dump.detached).toBe(false)
    expect(dump.temporary).toBe(true)
    expect(dump.args).toContain('--disable-background-mode')
  }
})
test('detached CLI dump uses native profiles without a worker', async () => {
  for (const flag of ['--detached', '-d']) {
    const result = await cli('pro.x.com', '--app', flag, '--dump', '--executable-file', Bun.argv[0])
    expect(result.code).toBe(0)
    const dump = JSON.parse(result.stdout) as {
      args: Array<string>
      background: boolean
      detached: boolean
      temporary: boolean
    }
    expect(dump.detached).toBe(true)
    expect(dump.background).toBe(false)
    expect(dump.temporary).toBe(false)
    expect(dump.args).toEqual(['--new-window', '--profile-directory=Default', '--app=https://pro.x.com/'])
  }
})
test('detached CLI passes an explicitly requested debugging port without management flags', async () => {
  const result = await cli('about:blank', '--detached', '--port', '9223', '--dump', '--executable-file', Bun.argv[0])
  expect(result.code).toBe(0)
  const dump = JSON.parse(result.stdout) as {
    args: Array<string>
    detached: boolean
  }
  expect(dump.detached).toBe(true)
  expect(dump.args).toContain('--remote-debugging-port=9223')
  expect(dump.args).not.toContain('--disable-background-mode')
  expect(dump.args.some(arg => arg.startsWith('--user-data-dir='))).toBe(false)
})
test('launch-time trace presets replace defaults and merge repeated flags', async () => {
  for (const presets of [[], ['network'], ['webgpu_game'], ['network', 'webgpu_game', 'network']]) {
    const result = await cli('--dump', '--executable-file', Bun.argv[0], '--trace', 'trace.msgpack.br', ...presets.flatMap(preset => ['--trace-preset', preset]))
    expect(result.code).toBe(0)
    const dump = JSON.parse(result.stdout) as {traceCategories: Array<string>}
    expect(dump.traceCategories).toEqual(resolveTraceCategories(presets))
  }
})
test('trace accepts an omitted output before flags, at the end, and before browser passthrough', async () => {
  const paths = new Set<string>
  for (const args of [['--trace'], ['--trace', '--app'], ['--trace', '--trace-preset', 'webgpu_game'], ['--trace', '--', '--headless=new'], ['--trace='], ['--trace', '']]) {
    const result = await cli('--dump', '--executable-file', Bun.argv[0], '--url', 'https://example.com', ...args)
    expect(result.code).toBe(0)
    const dump = JSON.parse(result.stdout) as {
      args: Array<string>
      trace: string
    }
    expect(dump.trace).toEndWith('.msgpack.br')
    expect(await Bun.file(dump.trace).exists()).toBe(false)
    expect(dump.trace.startsWith(`${resolve(tmpdir()).replaceAll('\\', '/')}/`)).toBe(true)
    paths.add(dump.trace)
    if (args.includes('--')) {
      expect(dump.args).toContain('--headless=new')
    }
  }
  expect(paths.size).toBe(6)
})
test('trace overrides and lifecycle controls appear in the launch plan', async () => {
  const result = await cli('--dump', '--executable-file', Bun.argv[0], '--trace', '--trace-preset', 'network', '--trace-category', 'gpu', '--trace-category', 'blink.console', '--trace-exclude', 'surf.console', '--trace-exclude', 'netlog', '--trace-start', 'manual', '--trace-delay', '5000', '--exit-after-trace')
  expect(result.code).toBe(0)
  const dump = JSON.parse(result.stdout) as {
    exitAfterTrace: boolean
    traceCategories: Array<string>
    traceDelay: number
    traceStart: string
  }
  expect(dump.traceCategories).toEqual(resolveTraceCategories(['network'], ['gpu', 'blink.console'], ['surf.console', 'netlog']))
  expect(dump.traceStart).toBe('manual')
  expect(dump.traceDelay).toBe(5000)
  expect(dump.exitAfterTrace).toBe(true)
})
test('manual tracing without a terminal fails before launching', async () => {
  const result = await cli('--executable-file', Bun.argv[0], '--trace', '--trace-start', 'manual')
  expect(result.code).not.toBe(0)
  expect(result.stderr).toContain('interactive terminal')
  expect(result.stdout).toBe('')
})
test('dump resolves both trace filenames from either extension or a stem', async () => {
  for (const suffix of ['', '.msgpack.br', '.pftrace.br']) {
    const result = await cli('--dump', '--executable-file', Bun.argv[0], '--trace', `pair${suffix}`)
    expect(result.code).toBe(0)
    const dump = JSON.parse(result.stdout) as {
      trace: string
      tracePerfetto: string
    }
    expect(dump.trace).toBe(resolve('pair.msgpack.br'))
    expect(dump.tracePerfetto).toBe(resolve('pair.pftrace.br'))
  }
})
test('trace title updates default on and accept explicit false', async () => {
  for (const enabled of [true, false]) {
    const result = await cli('--dump', '--executable-file', Bun.argv[0], '--trace', ...enabled ? [] : ['--title-updates=false'])
    expect(result.code).toBe(0)
    expect((JSON.parse(result.stdout) as {titleUpdates: boolean}).titleUpdates).toBe(enabled)
    expect(result.stdout).not.toContain('\u{1B}]')
  }
  const help = await cli('trace', '--help')
  expect(help.stdout).toContain('--title-updates')
})
test('trace stop timeout is resolved in the launch plan', async () => {
  for (const timeout of [undefined, 0, 600_000]) {
    const result = await cli('--dump', '--executable-file', Bun.argv[0], '--trace', ...timeout === undefined ? [] : ['--trace-stop-timeout', String(timeout)])
    expect(result.code).toBe(0)
    expect((JSON.parse(result.stdout) as {traceStopTimeout: number}).traceStopTimeout).toBe(timeout ?? 900_000)
  }
})
test('print-log is repeatable, independent of tracing, and initializes before navigation', async () => {
  const result = await cli('--dump', '--executable-file', Bun.argv[0], 'example.com', '--app', '--print-log', 'console', '--print-log', 'network', '--print-log', 'console')
  expect(result.code).toBe(0)
  const dump = JSON.parse(result.stdout) as {
    args: Array<string>
    navigateTo: string
    printLog: Array<string>
  }
  expect(dump.printLog).toEqual(['console', 'network'])
  expect(dump.args).toContain('--app=data:,')
  expect(dump.navigateTo).toBe('https://example.com/')
  const help = await cli('trace', '--help')
  expect(help.stdout).toContain('--print-log')
})
test('grant is repeatable and initializes before navigation', async () => {
  const result = await cli('--dump', '--executable-file', Bun.argv[0], 'example.com:8443/app', '--grant', 'local-network', '--grant', 'loopback-network', '--grant', 'local-network')
  expect(result.code).toBe(0)
  const dump = JSON.parse(result.stdout) as {
    args: Array<string>
    grant: Array<string>
    navigateTo: string
  }
  expect(dump.grant).toEqual(['local-network', 'loopback-network'])
  expect(dump.args.at(-1)).toBe('about:blank')
  expect(dump.navigateTo).toBe('https://example.com:8443/app')
  const help = await cli('--help')
  expect(help.stdout).toContain('--grant')
})
