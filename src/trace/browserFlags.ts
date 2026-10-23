import {resolve} from 'forward-slash-path'
import fs from 'fs-extra'

export type BrowserFlags = {
  customValues: Record<string, string>
  entries: Array<string>
}
export const readBrowserFlags = async (userDataDir: string): Promise<BrowserFlags> => {
  const localState = JSON.parse(await fs.readFile(resolve(userDataDir, 'Local State'), 'utf8')) as {
    browser?: {
      enabled_labs_experiments?: unknown
      enabled_labs_experiments_origin_lists?: unknown
    }
  }
  const entries: Array<string> = []
  if (Array.isArray(localState.browser?.enabled_labs_experiments)) {
    entries.push(...localState.browser.enabled_labs_experiments.filter((entry): entry is string => typeof entry === 'string'))
  }
  const originLists = localState.browser?.enabled_labs_experiments_origin_lists
  let customValues: Record<string, string> = {}
  if (originLists && typeof originLists === 'object' && !Array.isArray(originLists)) {
    customValues = Object.fromEntries(Object.entries(originLists).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  }
  return {
    customValues,
    entries,
  }
}
