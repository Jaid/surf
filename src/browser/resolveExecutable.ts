import {homedir} from 'node:os'

import {basename, dirname, join} from 'forward-slash-path'

import {resolvePath} from '../lib/paths.ts'

export const resolveExecutable = async (requested = Bun.env.BROWSER || undefined) => {
  if (requested !== undefined && !requested.trim()) {
    throw new Error('Browser executable must not be empty.')
  }
  const roots = [Bun.env.LOCALAPPDATA || join(homedir(), 'AppData/Local'), Bun.env.PROGRAMFILES || 'C:/Program Files', Bun.env['PROGRAMFILES(X86)'] || 'C:/Program Files (x86)']
  const candidates = requested ? [requested] : [
    'brave',
    'chrome',
    'msedge',
    'chromium',
    'chromium-browser',
    'google-chrome',
    ...process.platform === 'win32' ? roots.flatMap(root => [
      join(root, 'BraveSoftware/Brave-Browser/Application/brave.exe'),
      join(root, 'Google/Chrome/Application/chrome.exe'),
      join(root, 'Microsoft/Edge/Application/msedge.exe'),
    ]) : [],
    ...process.platform === 'darwin' ? [
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ] : [],
  ]
  for (const candidate of candidates) {
    let executable = Bun.which(candidate) ?? resolvePath(candidate)
    if (/_proxy\.exe$/i.test(basename(executable))) {
      for (const name of ['brave.exe', 'chrome.exe', 'msedge.exe']) {
        const browser = join(dirname(executable), name)
        if (await Bun.file(browser).exists()) {
          executable = browser
          break
        }
      }
    }
    if (await Bun.file(executable).exists()) {
      return executable.replaceAll('\\', '/')
    }
  }
  throw new Error(requested ? `Browser executable not found: ${requested}. Supply an executable, not a shell command.` : 'No Chromium browser found. Set BROWSER or pass --executable-file.')
}
