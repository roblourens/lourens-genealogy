import type { Person, GeoPoint } from '../../../shared/types';
import type { AppContext, ViewController } from '../main';
import { BRANCHES, type BranchKey } from '../data';
import { escapeHtml, lifespanLabel, shortPlace } from '../util';

const COUNTRY_ALIASES: Record<string, string> = {
	nederland: 'Netherlands',
	'pays-bas': 'Netherlands',
	holland: 'Netherlands',
	deutschland: 'Germany',
	allemagne: 'Germany',
	'united states of america': 'United States',
	usa: 'United States',
	'u.s.a.': 'United States',
	'verenigde staten van amerika': 'United States',
	'états-unis': 'United States',
	polska: 'Poland',
	pruisen: 'Germany',
	'pruisen (d)': 'Germany',
	preussen: 'Germany',
	prussia: 'Germany',
};

function normalizeCountry(name: string): string {
	const key = name.trim().toLowerCase();
	return COUNTRY_ALIASES[key] ?? name.trim();
}

function countryFromString(place: string): string | null {
	const seg = place
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean)
		.pop();
	if (!seg) return null;
	const s = seg.toLowerCase();
	if (/(usa|united states|u\.s|america|iowa|nebraska|missouri|kansas|illinois|indiana)/.test(s)) return 'United States';
	if (/(netherlands|nederland|pays-bas|holland|friesland|frysl|gelderland|wageningen|hallum|hannum)/.test(s)) return 'Netherlands';
	if (/(germany|deutschland|allemagne|prussia|pruisen|preussen|preußen|hannover|hanover|braunschweig|hildesheim|saxony|niedersachsen|schlesien|lippe|baden|bavaria|rhineland|germersheim)/.test(s)) return 'Germany';
	if (/(poland|posen|polska)/.test(s)) return 'Poland';
	return seg;
}

function makeCountryOf(places: Record<string, GeoPoint>): (place?: string) => string | null {
	return (place?: string): string | null => {
		if (!place) return null;
		const geo = places[place];
		if (geo?.country) return normalizeCountry(geo.country);
		return countryFromString(place);
	};
}

interface Crosser {
	id: string;
	name: string;
	birthYear?: number;
	deathYear?: number;
	origin: string;
	dest: string;
	branch: BranchKey;
}

const US_STATE = /^(iowa|missouri|kansas|illinois|indiana|wisconsin|nebraska|michigan|minnesota|ohio|texas|california|oregon|washington|colorado|south dakota|north dakota|ia|mo|ks|il|in|wi|ne|mi|mn|oh|tx)\.?$/i;

function usDestination(place?: string): string {
	if (!place) return 'the United States';
	const segs = place
		.split(',')
		.map((s) => s.trim().replace(/\?+$/, ''))
		.filter(Boolean)
		.filter((s) => !/^(usa|u\.?s\.?a?\.?|united states( of america)?|america)$/i.test(s));
	if (!segs.length) return 'the United States';
	const town = segs[0];
	const state = segs.slice(1).find((s) => US_STATE.test(s));
	return state ? `${town}, ${state}` : town;
}

// Ancestors born outside the United States who died in it: the ocean-crossing
// generation. Grouped into the two documented waves and sorted oldest -> youngest.
function oceanCrossers(
	people: Person[],
	countryOf: (place?: string) => string | null,
	branchOf: Map<string, BranchKey>,
): { dutch: Crosser[]; german: Crosser[] } {
	const dutch: Crosser[] = [];
	const german: Crosser[] = [];
	for (const p of people) {
		const from = countryOf(p.birth?.place);
		const to = countryOf(p.death?.place);
		if (!from || to !== 'United States' || from === 'United States') continue;
		const c: Crosser = {
			id: p.id,
			name: p.name,
			birthYear: p.birthYear ?? undefined,
			deathYear: p.deathYear ?? undefined,
			origin: shortPlace(p.birth?.place) || from,
			dest: usDestination(p.death?.place),
			branch: branchOf.get(p.id) ?? 'root',
		};
		if (from === 'Netherlands') dutch.push(c);
		else german.push(c);
	}
	const bySort = (a: Crosser, b: Crosser): number =>
		(a.birthYear ?? 9999) - (b.birthYear ?? 9999) || a.name.localeCompare(b.name);
	dutch.sort(bySort);
	german.sort(bySort);
	return { dutch, german };
}

