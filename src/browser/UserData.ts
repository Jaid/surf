import {tmpdir} from 'node:os'

import {join} from 'forward-slash-path'
import fs from 'fs-extra'

export class UserData {
  static async create(path?: string) {
    const temporary = path === undefined
    const rawFolder = path ?? await fs.mkdtemp(join(tmpdir(), 'surf-'))
    const folder = rawFolder.replaceAll('\\', '/')
    await fs.mkdir(folder, {recursive: true})
    const data = new UserData(folder, temporary)
    try {
      // Never change existing profiles, even if they have no Local State yet.
      const entries = await fs.readdir(folder)
      if (!entries.length) {
        await fs.writeFile(join(folder, 'Local State'), JSON.stringify({
          brave: {p3a: {
            enabled: false,
            notice_acknowledged: true,
          }},
        }), {flag: 'wx'}).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') {
            throw error
          }
        })
      }
      return data
    } catch (error) {
      await data.dispose()
      throw error
    }
  }

  private constructor(readonly path: string, readonly temporary: boolean) {}

  async dispose() {
    if (this.temporary) {
      await fs.rm(this.path, {
        recursive: true,
        force: true,
        maxRetries: 20,
        retryDelay: 100,
      })
    }
  }
}
