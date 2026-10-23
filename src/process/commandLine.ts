export const quoteWindowsArgument = (argument: string) => {
  if (argument && !/[\s"]/u.test(argument)) {
    return argument
  }
  let result = '"'
  let backslashes = 0
  for (const character of argument) {
    if (character === '\\') {
      backslashes++
      continue
    }
    if (character === '"') {
      result += `${'\\'.repeat(backslashes * 2 + 1)}"`
      backslashes = 0
      continue
    }
    result += `${'\\'.repeat(backslashes)}${character}`
    backslashes = 0
  }
  return `${result}${'\\'.repeat(backslashes * 2)}"`
}