function crosserRows(list: Crosser[]): string {
	return list
		.map((c) => {
			const br = BRANCHES[c.branch];
			const years =
				c.birthYear || c.deathYear
					? `${c.birthYear ?? '?'}\u2013${c.deathYear ?? '?'}`
					: '';
			return `<button class="crosser" data-person="${c.id}" title="View ${escapeHtml(
				c.name,
			)}">
				<span class="cx-dot" style="background:${br?.color ?? '#999'}"></span>
				<span class="cx-name">${escapeHtml(c.name)}</span>
				<span class="cx-years">${years}</span>
				<span class="cx-route"><span class="cx-from">${escapeHtml(
					c.origin,
				)}</span><span class="cx-arr">\u2192</span><span class="cx-to">${escapeHtml(
				c.dest,
			)}</span></span>
			</button>`;
		})
		.join('');
}

export function createStatsView(ctx: AppContext): ViewController {
	const { data } = ctx;
	const el = document.createElement('div');
	el.className = 'stats-view';

	const people = data.people;
	const withAge = people.filter((p) => p.ageAtDeath != null);
	const avgAge = withAge.length
		? Math.round(withAge.reduce((s, p) => s + (p.ageAtDeath ?? 0), 0) / withAge.length)
		: 0;
	const birthYears = people.map((p) => p.birthYear).filter((y): y is number => !!y);
	const earliest = birthYears.length ? Math.min(...birthYears) : 0;
	const generations = Math.max(...people.map((p) => p.generation ?? 0)) + 1;

	// Countries.
	const countryOf = makeCountryOf(data.places);
	const countryCounts = tally(people.map((p) => countryOf(p.birth?.place)).filter(Boolean) as string[]);
	const countriesSpanned = Object.keys(countryCounts).length;

	// Surnames.
	const surnameCounts = tally(people.map((p) => p.surname ?? '').filter(Boolean));

	// Occupations (from research enrichment).
	const {
		counts: occupationCounts,
		peopleWith: peopleWithOcc,
		byLabel: occupationPeople,
	} = tallyOccupations(data.enrichmentById, data.personById);
	const topOccupation = Object.entries(occupationCounts).sort((a, b) => b[1] - a[1])[0];

	// Births by half-century.
	const buckets = birthsByPeriod(birthYears);

	// Lifespan distribution by decade-of-age.
	const ageBuckets = lifespanBuckets(withAge);

	// Superlatives.
	const longest = [...withAge].sort((a, b) => (b.ageAtDeath ?? 0) - (a.ageAtDeath ?? 0)).slice(0, 1)[0];
	const mostChildren = [...people].sort((a, b) => b.childIds.length - a.childIds.length)[0];
	const earliestPerson = [...people].filter((p) => p.birthYear).sort((a, b) => (a.birthYear ?? 0) - (b.birthYear ?? 0))[0];
	const oldestImmigrantOriginCountries = countryCounts;

	// Parent's age at a child's birth (any child), from trusted birth years.
	const parentAges = parentChildAges(people, data.personById);
	const avgParentAge = parentAges.length ? Math.round(mean(parentAges.map((p) => p.age))) : 0;
	const fatherAges = parentAges.filter((p) => p.parentSex === 'M').map((p) => p.age);
	const motherAges = parentAges.filter((p) => p.parentSex === 'F').map((p) => p.age);
	const avgFather = fatherAges.length ? Math.round(mean(fatherAges)) : 0;
	const avgMother = motherAges.length ? Math.round(mean(motherAges)) : 0;
	const parentAgeTrend = averageByPeriod(
		parentAges.map((p) => ({ year: p.childBirthYear, value: p.age })),
	);
	const oldestParent = [...parentAges].sort((a, b) => b.age - a.age)[0];

	// Life expectancy by birth cohort (half-century).
	const lifeTrend = averageByPeriod(
		withAge.filter((p) => p.birthYear).map((p) => ({ year: p.birthYear as number, value: p.ageAtDeath as number })),
	);

	// Most common first (given) names.
	const givenNameCounts = tally(
		people.map((p) => (p.given ?? '').trim().split(/\s+/)[0]).filter(Boolean),
	);

	// People who died in a different country than where they were born.
	const movers = crossCountryCount(people, countryOf);

	// The ocean-crossing generation, grouped by documented wave.
	const crossers = oceanCrossers(people, countryOf, data.branchOf);

	// People behind each clickable bar/column, grouped per chart and namespaced by prefix
	// so hovering any bar lists who is in it (click a name to jump to them in the tree).
	const surnamePeople = peopleByGroup(people, (p) => p.surname || null);
	const countryPeople = peopleByGroup(people, (p) => countryOf(p.birth?.place));
	const givenPeople = peopleByGroup(people, (p) => (p.given ?? '').trim().split(/\s+/)[0] || null);
	const lifespanPeople = peopleByGroup(withAge, (p) =>
		p.ageAtDeath != null ? lifespanBucketOf(p.ageAtDeath) : null,
	);
	const birthPeople = peopleByGroup(people, (p) =>
		p.birthYear ? `${Math.floor(p.birthYear / 50) * 50}s` : null,
	);
	const peopleByKey: Record<string, { id: string; name: string }[]> = {};
	const registerPop = (
		prefix: string,
		map: Record<string, { id: string; name: string }[]>,
	): void => {
		for (const [label, ppl] of Object.entries(map)) peopleByKey[`${prefix}::${label}`] = ppl;
	};
	registerPop('occ', occupationPeople);
	registerPop('surname', surnamePeople);
	registerPop('country', countryPeople);
	registerPop('given', givenPeople);
	registerPop('life', lifespanPeople);
	registerPop('birth', birthPeople);

	el.innerHTML = `
	<div class="stats-inner">
		<div class="stats-intro">
			<h2>The Family in Numbers</h2>
			<p>Every figure below is computed directly from the family tree — ${people.length} people across ${generations} generations.</p>
		</div>

		<div class="kpi-grid">
			${kpi(String(people.length), 'People in the tree')}
			${kpi(String(generations), 'Generations', `back to ${earliest || '?'}`)}
			${kpi(`${avgAge}`, 'Average lifespan', `from ${withAge.length} known lives`)}
			${kpi(String(countriesSpanned), 'Countries of origin', Object.keys(oldestImmigrantOriginCountries).slice(0, 3).join(', '))}
			${kpi(longest?.ageAtDeath ? `${longest.ageAtDeath}` : '—', 'Longest life', longest ? longest.name : '')}
			${kpi(String(peopleWithOcc), 'With a known trade', topOccupation ? `${topOccupation[0].toLowerCase()} most common` : '')}
			${kpi(`${avgParentAge}`, 'Avg. age at parenthood', `fathers ${avgFather} \u00b7 mothers ${avgMother}`)}
			${kpi(String(movers.count), 'Crossed a border', movers.top ? `most often to ${movers.top}` : '')}
			${kpi(String(data.tree.places.length), 'Distinct places')}
		</div>

		<div class="chart-grid">
			<div class="chart-card wide">
				<h3>Births Across the Centuries</h3>
				<p class="chart-sub">When the people in the tree were born, grouped by half-century. <span class="chart-hint">Hover a bar to see who.</span></p>
				${histogram(buckets, { prefix: 'birth', people: birthPeople })}
			</div>

			<div class="chart-card wide">
				<h3>Lifespans Over the Centuries</h3>
				<p class="chart-sub">Average age at death by the half-century a person was born — life grew longer over time. Hover a point for the count behind it.</p>
				${trendChart(lifeTrend, { unit: ' yrs' })}
			</div>

			<div class="chart-card wide">
				<h3>The Age of Becoming a Parent</h3>
				<p class="chart-sub">Average age of a parent at a child's birth (${parentAges.length} parent\u2013child pairs), plotted by the child's half-century. Note: the "child" here is the descendant who continues our line in this tree \u2014 not necessarily the parent's firstborn. Hover any point for the average and the count behind it.</p>
				${trendChart(parentAgeTrend, { unit: ' yrs' })}
			</div>

			<div class="chart-card">
				<h3>Where the Lines Begin</h3>
				<p class="chart-sub">Country of birth across the whole tree. <span class="chart-hint">Hover a bar to see who.</span></p>
				${barList(countryCounts, 6, { prefix: 'country', people: countryPeople })}
			</div>

			<div class="chart-card">
				<h3>Most Common Surnames</h3>
				<p class="chart-sub">Family names carried by the most people. <span class="chart-hint">Hover a bar to see who.</span></p>
				${barList(surnameCounts, 8, { prefix: 'surname', people: surnamePeople })}
			</div>

			<div class="chart-card">
				<h3>Most Common First Names</h3>
				<p class="chart-sub">Given names handed down through the generations. <span class="chart-hint">Hover a bar to see who.</span></p>
				${barList(givenNameCounts, 8, { prefix: 'given', people: givenPeople })}
			</div>

			<div class="chart-card">
				<h3>What They Did for a Living</h3>
				<p class="chart-sub">Trades and callings found through research, across ${peopleWithOcc} ancestors. <span class="chart-hint">Hover a bar to see who.</span></p>
				${barList(occupationCounts, 10, { prefix: 'occ', people: occupationPeople })}
			</div>

			<div class="chart-card">
				<h3>How Long They Lived</h3>
				<p class="chart-sub">Distribution of age at death (${withAge.length} known). <span class="chart-hint">Hover a bar to see who.</span></p>
				${histogram(ageBuckets, { prefix: 'life', people: lifespanPeople })}
			</div>

			<div class="chart-card">
				<h3>Notable Lives</h3>
				<p class="chart-sub">Records drawn from the tree.</p>
				<div class="superlatives">
					${superlative(longest?.ageAtDeath ? `${longest.ageAtDeath}` : '—', longest, 'Longest-lived ancestor')}
					${oldestParent ? superlative(`${oldestParent.age}`, oldestParent.parent, 'Oldest parent at a birth') : ''}
					${superlative(String(mostChildren?.childIds.length ?? 0), mostChildren, 'Most children recorded')}
					${superlative(String(earliestPerson?.birthYear ?? '—'), earliestPerson, 'Earliest known ancestor')}
				</div>
			</div>

			<div class="chart-card wide">
				<h3>The Ocean Crossers</h3>
				<p class="chart-sub">Every ancestor born overseas who died in the United States &mdash; ${crossers.dutch.length + crossers.german.length} in all, oldest to youngest. Click a name to open them. <span class="chart-hint">The tree records birthplaces and deathplaces but not exact arrival dates, so the &ldquo;when&rdquo; is the birth&ndash;death span, not the crossing.</span></p>
				<div class="crosser-waves">
					<div class="crosser-col">
						<h4><span class="cw-dot" style="background:${BRANCHES.roorda.color}"></span>The Dutch wave <span class="cw-ct">${crossers.dutch.length}</span></h4>
						<p class="cw-sub">Frisian &amp; Gelderland lines &rarr; Pella and Marion County, Iowa</p>
						<div class="crosser-list">${crosserRows(crossers.dutch)}</div>
					</div>
					<div class="crosser-col">
						<h4><span class="cw-dot" style="background:${BRANCHES.stuenkel.color}"></span>The German wave <span class="cw-ct">${crossers.german.length}</span></h4>
						<p class="cw-sub">Stuenkel &amp; Brueggemann lines &rarr; Concordia (Lafayette Co.) and St. Louis, Missouri</p>
						<div class="crosser-list">${crosserRows(crossers.german)}</div>
					</div>
				</div>
			</div>
		</div>
	</div>`;

	// Animate bars in on show.
	const animate = (): void => {
		requestAnimationFrame(() => {
			el.querySelectorAll<HTMLElement>('.bar-fill[data-w]').forEach((b) => {
				b.style.width = b.dataset.w!;
			});
			el.querySelectorAll<HTMLElement>('.histo-bar[data-h]').forEach((b) => {
				b.style.height = b.dataset.h!;
			});
			el.querySelectorAll<SVGElement>('.trend').forEach((s) => s.classList.add('is-draw'));
		});
	};

	el.querySelectorAll('[data-person]').forEach((node) =>
		node.addEventListener('click', () => ctx.openPerson((node as HTMLElement).dataset.person!)),
	);

	// Detail popover: hover (or focus) any clickable bar/column to list the people behind
	// it, then click a name to jump to them in the tree. Shared by every chart.
	const occPop = document.createElement('div');
	occPop.className = 'occ-pop';
	occPop.hidden = true;
	el.appendChild(occPop);

	let hideTimer: number | undefined;
	const cancelHide = (): void => {
		if (hideTimer != null) {
			clearTimeout(hideTimer);
			hideTimer = undefined;
		}
	};
	const hidePop = (): void => {
		cancelHide();
		hideTimer = window.setTimeout(() => {
			occPop.hidden = true;
		}, 120);
	};
	const showPop = (trigger: HTMLElement): void => {
		const key = trigger.dataset.popKey;
		const label = trigger.dataset.popLabel ?? '';
		if (!key) return;
		const ppl = peopleByKey[key] ?? [];
		if (!ppl.length) return;
		cancelHide();
		occPop.innerHTML =
			`<div class="occ-pop-head">${escapeHtml(label)} <span>${ppl.length}</span></div>` +
			`<div class="occ-pop-list">${ppl
				.map(
					(p) =>
						`<button class="occ-pop-item" data-person-tree="${p.id}">${escapeHtml(p.name)}</button>`,
				)
				.join('')}</div>`;
		occPop.hidden = false;
		// Position below the trigger, in the scroll container's content coordinates.
		const rb = trigger.getBoundingClientRect();
		const eb = el.getBoundingClientRect();
		const pad = 8;
		const popW = occPop.offsetWidth;
		const popH = occPop.offsetHeight;
		const rowTop = rb.top - eb.top + el.scrollTop;
		let left = rb.left - eb.left + el.scrollLeft;
		let top = rb.bottom - eb.top + el.scrollTop + 6;
		if (left + popW > el.scrollLeft + el.clientWidth - pad) {
			left = el.scrollLeft + el.clientWidth - pad - popW;
		}
		if (left < el.scrollLeft + pad) left = el.scrollLeft + pad;
		// Flip above the trigger if it would overflow the visible bottom.
		if (top + popH > el.scrollTop + el.clientHeight - pad && rowTop - popH - 6 > el.scrollTop) {
			top = rowTop - popH - 6;
		}
		occPop.style.left = `${left}px`;
		occPop.style.top = `${top}px`;
	};

	el.querySelectorAll<HTMLElement>('.is-pop').forEach((trigger) => {
		trigger.addEventListener('mouseenter', () => showPop(trigger));
		trigger.addEventListener('mouseleave', hidePop);
		trigger.addEventListener('focus', () => showPop(trigger));
		trigger.addEventListener('blur', hidePop);
	});
	occPop.addEventListener('mouseenter', cancelHide);
	occPop.addEventListener('mouseleave', hidePop);
	occPop.addEventListener('click', (e) => {
		const id = (e.target as HTMLElement).closest<HTMLElement>('[data-person-tree]')?.dataset
			.personTree;
		if (id) {
			occPop.hidden = true;
			ctx.focusInTree(id);
		}
	});

	// Trend-chart hover tooltip: hovering anywhere over a point's column shows its value.
	const trendTip = document.createElement('div');
	trendTip.className = 'trend-tip';
	trendTip.hidden = true;
	el.appendChild(trendTip);
	const clearActiveDots = (): void =>
		el.querySelectorAll('.trend-dot.is-active').forEach((d) => d.classList.remove('is-active'));
	const hideTrendTip = (): void => {
		trendTip.hidden = true;
		clearActiveDots();
	};
	const showTrendTip = (rect: SVGRectElement, ev: MouseEvent): void => {
		const d = rect.dataset;
		trendTip.innerHTML = `<strong>${escapeHtml(d.label ?? '')}</strong><span>${escapeHtml(
			d.value ?? '',
		)}${escapeHtml(d.unit ?? '')}</span><em>${escapeHtml(d.n ?? '')} people</em>`;
		trendTip.hidden = false;
		const eb = el.getBoundingClientRect();
		const tw = trendTip.offsetWidth;
		const th = trendTip.offsetHeight;
		const pad = 8;
		let left = ev.clientX - eb.left + el.scrollLeft + 14;
		let top = ev.clientY - eb.top + el.scrollTop + 14;
		if (left + tw > el.scrollLeft + el.clientWidth - pad) {
			left = ev.clientX - eb.left + el.scrollLeft - tw - 14;
		}
		if (top + th > el.scrollTop + el.clientHeight - pad) {
			top = ev.clientY - eb.top + el.scrollTop - th - 14;
		}
		trendTip.style.left = `${left}px`;
		trendTip.style.top = `${top}px`;
		const svg = rect.closest('svg');
		clearActiveDots();
		svg?.querySelector(`.trend-dot[data-i="${d.i}"]`)?.classList.add('is-active');
	};
	el.querySelectorAll<SVGRectElement>('.trend-hit').forEach((r) => {
		r.addEventListener('mousemove', (e) => showTrendTip(r, e as MouseEvent));
		r.addEventListener('mouseleave', hideTrendTip);
	});

	let shown = false;
	return {
		el,
		show() {
			if (!shown) {
				animate();
				shown = true;
			}
		},
	};
}

