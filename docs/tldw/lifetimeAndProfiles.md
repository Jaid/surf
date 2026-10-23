| Setting | Behavior |
| --- | --- |
| Default | Surf waits for the browser process. Ctrl+C closes it and cleans up. |
| `--unmanaged` | Spawn directly and exit: no worker, CDP connection, icon helper, or cleanup. |
| `--detached` | Surf returns after startup. A background Surf worker supervises the browser and performs cleanup. |
| No `--user-data-dir` (managed) | A unique OS-temporary profile is created and removed after the browser exits. |
| Explicit `--user-data-dir` | The directory is created if necessary and **never deleted by Surf**. |
| `--profile` | A directory name inside the user data directory; defaults to `Default`. |

Paths can be relative to the current working directory or start with `~/`.

**Managed sessions:** A data directory must not already be open in another browser process, including another Surf session. Surf requires an independently owned process: it does not attach to or close your everyday browser. Chromium itself enforces profile exclusivity; a handoff to an existing process is treated as a failed launch. Recent Chrome also refuses remote debugging with its default everyday data directory; use a dedicated directory.

Existing profile files are not rewritten by Surf. Empty/new managed directories receive a small Brave P3A opt-out `Local State`; subsequent preference updates belong to the browser.

Normal shutdown is graceful, with a process-tree termination fallback after 10 seconds if the browser is stuck. OS crashes, force-killing Surf, and power loss can leave temporary profiles behind. Do not delete a profile while its browser is running.

A successful managed launch prints one JSON object to stdout with the browser PID, executable, URL, data directory, temporary status, and CDP WebSocket URL. Detached launches also report their log file. Diagnostics go to stderr or the detached session log.

Windows workers break away from the launching console and its Job Object. Detached session status/logs remain under `<cache>/sessions/<id>/`; the browser's temporary data directory is still removed. Completed session directories can be deleted when their logs are no longer needed.

# Unmanaged startup apps

Use `--unmanaged` for ordinary, long-lived apps such as the kiosk entries in `hello`. It implies detachment; `--detached` is unnecessary. The browser’s normal data directory is used unless `--user-data-dir` selects an explicit persistent directory. Surf never creates throwaway profiles or changes profile preferences in this mode.

Multiple app launches can share a running browser and its login sessions. Chromium handles the handoff; Surf neither connects to nor owns that browser. No Surf process remains after launch, and no session directory or log is created. On Windows the browser is launched independently of the terminal and its Job Object.

The JSON result has `mode: "unmanaged"` and `spawnedPid`, not an owned browser `pid`, debugging URL, or log path. The spawned process may exit immediately after handing the request to an existing browser. Success means the OS accepted the spawn, not that a window or page finished loading; later browser failures are not monitored.

`--trace` and `--better-icon` are rejected rather than silently starting supervision. Use managed sessions when those features are needed. Unmanaged launches only add the window/profile flags and explicitly requested performance or passthrough switches; they do not alter browser background mode or enable remote debugging by default. Explicit `--port` adds a loopback debugging endpoint without a worker or CDP connection; Surf does not wait for it or discover its WebSocket URL. Browser restrictions on debugging its normal data directory still apply. When handing off to an existing browser, startup-only flags such as the debugging port cannot reconfigure that process.
