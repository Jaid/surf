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

export const parseTraceCategory = (value: string): string => {
  if (!value || /[\s\u{0}-\u{1F}*,?]/u.test(value) || value.startsWith('-')) {
    throw new Error('Trace categories must be nonempty exact names, not patterns or comma-separated lists.')
  }
  if (value.startsWith('surf.') && !knownSurfCategories.has(value)) {
    throw new Error(`Unknown Surf trace category: ${value}`)
  }
  return value
}

export const resolveTraceCategories = (
  presets: ReadonlyArray<string> = [],
  additions: ReadonlyArray<string> = [],
  exclusions: ReadonlyArray<string> = [],
): Array<string> => {
  const base = presets.length ? presets.flatMap(preset => [...tracePresets[parseTracePreset(preset)]]) : [...standardTraceCategories]
  const excluded = new Set(exclusions.map(parseTraceCategory))
  const included = new Set([...base, ...additions.map(parseTraceCategory)])
  const categories = [...included.difference(excluded)]
  // An empty Chromium inclusion list would enable its defaults, not disable tracing.
  if (!splitTraceCategories(categories).chromiumCategories.length) {
    throw new Error('Select at least one Chromium trace category; Surf-only or empty traces are not supported.')
  }
  return categories
}
