import type {Browser} from 'puppeteer-core'

import {TargetType} from 'puppeteer-core'

export const navigateInitialPage = async (browser: Browser, url: string) => {
  await browser.waitForTarget(target => target.type() === TargetType.PAGE, {timeout: 10_000})
  const target = browser.targets().find(candidate => candidate.type() === TargetType.PAGE)!
  const session = await target.createCDPSession()
  try {
    await session.send('Page.navigate', {url})
  } finally {
    await session.detach().catch(() => {})
  }
}
