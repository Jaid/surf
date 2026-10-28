Print live browser events to stdout without needing a trace:

```powershell
surf slop.gallery --app --print-log console --print-log network
surf trace --port 9222 --print-log console --print-log network
```

The repeatable array accepts `console` and `network`; duplicates are removed and unknown categories rejected. It is empty by default.

- **console**: console API messages (including warnings/errors) and uncaught exceptions. Primitive arguments are printed as text; objects use Chromium's shallow previews/descriptions without evaluating getters or fetching entire object graphs.
- **network**: request methods/URLs, response statuses, redirects, failed requests, and WebSocket connection URLs. It does not dump headers, bodies, or WebSocket frames.

```text
[console] log: ready 42
[network] GET https://example.com/api
[network] 200 GET https://example.com/api
```

All selected events go to **stdout**, including console errors. Surf's own status/errors stay on stderr; the existing launch-info JSON is also on stdout, so opting into logging makes stdout a mixed human-readable stream. Terminal control characters in page messages are escaped.

Logging follows the first page and its CDP-reported frame traffic across navigation; `surf trace --target-id` selects another page. It does not separately attach to other tabs, workers, or out-of-process iframe targets. When launching, Surf starts at `about:blank` (`data:,` with `--app`, since Chromium only opens app windows for web URLs), enables logging, then navigates to your URL so initial navigation and startup messages are captured. `--dump` shows this initial argument and the final `navigateTo` URL. Attachment only observes requests from that point onward; Chromium may replay buffered console messages when enabled.

Printing is independent of trace categories: excluding `surf.console` does not disable console printing, and printing does not enable trace collectors. Logging continues while traces finalize/save and between repeated recordings.

`--detached` and `--unmanaged` are incompatible because Surf would no longer be attached to your stdout. Use a coupled browser, or attach with `surf trace --port …`. Library launch/attachment options accept `printLog: ['console', 'network']`.
