import type {CDPSession, Protocol} from 'puppeteer-core'

import {expect, mock, test} from 'bun:test'

import {finishTracing, resolveTraceStopTimeout} from '../src/trace/finishTracing.ts'

const event: Protocol.Tracing.TracingCompleteEvent = {
  dataLossOccurred: false,
  stream: 'trace',
  traceFormat: 'proto',
  streamCompression: 'gzip',
}
const session = (send = mock(async () => ({}))) => ({
  send,
  cdp: {send} as unknown as Pick<CDPSession, 'send'>,
})
test('finalization timeout defaults to five minutes and accepts zero', () => {
  expect(resolveTraceStopTimeout()).toBe(300_000)
  expect(resolveTraceStopTimeout(0)).toBe(0)
  for (const value of [-1, 0.5, Number.NaN, Infinity, 2_147_483_648]) {
    expect(() => resolveTraceStopTimeout(value)).toThrow('trace-stop-timeout')
  }
})
test('waits for both the command acknowledgement and trace stream', async () => {
  const ack = Promise.withResolvers<object>()
  const complete = Promise.withResolvers<Protocol.Tracing.TracingCompleteEvent>()
  const {cdp, send} = session(mock(() => ack.promise))
  const result = finishTracing(cdp, complete.promise, 1000)
  let done = false
  void result.then(() => {
    done = true
  }, () => {})
  complete.resolve(event)
  await Bun.sleep(10)
  expect(done).toBe(false)
  ack.resolve({})
  expect(await result).toEqual(event)
  expect(send).toHaveBeenCalledWith('Tracing.end', undefined, {timeout: 1000})
})
test('a finalization deadline covers a hung command acknowledgement', async () => {
  const {cdp} = session(mock(() => new Promise<object>(() => {})))
  await expect(finishTracing(cdp, Promise.resolve(event), 10)).rejects.toThrow('Increase --trace-stop-timeout')
})
test('a finalization deadline covers a missing completion event', async () => {
  const {cdp} = session()
  await expect(finishTracing(cdp, new Promise(() => {}), 10)).rejects.toThrow('within 10 ms')
})
test('zero disables the deadline and overrides the CDP command timeout', async () => {
  const {cdp, send} = session()
  const complete = Bun.sleep(40).then(() => event)
  expect(await finishTracing(cdp, complete, 0)).toEqual(event)
  expect(send).toHaveBeenCalledWith('Tracing.end', undefined, {timeout: 0})
})
test('disconnect and command errors reject without waiting for the deadline', async () => {
  const pending = new Promise<Protocol.Tracing.TracingCompleteEvent>(() => {})
  const {cdp} = session(mock(async () => {
    throw new Error('command failed')
  }))
  await expect(finishTracing(cdp, pending, 0)).rejects.toThrow('command failed')
  const hung = session(mock(() => new Promise<object>(() => {})))
  await expect(finishTracing(hung.cdp, Promise.reject(new Error('disconnected')), 0)).rejects.toThrow('disconnected')
})
test('a completion event later than the old 30-second deadline is accepted', async () => {
  const {cdp} = session()
  expect(await finishTracing(cdp, Bun.sleep(31_000).then(() => event), resolveTraceStopTimeout())).toEqual(event)
}, 40_000)
