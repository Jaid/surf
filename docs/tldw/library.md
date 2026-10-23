```ts
import {launchBrowser, launchDetached, TraceRecorder} from 'surf'

await using session = await launchBrowser({
  url: 'http://localhost:5173',
  app: true,
  performance: true,
})
console.log(session.info)
await session.exited
// Async disposal closes the owned browser and removes its throwaway profile.
```

`session.close()` performs the same idempotent cleanup. Direct library sessions should be closed or scoped with `await using`; CLI signal handling is not installed by `launchBrowser`.

`launchDetached(options)` resolves to the same launch information plus a log path and leaves the background worker responsible for cleanup. `TraceRecorder` offers `start()`, `stop()`, `finished`, and async disposal for recording an existing Puppeteer browser connection. `recordBrowserTrace(options)` exposes the interactive/timed attach workflow.

`launchUnmanaged({url, app: true})` is the worker-free alternative for startup apps. It submits the browser launch request and returns `UnmanagedInfo`; it has no session handle or disposal requirement. Without `userDataDir`, the browser chooses its normal data directory. The returned `spawnedPid` may be a short-lived handoff process, not the process hosting the window.
