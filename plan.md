
## Update 2026-06-20b — Directional arrows + research merged

- **Map directional arrows** — added an `arc-arrows` symbol layer (5 pre-colored, per-branch raster arrowheads drawn on canvas) running parent→child along each arc, so every migration line now shows its direction of travel. Verified live via Playwright (arrows point toward the American Midwest; dim/brighten correctly when a line is highlighted). Fixed a Mapbox `feature-state`-in-layout error by making `icon-size` zoom-only (selection emphasis comes from paint `icon-opacity`).
- **Research merged** — collected all four branch fun-facts agents (Lourens 41, Roorda 39, Stuenkel 32, Brueggemann 32 partial entries; **142 merged** into `enrichment.json`, no dupes), plus new famous connections (13 total incl. Grutte Pier, Fokker, van Harinxma) and new images (**21 keys / 22 JPEGs**, all valid). `npm run merge` + `npm run build` succeed.
- **Final QA** — Playwright pass across all six views (tree, map+arrows+highlight, timeline 423 bars, stats 344/16/64, connections w/ images, person panel w/ bio+images). **Zero console errors**. Magazine-quality throughout.
