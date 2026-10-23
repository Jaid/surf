export const spawnDetached = async (command: Array<string>) => {
  if (process.platform === 'win32') {
    // Break away from terminal/runner Job Objects as well as its console.
    const {WindowsBackgroundProcessLauncher} = await import('./WindowsBackgroundProcessLauncher.ts')
    const launcher = new WindowsBackgroundProcessLauncher
    return launcher.spawn(command, {
      cwd: process.cwd(),
      env: process.env,
    })
  }
  const child = Bun.spawn(command, {
    detached: true,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
  })
  child.unref()
  return child.pid
}
