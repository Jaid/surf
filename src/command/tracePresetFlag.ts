import {parseTracePreset, tracePresets} from '../trace/categories.ts'

export const tracePresetFlag = {
  type: [parseTracePreset] as const,
  description: `Replace standard trace categories with a preset; repeat to merge. Presets: ${Object.keys(tracePresets).join(', ')}`,
}
