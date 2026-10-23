Surf suppresses first-run/default-browser prompts and disables background mode so closing the final window can end the session. It deliberately avoids Puppeteer's automation argument preset and viewport emulation.

`--performance` carries forward the high-performance GPU, GPU rasterization, zero-copy, and background-throttling switches from the earlier launchers. These are requests to the browser, not guarantees of improved performance.

Sandboxing, download safety, self-XSS protection, syncing, and ordinary browser networking are not silently disabled. The old launchers' unsafe convenience switches can be supplied explicitly after `--` if desired.

Every session has a loopback CDP endpoint. `--port 0` (default) selects a free port; use a fixed port when another tool needs to attach:

```powershell
surf localhost:5173 --port 9222 --detached
```

CDP grants full control over the session. Do not expose its port outside loopback or use it with a profile whose data you do not want local debugging clients to access.
