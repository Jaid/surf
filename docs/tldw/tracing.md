### Launch and record together

```powershell
surf localhost:5173 --trace --reload
surf localhost:5173 --trace ./trace.msgpack.br --reload
surf localhost:5173 --app --performance --trace ./game.msgpack.br --duration 15000
```

Bare `--trace` (or `--trace=`) chooses a unique `tempy.temporaryFile({extension: 'msgpack.br'})` path in the OS temporary directory. The recording and saved-output messages print its full path. Surf retains both completed files after the browser/session closes; normal OS temporary-file cleanup can still remove it later. `--trace <path>` or `--trace=<path>` selects an explicit output stem or either pair filename; neither member is ever overwritten.

When placing the URL after `--trace`, use `--url` so it is not interpreted as the optional output path; alternatively put the positional URL before `--trace`. `--dump` shows the resolved output path without creating a file. The separate `surf trace` command retains its existing working-directory default when `--output` is omitted.

- Enter saves the trace and leaves the coupled browser open. Press Enter again to start a new recording.
- Ctrl+C saves the trace **before** closing the browser.
- `--duration` is in milliseconds; reaching it saves the trace but does not close the browser.
- Buffer exhaustion also stops and saves recording.
- `--title-updates` defaults to true for both launch-time tracing and `surf trace`. In an interactive terminal, ANSI title sequences show `42.3% 2m 7s slop.gallery`. Elapsed recording time updates every second; buffer fill updates on Chromium’s reports (every five seconds). The hostname comes from the selected page URL when recording starts (omitted for URLs without a hostname). While saving, the title freezes at the final recording duration. The previous title is restored once Chromium has finalized the recording, or on failure. Redirected stderr stays escape-free. Disable with `--title-updates=false`; without tracing it has no effect.
- Closing the browser window during recording cannot flush its in-memory trace. Stop recording first; Surf reports a failure and removes partial output if the connection is lost.

### Attach to a running browser

```powershell
surf trace --port 9222
surf trace --port 9222 --output ./trace.msgpack.br --duration 10000 --reload
```

`surf trace` never closes the browser. In an interactive terminal, Enter saves and another Enter starts a fresh recording; Ctrl+C saves and detaches. Without an interactive terminal, it exits after one recording. The optional duration stops each recording. Launch-time `--trace` cannot be combined with `--detached`; use this separate command instead.

The trace is browser-wide. Console events and optional reload belong to the first page target, or the page selected with `surf trace --target-id <id>`. The default trace buffer is 4,000,000,000 bytes; change it with `--buffer`.

### Repeated recordings

In an interactive terminal, both launch-time tracing and `surf trace` stay ready for another recording:

- Enter while recording stops and saves it.
- Enter while finalizing queues **one** restart; repeated presses coalesce. The restart begins as soon as Chromium releases the tracing session, even while the previous trace is still downloading/compressing.
- Enter while idle starts the next recording immediately (after any configured `--trace-delay`).
- Ctrl+C cancels a queued restart, stops an active recording, and waits for all pending saves before closing the owned browser or detaching.
- `--exit-after-trace` remains single-shot and ignores queued restarts. Non-interactive sessions also record only once.

Each recording gets a new UUID, console collection, buffer, duration timer, and terminal-title timer. Categories/presets, reload, delay, and duration apply to every recording; `--trace-start manual` gates only the first recording.

Bare `--trace` chooses a fresh tempy output for each recording. With an explicit stem, the first recording keeps the exact path; subsequent recordings use `game2.*`, `game3.*`, skipping existing pairs and reservations without overwriting anything. Default attachment filenames remain `trace.*`, `trace2.*`.

The library's `recordBrowserTrace()` remains single-shot by default. Opt into interactive repetition with `repeat: true`; it returns the last saved sidecar after exiting. `TraceRecorder.readyForNext` resolves when Chromium has finalized the stream, before `finished` resolves; the browser must remain connected until outstanding downloads finish.

### Context menu controls

```powershell
surf localhost:5173 --trace --surf-controls
```

`--surf-controls` loads a small MV3 extension into the launched browser that adds **Stop trace** to the right-click menu. It acts like Enter in the terminal: while recording it stops and saves; afterward the item reads **Start trace** and starts the next recording (also the first one with `--trace-start manual`). The extension reaches Surf through a token-protected WebSocket on 127.0.0.1 and is deleted with the session. Since menu clicks replace Enter, repeated recordings also work without an interactive terminal. It requires launch-time `--trace` and a browser that honors `--load-extension` (Chromium and Brave do; recent Google Chrome builds ignore it).

