#!/usr/bin/env bun
import makeCli from './makeCli.ts'

const cli = makeCli()
await cli()
