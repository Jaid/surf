/** Clerc treats a following "--" as a string value; protect the passthrough boundary. */
export const normalizeTraceArgs = (args: ReadonlyArray<string>): Array<string> => {
  const boundary = args.indexOf('--')
  return args.map((arg, index) => {
    if (boundary !== -1 && index >= boundary) {
      return arg
    }
    if (arg === '--trace' && (index + 1 === args.length || args[index + 1].startsWith('-'))) {
      return '--trace='
    }
    return arg
  })
}
