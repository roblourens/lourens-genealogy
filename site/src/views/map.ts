import mapboxgl from 'mapbox-gl';
import type { Person } from '../../../shared/types';
import type { AppContext, ViewController } from '../main';
import type { BranchKey } from '../data';
import { BRANCHES } from '../data';
import { branchColor, escapeHtml, firstPlacePoint, lifespanLabel, shortPlace } from '../util';

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined;
const ROOT_BIRTH = 1988;

interface Anchor {
	lng: number;
	lat: number;
	place: string;
}

/** Estimated year for timeline ordering when an exact birth year is unknown. */
function estYear(p: Person): number {
	if (p.birthYear) return p.birthYear;
	if (p.generation != null) return ROOT_BIRTH - p.generation * 30;
	return ROOT_BIRTH;
}

export function createMapView(ctx: AppContext): ViewController {
	const { data } = ctx;
	const el = document.createElement('div');
	el.className = 'map-view';

	if (!TOKEN) {
		el.innerHTML = `
			<div class="map-missing">
				<div class="panel-card">
					<h2>Add your Mapbox token to unlock the map</h2>
					<p style="color:var(--muted-text);line-height:1.6">
						The migration map uses Mapbox GL. Create a free token at
						<a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noopener" style="color:var(--branch-roorda)">account.mapbox.com</a>,
						then add it to a file named <code>.env.local</code> in the project root:
					</p>
					<pre style="background:rgba(0,0,0,.4);padding:14px 16px;border-radius:8px;text-align:left;overflow:auto;color:var(--gold-2)">VITE_MAPBOX_TOKEN=pk.your_token_here</pre>
					<p style="color:var(--muted-text)">Then restart the dev server. Every other view works without it.</p>
				</div>
			</div>`;
		return { el };
	}

	const mapEl = document.createElement('div');
	mapEl.id = 'map';
	el.appendChild(mapEl);

	el.insertAdjacentHTML(
		'beforeend',
		`
		<div class="legend panel-card" id="map-legend">
			<h4>Migration by Line</h4>
			<div id="map-legend-rows"></div>
			<div style="margin-top:10px;font-size:11.5px;color:var(--muted-text);line-height:1.45">
				Arcs run from each parent's origin to their child's. Click a line's branch to toggle it.
			</div>
		</div>
		<div class="view-intro-pill">Watch four immigrant lines cross from the Netherlands &amp; Germany into the American Midwest. Drag the timeline to move through the centuries.</div>
		<button class="map-clear-hint" id="map-clear-hint" type="button">Tracking one family line · click to reset</button>
		<div class="map-timeline panel-card">
			<button class="ctrl-btn map-play" id="map-play" title="Play">▶</button>
			<span class="yr-label" id="map-year">All years</span>
			<input type="range" id="map-slider" min="1550" max="2000" value="2000" step="5" />
		</div>`,
	);

	const hint = el.querySelector('#map-clear-hint') as HTMLButtonElement;
	hint.addEventListener('click', () => clearSelection());

	mapboxgl.accessToken = TOKEN;
	const map = new mapboxgl.Map({
		container: mapEl,
		style: 'mapbox://styles/mapbox/dark-v11',
		center: [-30, 47],
		zoom: 2.4,
		projection: { name: 'mercator' },
		attributionControl: true,
	});
	map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'bottom-right');
	if (import.meta.env.DEV) (window as unknown as { __genMap: mapboxgl.Map }).__genMap = map;

	const activeBranches = new Set<BranchKey>(['lourens', 'roorda', 'stuenkel', 'brueggemann', 'root']);
	let sliderYear = 2000;

	// Build anchors per person.
	const anchorOf = new Map<string, Anchor>();
	for (const p of data.people) {
		const pt = firstPlacePoint(data, p);
		if (pt) anchorOf.set(p.id, pt);
	}

	// Aggregate place nodes. For each place we record, per person, the earliest year they
	// appear there (actual event year when known, else an estimate). That lets the dot grow
	// over time: at slider year T a place shows only the people who had arrived by T.
	const nodeMap = new Map<
		string,
		{ lng: number; lat: number; place: string; arrivals: Map<string, number> }
	>();
	for (const p of data.people) {
		const est = estYear(p);
		for (const ev of p.events) {
			if (!ev.place) continue;
			const gp = data.places[ev.place];
			if (!gp) continue;
			const key = `${gp.lat.toFixed(3)},${gp.lng.toFixed(3)}`;
			let node = nodeMap.get(key);
			if (!node) {
				node = { lng: gp.lng, lat: gp.lat, place: ev.place, arrivals: new Map() };
				nodeMap.set(key, node);
			}
			const y = ev.year ?? est;
			const prev = node.arrivals.get(p.id);
			if (prev == null || y < prev) node.arrivals.set(p.id, y);
		}
	}

	// Per-node sorted arrival years (one entry per distinct person) — used to count how many
	// people are present at a place by a given year. Indexed to match feature ids.
	const nodeYears: number[][] = [];
	const pointFeatures: GeoJSON.Feature[] = [...nodeMap.values()].map((n, i) => {
		const years = [...n.arrivals.values()].sort((a, b) => a - b);
		nodeYears[i] = years;
		return {
			type: 'Feature',
			id: i,
			geometry: { type: 'Point', coordinates: [n.lng, n.lat] },
			properties: {
				place: shortPlace(n.place),
				count: n.arrivals.size,
				ids: [...n.arrivals.keys()].join(','),
				minYear: years[0],
			},
		};
	});

	/** Number of people present at node `i` by `year` (binary search over sorted arrivals). */
	function countByYear(i: number, year: number): number {
		const ys = nodeYears[i];
		let lo = 0;
		let hi = ys.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (ys[mid] <= year) lo = mid + 1;
			else hi = mid;
		}
		return lo;
	}

	// Build generational arcs (parent -> child).
	const arcFeatures: GeoJSON.Feature[] = [];
	for (const child of data.people) {
		const childAnchor = anchorOf.get(child.id);
		if (!childAnchor) continue;
		for (const parentId of child.parentIds) {
			const parentAnchor = anchorOf.get(parentId);
			if (!parentAnchor) continue;
			if (parentAnchor.lng === childAnchor.lng && parentAnchor.lat === childAnchor.lat) continue;
			const branch = data.branchOf.get(child.id) ?? 'root';
			const parent = data.personById.get(parentId)!;
			arcFeatures.push({
				type: 'Feature',
				id: arcFeatures.length,
				geometry: {
					type: 'LineString',
					coordinates: arc([parentAnchor.lng, parentAnchor.lat], [childAnchor.lng, childAnchor.lat]),
				},
				properties: {
					branch,
					color: branchColor(branch),
					year: estYear(child),
					childId: child.id,
					parentId,
					from: parent.name,
					to: child.name,
					fromPlace: shortPlace(parentAnchor.place),
					toPlace: shortPlace(childAnchor.place),
				},
			});
		}
	}

	// Directional arrow markers placed along each arc, with an explicit bearing so they always
	// point parent → child (the actual direction of migration). We compute the bearing in Web
	// Mercator space so it matches the rendered curve, instead of relying on Mapbox's ambiguous
	// line-symbol auto-rotation.
	const arrowFeatures: GeoJSON.Feature[] = [];
	for (const a of arcFeatures) {
		const coords = (a.geometry as GeoJSON.LineString).coordinates as [number, number][];
		const span = Math.hypot(
			coords[coords.length - 1][0] - coords[0][0],
			coords[coords.length - 1][1] - coords[0][1],
		);
		const nArrows = Math.max(1, Math.min(4, Math.round(span / 9)));
		for (let k = 1; k <= nArrows; k++) {
			const t = k / (nArrows + 1);
			const { point, bearing } = pointAtFraction(coords, t);
			arrowFeatures.push({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: point },
				properties: {
					branch: a.properties!.branch,
					color: a.properties!.color,
					year: a.properties!.year,
					bearing,
				},
			});
		}
	}

	// Adjacency over anchored arcs, for lineage tracing on click.
	const parentsOf = new Map<string, string[]>();
	const childrenOf = new Map<string, string[]>();
	for (const f of arcFeatures) {
		const childId = f.properties!.childId as string;
		const parentId = f.properties!.parentId as string;
		(parentsOf.get(childId) ?? parentsOf.set(childId, []).get(childId)!).push(parentId);
		(childrenOf.get(parentId) ?? childrenOf.set(parentId, []).get(parentId)!).push(childId);
	}

	/** All people on one person's vertical line: their anchored ancestors + descendants. */
	function lineageOf(personId: string): Set<string> {
		const set = new Set<string>([personId]);
		const upStack = [personId];
		while (upStack.length) {
			const id = upStack.pop()!;
			for (const p of parentsOf.get(id) ?? []) if (!set.has(p)) (set.add(p), upStack.push(p));
		}
		const downStack = [personId];
		while (downStack.length) {
			const id = downStack.pop()!;
			for (const c of childrenOf.get(id) ?? []) if (!set.has(c)) (set.add(c), downStack.push(c));
		}
		return set;
	}

	const yearsAll = arcFeatures.map((f) => f.properties!.year as number);
	const minYear = Math.min(ROOT_BIRTH, ...yearsAll);

	map.on('load', () => {
		boldenBorders(map);

		map.addSource('arcs', { type: 'geojson', data: fc(arcFeatures) });
		map.addSource('nodes', { type: 'geojson', data: fc(pointFeatures) });
		map.addSource('arrows', { type: 'geojson', data: fc(arrowFeatures) });
		map.addSource('arc-draw', { type: 'geojson', data: fc([]) });
		map.addSource('arc-head', { type: 'geojson', data: fc([]) });

		map.addLayer({
			id: 'arc-glow',
			type: 'line',
			source: 'arcs',
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': ['get', 'color'],
				'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 9, 4],
				'line-opacity': [
					'case',
					['boolean', ['feature-state', 'sel'], false],
					0.3,
					['boolean', ['feature-state', 'dim'], false],
					0.03,
					0.12,
				],
				'line-blur': 3,
			},
		});
		map.addLayer({
			id: 'arc-line',
			type: 'line',
			source: 'arcs',
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': ['get', 'color'],
				'line-width': [
					'interpolate',
					['linear'],
					['zoom'],
					2,
					['case', ['boolean', ['feature-state', 'sel'], false], 2.6, 1.1],
					6,
					['case', ['boolean', ['feature-state', 'sel'], false], 4.5, 2.2],
				],
				'line-opacity': [
					'case',
					['boolean', ['feature-state', 'sel'], false],
					0.98,
					['boolean', ['feature-state', 'dim'], false],
					0.06,
					0.7,
				],
			},
		});
		map.addLayer({
			id: 'arc-hit',
			type: 'line',
			source: 'arcs',
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': '#000000',
				'line-width': ['interpolate', ['linear'], ['zoom'], 2, 12, 6, 16],
				'line-opacity': 0.01,
			},
		});

		// Directional arrowheads: one source of pre-oriented points, each rotated to its arc's
		// parent → child bearing so it always points the way the family actually moved.
		for (const key of Object.keys(BRANCHES) as BranchKey[]) {
			const id = `arrow-${key}`;
			if (!map.hasImage(id)) map.addImage(id, makeArrowImage(BRANCHES[key].color), { pixelRatio: 2 });
		}
		map.addLayer({
			id: 'arc-arrows',
			type: 'symbol',
			source: 'arrows',
			layout: {
				'icon-image': [
					'match',
					['get', 'branch'],
					'lourens', 'arrow-lourens',
					'roorda', 'arrow-roorda',
					'stuenkel', 'arrow-stuenkel',
					'brueggemann', 'arrow-brueggemann',
					'arrow-root',
				],
				'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.8, 6, 1.4],
				'icon-rotate': ['get', 'bearing'],
				'icon-rotation-alignment': 'map',
				'icon-allow-overlap': true,
				'icon-ignore-placement': true,
			},
			paint: { 'icon-opacity': 0.95 },
		});
		// Animated "draw-in" layers: partial arcs grow from parent → child as the year sweeps.
		map.addLayer({
			id: 'arc-draw-glow',
			type: 'line',
			source: 'arc-draw',
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': ['get', 'color'],
				'line-width': ['interpolate', ['linear'], ['zoom'], 2, 6, 6, 11],
				'line-opacity': 0.28,
				'line-blur': 4,
			},
		});
		map.addLayer({
			id: 'arc-draw-line',
			type: 'line',
			source: 'arc-draw',
			layout: { 'line-cap': 'round', 'line-join': 'round' },
			paint: {
				'line-color': ['get', 'color'],
				'line-width': ['interpolate', ['linear'], ['zoom'], 2, 2.6, 6, 4.5],
				'line-opacity': 1,
			},
		});
		// Bright leading "comet head" at the tip of each line as it draws in.
		map.addLayer({
			id: 'arc-head-glow',
			type: 'circle',
			source: 'arc-head',
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 7, 6, 12],
				'circle-color': ['get', 'color'],
				'circle-blur': 1,
				'circle-opacity': 0.55,
			},
		});
		map.addLayer({
			id: 'arc-head',
			type: 'circle',
			source: 'arc-head',
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 2.6, 6, 4],
				'circle-color': '#fff7e8',
				'circle-opacity': 0.95,
			},
		});
		map.addLayer({
			id: 'node-circle',
			type: 'circle',
			source: 'nodes',
			paint: {
				'circle-radius': [
					'+',
					[
						'interpolate',
						['linear'],
						['coalesce', ['feature-state', 'cnt'], ['get', 'count']],
						1, 4, 5, 8, 15, 16,
					],
					['case', ['boolean', ['feature-state', 'sel'], false], 2, 0],
				],
				'circle-color': ['case', ['boolean', ['feature-state', 'sel'], false], '#f3dca0', '#e6c878'],
				'circle-opacity': [
					'case',
					['boolean', ['feature-state', 'dim'], false],
					0.12,
					0.85,
				],
				'circle-stroke-color': ['case', ['boolean', ['feature-state', 'sel'], false], '#f3dca0', '#14110f'],
				'circle-stroke-width': ['case', ['boolean', ['feature-state', 'sel'], false], 2.2, 1.4],
			},
		});
		map.addLayer({
			id: 'node-label',
			type: 'symbol',
			source: 'nodes',
			filter: ['>=', ['get', 'count'], 3],
			layout: {
				'text-field': ['get', 'place'],
				'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
				'text-size': 11,
				'text-offset': [0, 1.3],
				'text-anchor': 'top',
			},
			paint: {
				'text-color': '#ece4d8',
				'text-halo-color': '#14110f',
				'text-halo-width': 1.4,
			},
		});

		applyFilters();
		fitToData();

		map.on('click', 'node-circle', (e) => {
			const f = e.features?.[0];
			if (!f) return;
			const ids = (f.properties!.ids as string).split(',');
			selectNode(ids);
			showNodePopup(e.lngLat, f.properties!.place as string, ids);
		});
		map.on('mouseenter', 'node-circle', () => (map.getCanvas().style.cursor = 'pointer'));
		map.on('mouseleave', 'node-circle', () => (map.getCanvas().style.cursor = ''));

		map.on('click', 'arc-hit', (e) => {
			const nodeHits = map.queryRenderedFeatures(e.point, { layers: ['node-circle'] });
			if (nodeHits.length) return;
			const f = e.features?.[0];
			if (!f) return;
			selectLineage(f.properties!.childId as string);
			new mapboxgl.Popup({ offset: 8 })
				.setLngLat(e.lngLat)
				.setHTML(
					`<div class="map-pop-meta">${escapeHtml(f.properties!.from as string)} → ${escapeHtml(
						f.properties!.to as string,
					)}</div><div class="map-pop-meta" style="margin-top:4px">${escapeHtml(
						f.properties!.fromPlace as string,
					)} → ${escapeHtml(f.properties!.toPlace as string)}</div>`,
				)
				.addTo(map);
		});
		map.on('mouseenter', 'arc-hit', () => (map.getCanvas().style.cursor = 'pointer'));
		map.on('mouseleave', 'arc-hit', () => (map.getCanvas().style.cursor = ''));

		// Click empty map to clear any highlight.
		map.on('click', (e) => {
			const hits = map.queryRenderedFeatures(e.point, { layers: ['arc-hit', 'node-circle'] });
			if (!hits.length) clearSelection();
		});
	});

	// ---- Lineage highlight ----
	// personId -> node key (anchored place), node key -> feature id.
	const nodeIdByKey = new Map<string, number>();
	[...nodeMap.keys()].forEach((k, i) => nodeIdByKey.set(k, i));
	const nodeKeyOfPerson = new Map<string, string>();
	for (const [pid, a] of anchorOf) nodeKeyOfPerson.set(pid, `${a.lat.toFixed(3)},${a.lng.toFixed(3)}`);

	let selectionActive = false;

	function clearSelection(): void {
		if (!selectionActive) return;
		selectionActive = false;
		for (let i = 0; i < arcFeatures.length; i++) map.removeFeatureState({ source: 'arcs', id: i });
		// Clear only the highlight keys on nodes so the time-aware `cnt` state survives.
		for (let i = 0; i < pointFeatures.length; i++) {
			map.setFeatureState({ source: 'nodes', id: i }, { sel: false, dim: false });
		}
		hint.classList.remove('is-active');
	}

	function applySelection(selArcIds: Set<number>, selNodeIds: Set<number>): void {
		selectionActive = true;
		for (let i = 0; i < arcFeatures.length; i++) {
			map.setFeatureState({ source: 'arcs', id: i }, { sel: selArcIds.has(i), dim: !selArcIds.has(i) });
		}
		for (let i = 0; i < pointFeatures.length; i++) {
			map.setFeatureState({ source: 'nodes', id: i }, { sel: selNodeIds.has(i), dim: !selNodeIds.has(i) });
		}
		hint.classList.add('is-active');
	}

	function nodeIdsForPeople(people: Set<string>): Set<number> {
		const ids = new Set<number>();
		for (const pid of people) {
			const key = nodeKeyOfPerson.get(pid);
			const nid = key != null ? nodeIdByKey.get(key) : undefined;
			if (nid != null) ids.add(nid);
		}
		return ids;
	}

	function selectLineage(personId: string): void {
		const line = lineageOf(personId);
		const arcIds = new Set<number>();
		arcFeatures.forEach((f, i) => {
			if (line.has(f.properties!.childId as string) && line.has(f.properties!.parentId as string)) arcIds.add(i);
		});
		applySelection(arcIds, nodeIdsForPeople(line));
	}

	function selectNode(personIds: string[]): void {
		// Union of every line passing through the clicked place.
		const union = new Set<string>();
		for (const pid of personIds) for (const id of lineageOf(pid)) union.add(id);
		const arcIds = new Set<number>();
		arcFeatures.forEach((f, i) => {
			if (union.has(f.properties!.childId as string) && union.has(f.properties!.parentId as string)) arcIds.add(i);
		});
		applySelection(arcIds, nodeIdsForPeople(union));
	}

	function showNodePopup(lngLat: mapboxgl.LngLatLike, place: string, ids: string[]): void {
		const people = ids.map((id) => data.personById.get(id)).filter((p): p is Person => !!p);
		const list = people
			.slice(0, 12)
			.map(
				(p) =>
					`<div class="map-pop-name" data-person="${p.id}">${escapeHtml(p.name)} <span style="color:var(--muted-text);font-weight:400">${lifespanLabel(
						p,
					)}</span></div>`,
			)
			.join('');
		const popup = new mapboxgl.Popup({ offset: 12, maxWidth: '280px' })
			.setLngLat(lngLat)
			.setHTML(
				`<div class="map-pop-name" style="font-size:16px;margin-bottom:6px">${escapeHtml(place)}</div>${list}${
					people.length > 12 ? `<div class="map-pop-meta" style="margin-top:4px">+${people.length - 12} more</div>` : ''
				}`,
			)
			.addTo(map);
		popup.getElement()?.querySelectorAll('[data-person]').forEach((node) =>
			node.addEventListener('click', () => {
				ctx.openPerson((node as HTMLElement).dataset.person!);
			}),
		);
	}

	// ---- Year filtering + animated reveal ----
	// Arcs with year <= committedYear are drawn statically. When the slider moves forward, a reveal
	// frontier sweeps up to it; as the frontier passes each arc's year, that arc animates drawing
	// from parent → child over DRAW_MS (with a bright leading head) in the arc-draw / arc-head
	// sources, then commits to the static layer. The timed per-arc draw is decoupled from scrub
	// speed, so it stays clearly visible whether you nudge the slider, jump it, or press play.
	const DRAW_MS = 750;
	let committedYear = sliderYear; // arcs with year <= this are static
	let revFrontier = sliderYear; // leading edge of which years have begun revealing
	const drawStart = new Map<number, number>(); // arc feature id -> time it began drawing
	let revealRaf = 0;
	let revealLast = 0;

	function arcFilterFor(threshold: number): mapboxgl.FilterSpecification {
		return [
			'all',
			['<=', ['get', 'year'], threshold],
			['in', ['get', 'branch'], ['literal', [...activeBranches]]],
		] as unknown as mapboxgl.FilterSpecification;
	}

	function applyArcFilter(): void {
		if (!map.getLayer('arc-line')) return;
		const f = arcFilterFor(committedYear);
		map.setFilter('arc-line', f);
		map.setFilter('arc-glow', f);
		map.setFilter('arc-hit', f);
		if (map.getLayer('arc-arrows')) map.setFilter('arc-arrows', f);
	}

	function applyNodeFilter(): void {
		if (!map.getLayer('node-circle')) return;
		const nodeFilter = ['<=', ['get', 'minYear'], sliderYear] as unknown as mapboxgl.FilterSpecification;
		map.setFilter('node-circle', nodeFilter);
		map.setFilter('node-label', [
			'all',
			['>=', ['get', 'count'], 3],
			['<=', ['get', 'minYear'], sliderYear],
		] as unknown as mapboxgl.FilterSpecification);
	}

	/** Size every visible dot to the number of people present by the current slider year. */
	function applyNodeCounts(): void {
		if (!map.getSource('nodes')) return;
		for (let i = 0; i < pointFeatures.length; i++) {
			map.setFeatureState({ source: 'nodes', id: i }, { cnt: countByYear(i, sliderYear) });
		}
	}

	function clearDraw(): void {
		(map.getSource('arc-draw') as mapboxgl.GeoJSONSource | undefined)?.setData(fc([]));
		(map.getSource('arc-head') as mapboxgl.GeoJSONSource | undefined)?.setData(fc([]));
	}

	function stopReveal(): void {
		if (revealRaf) {
			cancelAnimationFrame(revealRaf);
			revealRaf = 0;
		}
		revealLast = 0;
		drawStart.clear();
	}

	function revealTick(ts: number): void {
		const now = ts;
		const dt = revealLast ? Math.min(80, ts - revealLast) : 16;
		revealLast = ts;

		// Advance the reveal frontier toward the slider year (years per ms, with a floor so it
		// always reaches the target, but slow enough that arcs reveal in a legible sequence).
		const speed = Math.max(0.45, (sliderYear - revFrontier) * 0.01);
		revFrontier = Math.min(sliderYear, revFrontier + speed * dt);

		// Begin drawing any arcs the frontier has newly passed.
		for (const f of arcFeatures) {
			const year = f.properties!.year as number;
			if (year <= committedYear || year > revFrontier) continue;
			if (!activeBranches.has(f.properties!.branch as BranchKey)) continue;
			if (!drawStart.has(f.id as number)) drawStart.set(f.id as number, now);
		}

		// Build partial geometry + leading heads for in-progress arcs; commit finished ones.
		const lines: GeoJSON.Feature[] = [];
		const heads: GeoJSON.Feature[] = [];
		let newCommitted = committedYear;
		for (const [id, t0] of drawStart) {
			const f = arcFeatures[id];
			const year = f.properties!.year as number;
			if (year <= committedYear || !activeBranches.has(f.properties!.branch as BranchKey)) {
				drawStart.delete(id);
				continue;
			}
			const raw = (now - t0) / DRAW_MS;
			if (raw >= 1) {
				drawStart.delete(id);
				if (year > newCommitted) newCommitted = year;
				continue;
			}
			const lp = 1 - (1 - raw) * (1 - raw); // ease-out
			const coords = (f.geometry as GeoJSON.LineString).coordinates as [number, number][];
			const seg = sliceArc(coords, lp);
			lines.push({
				type: 'Feature',
				geometry: { type: 'LineString', coordinates: seg },
				properties: { color: f.properties!.color },
			});
			heads.push({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: seg[seg.length - 1] },
				properties: { color: f.properties!.color },
			});
		}
		if (newCommitted !== committedYear) {
			committedYear = newCommitted;
			applyArcFilter();
		}
		(map.getSource('arc-draw') as mapboxgl.GeoJSONSource).setData(fc(lines));
		(map.getSource('arc-head') as mapboxgl.GeoJSONSource).setData(fc(heads));

		if (drawStart.size === 0 && revFrontier >= sliderYear) {
			committedYear = sliderYear;
			revFrontier = sliderYear;
			applyArcFilter();
			clearDraw();
			revealRaf = 0;
			revealLast = 0;
			return;
		}
		revealRaf = requestAnimationFrame(revealTick);
	}

	function ensureRevealLoop(): void {
		if (!revealRaf) {
			revealLast = 0;
			revealRaf = requestAnimationFrame(revealTick);
		}
	}

	function applyFilters(): void {
		applyArcFilter();
		applyNodeFilter();
		applyNodeCounts();
	}

	function fitToData(): void {
		const b = new mapboxgl.LngLatBounds();
		for (const f of pointFeatures) {
			const c = (f.geometry as GeoJSON.Point).coordinates;
			b.extend([c[0], c[1]]);
		}
		if (!b.isEmpty()) map.fitBounds(b, { padding: 80, maxZoom: 5, duration: 0 });
	}

	// Legend with toggles.
	const legendRows = el.querySelector('#map-legend-rows')!;
	const branchKeys: BranchKey[] = ['lourens', 'roorda', 'stuenkel', 'brueggemann', 'root'];
	legendRows.innerHTML = branchKeys
		.map(
			(k) =>
				`<div class="legend-row" data-branch="${k}" style="cursor:pointer;user-select:none"><span class="legend-swatch" style="background:${BRANCHES[k].color}"></span>${BRANCHES[k].label}</div>`,
		)
		.join('');
	legendRows.querySelectorAll('[data-branch]').forEach((row) =>
		row.addEventListener('click', () => {
			const k = (row as HTMLElement).dataset.branch as BranchKey;
			if (activeBranches.has(k)) {
				activeBranches.delete(k);
				(row as HTMLElement).style.opacity = '0.35';
			} else {
				activeBranches.add(k);
				(row as HTMLElement).style.opacity = '1';
			}
			applyFilters();
		}),
	);

	// Timeline.
	const slider = el.querySelector('#map-slider') as HTMLInputElement;
	const yearLabel = el.querySelector('#map-year') as HTMLElement;
	slider.min = String(Math.floor(minYear / 10) * 10);
	const setYear = (y: number, label?: string): void => {
		sliderYear = y;
		yearLabel.textContent = label ?? (y >= 2000 ? 'All years' : `to ${y}`);
		applyNodeFilter();
		applyNodeCounts();
		if (y < committedYear) {
			// Scrubbing back: snap arcs/arrows instantly, no draw animation.
			stopReveal();
			committedYear = y;
			revFrontier = y;
			clearDraw();
			applyArcFilter();
		} else if (y > committedYear) {
			// Scrubbing forward: sweep the reveal frontier up from the committed edge, drawing arcs in.
			if (!revealRaf) revFrontier = committedYear;
			ensureRevealLoop();
		}
	};
	slider.addEventListener('input', () => setYear(Number(slider.value)));

	const playBtn = el.querySelector('#map-play') as HTMLButtonElement;
	let playing = false;
	let raf = 0;
	playBtn.addEventListener('click', () => {
		if (playing) {
			playing = false;
			playBtn.textContent = '▶';
			cancelAnimationFrame(raf);
			return;
		}
		playing = true;
		playBtn.textContent = '❚❚';
		let y = Number(slider.min);
		const step = (): void => {
			if (!playing) return;
			y += 4;
			slider.value = String(y);
			setYear(y);
			if (y >= Number(slider.max)) {
				playing = false;
				playBtn.textContent = '▶';
				setYear(2000);
				slider.value = '2000';
				return;
			}
			raf = requestAnimationFrame(() => setTimeout(step, 60) as unknown as number);
		};
		step();
	});

	let resized = false;
	return {
		el,
		show() {
			if (!resized) {
				requestAnimationFrame(() => {
					map.resize();
					resized = true;
				});
			} else {
				map.resize();
			}
		},
	};
}

