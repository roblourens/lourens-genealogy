import type { Person } from '../../../shared/types';
import type { AppContext, ViewController } from '../main';
import type { BranchKey } from '../data';
import { BRANCHES } from '../data';
import { escapeHtml, lifespanLabel, shortPlace } from '../util';

const CURRENT_YEAR = new Date().getFullYear();
const AVG_LIFE = 70; // used only to draw a faint "unknown end" hint

interface Row {
	p: Person;
	branch: BranchKey;
	start: number;
	end: number;
	estStart: boolean;
	estEnd: boolean;
}

/** Estimated birth year for ordering when none is recorded. */
function estBirth(p: Person): number {
	if (p.birthYear) return p.birthYear;
	if (p.generation != null) return 1988 - p.generation * 30;
	return 1900;
}

export function createTimelineView(ctx: AppContext): ViewController {
	const { data } = ctx;
	const el = document.createElement('div');
	el.className = 'timeline-view';

	const active = new Set<BranchKey>(['lourens', 'roorda', 'stuenkel', 'brueggemann', 'root']);

	// Build a row per person with a usable lifespan span.
	const allRows: Row[] = data.people.map((p) => {
		const branch = data.branchOf.get(p.id) ?? 'root';
		const estStart = !p.birthYear;
		const start = estBirth(p);
		let end: number;
		let estEnd = false;
		if (p.deathYear) {
			end = p.deathYear;
		} else if (p.birthYear && p.ageAtDeath != null) {
			end = p.birthYear + p.ageAtDeath;
		} else {
			estEnd = true;
			// Faint hint only; never claim a death we don't know.
			end = Math.min(start + AVG_LIFE, CURRENT_YEAR);
		}
		return { p, branch, start, end, estStart, estEnd };
	});

	const minYear = Math.floor(Math.min(...allRows.map((r) => r.start)) / 25) * 25;
	const maxYear = Math.min(CURRENT_YEAR, Math.ceil(Math.max(...allRows.map((r) => r.end)) / 25) * 25);

	el.innerHTML = `
		<div class="view-head">
			<h2 class="view-title">A River of Lifetimes</h2>
			<p class="view-sub">Every life in the tree as a horizontal span, oldest at the top — birth at the left edge, death at the right. Solid bars are documented lifespans; faded ends mark lives whose death date we don't yet know. Colored by family line.</p>
		</div>
		<div class="tl-legend" id="tl-legend"></div>
		<div class="tl-scroll" id="tl-scroll">
			<svg id="tl-svg" xmlns="http://www.w3.org/2000/svg"></svg>
		</div>
		<div class="tl-tooltip" id="tl-tooltip" hidden></div>`;

	const legend = el.querySelector('#tl-legend') as HTMLElement;
	const scroll = el.querySelector('#tl-scroll') as HTMLElement;
	const svg = el.querySelector('#tl-svg') as SVGSVGElement;
	const tooltip = el.querySelector('#tl-tooltip') as HTMLElement;

	const branchKeys: BranchKey[] = ['lourens', 'roorda', 'stuenkel', 'brueggemann', 'root'];
	legend.innerHTML = branchKeys
		.map(
			(k) =>
				`<button class="tl-legend-item" data-branch="${k}"><span class="legend-swatch" style="background:${BRANCHES[k].color}"></span>${escapeHtml(
					BRANCHES[k].label,
				)}</button>`,
		)
		.join('');
	legend.querySelectorAll<HTMLElement>('[data-branch]').forEach((btn) =>
		btn.addEventListener('click', () => {
			const k = btn.dataset.branch as BranchKey;
			if (active.has(k)) {
				active.delete(k);
				btn.classList.add('is-off');
			} else {
				active.add(k);
				btn.classList.remove('is-off');
			}
			render();
		}),
	);

	const PAD_L = 16;
	const PAD_R = 16;
	const AXIS_H = 30;
	const ROW_H = 7;
	const BAR_H = 4.5;

	function render(): void {
		const rows = allRows
			.filter((r) => active.has(r.branch))
			.sort((a, b) => a.start - b.start || a.end - b.end);

		const width = Math.max(640, scroll.clientWidth);
		const plotW = width - PAD_L - PAD_R;
		const height = AXIS_H + rows.length * ROW_H + 14;
		const xOf = (year: number): number => PAD_L + ((year - minYear) / (maxYear - minYear)) * plotW;

		const parts: string[] = [];

		// Vertical decade/half-century gridlines + axis labels.
		const tickStep = (maxYear - minYear) > 320 ? 50 : 25;
		for (let y = minYear; y <= maxYear; y += tickStep) {
			const x = xOf(y);
			parts.push(
				`<line x1="${x.toFixed(1)}" y1="${AXIS_H - 6}" x2="${x.toFixed(1)}" y2="${height}" class="tl-grid"/>`,
			);
			parts.push(
				`<text x="${x.toFixed(1)}" y="${AXIS_H - 12}" class="tl-axis-label" text-anchor="middle">${y}</text>`,
			);
		}

		// Bars.
		rows.forEach((r, i) => {
			const y = AXIS_H + i * ROW_H;
			const x1 = xOf(r.start);
			const x2 = xOf(r.end);
			const color = BRANCHES[r.branch].color;
			const w = Math.max(2, x2 - x1);
			if (r.estEnd) {
				// Birth marker + faint indeterminate tail.
				parts.push(
					`<rect x="${x1.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(
						1,
					)}" height="${BAR_H}" rx="${(BAR_H / 2).toFixed(1)}" fill="${color}" class="tl-bar tl-bar-est" data-id="${
						r.p.id
					}" opacity="0.22"/>`,
				);
				parts.push(
					`<circle cx="${x1.toFixed(1)}" cy="${(y + BAR_H / 2).toFixed(1)}" r="${(BAR_H / 2 + 0.6).toFixed(
						1,
					)}" fill="${color}" class="tl-bar" data-id="${r.p.id}"/>`,
				);
			} else {
				parts.push(
					`<rect x="${x1.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(
						1,
					)}" height="${BAR_H}" rx="${(BAR_H / 2).toFixed(1)}" fill="${color}" class="tl-bar" data-id="${
						r.p.id
					}" opacity="${r.estStart ? '0.6' : '0.92'}"/>`,
				);
			}
		});

		svg.setAttribute('width', String(width));
		svg.setAttribute('height', String(height));
		svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
		svg.innerHTML = parts.join('');
	}

	// Interaction: hover tooltip + click to open person.
	function rowLabel(p: Person): string {
		const place = shortPlace(p.birth?.place);
		return `<strong>${escapeHtml(p.name)}</strong><span>${escapeHtml(lifespanLabel(p))}</span>${
			place ? `<span class="tl-tt-place">${escapeHtml(place)}</span>` : ''
		}`;
	}
	svg.addEventListener('mousemove', (e) => {
		const t = e.target as SVGElement;
		const id = t.getAttribute?.('data-id');
		if (!id) {
			tooltip.hidden = true;
			return;
		}
		const p = data.personById.get(id);
		if (!p) return;
		tooltip.innerHTML = rowLabel(p);
		tooltip.hidden = false;
		const r = scroll.getBoundingClientRect();
		let left = e.clientX - r.left + 14;
		const top = e.clientY - r.top + 12;
		if (left + 240 > r.width) left = e.clientX - r.left - 240;
		tooltip.style.left = `${left}px`;
		tooltip.style.top = `${top}px`;
	});
	svg.addEventListener('mouseleave', () => (tooltip.hidden = true));
	svg.addEventListener('click', (e) => {
		const id = (e.target as SVGElement).getAttribute?.('data-id');
		if (id) ctx.openPerson(id);
	});

	const ro = new ResizeObserver(() => render());
	ro.observe(scroll);

	let first = true;
	return {
		el,
		show() {
			if (first) {
				render();
				first = false;
			}
		},
	};
}
