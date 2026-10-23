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
