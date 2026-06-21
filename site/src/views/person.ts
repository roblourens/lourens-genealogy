import type { Person } from '../../../shared/types';
import type { AppContext } from '../main';
import type { AppData } from '../data';
import { BRANCHES } from '../data';
import {
	ageLabel,
	branchColor,
	escapeHtml,
	eventVerb,
	formatDate,
	lifespanLabel,
	shortPlace,
} from '../util';

export function openPersonPanel(data: AppData, id: string, ctx: AppContext): void {
	const person = data.personById.get(id);
	if (!person) return;
	const panel = document.getElementById('person-panel') as HTMLElement;
	const scrim = document.getElementById('panel-scrim') as HTMLElement;

	panel.innerHTML = renderPanel(data, person);
	panel.hidden = false;
	scrim.hidden = false;

	const close = (): void => {
		panel.hidden = true;
		scrim.hidden = true;
	};
	panel.querySelector('.pp-close')?.addEventListener('click', close);
	scrim.onclick = close;

	// Navigate to related people.
	panel.querySelectorAll('[data-person]').forEach((el) =>
		el.addEventListener('click', () => {
			const pid = (el as HTMLElement).dataset.person!;
			openPersonPanel(data, pid, ctx);
		}),
	);
	// Jump to tree / map.
	panel.querySelector('[data-action="tree"]')?.addEventListener('click', () => {
		close();
		ctx.focusInTree(person.id);
	});
}

function nameChip(data: AppData, id: string): string {
	const p = data.personById.get(id);
	if (!p) return '';
	return `<span class="chip person-chip" data-person="${id}">${escapeHtml(p.name)}${
		lifespanLabel(p) ? ` <span style="opacity:.6">${lifespanLabel(p)}</span>` : ''
	}</span>`;
}

