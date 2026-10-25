import {expect, spyOn, test} from 'bun:test'

import {TraceTitle} from '../src/trace/TraceTitle.ts'

const terminal = (isTTY = true) => {
  const writes: Array<string> = []
  return {
    writes,
    isTTY,
    write(value: Uint8Array | string) {
      writes.push(String(value))
      return true
    },
  }
}
test('trace title shows buffer and elapsed minutes/seconds, then restores once', () => {
  const output = terminal()
  const clock = spyOn(performance, 'now').mockReturnValue(1000)
  try {
    const title = new TraceTitle(true, output)
    title.start('https://slop.gallery/path?query=1')
    title.start('https://slop.gallery/path?query=1')
    expect(output.writes).toEqual(['\u{1B}[22;2t', '\u{1B}]2;0.0% 0m 0s slop.gallery\u{1B}\\'])
    clock.mockReturnValue(128_000)
    title.buffer(0.423)
    expect(output.writes.at(-1)).toContain('42.3% 2m 7s slop.gallery')
    const count = output.writes.length
    title.buffer(Number.NaN)
    title.buffer(Infinity)
    title.buffer(0.423)
    expect(output.writes.length).toBe(count)
    title.buffer(2)
    expect(output.writes.at(-1)).toContain('100.0%')
    title.buffer(-1)
    expect(output.writes.at(-1)).toContain('0.0%')
    title.saving()
    expect(output.writes.at(-1)).toContain('0.0% 2m 7s slop.gallery')
    title.buffer(0.5)
    expect(output.writes.at(-1)).toContain('0.0% 2m 7s slop.gallery')
    title[Symbol.dispose]()
    title[Symbol.dispose]()
    title.start('https://slop.gallery/path?query=1')
    expect(output.writes.filter(value => value === '\u{1B}[23;2t')).toHaveLength(1)
  } finally {
    clock.mockRestore()
  }
})
test('disabled titles and redirected stderr emit no escapes', () => {
  for (const [enabled, isTTY] of [[false, true], [true, false]]) {
    const output = terminal(isTTY)
    using title = new TraceTitle(enabled, output)
    title.start('https://slop.gallery/path?query=1')
    title.buffer(0.5)
    title.saving()
    expect(output.writes).toEqual([])
  }
})
test('elapsed time refreshes without new buffer events and stops on disposal', async () => {
  const output = terminal()
  using title = new TraceTitle(true, output)
  {
    title.start('https://slop.gallery/path?query=1')
    await Bun.sleep(1150)
    expect(output.writes.at(-1)).toContain('0m 1s')
    title[Symbol.dispose]()
    const count = output.writes.length
    await Bun.sleep(1100)
    expect(output.writes.length).toBe(count)
  }
})
