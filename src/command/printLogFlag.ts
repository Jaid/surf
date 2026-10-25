import {parsePrintLog} from '../log/categories.ts'

export const printLogFlag = {
  type: [parsePrintLog] as const,
  description: 'Print console or network events to stdout; repeat to combine',
}
