import {expect, test} from 'bun:test'

const {default: surf} = await import('#src/main.ts')
test('should run', () => {
  const result = surf()
  expect(result).toBe('surf') // TODO Test actual functionality
})
