# The Lourens Family Tree

An interactive, research-enriched visualization of the Lourens, Roorda, Stuenkel, and
Brueggemann family lines — four immigrant branches spanning twelve generations and four
centuries, from the 1500s Netherlands and Germany into the American Midwest.

The site is built from a GEDCOM export (Ancestry.com) that is **canonical and never
modified**. Web research is layered on top as a separate, additive enrichment keyed by
each person's stable Ancestry id, so an updated GEDCOM can be re-imported without losing
prior research.

## Views

- **Tree** — a zoomable, pannable D3 pedigree of every ancestor back to the 1500s. Click
  anyone to open their full story.
- **Migration Map** — a Mapbox GL map drawing generational arcs from each parent's origin
  to their child's, colored by branch, with a timeline scrubber and per-line toggles.
  Watch the four lines cross from the Netherlands & Germany into Iowa and Nebraska.
- **Statistics** — lifespans, births by half-century, country of origin, surname
  frequency, and superlatives, all computed live from the tree.
- **Connections** — distinctive surnames weighed against famous namesakes, each labelled
  by how likely the link really is (documented / plausible / speculative). Honestly
  assessed, never invented.

## Quick start

```bash
npm install

# (optional) enable the migration map — see "Mapbox token" below
echo "VITE_MAPBOX_TOKEN=pk.your_token_here" > .env.local

npm run dev      # http://localhost:5180
```

Every view works without a token; only the migration map needs one.

```bash
npm run build    # production build into dist/
npm run preview  # serve the production build
```

## Mapbox token

The map uses [Mapbox GL JS](https://www.mapbox.com/). Create a **free** access token at
[account.mapbox.com](https://account.mapbox.com/access-tokens/) (it starts with `pk.`),
then put it in an untracked `.env.local` file in the repo root:

```
VITE_MAPBOX_TOKEN=pk.your_token_here
```

Restart the dev server. The token is only used at runtime for map tiles; geocoding at
build time uses the free Nominatim service and needs no key. `.env.local` is gitignored.

## Data pipeline

The original GEDCOM is the source of truth. Tools transform it into static JSON that the
site loads at runtime.

```
Lourens Family Tree.ged                 # source (replace to update)
  │
  ├─ npm run parse   ─►  data/tree.json        normalized people/families/events + per-person hash
  ├─ npm run geocode ─►  data/places.json      place → {lat,lng,country} (cached, additive)
  └─ npm run merge   ─►  data/enrichment.json   research findings, keyed by person id

  npm run data       # runs parse + geocode + merge in order

data/connections.json     # famous-surname research (confidence-labelled)
data/place-overrides.json # hand corrections for bad/ambiguous geocodes
data/sync-state.json      # last-seen per-person hashes (drives incremental re-research)
data/enrichment-partial/  # per-branch research drops, merged into enrichment.json
```

The site reads `data/*` (symlinked into `site/public/data`) and merges canonical facts
with the enrichment layer at load time. Research facts are kept separate from GEDCOM facts
and carry citations.

## Updating the tree (incremental re-import)

When you export a fresh GEDCOM from Ancestry, the pipeline only re-does work for people
who actually changed:

```bash
# 1. Replace the GEDCOM file, then diff it against the last sync:
npm run sync
```

`sync` re-parses the tree, geocodes any new places, and writes `data/research-queue.json`
listing exactly which people are **added**, **changed**, **removed**, or **stale** (i.e.
need research). Existing enrichment and connections for unchanged people are preserved,
keyed by their stable Ancestry id.

```bash
# 2. Research the queued people (added/changed) and drop findings into
#    data/enrichment-partial/<branch>.json using the existing entry shape.

# 3. Fold the new research back in:
npm run merge
```

Because everything is keyed by stable id and guarded by content hashes, re-running is
idempotent — research is never lost and only genuinely new/changed people are re-queried.

## Tech

Vite + TypeScript static site. D3 for the tree and charts, Mapbox GL JS for the map.
Shared data-model types live in `shared/types.ts`; tools run via `tsx`.

## Notes on data integrity

- GEDCOM facts are canonical and untouched.
- Enrichment and famous-person connections are clearly separated, cited where possible,
  and labelled by confidence. Nothing genealogical is fabricated; unproven links are
  called out as such.