function kpi(num: string, label: string, sub = ''): string {
	return `<div class="kpi"><div class="num">${num}</div><div class="label">${label}</div>${
		sub ? `<div class="sub">${escapeHtml(sub)}</div>` : ''
	}</div>`;
}

function tally(items: string[]): Record<string, number> {
	const out: Record<string, number> = {};
	for (const i of items) out[i] = (out[i] ?? 0) + 1;
	return out;
}

// Light canonicalization so historical / bilingual occupation strings collapse into common trades.
const OCCUPATION_RULES: [RegExp, string][] = [
	[/farmhand|farm ?servant|farm ?hand|farm laborer/i, 'Farmhand'],
	[/farmer|^boer$|colona|colon\b|husbandman|meiermann|vollmeier|hoferb|meier /i, 'Farmer'],
	[/day ?labou?rer|^labou?rer$|workman|arbeider/i, 'Laborer'],
	[/pastor|minister|missionary|reverend|predikant|clergy/i, 'Lutheran pastor / minister'],
	[/housewife|hausfrau|homemaker/i, 'Housewife / homemaker'],
	[/domestic servant|housekeeper|housemaid|^maid$|dienst/i, 'Domestic servant'],
	[/nurse/i, 'Nurse'],
	[/shoemaker|cobbler/i, 'Shoemaker'],
	[/tailor|seamstress/i, 'Tailor'],
	[/spinner|weaver/i, 'Spinner / weaver'],
	[/m.ller\b|miller/i, 'Miller'],
	[/z.llner|customs officer/i, 'Customs officer'],
	[/voerman|carter/i, 'Carter'],
	[/soldier|army|private first class|infantry|wehrmacht/i, 'Soldier'],
];

