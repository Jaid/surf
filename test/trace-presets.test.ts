import {expect, test} from 'bun:test'

import {parseTracePreset, resolveTraceCategories, standardTraceCategories, tracePresets} from '../src/trace/categories.ts'

test('standard trace categories are minimal and exclude detailed opt-in instrumentation', () => {
  expect(resolveTraceCategories()).toEqual(['blink.user_timing', 'devtools.timeline', 'loading', 'toplevel'])
  expect(resolveTraceCategories([])).toEqual([...standardTraceCategories])
})
test('presets replace rather than extend the standard list', () => {
  expect(resolveTraceCategories(['network'])).toEqual([...tracePresets.network])
  expect(resolveTraceCategories(['network'])).not.toContain('toplevel')
  expect(resolveTraceCategories(['webgpu_game'])).toEqual([...tracePresets.webgpu_game])
})
test('repeated presets form a stable union without duplicate categories', () => {
  expect(resolveTraceCategories(['network', 'webgpu_game', 'network'])).toEqual([...new Set([...tracePresets.network, ...tracePresets.webgpu_game])])
  expect(resolveTraceCategories(['webgpu_game', 'webgpu_game'])).toEqual([...tracePresets.webgpu_game])
})
test('invalid and inherited names are rejected', () => {
  for (const value of ['', 'unknown', 'NETWORK', 'network,webgpu_game', '__proto__', 'constructor', 'toString']) {
    expect(() => parseTracePreset(value)).toThrow('Unknown trace preset')
    expect(() => resolveTraceCategories([value])).toThrow('Available presets')
  }
})
test('resolving categories returns independent arrays', () => {
  resolveTraceCategories().push('test')
  resolveTraceCategories(['network']).push('test')
  expect(resolveTraceCategories()).not.toContain('test')
  expect(resolveTraceCategories(['network'])).not.toContain('test')
})
test('webgpu_game preserves the original category list exactly', () => {
  expect([...tracePresets.webgpu_game]).toEqual(['blink.user_timing', 'cc', 'devtools.timeline', 'disabled-by-default-devtools.timeline.frame', 'disabled-by-default-devtools.timeline.inputs', 'disabled-by-default-devtools.timeline.stack', 'disabled-by-default-devtools.timeline', 'disabled-by-default-display.framedisplayed', 'disabled-by-default-gpu.dawn', 'disabled-by-default-v8.cpu_profiler', 'disabled-by-default-webgpu', 'gpu', 'graphics.pipeline', 'input.scrolling', 'input', 'latencyInfo', 'loading', 'memory_pressure', 'renderer.scheduler.status', 'renderer.scheduler', 'scheduler.long_tasks', 'toplevel', 'v8.execute', 'v8', 'viz'])
})