### Saving and finalization timeouts

Enter requests a stop, but Chromium must still finalize its trace stream before Surf can download it. The old fixed 30-second wait could discard a recording even with plenty of buffer space remaining. Buffer fill is not export progress.

`--trace-stop-timeout <milliseconds>` defaults to 300,000 (five minutes). It bounds the stop request plus the wait for Chromium's completion event, and separately each stream read. It overrides the ordinary CDP command timeout for these operations; it does not limit recording duration or local compression. Set it to 0 to disable these deadlines. Both launch-time tracing and `surf trace` support it.

Surf prints the finalization, download, and compression stages, with elapsed-time reminders every ten seconds while waiting for Chromium. Keep the browser open until the saved-files message. A disconnected browser still fails promptly. With a disabled deadline, a stalled browser can wait indefinitely; closing it abandons the recording. Timeout/disconnection cleanup removes partial outputs, so increase the limit **before** recording, not after a failed save.

### Two-file trace format

Each recording produces:

- **`<name>.pftrace.br`**: the original Perfetto protobuf, Brotli-compressed without conversion.
- **`<name>.msgpack.br`**: Surf's console events and metadata in a versioned MessagePack/Brotli sidecar. This replaces the old combined format: the sidecar has **no `traceEvents` array**.

Surf downloads CDP's gzip stream to a temporary protobuf file, then compresses both outputs concurrently at Brotli quality 6. Console entries are encoded incrementally. No traceconv download/execution or intermediate JSON/MessagePack files are needed at runtime.

The sidecar schema is exported as `TraceSidecar`:

```ts
{
  formatVersion: 1,
  consoleEvents: [...],
  metadata: {
    RecordingId: 'UUID',
    RecordingStartedAt: 'UTC ISO timestamp',
    RecordingStoppedAt: 'UTC ISO timestamp',
    // Browser/V8 versions, categories, collector metadata,
    // TraceDataLossOccurred, DroppedConsoleEvents, …
  },
  perfetto: {
    file: 'game.pftrace.br', // sibling filename
    compression: 'brotli',
    sha256: '...', // SHA-256 of the DECOMPRESSED protobuf
    uncompressedBytes: 123456,
  },
}
```

The UUID lives in the sidecar; Surf leaves the protobuf untouched. The hash links the sidecar to its exact native trace and detects accidental mismatches. Keep both files together. The sidecar's final descriptor waits for Perfetto compression to finish, while console encoding/compression runs concurrently.

Recording timestamps are wall-clock bounds sampled before requesting capture start/stop, not substitutes for Perfetto's native clock snapshots. CDP console parameters retain their original timestamps. Console capture remains capped at 100,000 events. Windows/Linux command lines are discovered automatically; `surf trace --user-data-dir` can select the profile whose experimental flags are recorded.

An output stem (`game`) or either filename (`game.msgpack.br`, `game.pftrace.br`) selects the same pair. Without `--output`, attachment chooses `trace.*`, `trace2.*`, etc., skipping pairs with either existing member or a reservation. Bare launch-time `--trace` still uses tempy.

Both files finish writing before publication. Each file is published atomically without overwriting; the pair cannot be atomic. Perfetto is published first, then the **sidecar last as the completion marker**. If the second publication fails, Surf rolls back its newly published Perfetto file. Normal failures remove locks/partials. A hard crash can leave an orphaned Perfetto file or stale `.lock`/`.partial` files; remove them only after confirming the recorder is no longer running.

Library `stop()`/`finished` and `recordBrowserTrace()` still return the **sidecar path**, after both files are published. Exported `traceOutputPaths(pathOrStem)` returns `{path, perfettoPath}`; `path` is the sidecar. `--dump` reports both as `trace` and `tracePerfetto`.

Decompress `.pftrace.br` to `.pftrace` before opening it in Perfetto UI. Surf's sidecar is not automatically loaded into that UI. Temporary disk space is needed for the raw protobuf and compressed outputs, but not converted JSON.

The attachment CLI's `--cache-folder` and recording library's `cacheFolder` option were removed with traceconv. Launch-time `--cache-folder` remains for icons and detached-session logs. Surf no longer counts decoded browser events; empty native streams fail, and nonempty protobuf is preserved without conversion.

### Categories and presets

Without `--trace-preset`, Surf requests these standard categories (four Chromium categories plus two Surf collectors):

```text
blink.user_timing
devtools.timeline
loading
toplevel
surf.console
surf.browser_metadata
```