function canonOccupation(raw: string): string {
	const c = raw
		.toLowerCase()
		.replace(/\(.*?\)/g, '')
		.replace(/\s+/g, ' ')
		.trim();
	for (const [re, label] of OCCUPATION_RULES) if (re.test(c)) return label;
	return c.charAt(0).toUpperCase() + c.slice(1);
}

/** Tally distinct trades across the tree (each person counts once per occupation). */
function tallyOccupations(
	entries: Record<string, { personName?: string; occupations?: string[] }>,
	personById: Map<string, Person>,
): {
	counts: Record<string, number>;
	peopleWith: number;
	byLabel: Record<string, { id: string; name: string }[]>;
} {
	const counts: Record<string, number> = {};
	const byLabel: Record<string, { id: string; name: string }[]> = {};
	let peopleWith = 0;
	for (const [id, e] of Object.entries(entries)) {
		const occ = (e.occupations ?? []).filter(Boolean);
		if (!occ.length) continue;
		peopleWith++;
		const name = personById.get(id)?.name ?? e.personName ?? id;
		for (const label of new Set(occ.map(canonOccupation))) {
			counts[label] = (counts[label] ?? 0) + 1;
			(byLabel[label] ??= []).push({ id, name });
		}
	}
	for (const label of Object.keys(byLabel)) {
		byLabel[label].sort((a, b) => a.name.localeCompare(b.name));
	}
	return { counts, peopleWith, byLabel };
}

