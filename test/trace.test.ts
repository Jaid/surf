import {beforeAll, expect, test} from 'bun:test'
import {resolve} from 'node:path'

import fs from 'fs-extra'

import {readBrowserFlags} from '../src/trace/browserFlags.ts'

// temp/ is gitignored, so a fresh checkout doesn’t have it yet
beforeAll(() => fs.ensureDir(resolve(import.meta.dir, '../temp')))
test('reads persisted browser flag selections and custom values', async () => {
  const root = await fs.mkdtemp(resolve(import.meta.dir, '../temp/browser-flags-test-'))
  try {
    await fs.writeJson(resolve(root, 'Local State'), {
      browser: {
        enabled_labs_experiments: ['enable-gpu-rasterization', 'some-choice@2', 123],
        enabled_labs_experiments_origin_lists: {
          'origin-list-flag': 'https://example.com,https://example.org',
          ignored: 123,
        },
      },
    })
    expect(await readBrowserFlags(root)).toEqual({
      customValues: {
        'origin-list-flag': 'https://example.com,https://example.org',
      },
      entries: ['enable-gpu-rasterization', 'some-choice@2'],
    })
  } finally {
    await fs.remove(root)
  }
})
