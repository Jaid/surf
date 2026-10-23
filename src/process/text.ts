export const toWideString = (value: string) => {
  const buffer = new Uint16Array(value.length + 1)
  for (let index = 0; index < value.length; index++) {
    // Win32 expects UTF-16 code units, not Unicode code points.
    // eslint-disable-next-line unicorn/prefer-code-point
    buffer[index] = value.charCodeAt(index)
  }
  return buffer
}
