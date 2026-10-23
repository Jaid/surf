`--app --better-icon` supports Windows with PowerShell 7 and an HTTP(S) launch URL.

- Discovers page and web-app-manifest icons, preferring SVG and high-resolution sources.
- Selects media-qualified icons and renders SVG color-scheme rules using the Windows **system/taskbar** theme.
- Produces a multi-resolution ICO, including exact 32 px and DPI-scaled sizes.
- Uses an isolated, headless browser for SVG rendering; external SVG resources are blocked.
- Caches icons for 24 hours by URL and theme.
- Applies icons only to the owned browser PID's unambiguous app window; never guesses by focus or title.
- Reapplies native icons if Chromium replaces them, and releases the handles on shutdown.

Icon failures do not prevent launching. The launch site's icon stays fixed across navigation and theme changes; relaunch to refresh it. Discovery uses unauthenticated HTTP rather than browser cookies or page JavaScript. Existing pinned shortcuts and taskbar grouping can still affect the displayed icon. Multiple matching windows are deliberately rejected.
