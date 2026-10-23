<center><a href="https://github.com/Jaid/surf/raw/HEAD/license.txt"><img src="https://shieldcn.dev/github/license/Jaid/surf.svg?variant=secondary" alt="License"/></a></center>

# Surf

Launch and supervise Chromium browser sessions, app windows, and performance traces

A Bun CLI for dedicated Chromium browser sessions: ordinary windows, chromeless app windows, fullscreen kiosks, persistent or disposable profiles, performance traces, and sharper Windows taskbar icons.

## getting started

Requires current Bun and an installed Chromium-family browser (Brave, Chrome, Edge, or Chromium). Surf does not download a browser.

```powershell
bun install --frozen-lockfile
bun src/main.ts --help
bun link
```

```powershell
# Coupled browser, disposable profile
surf example.com

# Chromeless game/app window; keep Surf attached
surf localhost:5173 --app --performance

# Detached app with a theme-aware taskbar icon
surf github.com --app --better-icon --detached

# Reuse a persistent data directory, or create it if missing
surf example.com --user-data-dir C:/Users/jaid/surf/work --profile "Profile 1"

# Fullscreen is separate from chromeless app mode
surf example.com --kiosk --detached

# Inspect the executable and argument vector without creating a profile
surf example.com --app --dump
```

The URL is optional and defaults to `https://google.com`. `--url` is an alternative to the positional URL. Bare hosts get HTTPS; localhost and loopback addresses get HTTP. Explicit URLs, including `about:blank`, `file:///`, and browser-internal URLs, are accepted. Existing query encoding, repeated parameters, and `+` characters are preserved.

Executable selection: `--executable-file`, then `BROWSER`, then PATH/standard install locations. Supply an executable path, **not a shell command with arguments**. Chromium's `chrome_proxy.exe`-style launchers are resolved to the sibling browser executable.

Additional browser switches go after `--`, one argument per switch:

```powershell
surf localhost:5173 -- --enable-features=OverlayScrollbar --auto-open-devtools-for-tabs
```

Use `--switch=value` for switches with values. Surf rejects passthrough switches that would override its profile, debugging endpoint, or window/lifecycle settings. Arguments are never interpolated into a shell command.

## lifetime and profiles

| Setting | Behavior |
| --- | --- |
| Default | Surf waits for the browser process. Ctrl+C closes it and cleans up. |
| `--detached` | Surf returns after startup. A background Surf worker supervises the browser and performs cleanup. |
| No `--user-data-dir` | A unique OS-temporary profile is created and removed after the browser exits. |
| Explicit `--user-data-dir` | The directory is created if necessary and **never deleted by Surf**. |
| `--profile` | A directory name inside the user data directory; defaults to `Default`. |

Paths can be relative to the current working directory or start with `~/`.

A data directory must not already be open in another browser process, including another Surf session. Surf requires an independently owned process: it does not attach to or close your everyday browser. Chromium itself enforces profile exclusivity; a handoff to an existing process is treated as a failed launch. Recent Chrome also refuses remote debugging with its default everyday data directory; use a dedicated directory.

Existing profile files are not rewritten by Surf. Empty/new directories receive a small Brave P3A opt-out `Local State`; subsequent preference updates belong to the browser.

Normal shutdown is graceful, with a process-tree termination fallback after 10 seconds if the browser is stuck. OS crashes, force-killing Surf, and power loss can leave temporary profiles behind. Do not delete a profile while its browser is running.

A successful launch prints one JSON object to stdout with the browser PID, executable, URL, data directory, temporary status, and CDP WebSocket URL. Detached launches also report their log file. Diagnostics go to stderr or the detached session log.

Windows workers break away from the launching console and its Job Object. Detached session status/logs remain under `<cache>/sessions/<id>/`; the browser's temporary data directory is still removed. Completed session directories can be deleted when their logs are no longer needed.

## browser defaults

Surf suppresses first-run/default-browser prompts and disables background mode so closing the final window can end the session. It deliberately avoids Puppeteer's automation argument preset and viewport emulation.

`--performance` carries forward the high-performance GPU, GPU rasterization, zero-copy, and background-throttling switches from the earlier launchers. These are requests to the browser, not guarantees of improved performance.

Sandboxing, download safety, self-XSS protection, syncing, and ordinary browser networking are not silently disabled. The old launchers' unsafe convenience switches can be supplied explicitly after `--` if desired.

Every session has a loopback CDP endpoint. `--port 0` (default) selects a free port; use a fixed port when another tool needs to attach:

```powershell
surf localhost:5173 --port 9222 --detached
```

CDP grants full control over the session. Do not expose its port outside loopback or use it with a profile whose data you do not want local debugging clients to access.

## tracing

### Launch and record together

```powershell
surf localhost:5173 --trace ./trace.msgpack.br --reload
surf localhost:5173 --app --performance --trace ./game.msgpack.br --duration 15000
```

