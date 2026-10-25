import {parseTraceCategory} from '../trace/categories.ts'
import {parseTraceStart} from '../trace/waitForTraceStart.ts'

export const traceControlFlags = {
  traceStopTimeout: {
    type: Number,
    description: 'Trace finalization / per-read timeout in milliseconds (default 300000; 0 disables)',
  },
  titleUpdates: {
    type: Boolean,
    default: true,
    description: 'Show trace buffer usage in the terminal tab title (TTY only)',
  },
  traceCategory: {
    type: [parseTraceCategory] as const,
    description: 'Add an exact trace category after defaults/presets; repeat to add more',
  },
  traceExclude: {
    type: [parseTraceCategory] as const,
    description: 'Exclude an exact category after additions; repeat to remove more',
  },
  traceStart: {
    type: parseTraceStart,
    description: 'Start immediately (default) or wait for Enter (manual)',
  },
  traceDelay: {
    type: Number,
    description: 'Wait this many milliseconds before recording; after Enter in manual mode',
  },
}
