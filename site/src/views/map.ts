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
		<div class="map-timeline panel-card">
			<button class="ctrl-btn map-play" id="map-play" title="Play">▶</button>
			<span class="yr-label" id="map-year">All years</span>
			<input type="range" id="map-slider" min="1550" max="2000" value="2000" step="5" />
		</div>`,
	);

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

	const pointFeatures: GeoJSON.Feature[] = [...nodeMap.values()].map((n) => ({
		type: 'Feature',
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
				geometry: {
					type: 'LineString',
					coordinates: arc([parentAnchor.lng, parentAnchor.lat], [childAnchor.lng, childAnchor.lat]),
				},
				properties: {
					branch,
					color: branchColor(branch),
					year: estYear(child),
					from: parent.name,
					to: child.name,
					fromPlace: shortPlace(parentAnchor.place),
					toPlace: shortPlace(childAnchor.place),
				},
			});
		}
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
				'line-width': 4,
				'line-opacity': 0.12,
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
				'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.1, 6, 2.2],
				'line-opacity': 0.7,
			},
		});
		map.addLayer({
			id: 'node-circle',
			type: 'circle',
			source: 'nodes',
			paint: {
				'circle-radius': ['interpolate', ['linear'], ['get', 'count'], 1, 4, 5, 8, 15, 16],
				'circle-color': '#e6c878',
				'circle-opacity': 0.85,
				'circle-stroke-color': '#14110f',
				'circle-stroke-width': 1.4,
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
			showNodePopup(e.lngLat, f.properties!.place as string, ids);
		});
		map.on('mouseenter', 'node-circle', () => (map.getCanvas().style.cursor = 'pointer'));
		map.on('mouseleave', 'node-circle', () => (map.getCanvas().style.cursor = ''));

		map.on('click', 'arc-line', (e) => {
			const f = e.features?.[0];
			if (!f) return;
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
	});

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
