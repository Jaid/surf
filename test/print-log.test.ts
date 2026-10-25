import {expect, test} from 'bun:test'

import {resolvePrintLog} from '../src/log/categories.ts'
import {logText, remoteText} from '../src/log/format.ts'

test('print-log validates and deduplicates categories', () => {
  expect(resolvePrintLog()).toEqual([])
  expect(resolvePrintLog(['console', 'network', 'console'])).toEqual(['console', 'network'])
  for (const category of ['', 'Console', 'console,network', 'unknown']) {
    expect(() => resolvePrintLog([category])).toThrow('Unknown print-log category')
  }
})
test('console values render without evaluating browser objects', () => {
  expect(remoteText({
    type: 'string',
    value: 'hello',
  })).toBe('hello')
  expect(remoteText({
    type: 'number',
    value: 42,
  })).toBe('42')
  expect(remoteText({
    type: 'object',
    subtype: 'null',
    value: null,
  })).toBe('null')
  expect(remoteText({type: 'undefined'})).toBe('undefined')
  expect(remoteText({
    type: 'number',
    unserializableValue: 'NaN',
  })).toBe('NaN')
  expect(remoteText({
    type: 'bigint',
    unserializableValue: '42n',
  })).toBe('42n')
  expect(remoteText({
    type: 'object',
    subtype: 'error',
    description: 'Error: failure\n  at example.js:1',
  })).toContain('Error: failure')
  expect(remoteText({
    type: 'object',
    description: 'Object',
    preview: {
      type: 'object',
      overflow: true,
      properties: [{
        type: 'number',
        name: 'answer',
        value: '42',
      }],
    },
  })).toBe('Object { answer: 42, … }')
})
test('page log text cannot inject terminal control sequences', () => {
  expect(logText('hello\nworld\t!')).toBe('hello\nworld\t!')
  expect(logText('\u{1B}]2;title\u{7}')).toBe(String.raw`\u001b]2;title\u0007`)
  expect(logText('progress\rreplace')).toBe(String.raw`progress\u000dreplace`)
})
