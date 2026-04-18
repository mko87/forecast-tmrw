# forecast-tmrw — Changelog

## v0.1 (2026-04-18)

### Initial release

**Features:**
- Current weather via Tomorrow.io Realtime API
  - Temperature (decimal precision)
  - Weather condition (EN/DE)
  - Rain probability (%)
  - Rain intensity (mm/h)
- 24h temperature chart
  - 2px line, full decimal precision
  - Night shading (blue fill on color, stipple on B&W)
  - Y-axis: min/max labels
  - X-axis: hour labels every 6h, no overlap
- 24h rain intensity chart (same layout)
- Pebble Clay settings
  - Tomorrow.io API key input
  - EN/DE language toggle (default: EN)
  - Debug log toggle + log display
- Scroll layout for all screen sizes

**Platforms:** aplite, basalt, chalk, diorite, emery