interface PopLink {
	prefix: string;
	people: Record<string, { id: string; name: string }[]>;
}

function popAttrs(link: PopLink | undefined, label: string, base: string): string {
	if (link && (link.people[label]?.length ?? 0) > 0) {
		return ` class="${base} is-pop" data-pop-key="${escapeHtml(link.prefix)}::${escapeHtml(
			label,
		)}" data-pop-label="${escapeHtml(label)}" tabindex="0"`;
	}
	return ` class="${base}"`;
}

function barList(counts: Record<string, number>, limit: number, link?: PopLink): string {
	const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
	const max = entries.length ? entries[0][1] : 1;
	return entries
		.map(([label, n]) => {
			return `<div${popAttrs(link, label, 'bar-row')}><div class="bl">${escapeHtml(
				label,
			)}</div><div class="bar-track"><div class="bar-fill" data-w="${(
				(n / max) *
				100
			).toFixed(1)}%" style="width:0"></div></div><div class="bv">${n}</div></div>`;
		})
		.join('');
}

interface Bucket {
	label: string;
	value: number;
}

/** Group people into name-sorted lists by an arbitrary key (skips null keys). */
function peopleByGroup(
	people: Person[],
	keyOf: (p: Person) => string | null | undefined,
): Record<string, { id: string; name: string }[]> {
	const out: Record<string, { id: string; name: string }[]> = {};
	for (const p of people) {
		const k = keyOf(p);
		if (!k) continue;
		(out[k] ??= []).push({ id: p.id, name: p.name });
	}
	for (const k of Object.keys(out)) out[k].sort((a, b) => a.name.localeCompare(b.name));
	return out;
}

