---
name: gedcom-reimport
description: Re-import an updated Ancestry GEDCOM into the family-tree site, research the newly-added people, find images and famous-person connections for them, surface data found online that is NOT in the GEDCOM (for porting back to Ancestry), and rebuild/QA the site. Use whenever the owner says they updated/exported a new "Lourens Family Tree.ged", added people on Ancestry, or wants the site refreshed from the latest GEDCOM.
---

# Re-importing an updated GEDCOM

This repo is a static Vite + TypeScript site that visualizes a family tree exported from
Ancestry.com. The owner periodically updates `Lourens Family Tree.ged` with new people/data
from Ancestry. This skill is the complete, repeatable workflow for every GEDCOM update:

1. **Locate** the genuinely-latest export and copy it in (Step 0 — don't skip; the new file is
   often still in `~/Downloads`, and a wrong/old copy can be destructive).
2. **Ingest** — re-parse, geocode, merge, build.
3. **Diff & bucket** the newly-added people into the four family branches.
4. **Research** each new person (cited, no fabrication): bios, occupations, records.
5. **Images** — find freely-licensed Wikimedia images for new people/places/connections.
6. **Famous connections** — check whether new surnames plausibly link to famous people.
7. **Gaps report** — surface data found online that ISN'T in the GEDCOM, for porting to Ancestry.
8. **QA & commit.**

If an update turns out to contain **no new people** (e.g. only edited dates/sources on existing
people, or no change at all), say so plainly and skip the research/image/connection steps — see
Step 0. Never fabricate a re-import.

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

### 0. Locate the genuinely-latest export (do this first)
**Ancestry exports as a `.zip`** (containing `Lourens Family Tree.ged` + any media), and it usually
lands in `~/Downloads`. Repeated exports get numbered: `Lourens Family Tree.zip`,
`Lourens Family Tree (1).zip`, `(2)`, `(3)`… **The highest number is NOT always newest** — sort by
mtime and by the `.ged` size inside. The repo copy may already be newer than a stale download.
Before importing, figure out which file is actually latest and confirm it really adds something:
```bash
# Inspect every export zip in Downloads: show the .ged size + date inside each
cd ~/Downloads && for z in "Lourens Family Tree"*.zip; do
  echo "$z ->"; unzip -l "$z" | grep -i '\.ged'
done
# Extract the newest-looking one and compare INDI (people) counts to the repo
unzip -o -q "Lourens Family Tree (N).zip" -d ./_ged_check
NEW="./_ged_check/Lourens Family Tree.ged"; REPO="/Users/roblou/code/geneaology/Lourens Family Tree.ged"
echo "NEW  $(grep -c '^0 @I' "$NEW") people / $(wc -c < "$NEW") bytes"
echo "REPO $(grep -c '^0 @I' "$REPO") people / $(wc -c < "$REPO") bytes"
diff <(grep -oE '^0 @I[0-9]+@' "$REPO"|sort) <(grep -oE '^0 @I[0-9]+@' "$NEW"|sort) | grep -c '^>'  # new people
```
(Also check for any bare `~/Downloads/Lourens Family Tree.ged` — an older flow extracted it loose.)
Decision rules:
- **The newest, largest export wins.** A *smaller* INDI count than the repo copy almost always
  means an older/partial export — importing it would DELETE people. Never import a smaller file
  without explicit owner confirmation.
- Once you've identified the genuinely-newest `.ged`, copy it into the repo
  (`cp "./_ged_check/Lourens Family Tree.ged" .`) before parsing, then clean up `_ged_check`.
- After parsing, **diff to confirm real change** (Step 2). If `git diff "Lourens Family Tree.ged"`
  is empty and the parsed people are byte-identical (0 added, 0 changed by `hash`), there is
  nothing to import — tell the owner the repo already has the latest (cite the timestamp + count)
  and ask where the new export is. Do not run research on an unchanged tree.
- An update can also change data on *existing* people (not add new ones). Detect that by comparing
  per-person `hash` against `git show HEAD:data/tree.json` (see Step 2). Re-research changed people
  too if the change is substantive (new place/occupation/dates).

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