- Enter saves the trace and leaves the coupled browser open.
- Ctrl+C saves the trace **before** closing the browser.
- `--duration` is in milliseconds; reaching it saves the trace but does not close the browser.
- Buffer exhaustion also stops and saves recording.
- Closing the browser window during recording cannot flush its in-memory trace. Stop recording first; Surf reports a failure and removes partial output if the connection is lost.

### Attach to a running browser

```powershell
surf trace --port 9222
surf trace --port 9222 --output ./trace.msgpack.br --duration 10000 --reload
```

`surf trace` never closes the browser. Enter, Ctrl+C, or the optional duration stops recording. Launch-time `--trace` cannot be combined with `--detached`; use this separate command instead.

The trace is browser-wide. Console events and optional reload belong to the first page target, or the page selected with `surf trace --target-id <id>`. The default trace buffer is 4,000,000,000 bytes; change it with `--buffer`.

The large-trace pipeline from `recordBrowserTrace.ts` is retained:

1. CDP streams gzip-compressed Perfetto protobuf rather than the browser's size-limited JSON export.
2. SHA-256-verified, pinned Perfetto `traceconv v58.2` converts it to Chrome JSON events.
3. Events are encoded incrementally as MessagePack and compressed with Brotli.

Files contain `traceEvents`, `consoleEvents`, and metadata, including browser/V8 versions, experimental flags when readable, trace data loss, and dropped console event counts. Console capture is capped at 100,000 events. Windows and Linux command lines are discovered automatically; `surf trace --user-data-dir` can explicitly select the profile whose experimental flags are recorded.

Outputs are always Brotli-compressed MessagePack, not DevTools-loadable JSON. Without `--output`, the attach command chooses `trace.msgpack.br`, `trace2.msgpack.br`, etc. in the working directory. Explicit outputs are never overwritten. Reservation locks and partial files are removed on normal success/failure; after a hard crash, remove stale `.lock`/`.partial` files only when the recorder is no longer running.

The first trace downloads the pinned converter from Perfetto's artifact service. Cached executable checksums are verified before reuse. Trace conversion needs temporary disk space for protobuf, JSON, and MessagePack alongside the final file.

## better taskbar icons

`--app --better-icon` supports Windows with PowerShell 7 and an HTTP(S) launch URL.

- Discovers page and web-app-manifest icons, preferring SVG and high-resolution sources.
- Selects media-qualified icons and renders SVG color-scheme rules using the Windows **system/taskbar** theme.
- Produces a multi-resolution ICO, including exact 32 px and DPI-scaled sizes.
- Uses an isolated, headless browser for SVG rendering; external SVG resources are blocked.
- Caches icons for 24 hours by URL and theme.
- Applies icons only to the owned browser PID's unambiguous app window; never guesses by focus or title.
- Reapplies native icons if Chromium replaces them, and releases the handles on shutdown.

Icon failures do not prevent launching. The launch site's icon stays fixed across navigation and theme changes; relaunch to refresh it. Discovery uses unauthenticated HTTP rather than browser cookies or page JavaScript. Existing pinned shortcuts and taskbar grouping can still affect the displayed icon. Multiple matching windows are deliberately rejected.

## cache

Override with `--cache-folder`. Defaults:

- Windows: `%LOCALAPPDATA%/surf`
- macOS: `~/Library/Caches/surf`
- Linux: `${XDG_CACHE_HOME:-~/.cache}/surf`

Icons, the converter, and detached session logs live here; disposable browser profiles do not.

## library

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

## development

Maintain README content in `docs/tldw` and package metadata in `package.json`. Do not edit `readme.md` directly. Run `bun run readme` (or `bun tldw`) to regenerate it. CI checks that the generated file is up to date.

The CLI follows `src/main.ts → makeCli.ts → command/mainCommand.ts → command/main.ts`, using Clerc's core and selected plugin packages. Browser ownership, profile cleanup, detached launching, icons, and tracing are separate modules.

```powershell
# Real headless-browser tests, including trace conversion and detachment
$env:SURF_TEST_BROWSER = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe'
bun test

# Additionally open a brief app window and verify its native icon
$env:SURF_TEST_NATIVE = '1'
bun test
```

Default tests do not launch a browser or download Perfetto. The native helper compilation test runs on Windows when PowerShell is available. Browser-backed integration tests are opt-in.

### setting up

```sh
git clone git@github.com:Jaid/surf.git
cd surf
bun install
```

### linting

```sh
bun run lint
```

### type checking

```sh
bun run typecheck
```

### testing

```sh
bun run test
```

## license

[MIT License](https://github.com/Jaid/surf/raw/HEAD/license.txt)<br>
Copyright © 2026, Jaid \<jaid.jsx@gmail.com> (https://github.com/jaid)

<!--
readme generated with tldw v9.9.0 from ./docs/tldw
github.com/Jaid/tldw
-->