function birthsByPeriod(years: number[]): Bucket[] {
	if (!years.length) return [];
	const min = Math.floor(Math.min(...years) / 50) * 50;
	const max = Math.ceil(Math.max(...years) / 50) * 50;
	const buckets: Bucket[] = [];
	for (let y = min; y < max; y += 50) {
		const count = years.filter((yr) => yr >= y && yr < y + 50).length;
		buckets.push({ label: `${y}s`, value: count });
	}
	return buckets;
}

const LIFESPAN_RANGES: [number, number][] = [
	[0, 20],
	[20, 40],
	[40, 60],
	[60, 70],
	[70, 80],
	[80, 90],
	[90, 120],
];

function lifespanRangeLabel(lo: number, hi: number): string {
	return hi === 120 ? `${lo}+` : `${lo}\u2013${hi}`;
}

/** The lifespan-distribution bucket label an age falls into (matches lifespanBuckets). */
function lifespanBucketOf(age: number): string | null {
	for (const [lo, hi] of LIFESPAN_RANGES) if (age >= lo && age < hi) return lifespanRangeLabel(lo, hi);
	return null;
}

function lifespanBuckets(people: Person[]): Bucket[] {
	return LIFESPAN_RANGES.map(([lo, hi]) => ({
		label: lifespanRangeLabel(lo, hi),
		value: people.filter((p) => (p.ageAtDeath ?? -1) >= lo && (p.ageAtDeath ?? -1) < hi).length,
	}));
}

