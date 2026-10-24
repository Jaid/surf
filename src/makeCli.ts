// Import only the plugins we use: the clerc umbrella eagerly imports an update
// notifier whose exit hook terminates the process before async signal cleanup.
import {Clerc} from '@clerc/core'
import {friendlyErrorPlugin} from '@clerc/plugin-friendly-error'
import {helpPlugin} from '@clerc/plugin-help'
import {strictFlagsPlugin} from '@clerc/plugin-strict-flags'
import {versionPlugin} from '@clerc/plugin-version'

import packageMetadata from '../package.json'
import mainCommand from './command/mainCommand.ts'
import {normalizeTraceArgs} from './command/normalizeTraceArgs.ts'
import traceCommand from './command/traceCommand.ts'

export default (args?: Array<string>) => {
  const cli = Clerc.create({
    scriptName: 'surf',
    name: 'surf',
    description: packageMetadata.description,
    version: packageMetadata.version,
  })
    .use(helpPlugin())
    .use(versionPlugin())
    .use(strictFlagsPlugin())
    .use(friendlyErrorPlugin())
    .command(mainCommand)
    .command(traceCommand)
  return async () => {
    await cli.parse(normalizeTraceArgs(args ?? process.argv.slice(2)))
  }
}
