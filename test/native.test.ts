import {expect, test} from 'bun:test'

import {join} from 'forward-slash-path'

test.skipIf(process.platform !== 'win32' || !Bun.which('pwsh'))('native icon helper compiles and does not match unrelated processes', async () => {
  const file = join(import.meta.dir, '../src/icon/WindowIcon.cs').replaceAll("'", "''")
  const child = Bun.spawn(['pwsh', '-NoProfile', '-NonInteractive', '-Command', `Add-Type -Path '${file}'; [SurfWindowIcon]::Windows($PID).Count`], {
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true,
  })
  const output = new Response(child.stdout)
  const errors = new Response(child.stderr)
  expect(await child.exited).toBe(0)
  expect(await errors.text()).toBe('')
  const stdout = await output.text()
  expect(stdout.trim()).toBe('0')
}, 20_000)
