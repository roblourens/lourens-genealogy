import * as d3 from 'd3';
import type { Person } from '../../../shared/types';
import type { AppContext, ViewController } from '../main';
import { BRANCHES, type BranchKey } from '../data';
import { branchColor, lifespanLabel, shortPlace } from '../util';

const CARD_W = 188;
const CARD_H = 50;
const X_GAP = 250; // horizontal distance between generations
const Y_GAP = 62; // vertical distance between siblings

export function createTreeView(ctx: AppContext): ViewController & { focus(id: string): void } {
	const { data } = ctx;
	const el = document.createElement('div');
	el.className = 'tree-view';
	el.innerHTML = `
		<div class="view-intro-pill">Ancestor pedigree from you back to the 1400s. Drag to pan, scroll to zoom, click anyone for their story.</div>
		<div class="legend panel-card" id="tree-legend"></div>
		<div class="controls bottom-left">
			<button class="ctrl-btn" data-z="in" title="Zoom in">+</button>
			<button class="ctrl-btn" data-z="out" title="Zoom out">−</button>
			<button class="ctrl-btn" data-z="fit" title="Fit to screen">⤢</button>
		</div>
	`;

	const svg = d3.create('svg').attr('class', 'tree-svg');
	const gZoom = svg.append('g');
	const gLinks = gZoom.append('g').attr('class', 'links');
	const gNodes = gZoom.append('g').attr('class', 'nodes');
	el.appendChild(svg.node()!);

	// Build ancestor hierarchy: a person's "children" in the layout are their parents.
	const root = d3.hierarchy<Person>(data.root, (p: Person) =>
		p.parentIds.map((id: string) => data.personById.get(id)).filter((x): x is Person => !!x),
	);
	const layout = d3.tree<Person>().nodeSize([Y_GAP, X_GAP]).separation(() => 1);
	layout(root);

	const nodes = root.descendants();
	const links = root.links();

	// Links (elbow curves from child generation back to parents).
	gLinks
		.selectAll('path')
		.data(links)
		.join('path')
		.attr('class', 'link')
		.attr('d', (d) => {
			const sx = d.source.y ?? 0;
			const sy = d.source.x ?? 0;
			const tx = d.target.y ?? 0;
			const ty = d.target.x ?? 0;
			const mx = (sx + tx) / 2;
			return `M${sx + CARD_W / 2},${sy} C${mx},${sy} ${mx},${ty} ${tx - CARD_W / 2},${ty}`;
		});

	// Node cards.
	const node = gNodes
		.selectAll('g.node-card')
		.data(nodes)
		.join('g')
		.attr('class', 'node-card')
		.attr('data-id', (d) => d.data.id)
		.attr('transform', (d) => `translate(${(d.y ?? 0) - CARD_W / 2},${(d.x ?? 0) - CARD_H / 2})`)
		.on('click', (_e, d) => ctx.openPerson(d.data.id));

	node
		.append('rect')
		.attr('class', 'card-bg')
		.attr('width', CARD_W)
		.attr('height', CARD_H)
		.attr('rx', 9)
		.attr('fill', 'var(--panel)')
		.attr('stroke', 'var(--line-strong)')
		.attr('stroke-width', 1.2);

	// Branch color stripe.
	node
		.append('rect')
		.attr('width', 4)
		.attr('height', CARD_H)
		.attr('rx', 2)
		.attr('fill', (d) => branchColor(data.branchOf.get(d.data.id)));

	node
		.append('text')
		.attr('class', 'node-name')
		.attr('x', 14)
		.attr('y', 20)
		.text((d) => truncate(d.data.name, 24));

	node
		.append('text')
		.attr('class', 'node-dates')
		.attr('x', 14)
		.attr('y', 35)
		.text((d) => lifespanLabel(d.data));

	node
		.append('text')
		.attr('class', 'node-place')
		.attr('x', 14)
		.attr('y', 46)
		.text((d) => shortPlace(d.data.birth?.place) || '');

	// Zoom behaviour.
	const zoom = d3
		.zoom<SVGSVGElement, undefined>()
		.scaleExtent([0.12, 2.2])
		.on('zoom', (event) => gZoom.attr('transform', event.transform.toString()));
	svg.call(zoom);

	function bounds(): { x0: number; x1: number; y0: number; y1: number } {
		let x0 = Infinity;
		let x1 = -Infinity;
		let y0 = Infinity;
		let y1 = -Infinity;
		for (const n of nodes) {
			x0 = Math.min(x0, (n.y ?? 0) - CARD_W / 2);
			x1 = Math.max(x1, (n.y ?? 0) + CARD_W / 2);
			y0 = Math.min(y0, (n.x ?? 0) - CARD_H / 2);
			y1 = Math.max(y1, (n.x ?? 0) + CARD_H / 2);
		}
		return { x0, x1, y0, y1 };
	}

	function fit(): void {
		const { x0, x1, y0, y1 } = bounds();
		const w = el.clientWidth || 1000;
		const h = el.clientHeight || 700;
		const fullW = x1 - x0 + 80;
		const fullH = y1 - y0 + 80;
		const scale = Math.min(w / fullW, h / fullH, 1.4);
		const tx = (w - scale * (x0 + x1)) / 2;
		const ty = (h - scale * (y0 + y1)) / 2;
		svg
			.transition()
			.duration(500)
			.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
	}

	function focus(id: string): void {
		const target = nodes.find((n) => n.data.id === id);
		gNodes.selectAll('g.node-card').classed('is-selected', false);
		if (!target) return;
		gNodes.select(`g.node-card[data-id="${id}"]`).classed('is-selected', true);
		const w = el.clientWidth || 1000;
		const h = el.clientHeight || 700;
		const scale = 1;
		const tx = w / 2 - scale * (target.y ?? 0);
		const ty = h / 2 - scale * (target.x ?? 0);
		svg
			.transition()
			.duration(600)
			.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(scale));
	}

	el.querySelector('[data-z="in"]')!.addEventListener('click', () =>
		svg.transition().duration(200).call(zoom.scaleBy, 1.35),
	);
	el.querySelector('[data-z="out"]')!.addEventListener('click', () =>
		svg.transition().duration(200).call(zoom.scaleBy, 1 / 1.35),
	);
	el.querySelector('[data-z="fit"]')!.addEventListener('click', fit);

	// Legend.
	const legendKeys: BranchKey[] = ['lourens', 'roorda', 'stuenkel', 'brueggemann', 'root'];
	el.querySelector('#tree-legend')!.innerHTML =
		`<h4>The Four Lines</h4>` +
		legendKeys
			.map(
				(k) =>
					`<div class="legend-row"><span class="legend-swatch" style="background:${BRANCHES[k].color}"></span>${BRANCHES[k].label}</div>`,
			)
			.join('');

	let fitted = false;
	return {
		el,
		show() {
			if (!fitted) {
				// Defer until the element has real dimensions.
				requestAnimationFrame(() => {
					fit();
					fitted = true;
				});
			}
		},
		focus,
	};
}

function truncate(s: string, n: number): string {
	return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
