export const printLogCategories = ['console', 'network'] as const
export type PrintLogCategory = typeof printLogCategories[number]

export const parsePrintLog = (value: string): PrintLogCategory => {
  if (value !== 'console' && value !== 'network') {
    throw new Error(`Unknown print-log category ${JSON.stringify(value)}. Available categories: console, network`)
  }
  return value
}

export const resolvePrintLog = (categories: ReadonlyArray<string> = []) => [...new Set(categories.map(parsePrintLog))]
