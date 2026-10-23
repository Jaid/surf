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
