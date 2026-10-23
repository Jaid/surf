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