They provide user timing marks/measures, the basic DevTools timeline, loading, and top-level task activity, without opting into detailed CPU profiling or GPU diagnostics.

| Preset | Purpose |
| --- | --- |
| `webgpu_game` | The original 25 Chromium categories, plus Surf collectors: WebGPU/Dawn, graphics and frame presentation, input latency, V8 CPU profiling, and scheduling. |
| `network` | Network-stack and resource-loading diagnostics, service workers/cache storage, and JavaScript timeline/stack context for API handling. |

```powershell
surf localhost:5173 --trace ./game.msgpack.br --trace-preset webgpu_game
surf trace --port 9222 --trace-preset network
surf trace --port 9222 --trace-preset webgpu_game --trace-preset network
```

Supplying any presets **replaces** the standard list. Repeating the flag merges only the selected presets and removes duplicate categories, preserving first-occurrence order. Unknown names are rejected before launching or connecting. On the launch command, `--trace-preset` requires `--trace`. Use `--dump --trace ./trace.msgpack.br` with optional presets to inspect the resolved `traceCategories`.

The `network` preset requests:

```text
blink.resource
blink.user_timing
CacheStorage
devtools.timeline
disabled-by-default-devtools.timeline
disabled-by-default-devtools.timeline.stack
loading
net
net.stream
netlog
network.scheduler
ServiceWorker
v8.execute
surf.console
surf.browser_metadata
```

Chromium describes `netlog` as network-stack events covering HTTP, TLS, DNS, connections, and sockets in its [category registry](https://chromium.googlesource.com/chromium/src/+/main/base/trace_event/builtin_categories.h). This is a browser trace, **not** a HAR export, packet capture, or complete request/response-body archive. Available events depend on the browser version and workload. The preset does not enable `disabled-by-default-netlog.sensitive`, but traces can still contain URLs and application data; review them before sharing.

Saved metadata records the deduplicated `TracePresets` (empty for the standard list) and the requested `TraceCategories`. The browser-only subset is recorded as `ChromiumTraceCategories`.

### Surf collector categories

These are Surf categories, not Chromium instrumentation categories. Surf uses them to enable its own collectors and removes them from the `Tracing.start` category filter. Both are explicitly included in the standard list and every preset, and deduplicated when presets are merged.

| Category | Collector |
| --- | --- |
| `surf.console` | Selected-page `Runtime.consoleAPICalled` (all console methods, not just `console.log`), `Runtime.exceptionThrown`, and `Log.entryAdded`. |
| `surf.browser_metadata` | Browser command line and persisted experimental flags/custom values, when discoverable. |

Console records stay in the existing `consoleEvents` array, now tagged with `cat: 'surf.console'`. The 100,000-event cap and dropped-event counter are unchanged. Browser metadata stays in `metadata.CommandLine` and `metadata.BraveFlags`. Core recording metadata (browser/V8 versions, category selection, trace format, data-loss status) is always recorded; it is not a separate optional collector.

### Category overrides and recording lifecycle

`--trace-category <category>` and `--trace-exclude <category>` are repeatable. Surf first selects the standard list or merged presets, then adds categories, then removes exclusions. Exclusions always win, regardless of flag order. Names are exact and case-sensitive; wildcards, comma-separated lists, and unknown `surf.*` categories are rejected. At least one Chromium category must remain: an empty CDP inclusion list would enable browser defaults rather than disable them.

```powershell
surf localhost:5173 --trace --trace-preset webgpu_game --trace-category netlog --trace-exclude surf.console
surf localhost:5173 --trace --trace-start manual --duration 15000 --exit-after-trace
surf trace --port 9222 --trace-delay 5000 --duration 10000
```

- `--trace-start immediate|manual` defaults to immediate. Manual mode requires an interactive terminal: Enter starts recording, then a subsequent Enter saves it.
- `--trace-delay <milliseconds>` postpones recording after browser launch/attachment. Combined with manual mode, the delay starts after Enter.
- Ctrl+C while waiting cancels without creating an output file. A coupled browser is closed; an attached browser stays open.
- `--duration` measures recording time, excluding the start gate and recorder setup. Optional `--reload` happens after recording starts.
- `--exit-after-trace` closes the owned browser after saving, including Enter, duration, or buffer exhaustion. It is launch-only; `surf trace` never owns or closes the attached browser.

On the launch command, all these options require `--trace`. Category overrides and start/delay controls also work with `surf trace`. Excluding `surf.console` disables console collection; excluding `surf.browser_metadata` disables command-line/experimental-flag collection without removing core recording metadata.
