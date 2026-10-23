import {describe, expect, test} from 'bun:test'
import {homedir} from 'node:os'

import {browserArguments, normalizeUrl, resolveOptions} from '../src/browser/options.ts'
import {resolvePath} from '../src/lib/paths.ts'
import {quoteWindowsArgument} from '../src/process/commandLine.ts'

describe('URLs', () => {
  for (const [input, expected] of [
    ['example.com', 'https://example.com/'],
    ['example.com:8443/a', 'https://example.com:8443/a'],
    ['localhost:5173/a', 'http://localhost:5173/a'],
    ['127.0.0.1:8080', 'http://127.0.0.1:8080/'],
    ['[::1]:8080', 'http://[::1]:8080/'],
    ['about:blank', 'about:blank'],
    ['brave://flags', 'brave://flags'],
    ['file:///C:/test.html', 'file:///C:/test.html'],
    ['https://example.com/?a=1+2&a=x%26y&raw=%25#hello', 'https://example.com/?a=1+2&a=x%26y&raw=%25#hello'],
    ['https://example.com/ä b?q=a b', 'https://example.com/%C3%A4%20b?q=a%20b'],
  ]) {
    test(input, () => expect(normalizeUrl(input)).toBe(expected))
  }
  for (const input of ['', ' ', 'javascript:alert(1)', 'https://', 'https://example.com/\n--evil']) {
    test(`rejects ${JSON.stringify(input)}`, () => expect(() => normalizeUrl(input)).toThrow())
  }
})
test('launch defaults and app/fullscreen modes', () => {
  const options = resolveOptions({url: 'example.com'})
  expect(options.port).toBe(0)
  expect(options.userDataDir).toBeUndefined()
  const args = browserArguments(options, 'C:/profile with spaces')
  expect(args).toContain('--user-data-dir=C:/profile with spaces')
  expect(args.at(-1)).toBe('https://example.com/')
  expect(args).not.toContain('--enable-automation')
  expect(browserArguments(resolveOptions({app: true}), 'profile').at(-1)).toStartWith('--app=')
  expect(browserArguments(resolveOptions({kiosk: true}), 'profile')).toContain('--kiosk')
  expect(() => resolveOptions({
    app: true,
    kiosk: true,
  })).toThrow()
})
test('validates lifecycle switches and numeric boundaries', () => {
  for (const port of [-1, 65_536, 1.2, Number.NaN, Infinity]) {
    expect(() => resolveOptions({port})).toThrow()
  }
  for (const arg of ['--user-data-dir=x', '--profile-directory=Default', '--remote-debugging-port=9', '--remote-debugging-pipe', '--app=x', '--kiosk', '--no-startup-window', 'example.com', '--foo\0bar']) {
    expect(() => resolveOptions({args: [arg]})).toThrow()
  }
  expect(resolveOptions({args: ['--enable-features=OverlayScrollbar']})).toHaveProperty('args', ['--enable-features=OverlayScrollbar'])
  expect(() => resolveOptions({betterIcon: true})).toThrow()
  for (const profile of ['', '../profile', '.', '..', 'foo/bar', String.raw`foo\bar`]) {
    expect(() => resolveOptions({profile})).toThrow()
  }
})
test('home expansion and Windows argument quoting', () => {
  expect(resolvePath('~/surf')).toBe(`${homedir().replaceAll('\\', '/')}/surf`)
  expect(quoteWindowsArgument('')).toBe('""')
  expect(quoteWindowsArgument('plain')).toBe('plain')
  expect(quoteWindowsArgument('a b')).toBe('"a b"')
  expect(quoteWindowsArgument('a"b')).toBe(String.raw`"a\"b"`)
})
