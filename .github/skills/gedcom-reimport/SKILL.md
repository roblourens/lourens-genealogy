---
name: gedcom-reimport
description: Re-import an updated Ancestry GEDCOM into the family-tree site, research the newly-added people, surface data found online that is NOT in the GEDCOM (for porting back to Ancestry), and rebuild/QA the site. Use whenever the owner says they updated/exported a new "Lourens Family Tree.ged", added people on Ancestry, or wants the site refreshed from the latest GEDCOM.
---

# Re-importing an updated GEDCOM

This repo is a static Vite + TypeScript site that visualizes a family tree exported from
Ancestry.com. The owner periodically updates `Lourens Family Tree.ged` with new people/data
from Ancestry. This skill is the repeatable workflow for pulling those changes in: re-parse the
data, research the new people (cited, no fabrication), and report back anything discovered online
that ISN'T in the GEDCOM so the owner can add it to Ancestry.

## Mental model

```
Lourens Family Tree.ged  (source of truth, edited on Ancestry)
        │  npm run parse
        ▼
data/tree.json ──┬── npm run geocode ──► data/places.json
                 ├── (research agents) ─► data/enrichment-partial/*.json
                 │                         └ npm run merge ─► data/enrichment.json
                 ├── data/connections.json   (famous-person links)
                 └── data/images.json         (Wikimedia images)
        │  npm run build
        ▼
dist/  (static site: HTML + JS + data/ + images, served by GitHub Pages)
```

The site reads `data/*.json` at runtime via **relative** fetches. The `.ged` file itself is never
shipped — only the generated JSON. Research is stored append-only in
`data/enrichment-partial/*.json` (one or more fragments per branch) and merged by personId.

## Pipeline commands

| Command | Does |
|---|---|
| `npm run parse` | GEDCOM → `data/tree.json` (people, families, places) |
| `npm run geocode` | new place names → lat/lng in `data/places.json` (rate-limited; misses are omitted) |
| `npm run merge` | folds every `data/enrichment-partial/*.json` → `data/enrichment.json` (validates personIds, skips unknown) |
| `npm run data` | parse + geocode + merge in sequence |
| `npm run build` | builds `dist/` |
| `npm run dev` | vite dev server on **:5180** |

## Step-by-step

### 1. Snapshot the current people, then re-parse
Capture the existing IDs BEFORE parsing so you can diff:
```bash
node -e "const t=require('./data/tree.json');require('fs').writeFileSync('research-work/old-ids.json',JSON.stringify(t.people.map(p=>p.id)))"
mkdir -p research-work   # gitignored scratch dir (see .gitignore)
npm run parse && npm run geocode && npm run merge && npm run build
```
`research-work/` is the scratch directory for this workflow — it is gitignored. **Do not use
`/tmp`**: background research agents in this environment refuse `/tmp` file operations, so all
agent input/output MUST be repo-relative paths under `research-work/`.

### 2. Diff new people and bucket them into branches
Every person is assigned to one of four grandparent lines (or `root`) by the SAME algorithm the
app uses — `computeBranches` in `site/src/data.ts`. Replicate it to bucket the newly-added people:
```bash
node -e '
const fs=require("fs");
const t=require("./data/tree.json");
const byId=new Map(t.people.map(p=>[p.id,p]));
const old=new Set(JSON.parse(fs.readFileSync("research-work/old-ids.json")));
const branchOf=new Map();
const root=byId.get(t.rootId);
const parents=root.parentIds.map(id=>byId.get(id)).filter(Boolean);
const gps=parents.flatMap(p=>p.parentIds.map(id=>byId.get(id)).filter(Boolean));
const s2b={lourens:"lourens",roorda:"roorda",stuenkel:"stuenkel",brueggemann:"brueggemann"};
for(const gp of gps){const b=s2b[(gp.surname||"").toLowerCase()];if(!b)continue;const q=[gp.id];const seen=new Set();while(q.length){const id=q.shift();if(seen.has(id))continue;seen.add(id);if(!branchOf.has(id))branchOf.set(id,b);const p=byId.get(id);p&&p.parentIds.forEach(pid=>q.push(pid));}}
for(const p of t.people){if(branchOf.has(p.id))continue;const fp=p.parentIds.map(id=>branchOf.get(id)).find(Boolean);branchOf.set(p.id,fp||"root");}
const neu=t.people.filter(p=>!old.has(p.id));
const buckets={lourens:[],roorda:[],stuenkel:[],brueggemann:[],root:[]};
for(const p of neu)buckets[branchOf.get(p.id)].push(p);
for(const k in buckets)console.log(k,buckets[k].length);
'
```
Branch colors (used across the site): lourens `#d98a4e`, roorda `#5aa9b8`, stuenkel `#8a7fc9`,
brueggemann `#b8657f`, root `#e6c878`.

