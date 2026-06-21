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

	const activeBranches = new Set<BranchKey>(['lourens', 'roorda', 'stuenkel', 'brueggemann', 'root']);
	let sliderYear = 2000;

	// Build anchors per person.
	const anchorOf = new Map<string, Anchor>();
	for (const p of data.people) {
		const pt = firstPlacePoint(data, p);
		if (pt) anchorOf.set(p.id, pt);
	}

	// Aggregate place nodes (all events).
	const nodeMap = new Map<string, { lng: number; lat: number; place: string; ids: Set<string>; minYear: number }>();
	for (const p of data.people) {
		const years = estYear(p);
		for (const ev of p.events) {
			if (!ev.place) continue;
			const gp = data.places[ev.place];
			if (!gp) continue;
			const key = `${gp.lat.toFixed(3)},${gp.lng.toFixed(3)}`;
			let node = nodeMap.get(key);
			if (!node) {
				node = { lng: gp.lng, lat: gp.lat, place: ev.place, ids: new Set(), minYear: years };
				nodeMap.set(key, node);
			}
			node.ids.add(p.id);
			node.minYear = Math.min(node.minYear, years);
		}
	}

	const pointFeatures: GeoJSON.Feature[] = [...nodeMap.values()].map((n, i) => ({
		type: 'Feature',
		id: i,
		geometry: { type: 'Point', coordinates: [n.lng, n.lat] },
		properties: {
			place: shortPlace(n.place),
			count: n.ids.size,
			ids: [...n.ids].join(','),
			minYear: n.minYear,
		},
	}));

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
		map.addSource('arcs', { type: 'geojson', data: fc(arcFeatures) });
		map.addSource('nodes', { type: 'geojson', data: fc(pointFeatures) });

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

		// Directional arrowheads along each arc (parent origin -> child destination).
		for (const key of Object.keys(BRANCHES) as BranchKey[]) {
			const id = `arrow-${key}`;
			if (!map.hasImage(id)) map.addImage(id, makeArrowImage(BRANCHES[key].color), { pixelRatio: 2 });
		}
		map.addLayer({
			id: 'arc-arrows',
			type: 'symbol',
			source: 'arcs',
			layout: {
				'symbol-placement': 'line',
				'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 2, 90, 6, 150],
				'icon-image': [
					'match',
					['get', 'branch'],
					'lourens', 'arrow-lourens',
					'roorda', 'arrow-roorda',
					'stuenkel', 'arrow-stuenkel',
					'brueggemann', 'arrow-brueggemann',
					'arrow-root',
				],
				'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.46, 6, 0.78],
				'icon-rotation-alignment': 'map',
				'icon-allow-overlap': true,
				'icon-ignore-placement': true,
				'icon-keep-upright': false,
			},
			paint: {
				'icon-opacity': [
					'case',
					['boolean', ['feature-state', 'sel'], false],
					1,
					['boolean', ['feature-state', 'dim'], false],
					0.03,
					0.5,
				],
			},
		});
		map.addLayer({
			id: 'node-circle',
			type: 'circle',
			source: 'nodes',
			paint: {
				'circle-radius': [
					'+',
					['interpolate', ['linear'], ['get', 'count'], 1, 4, 5, 8, 15, 16],
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
		for (let i = 0; i < pointFeatures.length; i++) map.removeFeatureState({ source: 'nodes', id: i });
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

	function applyFilters(): void {
		if (!map.getLayer('arc-line')) return;
		const arcFilter = [
			'all',
			['<=', ['get', 'year'], sliderYear],
			['in', ['get', 'branch'], ['literal', [...activeBranches]]],
		] as unknown as mapboxgl.FilterSpecification;
		map.setFilter('arc-line', arcFilter);
		map.setFilter('arc-glow', arcFilter);
		map.setFilter('arc-hit', arcFilter);
		if (map.getLayer('arc-arrows')) map.setFilter('arc-arrows', arcFilter);
		const nodeFilter = ['<=', ['get', 'minYear'], sliderYear] as unknown as mapboxgl.FilterSpecification;
		map.setFilter('node-circle', nodeFilter);
		map.setFilter('node-label', [
			'all',
			['>=', ['get', 'count'], 3],
			['<=', ['get', 'minYear'], sliderYear],
		] as unknown as mapboxgl.FilterSpecification);
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
		applyFilters();
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

/** Build a small upward-pointing arrowhead icon tinted to a branch color. */
function makeArrowImage(hex: string): { width: number; height: number; data: Uint8Array } {
	const S = 26;
	const cvs = document.createElement('canvas');
	cvs.width = S;
	cvs.height = S;
	const c = cvs.getContext('2d')!;
	c.clearRect(0, 0, S, S);
	c.beginPath();
	c.moveTo(S * 0.5, S * 0.14);
	c.lineTo(S * 0.84, S * 0.74);
	c.lineTo(S * 0.5, S * 0.58);
	c.lineTo(S * 0.16, S * 0.74);
	c.closePath();
	c.lineJoin = 'round';
	c.lineWidth = S * 0.10;
	c.strokeStyle = 'rgba(8,6,5,0.65)';
	c.stroke();
	c.fillStyle = hex;
	c.fill();
	const img = c.getImageData(0, 0, S, S);
	return { width: S, height: S, data: new Uint8Array(img.data.buffer) };
}
