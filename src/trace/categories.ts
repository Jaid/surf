export const surfTraceCategories = ['surf.console', 'surf.browser_metadata'] as const

export const standardTraceCategories = [
  'blink.user_timing',
  'devtools.timeline',
  'loading',
  'toplevel',
  ...surfTraceCategories,
] as const

export const tracePresets = {
  webgpu_game: [
    'blink.user_timing',
    'cc',
    'devtools.timeline',
    'disabled-by-default-devtools.timeline.frame',
    'disabled-by-default-devtools.timeline.inputs',
    'disabled-by-default-devtools.timeline.stack',
    'disabled-by-default-devtools.timeline',
    'disabled-by-default-display.framedisplayed',
    'disabled-by-default-gpu.dawn',
    'disabled-by-default-v8.cpu_profiler',
    'disabled-by-default-webgpu',
    'gpu',
    'graphics.pipeline',
    'input.scrolling',
    'input',
    'latencyInfo',
    'loading',
    'memory_pressure',
    'renderer.scheduler.status',
    'renderer.scheduler',
    'scheduler.long_tasks',
    'toplevel',
    'v8.execute',
    'v8',
    'viz',
    ...surfTraceCategories,
  ] as const,
  network: [
    'blink.resource',
    'blink.user_timing',
    'CacheStorage',
    'devtools.timeline',
    'disabled-by-default-devtools.timeline',
    'disabled-by-default-devtools.timeline.stack',
    'loading',
    'net',
    'net.stream',
    'netlog',
    'network.scheduler',
    'ServiceWorker',
    'v8.execute',
    ...surfTraceCategories,
  ] as const,
}

export type TracePreset = keyof typeof tracePresets

export const parseTracePreset = (value: string): TracePreset => {
  if (!Object.hasOwn(tracePresets, value)) {
    throw new Error(`Unknown trace preset ${JSON.stringify(value)}. Available presets: ${Object.keys(tracePresets).join(', ')}`)
  }
  return value as TracePreset
}

export const resolveTraceCategories = (presets: ReadonlyArray<string> = []): Array<string> => {
  if (!presets.length) {
    return [...standardTraceCategories]
  }
  return [...new Set(presets.flatMap(preset => [...tracePresets[parseTracePreset(preset)]]))]
}

const knownSurfCategories: ReadonlySet<string> = new Set(surfTraceCategories)

export const splitTraceCategories = (categories: ReadonlyArray<string>) => {
  for (const category of categories) {
    if (category.startsWith('surf.') && !knownSurfCategories.has(category)) {
      throw new Error(`Unknown Surf trace category: ${category}`)
    }
  }
  return {
    chromiumCategories: [...new Set(categories.filter(category => !category.startsWith('surf.')))],
    collectConsole: categories.includes('surf.console'),
    collectBrowserMetadata: categories.includes('surf.browser_metadata'),
  }
}