function renderPanel(data: AppData, person: Person): string {
	const branch = data.branchOf.get(person.id) ?? 'root';
	const color = branchColor(branch);
	const enr = data.enrichmentById[person.id];

	const facts: Array<[string, string]> = [];
	if (person.sex !== 'U') facts.push(['Sex', person.sex === 'M' ? 'Male' : 'Female']);
	if (person.generation != null && person.directLine) {
		facts.push(['Generation', person.generation === 0 ? 'You' : `${person.generation} back`]);
	}
	if (ageLabel(person)) facts.push(['Lifespan', ageLabel(person)!]);
	facts.push(['Lineage', BRANCHES[branch].label]);

	const sources = person.sourceIds
		.map((sid) => data.tree.sources.find((s) => s.id === sid))
		.filter(Boolean);

	return `
	<div class="pp-hero" style="background:
		radial-gradient(420px 160px at 100% 0%, ${color}22, transparent 70%),
		linear-gradient(180deg, var(--panel-2), var(--panel));">
		<button class="pp-close" aria-label="Close">×</button>
		<div class="pp-branch-tag"><span class="pp-branch-dot" style="background:${color}"></span>${BRANCHES[branch].label}</div>
		<h2 class="pp-name">${escapeHtml(person.name)}</h2>
		${lifespanLabel(person) ? `<p class="pp-life">${lifespanLabel(person)}</p>` : ''}
	</div>

	${
		enr?.bio
			? `<div class="pp-section"><h3>Biography <span class="researched-tag">Researched</span></h3><p class="pp-bio">${escapeHtml(
					enr.bio,
				)}</p></div>`
			: ''
	}

	${
		enr?.occupations?.length
			? `<div class="pp-section"><h3>Occupation</h3><div class="pp-chips">${enr.occupations
					.map((o) => `<span class="chip">${escapeHtml(o)}</span>`)
					.join('')}</div></div>`
			: ''
	}

	<div class="pp-section">
		<h3>Facts</h3>
		<div class="pp-fact-grid">
			${facts.map(([k, v]) => `<div class="pp-fact"><div class="k">${k}</div><div class="v">${escapeHtml(v)}</div></div>`).join('')}
		</div>
	</div>

	${renderTimeline(person)}

	${
		enr?.funFacts?.length
			? `<div class="pp-section"><h3>Fun Facts <span class="researched-tag">Researched</span></h3><ul class="pp-list">${enr.funFacts
					.map((f) => `<li>${escapeHtml(f)}</li>`)
					.join('')}</ul></div>`
			: ''
	}

	${
		enr?.immigration
			? `<div class="pp-section"><h3>Immigration <span class="researched-tag">Researched</span></h3><p class="pp-bio">${escapeHtml(
					enr.immigration,
				)}</p></div>`
			: ''
	}

	${
		enr?.records?.length
			? `<div class="pp-section"><h3>Records Found <span class="researched-tag">Researched</span></h3><ul class="pp-list">${enr.records
					.map((r) => `<li>${escapeHtml(r)}</li>`)
					.join('')}</ul></div>`
			: ''
	}

	${renderRelations(data, person)}

	${
		enr?.citations?.length
			? `<div class="pp-section"><h3>Sources (Researched)</h3><div class="pp-list" style="list-style:none;padding:0">${enr.citations
					.map(
						(c) =>
							`<div class="pp-cite">${
								c.url ? `<a href="${encodeURI(c.url)}" target="_blank" rel="noopener">${escapeHtml(c.label)} ↗</a>` : escapeHtml(c.label)
							}</div>`,
					)
					.join('')}</div></div>`
			: ''
	}

	${
		sources.length
			? `<div class="pp-section"><h3>Tree Sources</h3><ul class="pp-list">${sources
					.map((s) => `<li>${escapeHtml(s!.title ?? s!.id)}</li>`)
					.join('')}</ul></div>`
			: ''
	}

	${
		person.media.length
			? `<div class="pp-section"><h3>Media in Tree</h3><ul class="pp-list">${person.media
					.map((m) => `<li>${escapeHtml(m.title ?? 'Image')}${m.place ? ` <span style="color:var(--muted-text)">— ${escapeHtml(m.place)}</span>` : ''}</li>`)
					.join('')}</ul><p class="empty-note" style="margin-top:8px">Images are hosted on Ancestry and not embedded in the export.</p></div>`
			: ''
	}

	<div class="pp-section">
		<button class="ctrl-btn" data-action="tree" style="width:auto;padding:0 16px;gap:8px;font-size:13px;font-weight:500">❦ Show in tree</button>
	</div>
	`;
}

function renderTimeline(person: Person): string {
	if (!person.events.length) return '';
	const items = person.events
		.map((ev) => {
			const cls = ev.type === 'birth' ? 'birth' : ev.type === 'death' ? 'death' : '';
			const date = formatDate(ev.date);
			const place = ev.place ? shortPlace(ev.place) : '';
			const meta = [date, place].filter(Boolean).join(' · ');
			return `<li class="pp-event ${cls}">
				<div class="ev-title">${eventVerb(ev)}</div>
				${meta ? `<div class="ev-meta">${escapeHtml(meta)}</div>` : ''}
			</li>`;
		})
		.join('');
	return `<div class="pp-section"><h3>Life Timeline</h3><ul class="pp-timeline">${items}</ul></div>`;
}

function renderRelations(data: AppData, person: Person): string {
	const blocks: string[] = [];
	const group = (label: string, ids: string[]): void => {
		const valid = ids.filter((id) => data.personById.has(id));
		if (!valid.length) return;
		blocks.push(
			`<div style="margin-bottom:14px"><div class="k" style="margin-bottom:8px;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted-text)">${label}</div><div class="pp-chips">${valid
				.map((id) => nameChip(data, id))
				.join('')}</div></div>`,
		);
	};
	group('Parents', person.parentIds);
	group('Spouse(s)', person.spouseIds);
	group('Children', person.childIds);
	group('Siblings', person.siblingIds);
	if (!blocks.length) return '';
	return `<div class="pp-section"><h3>Family</h3>${blocks.join('')}</div>`;
}
