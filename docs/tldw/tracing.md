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
