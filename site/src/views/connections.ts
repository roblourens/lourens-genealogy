import type { AppContext, ViewController } from '../main';
import { escapeHtml, lifespanLabel } from '../util';

const CONFIDENCE_ORDER: Record<string, number> = { confirmed: 0, plausible: 1, speculative: 2 };
const CONFIDENCE_NOTE: Record<string, string> = {
	confirmed: 'Documented genealogical link',
	plausible: 'Same rare surname, overlapping region & era — a real possibility, though unproven',
	speculative: 'A shared surname and a fun "what if" — no established link',
};

export function createConnectionsView(ctx: AppContext): ViewController {
	const { data } = ctx;
	const el = document.createElement('div');
	el.className = 'conn-view';

	const connections = [...data.connections].sort(
		(a, b) => (CONFIDENCE_ORDER[a.confidence] ?? 9) - (CONFIDENCE_ORDER[b.confidence] ?? 9),
	);

	const cards = connections
		.map((c) => {
			const related = c.relatedPersonIds
				.map((id) => data.personById.get(id))
				.filter((p) => p)
				.map(
					(p) =>
						`<span class="chip person-chip" data-person="${p!.id}">${escapeHtml(p!.name)}${
							lifespanLabel(p!) ? ` <span style="opacity:.6">${lifespanLabel(p!)}</span>` : ''
						}</span>`,
				)
				.join('');
			const cites = (c.citations ?? [])
				.map((cit) =>
					cit.url
						? `<a class="pp-cite" href="${encodeURI(cit.url)}" target="_blank" rel="noopener" style="color:var(--branch-roorda);text-decoration:none">${escapeHtml(
								cit.label,
							)} ↗</a>`
						: `<span class="pp-cite">${escapeHtml(cit.label)}</span>`,
				)
				.join('');
			const img = data.imagesById[c.id]?.[0];
			const figure = img
				? `<figure class="conn-figure">
						<a href="${encodeURI(img.sourceUrl ?? img.localPath)}" target="_blank" rel="noopener">
							<img src="${encodeURI(img.localPath)}" alt="${escapeHtml(img.caption ?? c.famousPerson)}" loading="lazy" />
						</a>
						<figcaption>${escapeHtml([img.credit, img.license].filter(Boolean).join(' · '))}</figcaption>
					</figure>`
				: '';
			return `
			<div class="conn-card${figure ? ' has-figure' : ''}">
				${figure}
				<div class="conn-body">
				<div class="conn-head">
					<div>
						<h3 class="conn-famous">${escapeHtml(c.famousPerson)}</h3>
						<div class="conn-surname">via the ${escapeHtml(c.surname)} line</div>
					</div>
					<span class="confidence ${c.confidence}" title="${CONFIDENCE_NOTE[c.confidence] ?? ''}">${c.confidence}</span>
				</div>
				<p class="conn-desc">${escapeHtml(c.famousDescription)}</p>
				<p class="conn-reasoning">${escapeHtml(c.reasoning)}</p>
				<div class="conn-foot">
					${related ? `<div class="pp-chips">${related}</div>` : ''}
					${cites}
				</div>
				</div>
			</div>`;
		})
		.join('');

	el.innerHTML = `
	<div class="conn-inner">
		<div class="stats-intro">
			<h2>Notable Connections</h2>
			<p>Distinctive surnames in the tree, weighed against famous namesakes. Each is labelled by how likely the link really is — most are fun long-shots, honestly assessed, never invented.</p>
		</div>
		<div style="display:flex;gap:18px;margin:0 0 24px;flex-wrap:wrap">
			${legendPill('confirmed', 'Documented')}
			${legendPill('plausible', 'Plausible')}
			${legendPill('speculative', 'Speculative')}
		</div>
		${cards || '<p class="empty-note">No connections have been researched yet.</p>'}
	</div>`;

	el.querySelectorAll('[data-person]').forEach((node) =>
		node.addEventListener('click', () => ctx.openPerson((node as HTMLElement).dataset.person!)),
	);

	return { el };
}

function legendPill(cls: string, label: string): string {
	return `<span style="display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:var(--muted-text)"><span class="confidence ${cls}" style="pointer-events:none">${label}</span> ${escapeHtml(
		CONFIDENCE_NOTE[cls] ?? '',
	)}</span>`;
}