Also detect people whose *data changed* (not just additions) by comparing content hashes against
the committed tree:
```bash
git show HEAD:data/tree.json > research-work/tree-old.json
node -e '
const o=new Map(require("./research-work/tree-old.json").people.map(p=>[p.id,p.hash]));
const changed=require("./data/tree.json").people.filter(p=>o.has(p.id)&&o.get(p.id)!==p.hash);
console.log("changed existing people:",changed.length); changed.forEach(p=>console.log("  ",p.id,p.name));
'
```

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
Combine `research-work/out-gaps-*.json` into one owner-facing report committed at
**`research/ancestry-gaps.md`** (note: `research/` is committed; `research-work/` is gitignored
scratch). Group by person, sort findings confirmed → probable → possible, render each with its
type, confidence badge, and source link, and flag findings that **conflict** with existing tree
values. Lead with the most actionable (occupations, exact dates, unrecorded children/spouses, new
record sources). Surface the headline numbers to the owner in chat.

### 7. Find images (Wikimedia)
Look for freely-licensed images for the new people, their key places, and any famous connections.
Manifest is `data/images.json`; files live in `data/images/` and are served because
`site/public/data` symlinks to `../../data`. The person panel (`person.ts`) and connection cards
(`connections.ts`) auto-render images keyed by personId or connection id — no code change needed.

Dispatch a background agent (repo-relative paths only) that:
- Searches **Wikimedia Commons** (and only clearly free licenses: public domain, CC0, CC BY,
  CC BY-SA) for portraits of famous connections, coats of arms, and place/context images
  (churches, towns, states/stinsen) relevant to new people and connections.
- **Downloads** each into `data/images/<key>-<n>.jpg` (`key` = a personId like `I2727...` for
  place-context on a person, or a connection id like `roorda-frisian-nobility`).
- **Appends** to `data/images.json` preserving existing entries, each:
```json
{ "localPath": "data/images/<key>-1.jpg", "sourceUrl": "https://commons.wikimedia.org/...",
  "caption": "...", "credit": "Author / institution", "license": "CC BY-SA 4.0",
  "kind": "portrait|coat-of-arms|context" }
```
Never invent a person's photo — pre-photography ancestors get *place/context* images only, clearly
captioned as context, not as a likeness. Validate: every `localPath` exists and is a real JPEG
(`b[0]===0xFF && b[1]===0xD8`).

### 8. Check for famous connections
For distinctive/rare surnames among the new people, research whether they plausibly connect to a
famous person of that name. Manifest is `data/connections.json` (rendered on the Connections page,
sorted by confidence). Dispatch a background agent that, for each candidate surname:
- Researches the famous namesake AND the family's region/era, and judges the link honestly.
- **Appends** a connection entry (preserve existing; `relatedPersonIds` MUST be real tree ids):
```json
{ "id": "kebab-id", "surname": "Roorda", "famousPerson": "...", "famousDescription": "...",
  "relatedPersonIds": ["I2727..."], "confidence": "confirmed|plausible|speculative",
  "reasoning": "honest assessment — what's documented vs. what's a shared-surname guess",
  "citations": [{ "label": "...", "url": "https://..." }] }
```
Confidence rubric: `confirmed` = a documented genealogical link; `plausible` = same rare surname,
overlapping region & era, real possibility but unproven; `speculative` = shared surname + fun
"what if", no established link. **Be honest** — most are plausible/speculative and the UI says so.
Never inflate confidence. Validate every `relatedPersonIds` exists in `data/tree.json`.

### 9. QA with Playwright, then commit
Dev server on :5180. Drive it with `playwright-cli` (see the `playwright-cli` skill). Verify all
views render with the new counts and **no console errors**: Tree, Migration Map (arcs + arrows +
line-click highlight), Timeline ("River of Lifetimes"), Statistics, Connections (with images),
and a Person panel (bio + image gallery). Then:
```bash
git add -A   # research-work/ is gitignored and won't be committed
git commit -m "Re-import GEDCOM (N people): research M new ancestors + images + connections + gaps"
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
- **"I updated the GEDCOM" ≠ there's new data.** The newest export is often still in `~/Downloads`
  and the repo copy may already be newer. Always run Step 0: compare mtime + INDI count, never
  import a smaller file, and if nothing actually changed, report that (with timestamp + count) and
  ask where the new file is — don't run a no-op research pass.
- **Images**: only free licenses (PD/CC0/CC BY/CC BY-SA), always store `credit` + `license`, and
  never present a context image (church/town) as a person's likeness. Pre-photography people get
  context images only.
- **Connections**: be honest about confidence — most are `plausible`/`speculative`. Validate every
  `relatedPersonIds` against the tree, or the card silently references a missing person.
