For managed sessions, Surf suppresses first-run/default-browser prompts and disables background mode so closing the final window can end the session. It deliberately avoids Puppeteer's automation argument preset and viewport emulation.

`--performance` carries forward the high-performance GPU, GPU rasterization, zero-copy, and background-throttling switches from the earlier launchers. These are requests to the browser, not guarantees of improved performance.

Sandboxing, download safety, self-XSS protection, syncing, and ordinary browser networking are not silently disabled. The old launchers' unsafe convenience switches can be supplied explicitly after `--` if desired.

Every managed session has a loopback CDP endpoint. `--port 0` (default) selects a free port; use a fixed port when another tool needs to attach:

```powershell
surf localhost:5173 --port 9222 --background
```

`--grant` pre-answers permission prompts for the URL’s origin, which is handy because throwaway profiles forget “Remember my decision” choices. For example, a public site sending telemetry to `*.lan` hosts needs Chromium’s Local Network Access permission:

```powershell
surf slop.gallery --app --grant local-network
```

Use web permission names as accepted by `navigator.permissions.query()`, like `local-network` (other devices on the local network), `loopback-network` (localhost), `notifications` or `camera`; repeat the flag to combine them. Grants apply to the launch URL’s origin only and last for the browser session. Surf opens a placeholder page first, grants over CDP, then navigates, so even the first requests are allowed. It requires a managed session and an HTTP(S) URL; library options accept `grant: ['local-network']`.

CDP grants full control over the session. Do not expose its port outside loopback or use it with a profile whose data you do not want local debugging clients to access.
