import {afterAll, expect, test} from 'bun:test'
import {tmpdir} from 'node:os'

import {join} from 'forward-slash-path'
import fs from 'fs-extra'

import {userDataFromCommandLine} from '../src/trace/browserMetadata.ts'
import {TraceOutput} from '../src/trace/TraceOutput.ts'

const folder = await fs.mkdtemp(join(tmpdir(), 'surf-output-test-'))
afterAll(() => fs.remove(folder))
test('reserves outputs exclusively and publishes without overwriting', async () => {
  const path = join(folder, 'reserved.msgpack.br')
  await using output = await TraceOutput.create(path)
  await expect(TraceOutput.create(path)).rejects.toThrow('reserve')
  const temporary = output.temporary('br')
  await Bun.write(temporary, 'trace')
  await output.publish(temporary)
  expect(await Bun.file(path).text()).toBe('trace')
  await expect(output.publish(temporary)).rejects.toThrow()
  await output[Symbol.asyncDispose]()
  expect(await fs.pathExists(temporary)).toBe(false)
  expect(await fs.pathExists(`${path}.lock`)).toBe(false)
  await expect(TraceOutput.create(path)).rejects.toThrow('overwrite')
  expect(await Bun.file(path).text()).toBe('trace')
})
test('disposal removes partial output but never a competing output file', async () => {
  const path = join(folder, 'competing.msgpack.br')
  {
    await using output = await TraceOutput.create(path)
    const temporary = output.temporary('br')
    await Bun.write(temporary, 'new')
    await Bun.write(path, 'keep')
    await expect(output.publish(temporary)).rejects.toThrow()
  }
  expect(await Bun.file(path).text()).toBe('keep')
  expect(await fs.pathExists(`${path}.lock`)).toBe(false)
})
test('rejects empty output paths', async () => {
  await expect(TraceOutput.create('')).rejects.toThrow()
})
test('extracts Windows user data paths, including whole-argument quoting', () => {
  for (const command of [
    '"C:/browser.exe" "--user-data-dir=C:/profile with spaces"',
    '"C:/browser.exe" --user-data-dir="C:/profile with spaces"',
  ]) {
    expect(userDataFromCommandLine(command)).toBe('C:/profile with spaces')
  }
  expect(userDataFromCommandLine('browser --user-data-dir=C:/profile --app=https://example.com')).toBe('C:/profile')
  expect(userDataFromCommandLine('browser --app=https://example.com')).toBeUndefined()
})
