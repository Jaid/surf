import {expect, test} from 'bun:test'
import {tmpdir} from 'node:os'

import {join} from 'forward-slash-path'
import fs from 'fs-extra'

import {BrowserSession} from '../src/browser/BrowserSession.ts'

test.skipIf(process.platform !== 'win32' || !Bun.env.SURF_TEST_NATIVE || !Bun.env.SURF_TEST_BROWSER)('app window receives the rendered native icon', async () => {
  const folder = await fs.mkdtemp(join(tmpdir(), 'surf-native-test-'))
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const requestUrl = new URL(request.url)
      if (requestUrl.pathname === '/icon.svg') {
        return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#03fe89" d="M0 0h256v256H0z"/></svg>', {headers: {'content-type': 'image/svg+xml'}})
      }
      return new Response('<title>Surf icon test</title><link rel="icon" href="/icon.svg"><h1>Surf native icon test</h1>', {headers: {'content-type': 'text/html'}})
    },
  })
  try {
    await using session = await BrowserSession.launch({
      executableFile: Bun.env.SURF_TEST_BROWSER,
      app: true,
      betterIcon: true,
      url: server.url.href,
      cacheFolder: folder,
    })
    const helper = join(import.meta.dir, '../src/icon/WindowIcon.cs').replaceAll("'", "''")
    const script = `
Add-Type -Path '${helper}'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class SurfIconProbe {
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint msg, IntPtr param, IntPtr value, uint flags, uint timeout, out IntPtr result);
}
'@
$deadline = [DateTime]::UtcNow.AddSeconds(10)
while ([DateTime]::UtcNow -lt $deadline) {
  $windows = [SurfWindowIcon]::Windows(${session.pid})
  if ($windows.Count -eq 1) {
    $handle = [IntPtr]::Zero
    [void][SurfIconProbe]::SendMessageTimeout($windows[0], 0x7F, [IntPtr]1, [IntPtr]::Zero, 2, 250, [ref]$handle)
    if ($handle -ne [IntPtr]::Zero) {
      $icon = [Drawing.Icon]::FromHandle($handle)
      $bitmap = $icon.ToBitmap()
      try {
        $pixel = $bitmap.GetPixel([int]($bitmap.Width/2), [int]($bitmap.Height/2))
        if ($pixel.R -eq 3 -and $pixel.G -eq 254 -and $pixel.B -eq 137) { 'matched'; exit 0 }
      } finally { $bitmap.Dispose(); $icon.Dispose() }
    }
  }
  Start-Sleep -Milliseconds 100
}
throw 'Native icon did not match the rendered source.'
`
    const probe = Bun.spawn(['pwsh', '-NoProfile', '-NonInteractive', '-Command', script], {
      stdout: 'pipe',
      stderr: 'pipe',
      windowsHide: true,
    })
    const output = new Response(probe.stdout)
    const errors = new Response(probe.stderr)
    const [code, stdout, stderr] = await Promise.all([probe.exited, output.text(), errors.text()])
    expect(stderr).toBe('')
    expect(code).toBe(0)
    expect(stdout.trim()).toBe('matched')
  } finally {
    await server.stop(true)
    await fs.remove(folder)
  }
}, 45_000)