/**
 * Brighten and thicken the country / state borders in the Mapbox dark style so the landmasses
 * read clearly behind the migration arcs. Tweaks the built-in admin-boundary layers in place;
 * silently skips any the style version doesn't expose.
 */
function boldenBorders(map: mapboxgl.Map): void {
	const setIf = (id: string, fn: () => void): void => {
		if (map.getLayer(id)) {
			try {
				fn();
			} catch {
				/* style layer shape changed across versions — ignore */
			}
		}
	};
	// Country borders.
	setIf('admin-0-boundary', () => {
		map.setPaintProperty('admin-0-boundary', 'line-color', '#7c8aa0');
		map.setPaintProperty('admin-0-boundary', 'line-width', [
			'interpolate', ['linear'], ['zoom'], 1, 0.9, 4, 1.8, 8, 2.6,
		]);
		map.setPaintProperty('admin-0-boundary', 'line-opacity', 0.9);
	});
	// Soft casing behind country borders, for extra weight.
	setIf('admin-0-boundary-bg', () => {
		map.setPaintProperty('admin-0-boundary-bg', 'line-color', '#2b3340');
		map.setPaintProperty('admin-0-boundary-bg', 'line-width', [
			'interpolate', ['linear'], ['zoom'], 1, 3, 8, 8,
		]);
		map.setPaintProperty('admin-0-boundary-bg', 'line-opacity', 0.6);
	});
	// State / province borders, a touch lighter than countries.
	setIf('admin-1-boundary', () => {
		map.setPaintProperty('admin-1-boundary', 'line-color', '#566173');
		map.setPaintProperty('admin-1-boundary', 'line-width', [
			'interpolate', ['linear'], ['zoom'], 3, 0.5, 8, 1.4,
		]);
		map.setPaintProperty('admin-1-boundary', 'line-opacity', 0.7);
	});
}

