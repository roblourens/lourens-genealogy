
## Update 2026-06-20b — Directional arrows + research merged

- **Map directional arrows** — added an `arc-arrows` symbol layer (5 pre-colored, per-branch raster arrowheads drawn on canvas) running parent→child along each arc, so every migration line now shows its direction of travel. Verified live via Playwright (arrows point toward the American Midwest; dim/brighten correctly when a line is highlighted). Fixed a Mapbox `feature-state`-in-layout error by making `icon-size` zoom-only (selection emphasis comes from paint `icon-opacity`).
- **Research merged** — collected all four branch fun-facts agents (Lourens 41, Roorda 39, Stuenkel 32, Brueggemann 32 partial entries; **142 merged** into `enrichment.json`, no dupes), plus new famous connections (13 total incl. Grutte Pier, Fokker, van Harinxma) and new images (**21 keys / 22 JPEGs**, all valid). `npm run merge` + `npm run build` succeed.
- **Final QA** — Playwright pass across all six views (tree, map+arrows+highlight, timeline 423 bars, stats 344/16/64, connections w/ images, person panel w/ bio+images). **Zero console errors**. Magazine-quality throughout.

## Update 2026-06-21 — GEDCOM re-import (344 → 447) + Ancestry gaps report

- Owner updated `Lourens Family Tree.ged` again: **344 → 447 people** (103 new, all on the Stuenkel/German line, deep 1400s–1700s Hessen & Hannover ancestors). Re-ran parse/geocode/merge/build.
- Researched all 103 via 3 parallel agents (repo-relative paths under `research-work/` — agents reject `/tmp` here): **51 cited enrichment entries** merged (enrichment.json 142 → 193, no dupes, all cited).
- **New: Ancestry gaps report** (`research/ancestry-gaps.md`) — 159 sourced findings across 49 people that are NOT in the GEDCOM (occupations, exact dates, marriages, unrecorded children, parents, record sources), prioritized by confidence with conflict flags, for porting back to Ancestry.
- **New: project skill** `.github/skills/gedcom-reimport/SKILL.md` documenting this whole re-import + research + gaps workflow.
- QA: stats 447/16/64, map arrows + highlight, new person panels (e.g. Johann Feddeler) all render, zero console errors.
