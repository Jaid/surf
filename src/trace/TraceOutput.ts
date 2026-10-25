import {dirname} from 'forward-slash-path'
import fs from 'fs-extra'

import {resolvePath} from '../lib/paths.ts'

export const traceOutputPaths = (output: string) => {
  const resolved = resolvePath(output)
  const stem = resolved.replace(/\.(?:msgpack|pftrace)\.br$/iu, '')
  return {
    path: `${stem}.msgpack.br`,
    perfettoPath: `${stem}.pftrace.br`,
  }
}

export class TraceOutput {
  static async create(output?: string, numbered = false) {
    const requested = output === undefined ? undefined : traceOutputPaths(output).path
    const strict = requested !== undefined && !numbered
    const base = requested ?? resolvePath('trace.msgpack.br')
    await fs.mkdir(dirname(base), {recursive: true})
    for (let index = 1; ; index++) {
      const path = strict ? requested : (index === 1 ? base : `${base.slice(0, -'.msgpack.br'.length)}${index}.msgpack.br`)
      const lock = `${path}.lock`
      try {
        await using handle = await fs.promises.open(lock, 'wx')
      } catch (error) {
        if (!strict && (error as NodeJS.ErrnoException).code === 'EEXIST') {
          continue
        }
        throw new Error(`Cannot reserve trace output: ${path}`, {cause: error})
      }
      try {
        if (await fs.pathExists(path) || await fs.pathExists(traceOutputPaths(path).perfettoPath)) {
          if (strict) {
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
  readonly perfettoPath: string
  private disposed = false

  private readonly partials = new Set<string>

  private readonly prefix = crypto.randomUUID()

  private constructor(readonly path: string, private readonly lock: string) {
    this.perfettoPath = traceOutputPaths(path).perfettoPath
  }

  async publish(perfetto: string, sidecar: string) {
    // Each link is atomic and no-clobber, but the pair cannot be atomic.
    // Publish the completion marker last; roll back only our own first link.
    await fs.link(perfetto, this.perfettoPath)
    try {
      await fs.link(sidecar, this.path)
    } catch (error) {
      await fs.rm(this.perfettoPath, {force: true})
      throw error
    }
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
