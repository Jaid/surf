import {tmpdir} from 'node:os'

import {join} from 'forward-slash-path'
import fs from 'fs-extra'

export type SurfControlsState = 'hidden' | 'start' | 'stop'

const titles = {
  start: 'Start trace',
  stop: 'Stop trace',
}

/** Serves a context menu extension whose “Stop trace” item acts like Enter in the terminal. */
export class SurfControls {
  static async create() {
    const rawFolder = await fs.mkdtemp(join(tmpdir(), 'surf-controls-'))
    const folder = rawFolder.replaceAll('\\', '/')
    const controls = new SurfControls(folder)
    try {
      await fs.copy(join(import.meta.dir, 'extension'), folder)
      await fs.writeFile(join(folder, 'config.js'), `export const endpoint = ${JSON.stringify(controls.endpoint)}\n`)
      return controls
    } catch (error) {
      await controls[Symbol.asyncDispose]()
      throw error
    }
  }
  private readonly listeners = new Set<() => void>
  private readonly server: Bun.Server<undefined>
  private state: SurfControlsState = 'hidden'
  private readonly token = crypto.randomUUID()

  private constructor(readonly folder: string) {
    this.server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request, server) => {
        const {pathname} = new URL(request.url)
        if (pathname === `/${this.token}` && server.upgrade(request)) {
          return
        }
        return new Response(null, {status: 404})
      },
      websocket: {
        open: socket => {
          socket.subscribe('state')
          socket.send(this.message())
        },
        message: (_socket, message) => {
          if (message === 'enter') {
            for (const listener of this.listeners) {
              listener()
            }
          }
        },
      },
    })
  }

  get endpoint() {
    return `ws://127.0.0.1:${this.server.port}/${this.token}`
  }

  /** Adds the extension to browser arguments, keeping extensions the user loads. */
  browserArguments(args: ReadonlyArray<string> = []) {
    const index = args.findLastIndex(arg => arg.startsWith('--load-extension='))
    if (index === -1) {
      return [...args, `--load-extension=${this.folder}`]
    }
    return args.with(index, `${args[index]},${this.folder}`)
  }

  onEnter(listener: () => void): Disposable {
    this.listeners.add(listener)
    return {[Symbol.dispose]: () => this.listeners.delete(listener)}
  }

  show(state: SurfControlsState) {
    if (state !== this.state) {
      this.state = state
      this.server.publish('state', this.message())
    }
  }

  async [Symbol.asyncDispose]() {
    this.listeners.clear()
    await this.server.stop(true)
    await fs.rm(this.folder, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100,
    })
  }

  private message() {
    return JSON.stringify(this.state === 'hidden' ? {visible: false} : {
      title: titles[this.state],
      visible: true,
    })
  }
}
