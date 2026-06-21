#!/usr/bin/env bash
# Build historical European border snapshots for the migration map.
#
# Source: aourednik/historical-basemaps (GPL-3.0) — world border GeoJSON snapshots.
# We crop each snapshot to a Europe bounding box, simplify the geometry, keep only
# the country NAME, and combine everything into a single data/borders.json keyed by
# year. The map lazily fetches this file when the "Historical borders" toggle is on
# and swaps the visible snapshot to the most recent year <= the timeline position.
set -euo pipefail

YEARS=(1500 1530 1600 1650 1700 1715 1783 1800 1815 1880 1900 1914 1920 1938 1945 1994 2010)
BBOX="-12,35,40,71"          # west,south,east,north — British Isles to the Baltic
SIMPLIFY="8%"
PRECISION="0.01"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CACHE="$ROOT/tools/.borders-cache"
OUT_DIR="$CACHE/processed"
BASE="https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson"
mkdir -p "$CACHE" "$OUT_DIR"

for y in "${YEARS[@]}"; do
	raw="$CACHE/world_${y}.geojson"
	proc="$OUT_DIR/${y}.geojson"
	if [ ! -f "$raw" ]; then
		echo "downloading $y..."
		curl -sL "$BASE/world_${y}.geojson" -o "$raw"
	fi
	echo "processing $y..."
	npx --yes mapshaper "$raw" \
		-clip bbox="$BBOX" \
		-simplify "$SIMPLIFY" keep-shapes \
		-filter-fields NAME \
		-o format=geojson precision="$PRECISION" "$proc" >/dev/null 2>&1
done

echo "combining..."
python3 - "$OUT_DIR" "$ROOT/data/borders.json" "${YEARS[@]}" <<'PY'
import json, sys
out_dir, out_path = sys.argv[1], sys.argv[2]
years = [int(y) for y in sys.argv[3:]]
snapshots = {}
for y in years:
    with open(f"{out_dir}/{y}.geojson") as f:
        fc = json.load(f)
    # Drop features with no name to reduce clutter.
    fc["features"] = [ft for ft in fc["features"] if ft.get("properties", {}).get("NAME")]
    snapshots[str(y)] = fc
doc = {
    "source": "aourednik/historical-basemaps (GPL-3.0)",
    "sourceUrl": "https://github.com/aourednik/historical-basemaps",
    "years": years,
    "snapshots": snapshots,
}
with open(out_path, "w") as f:
    json.dump(doc, f, separators=(",", ":"))
import os
print(f"wrote {out_path} ({os.path.getsize(out_path)//1024} KB), {len(years)} snapshots")
PY
