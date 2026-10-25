import {expect, test} from 'bun:test'
import {PassThrough} from 'node:stream'

import {TraceInput} from '../src/trace/TraceInput.ts'

const stream = (isTTY = true) => {
  const input = new PassThrough
  Object.defineProperty(input, 'isTTY', {value: isTTY})
  return input as unknown as NodeJS.ReadStream
}
test('queues one restart during saving and consumes it exactly once', async () => {
  const source = stream()
  using input = new TraceInput(source)
  source.emit('data', Buffer.from('\r\n'))
  source.emit('data', Buffer.from('\n'))
  expect(await input.wait(new Promise(() => {}))).toEqual({kind: 'enter'})
  expect(await input.wait(Promise.resolve(130))).toEqual({
    kind: 'other',
    value: 130,
  })
  source.emit('data', Buffer.from('ignored'))
  expect(await input.wait(Promise.resolve(0))).toEqual({
    kind: 'other',
    value: 0,
  })
  source.emit('data', Buffer.from('\n'))
  expect(await input.wait(new Promise(() => {}))).toEqual({kind: 'enter'})
})
test('interruption takes precedence over an already queued Enter', async () => {
  using input = new TraceInput(stream())
  input.request()
  expect(await input.wait(Promise.resolve(130))).toEqual({
    kind: 'other',
    value: 130,
  })
})
test('input completion wakes a waiter and disposal restores listeners/pause state', async () => {
  const source = stream()
  source.pause()
  const title = new TraceInput(source)
  source.emit('end')
  expect(await title.wait(new Promise(() => {}))).toEqual({kind: 'end'})
  title[Symbol.dispose]()
  expect(source.listenerCount('data')).toBe(0)
  expect(source.listenerCount('end')).toBe(0)
  expect(source.listenerCount('error')).toBe(0)
  expect(source.isPaused()).toBe(true)
})
test('non-terminal input is not consumed', () => {
  const source = stream(false)
  using input = new TraceInput(source)
  expect(source.listenerCount('data')).toBe(0)
})
test('a CRLF split across input chunks is still one Enter', async () => {
  const source = stream()
  using input = new TraceInput(source)
  source.emit('data', Buffer.from('\r'))
  expect(await input.wait(new Promise(() => {}))).toEqual({kind: 'enter'})
  source.emit('data', Buffer.from('\n'))
  expect(await input.wait(Promise.resolve(0))).toEqual({
    kind: 'other',
    value: 0,
  })
  source.emit('data', Buffer.from('\r'))
  expect(await input.wait(new Promise(() => {}))).toEqual({kind: 'enter'})
})
test('an initially untouched terminal is paused again on disposal', () => {
  const source = stream()
  expect(source.readableFlowing).toBeNull()
  const input = new TraceInput(source)
  expect(source.readableFlowing).toBe(true)
  input[Symbol.dispose]()
  expect(source.isPaused()).toBe(true)
})
test('an already flowing terminal remains flowing on disposal', () => {
  const source = stream()
  source.resume()
  const input = new TraceInput(source)
  input[Symbol.dispose]()
  expect(source.readableFlowing).toBe(true)
  source.pause()
})
