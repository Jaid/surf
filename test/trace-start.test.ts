import {expect, test} from 'bun:test'
import {PassThrough} from 'node:stream'

import {requireTraceInput, validateTraceStart, waitForTraceStart} from '../src/trace/waitForTraceStart.ts'

const terminal = () => Object.assign(new PassThrough, {isTTY: true}) as unknown as NodeJS.ReadStream
test('trace start validates modes, delay bounds, and terminal availability', () => {
  for (const traceDelay of [-1, NaN, Infinity, 0.1, 2_147_483_648]) {
    expect(() => validateTraceStart({traceDelay})).toThrow()
  }
  validateTraceStart({traceDelay: 0})
  expect(() => validateTraceStart({traceStart: 'invalid' as 'manual'})).toThrow()
  expect(() => requireTraceInput({traceStart: 'manual'}, Object.assign(new PassThrough, {isTTY: false}) as unknown as NodeJS.ReadStream)).toThrow('interactive')
})
test('immediate start does not wait for input', async () => {
  expect(await waitForTraceStart({}, new Promise(() => {}))).toBeUndefined()
})
test('manual start waits for Enter and releases its input listeners', async () => {
  const input = terminal()
  const waiting = waitForTraceStart({traceStart: 'manual'}, new Promise(() => {}), input)
  expect(input.listenerCount('data')).toBe(1)
  input.emit('data', Buffer.from('x'))
  expect(input.listenerCount('data')).toBe(1)
  input.emit('data', Buffer.from('\r\n'))
  expect(await waiting).toBeUndefined()
  expect(input.listenerCount('data')).toBe(0)
  expect(input.listenerCount('end')).toBe(0)
  expect(input.listenerCount('error')).toBe(0)
  input.destroy()
})
test('manual cancellation cleans up without starting', async () => {
  const input = terminal()
  const stop = Promise.withResolvers<number>()
  const waiting = waitForTraceStart({traceStart: 'manual'}, stop.promise, input)
  stop.resolve(130)
  expect(await waiting).toBe(130)
  expect(input.listenerCount('data')).toBe(0)
  input.destroy()
})
test('manual input closure rejects instead of hanging', async () => {
  const input = terminal()
  const waiting = waitForTraceStart({traceStart: 'manual'}, new Promise(() => {}), input)
  input.emit('end')
  await expect(waiting).rejects.toThrow('input closed')
  expect(input.listenerCount('data')).toBe(0)
  input.destroy()
})
test('delay runs after manual confirmation and is interruptible', async () => {
  const input = terminal()
  const stop = Promise.withResolvers<number>()
  const waiting = waitForTraceStart({
    traceStart: 'manual',
    traceDelay: 10_000,
  }, stop.promise, input)
  input.emit('data', Buffer.from('\n'))
  await Bun.sleep(10)
  stop.resolve(143)
  expect(await waiting).toBe(143)
  input.destroy()
})
test('delay completes only after its interval', async () => {
  const started = performance.now()
  expect(await waitForTraceStart({traceDelay: 40}, new Promise(() => {}))).toBeUndefined()
  expect(performance.now() - started).toBeGreaterThanOrEqual(30)
})