function histogram(buckets: Bucket[], link?: PopLink): string {
	const max = Math.max(1, ...buckets.map((b) => b.value));
	return `<div class="histo">${buckets
		.map(
			(b) =>
				`<div${popAttrs(link, b.label, 'histo-col')}><div class="histo-track"><div class="histo-bar" data-h="${(
					(b.value / max) *
					100
				).toFixed(
					1,
				)}%" style="height:0" title="${b.value}"></div></div><div class="histo-count">${b.value}</div><div class="histo-label">${escapeHtml(b.label)}</div></div>`,
		)
		.join('')}</div>`;
}

function superlative(val: string, person: Person | undefined, desc: string): string {
	if (!person) return '';
	const place = shortPlace(person.birth?.place);
	return `<div class="superlative"><div class="sl-val">${val}</div><div class="sl-body"><div class="sl-name" data-person="${
		person.id
	}">${escapeHtml(person.name)}</div><div class="sl-desc">${desc}${
		place ? ` · ${escapeHtml(place)}` : ''
	}${lifespanLabel(person) ? ` · ${lifespanLabel(person)}` : ''}</div></div></div>`;
}

function mean(nums: number[]): number {
	return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
}

interface ParentAge {
	age: number;
	parentSex?: string;
	childBirthYear: number;
	parent: Person;
}

/** Age of each parent at a child's birth, for every parent-child pair with both birth years known. */
function parentChildAges(people: Person[], byId: Map<string, Person>): ParentAge[] {
	const out: ParentAge[] = [];
	for (const child of people) {
		if (!child.birthYear) continue;
		for (const pid of child.parentIds ?? []) {
			const parent = byId.get(pid);
			if (!parent?.birthYear) continue;
			const age = child.birthYear - parent.birthYear;
			if (age < 12 || age > 70) continue; // drop implausible/erroneous pairs
			out.push({ age, parentSex: parent.sex, childBirthYear: child.birthYear, parent });
		}
	}
	return out;
}

interface TrendPoint {
	label: string;
	value: number;
	n: number;
}

/** Average a series of {year,value} into half-century bins (empty bins are skipped). */
function averageByPeriod(items: { year: number; value: number }[], span = 50): TrendPoint[] {
	if (!items.length) return [];
	const min = Math.floor(Math.min(...items.map((i) => i.year)) / span) * span;
	const max = Math.floor(Math.max(...items.map((i) => i.year)) / span) * span;
	const out: TrendPoint[] = [];
	for (let y = min; y <= max; y += span) {
		const vals = items.filter((i) => i.year >= y && i.year < y + span).map((i) => i.value);
		if (!vals.length) continue;
		out.push({ label: `${y}s`, value: mean(vals), n: vals.length });
	}
	return out;
}

/** Count people whose birth and death countries differ, plus the most common destination. */
function crossCountryCount(
	people: Person[],
	countryOf: (place?: string) => string | null,
): { count: number; top: string } {
	let count = 0;
	const dest: Record<string, number> = {};
	for (const p of people) {
		const b = countryOf(p.birth?.place);
		const d = countryOf(p.death?.place);
		if (b && d && b !== d) {
			count++;
			dest[d] = (dest[d] ?? 0) + 1;
		}
	}
	const top = Object.entries(dest).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
	return { count, top };
}

/** Responsive SVG line chart for an "over time" trend (averages per period). */
function trendChart(points: TrendPoint[], opts: { unit?: string } = {}): string {
	if (points.length < 2) return '<p class="chart-empty">Not enough data to chart.</p>';
	const unit = opts.unit ?? '';
	const W = 1000;
	const H = 280;
	const padL = 60;
	const padR = 28;
	const padT = 26;
	const padB = 48;
	const vals = points.map((p) => p.value);
	const yMin = Math.floor((Math.min(...vals) - 3) / 5) * 5;
	const yMax = Math.ceil((Math.max(...vals) + 3) / 5) * 5;
	const xFor = (i: number): number => padL + (i / (points.length - 1)) * (W - padL - padR);
	const yFor = (v: number): number => padT + (1 - (v - yMin) / (yMax - yMin)) * (H - padT - padB);
	const line = points
		.map((p, i) => `${i ? 'L' : 'M'}${xFor(i).toFixed(1)},${yFor(p.value).toFixed(1)}`)
		.join(' ');
	const area =
		`M${xFor(0).toFixed(1)},${(H - padB).toFixed(1)} ` +
		points.map((p, i) => `L${xFor(i).toFixed(1)},${yFor(p.value).toFixed(1)}`).join(' ') +
		` L${xFor(points.length - 1).toFixed(1)},${(H - padB).toFixed(1)} Z`;
	const ticks = [yMin, Math.round((yMin + yMax) / 2), yMax];
	const grid = ticks
		.map((t) => {
			const y = yFor(t);
			return (
				`<line class="trend-grid" x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"></line>` +
				`<text class="trend-ylabel" x="${padL - 10}" y="${(y + 5).toFixed(1)}">${t}</text>`
			);
		})
		.join('');
	const dots = points
		.map(
			(p, i) =>
				`<circle class="trend-dot" data-i="${i}" cx="${xFor(i).toFixed(1)}" cy="${yFor(
					p.value,
				).toFixed(1)}" r="5"></circle>`,
		)
		.join('');
	const xlabels = points
		.map(
			(p, i) =>
				`<text class="trend-xlabel" x="${xFor(i).toFixed(1)}" y="${H - 16}">${escapeHtml(
					p.label,
				)}</text>`,
		)
		.join('');
	// Invisible per-point hover bands (full plot height) so hovering anywhere over a
	// column reveals that point's data, not just the small dot.
	const plotTop = padT;
	const plotH = H - padT - padB;
	const hits = points
		.map((p, i) => {
			const left = i === 0 ? padL : (xFor(i - 1) + xFor(i)) / 2;
			const right = i === points.length - 1 ? W - padR : (xFor(i) + xFor(i + 1)) / 2;
			return `<rect class="trend-hit" x="${left.toFixed(1)}" y="${plotTop}" width="${(
				right - left
			).toFixed(1)}" height="${plotH}" data-i="${i}" data-label="${escapeHtml(
				p.label,
			)}" data-value="${p.value.toFixed(1)}" data-n="${p.n}" data-unit="${escapeHtml(unit)}"></rect>`;
		})
		.join('');
	return (
		`<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="Trend over time">` +
		`<defs><linearGradient id="trendFill" x1="0" x2="0" y1="0" y2="1">` +
		`<stop offset="0" stop-color="var(--gold)" stop-opacity="0.26"/>` +
		`<stop offset="1" stop-color="var(--gold)" stop-opacity="0"/></linearGradient></defs>` +
		grid +
		`<path class="trend-area" d="${area}" fill="url(#trendFill)"/>` +
		`<path class="trend-line" d="${line}"/>` +
		dots +
		xlabels +
		`<g class="trend-hits">${hits}</g>` +
		`</svg>`
	);
}
