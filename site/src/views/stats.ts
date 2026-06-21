import type { Person, GeoPoint } from '../../../shared/types';
import type { AppContext, ViewController } from '../main';
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

	// Births by half-century.
	const buckets = birthsByPeriod(birthYears);

	// Lifespan distribution by decade-of-age.
	const ageBuckets = lifespanBuckets(withAge);

	// Superlatives.
	const longest = [...withAge].sort((a, b) => (b.ageAtDeath ?? 0) - (a.ageAtDeath ?? 0)).slice(0, 1)[0];
	const mostChildren = [...people].sort((a, b) => b.childIds.length - a.childIds.length)[0];
	const earliestPerson = [...people].filter((p) => p.birthYear).sort((a, b) => (a.birthYear ?? 0) - (b.birthYear ?? 0))[0];
	const oldestImmigrantOriginCountries = countryCounts;

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
			${kpi(String(data.tree.places.length), 'Distinct places')}
		</div>

		<div class="chart-grid">
			<div class="chart-card wide">
				<h3>Births Across the Centuries</h3>
				<p class="chart-sub">When the people in the tree were born, grouped by half-century.</p>
				${histogram(buckets)}
			</div>

			<div class="chart-card">
				<h3>Where the Lines Begin</h3>
				<p class="chart-sub">Country of birth across the whole tree.</p>
				${barList(countryCounts, 6)}
			</div>

			<div class="chart-card">
				<h3>Most Common Surnames</h3>
				<p class="chart-sub">Family names carried by the most people.</p>
				${barList(surnameCounts, 8)}
			</div>

			<div class="chart-card">
				<h3>How Long They Lived</h3>
				<p class="chart-sub">Distribution of age at death (${withAge.length} known).</p>
				${histogram(ageBuckets)}
			</div>

			<div class="chart-card">
				<h3>Notable Lives</h3>
				<p class="chart-sub">Records drawn from the tree.</p>
				<div class="superlatives">
					${superlative(longest?.ageAtDeath ? `${longest.ageAtDeath}` : '—', longest, 'Longest-lived ancestor')}
					${superlative(String(mostChildren?.childIds.length ?? 0), mostChildren, 'Most children recorded')}
					${superlative(String(earliestPerson?.birthYear ?? '—'), earliestPerson, 'Earliest known ancestor')}
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
		});
	};

	el.querySelectorAll('[data-person]').forEach((node) =>
		node.addEventListener('click', () => ctx.openPerson((node as HTMLElement).dataset.person!)),
	);

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

function barList(counts: Record<string, number>, limit: number): string {
	const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, limit);
	const max = entries.length ? entries[0][1] : 1;
	return entries
		.map(
			([label, n]) =>
				`<div class="bar-row"><div class="bl">${escapeHtml(label)}</div><div class="bar-track"><div class="bar-fill" data-w="${(
					(n / max) *
					100
				).toFixed(1)}%" style="width:0"></div></div><div class="bv">${n}</div></div>`,
		)
		.join('');
}

interface Bucket {
	label: string;
	value: number;
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

function lifespanBuckets(people: Person[]): Bucket[] {
	const ranges = [
		[0, 20],
		[20, 40],
		[40, 60],
		[60, 70],
		[70, 80],
		[80, 90],
		[90, 120],
	];
	return ranges.map(([lo, hi]) => ({
		label: hi === 120 ? `${lo}+` : `${lo}\u2013${hi}`,
		value: people.filter((p) => (p.ageAtDeath ?? -1) >= lo && (p.ageAtDeath ?? -1) < hi).length,
	}));
}

function histogram(buckets: Bucket[]): string {
	const max = Math.max(1, ...buckets.map((b) => b.value));
	return `<div class="histo">${buckets
		.map(
			(b) =>
				`<div class="histo-col"><div class="histo-bar" data-h="${((b.value / max) * 100).toFixed(
					1,
				)}%" style="height:0" title="${b.value}"></div><div class="histo-label">${escapeHtml(b.label)}</div></div>`,
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
