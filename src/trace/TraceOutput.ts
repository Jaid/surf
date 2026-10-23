import {dirname} from 'forward-slash-path'
import fs from 'fs-extra'

import {resolvePath} from '../lib/paths.ts'

export class TraceOutput {
  static async create(output?: string) {
    const requested = output === undefined ? undefined : resolvePath(output)
    const base = requested ?? resolvePath('trace.msgpack.br')
    await fs.mkdir(dirname(base), {recursive: true})
    for (let index = 1; ; index++) {
      const path = requested ?? (index === 1 ? base : `${base.slice(0, -'.msgpack.br'.length)}${index}.msgpack.br`)
      const lock = `${path}.lock`
      try {
        await using handle = await fs.promises.open(lock, 'wx')
      } catch (error) {
        if (!requested && (error as NodeJS.ErrnoException).code === 'EEXIST') {
          continue
        }
        throw new Error(`Cannot reserve trace output: ${path}`, {cause: error})
      }
      try {
        if (await fs.pathExists(path)) {
          if (requested) {
            throw new Error(`Refusing to overwrite trace: ${path}`)
          }
          await fs.rm(lock)
          continue
        }
        return new TraceOutput(path, lock)
      } catch (error) {
        await fs.rm(lock, {force: true})
        throw error
      }
    }
  }
  private disposed = false
  private readonly partials = new Set<string>

  private readonly prefix = crypto.randomUUID()

  private constructor(readonly path: string, private readonly lock: string) {}

  async publish(source: string) {
    // Atomic no-clobber publication, including writers that ignore the lock.
    await fs.link(source, this.path)
  }

  async [Symbol.asyncDispose]() {
    if (this.disposed) {
      return
    }
    this.disposed = true
    try {
      await Promise.all(this.partials.values().map(path => fs.rm(path, {force: true})))
    } finally {
      await fs.rm(this.lock, {force: true})
    }
  }

  temporary(suffix: string) {
    const path = `${this.path}.${this.prefix}.${suffix}.partial`
    this.partials.add(path)
    return path
  }
}
