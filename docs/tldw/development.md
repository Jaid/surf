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
