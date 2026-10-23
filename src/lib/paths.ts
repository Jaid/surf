import {homedir} from 'node:os'

import {join, resolve} from 'forward-slash-path'

export const resolvePath = (value: string) => {
  if (value.includes('\0') || !value.trim()) {
    throw new Error('Paths must be nonempty and contain no NUL characters.')
  }
  if (value === '~') {
    return resolve(homedir())
  }
  return resolve(/^~[/\\]/.test(value) ? join(homedir(), value.slice(2)) : value)
}

export const defaultCacheFolder = () => {
  if (process.platform === 'win32') {
    return join(Bun.env.LOCALAPPDATA || join(homedir(), 'AppData/Local'), 'surf')
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library/Caches/surf')
  }
  return join(Bun.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'surf')
}