### 3. Build rich research chunks
Give each research agent FULL existing context per person (so it can tell what's already known
vs. genuinely new). Write enriched records — id, name, birth/death, residences, events, resolved
parent/spouse/child NAMES, existing source/media counts — to `research-work/chunk-*.json`.
Split large branches into ~30–35-person chunks so agents don't time out. See the helper script in
prior runs (build `rich(person)` from `tree.json`).

### 4. Dispatch background research agents
One `general-purpose` background agent per chunk, in parallel. The prompt MUST include:
- **Repo-relative paths only** (input `research-work/chunk-X.json`, outputs
  `research-work/out-enrich-X.json` and `research-work/out-gaps-X.json`). Never `/tmp`.
- **Hard no-fabrication rules**: every claim cited with a real URL; cautious language for
  unproven leads ("candidate record", "not yet proven"); skip a person rather than pad with
  filler; quality over coverage. Deep pre-1700 ancestors will have many skips — that's correct.
- Two outputs (see schemas below): enrichment + gaps.

**Enrichment entry** (matches `mergeEnrichment` in `tools/merge-enrichment.ts`):
```json
{ "personId": "I...", "occupations": ["..."], "bio": "cited narrative",
  "funFacts": ["..."], "records": ["..."],
  "citations": [{ "label": "...", "url": "https://..." }] }
```
Every entry needs ≥1 citation. The merge auto-stamps `personName`, `researchedHash`,
`researchedAt`. Multiple fragments for the same personId are merged field-wise, so separate
per-agent files avoid write races — write each agent to its OWN file.

**Gaps finding** (the high-value "port back to Ancestry" output):
```json
{ "personId": "I...", "personName": "...",
  "findings": [{ "type": "occupation|birth-date|death-date|marriage|spouse|child|parent|residence|record-source|other",
    "detail": "the NEW data point, e.g. 'Occupation: Schulmeister in Flörsheim'",
    "inGedcom": false, "confidence": "confirmed|probable|possible",
    "source": { "label": "...", "url": "https://..." } }] }
```
Only list findings that ADD or REFINE beyond the input record. Always cite.

### 5. Collect, validate, and install research
For each agent: `read_agent`, confirm both output files parse, check for duplicate personIds.
Then move the enrichment fragments into the merge directory with descriptive names:
```bash
cp research-work/out-enrich-a.json data/enrichment-partial/Stuenkel-new-a.json   # etc.
npm run merge && npm run build
```
(`data/enrichment-partial/*.json` is globbed by the merge — any number of files is fine.)

### 6. Build the Ancestry gaps report
Combine `research-work/out-gaps-*.json` into one owner-facing report at
`research-work/ancestry-gaps.md` — grouped by person, every finding with its confidence and
source link. This is gitignored scratch; surface it to the owner in chat (or copy to the session
artifacts dir). Lead with the highest-confidence, most actionable findings (occupations, exact
dates, unrecorded children/spouses, new record sources).

### 7. QA with Playwright, then commit
Dev server on :5180. Drive it with `playwright-cli` (see the `playwright-cli` skill). Verify all
views render with the new counts and **no console errors**: Tree, Migration Map (arcs + arrows +
line-click highlight), Timeline ("River of Lifetimes"), Statistics, Connections (with images),
and a Person panel (bio + image gallery). Then:
```bash
git add -A   # research-work/ is gitignored and won't be committed
git commit -m "Re-import GEDCOM (N people): research M new ancestors + Ancestry gaps report"
```
Use the co-author trailer: `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.

## Gotchas (learned the hard way)

- **Agents reject `/tmp`** in this environment. All agent I/O must be under `research-work/`
  (repo-relative). Keep `research-work/` in `.gitignore`.
- **Branch assignment** is by grandparent surname; collaterals inherit a parent's branch. New
  people commonly land entirely in ONE branch (e.g. a big Stuenkel German push) — that's normal.
- **Relative fetch paths**: the app fetches `data/tree.json` etc. relatively, so the site works
  under a GitHub Pages subpath. Don't change them to absolute `/data/...`.
- **Mapbox**: token in `.env.local` (`VITE_MAPBOX_TOKEN`); restrict it by URL for public hosting.
  Map layer properties may only use `['zoom']` as the direct input to a top-level interpolate —
  never nested inside `case` (silent layer failure). Layout props (e.g. `icon-size`) can't use
  `feature-state` — drive selection emphasis through paint props (`icon-opacity`) instead.
- **Playwright + Mapbox**: `page.mouse.click` uses viewport coords but Mapbox feature queries use
  container coords; offset clicks by `canvas.getBoundingClientRect()`. The map sits ~84px below
  the viewport top (header).
- **Geocode misses** are simply omitted (variant/garbled place names); add fixes to
  `data/place-overrides.json` only if a gap is visually noticeable on the map.
- **Don't take external actions** (create repos, push public data, file issues/PRs) without the
  owner explicitly asking — the tree contains living relatives' data.