/** Quadratic-bezier great-ish-circle arc between two points for a pleasing curve. */
function arc(a: [number, number], b: [number, number], segments = 48): [number, number][] {
	const [x1, y1] = a;
	const [x2, y2] = b;
	const mx = (x1 + x2) / 2;
	const my = (y1 + y2) / 2;
	const dx = x2 - x1;
	const dy = y2 - y1;
	const dist = Math.hypot(dx, dy);
	// Perpendicular offset scaled by distance gives the curve its lift.
	const curve = Math.min(dist * 0.18, 16);
	const nx = -dy / (dist || 1);
	const ny = dx / (dist || 1);
	const cx = mx + nx * curve;
	const cy = my + ny * curve;
	const pts: [number, number][] = [];
	for (let i = 0; i <= segments; i++) {
		const t = i / segments;
		const x = (1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * cx + t * t * x2;
		const y = (1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * cy + t * t * y2;
		pts.push([x, y]);
	}
	return pts;
}

function fc(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
	return { type: 'FeatureCollection', features };
}

/** First `t` fraction (0..1) of a polyline, by point count, with an interpolated end point. */
function sliceArc(coords: [number, number][], t: number): [number, number][] {
	const n = coords.length;
	if (n < 2 || t >= 1) return coords;
	if (t <= 0) return [coords[0], coords[0]];
	const pos = t * (n - 1);
	const idx = Math.floor(pos);
	const frac = pos - idx;
	const out = coords.slice(0, idx + 1);
	const a = coords[idx];
	const b = coords[Math.min(idx + 1, n - 1)];
	out.push([a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac]);
	return out;
}

/** Web-Mercator y for a latitude in degrees (dimensionless, matches Mapbox projection). */
function mercY(lat: number): number {
	return Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
}

/** Compass bearing (deg clockwise from north) from a → b in Mercator space. */
function mercBearing(a: [number, number], b: [number, number]): number {
	const east = (b[0] - a[0]) * (Math.PI / 180);
	const north = mercY(b[1]) - mercY(a[1]);
	return (Math.atan2(east, north) * 180) / Math.PI;
}

/** Point and parent→child bearing at fraction `t` along a polyline. */
function pointAtFraction(
	coords: [number, number][],
	t: number,
): { point: [number, number]; bearing: number } {
	const n = coords.length;
	const pos = Math.max(0, Math.min(n - 1, t * (n - 1)));
	const idx = Math.min(n - 2, Math.floor(pos));
	const frac = pos - idx;
	const a = coords[idx];
	const b = coords[idx + 1];
	return {
		point: [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac],
		bearing: mercBearing(a, b),
	};
}

/** Build a bold upward-pointing arrowhead icon tinted to a branch color. */
function makeArrowImage(hex: string): { width: number; height: number; data: Uint8Array } {
	const S = 34;
	const cvs = document.createElement('canvas');
	cvs.width = S;
	cvs.height = S;
	const c = cvs.getContext('2d')!;
	c.clearRect(0, 0, S, S);
	c.beginPath();
	c.moveTo(S * 0.5, S * 0.08);
	c.lineTo(S * 0.92, S * 0.82);
	c.lineTo(S * 0.5, S * 0.6);
	c.lineTo(S * 0.08, S * 0.82);
	c.closePath();
	c.lineJoin = 'round';
	c.lineWidth = S * 0.14;
	c.strokeStyle = 'rgba(8,6,5,0.8)';
	c.stroke();
	c.fillStyle = hex;
	c.fill();
	const img = c.getImageData(0, 0, S, S);
	return { width: S, height: S, data: new Uint8Array(img.data.buffer) };
}
