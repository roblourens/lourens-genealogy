import type { Person } from '../../../shared/types';
import type { AppContext, ViewController } from '../main';
import { BRANCHES, type BranchKey } from '../data';
import { escapeHtml, lifespanLabel } from '../util';

// Canonical Wikipedia sources (all verified to resolve). Kept in one place so the
// prose and the "Further reading" list stay in sync.
const W = {
	pella: 'https://en.wikipedia.org/wiki/Pella,_Iowa',
	afscheiding: 'https://en.wikipedia.org/wiki/Secession_of_1834',
	dutchAmericans: 'https://en.wikipedia.org/wiki/Dutch_Americans',
	crc: 'https://en.wikipedia.org/wiki/Christian_Reformed_Church_in_North_America',
	oldLutherans: 'https://en.wikipedia.org/wiki/Old_Lutherans',
	prussianUnion: 'https://en.wikipedia.org/wiki/Prussian_Union_of_Churches',
	lcms: 'https://en.wikipedia.org/wiki/Lutheran_Church%E2%80%93Missouri_Synod',
	germanAmericans: 'https://en.wikipedia.org/wiki/German_Americans',
	posen: 'https://en.wikipedia.org/wiki/Province_of_Posen',
	potato: 'https://en.wikipedia.org/wiki/European_Potato_Failure',
	fortyEighters: 'https://en.wikipedia.org/wiki/Forty-Eighters',
	homestead: 'https://en.wikipedia.org/wiki/Homestead_Acts',
};

interface Mover {
	p: Person;
	from: string;
	to: string;
}

function normCountry(c?: string | null): string | null {
	if (!c) return null;
	const k = c.toLowerCase();
	if (/nederland|netherlands|holland/.test(k)) return 'Netherlands';
	if (/deutschland|germany|prussia|pruisen|preussen|preu/.test(k)) return 'Germany';
	if (/united states|america|verenigde|u\.s/.test(k)) return 'United States';
	if (/pol/.test(k)) return 'Poland';
	return c;
}

function link(label: string, url: string): string {
	return `<a class="wiki-link" href="${url}" target="_blank" rel="noopener">${escapeHtml(label)}</a>`;
}

function peakBirthDecade(movers: Mover[]): string | null {
	const tally: Record<number, number> = {};
	for (const m of movers) {
		if (!m.p.birthYear) continue;
		const d = Math.floor(m.p.birthYear / 10) * 10;
		tally[d] = (tally[d] ?? 0) + 1;
	}
	const top = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
	return top ? `${top[0]}s` : null;
}

function chips(movers: Mover[], limit: number): string {
	const picks = movers
		.filter((m) => m.p.birthYear)
		.sort((a, b) => (a.p.birthYear ?? 0) - (b.p.birthYear ?? 0))
		.slice(0, limit);
	if (!picks.length) return '';
	return `<div class="person-chips">${picks
		.map(
			(m) =>
				`<button class="person-chip" data-person="${m.p.id}"><span>${escapeHtml(
					m.p.name,
				)}</span><span class="chip-yr">${escapeHtml(lifespanLabel(m.p) || '')}</span></button>`,
		)
		.join('')}</div>`;
}

interface BranchTally {
	key: BranchKey;
	label: string;
	color: string;
	count: number;
}

/** Which family branches a set of movers belong to, biggest first (excluding 'root'). */
function branchesOf(movers: Mover[], branchOf: Map<string, BranchKey>): BranchTally[] {
	const counts = new Map<BranchKey, number>();
	for (const m of movers) {
		const b = branchOf.get(m.p.id) ?? 'root';
		if (b === 'root') continue;
		counts.set(b, (counts.get(b) ?? 0) + 1);
	}
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([key, count]) => ({ key, label: BRANCHES[key].label, color: BRANCHES[key].color, count }));
}

/** Render the branches as coloured pills naming which lines of the family made this crossing. */
function branchPills(tallies: BranchTally[]): string {
	if (!tallies.length) return '';
	return `<div class="branch-pills"><span class="bp-intro">In our tree:</span>${tallies
		.map(
			(t) =>
				`<span class="branch-pill" style="--bc:${t.color}"><span class="bp-dot"></span>${escapeHtml(
					t.label,
				)} <span class="bp-ct">${t.count}</span></span>`,
		)
		.join('')}</div>`;
}

/** A plain-language phrase naming the branches, e.g. "Roorda (Frisian) and Lourens (Dutch)". */
function branchPhrase(tallies: BranchTally[]): string {
	const names = tallies.map((t) => `<strong style="color:${t.color}">${escapeHtml(t.label)}</strong>`);
	if (names.length <= 1) return names[0] ?? 'these';
	if (names.length === 2) return `${names[0]} and ${names[1]}`;
	return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

export function createHistoryView(ctx: AppContext): ViewController {
	const { data } = ctx;
	const el = document.createElement('div');
	el.className = 'history-view';

	const ctryOf = (place?: string): string | null => normCountry(data.places[place ?? '']?.country);
	const movers: Mover[] = [];
	for (const p of data.people) {
		const from = ctryOf(p.birth?.place);
		const to = ctryOf(p.death?.place);
		if (from && to && from !== to) movers.push({ p, from, to });
	}
	const dutch = movers.filter((m) => m.from === 'Netherlands' && m.to === 'United States');
	const german = movers.filter(
		(m) => (m.from === 'Germany' || m.from === 'Poland') && m.to === 'United States',
	);
	const overseas = movers.filter((m) => m.to === 'United States');

	const dutchPeak = peakBirthDecade(dutch);
	const germanPeak = peakBirthDecade(german);
	const dutchBranches = branchesOf(dutch, data.branchOf);
	const germanBranches = branchesOf(german, data.branchOf);

	el.innerHTML = `
	<div class="history-inner">
		<header class="history-hero">
			<p class="eyebrow">Historical Context</p>
			<h2>Why They Crossed the Ocean</h2>
			<p class="lede">At least ${overseas.length} people in this tree were born in Europe and died in the United States. They did not leave at random: they belonged to two of the great religious migrations of the nineteenth century &mdash; Dutch Reformed <em>Seceders</em> and German <em>Old Lutherans</em> &mdash; who crossed the Atlantic for faith and farmland, and who happened to converge on the very same corners of Iowa and Missouri where this family later grew together.</p>
		</header>

		<section class="era-card">
			<div class="era-body">
				<h3>The Seceders of Pella</h3>
				<p>In the 1840s a wave of Dutch families left provinces such as <strong>Gelderland, Friesland and Utrecht</strong> for the American Midwest. Many were <em>Seceders</em> &mdash; followers of the ${link(
					'Afscheiding of 1834',
					W.afscheiding,
				)}, a break from the state-controlled Dutch Reformed Church. Their ministers were fined, jailed and barred from preaching, and the ${link(
					'European Potato Failure',
					W.potato,
				)} of the mid-1840s deepened the hardship at home.</p>
				<p>In 1847 the Dominee Hendrik Scholte led some 800 of them to a stretch of Iowa prairie they named ${link(
					'Pella',
					W.pella,
				)} &mdash; a &ldquo;city of refuge.&rdquo; Their descendants went on to found the ${link(
					'Christian Reformed Church',
					W.crc,
				)} and remain one of the most recognizable ${link('Dutch-American', W.dutchAmericans)} communities in the country.</p>
				<p class="era-family">In <em>this</em> family, the Dutch crossing runs mainly through the ${branchPhrase(
					dutchBranches,
				)} ${dutchBranches.length > 1 ? 'lines' : 'line'} &mdash; the Frisian Roordas and the Gelderland Lourenses &mdash; who settled around <strong>Pella and Marion County, Iowa</strong>.</p>
				${branchPills(dutchBranches)}
				${chips(dutch, 6)}
			</div>
			<aside class="era-side">
				<div class="era-stat"><span class="es-num">${dutch.length}</span><span class="es-lab">ancestors, Netherlands &rarr; USA</span></div>
				${dutchPeak ? `<div class="era-stat"><span class="es-num">${dutchPeak}</span><span class="es-lab">most-common birth decade</span></div>` : ''}
				<div class="era-stat"><span class="es-num">Pella</span><span class="es-lab">Marion County, Iowa &mdash; their hub in our tree</span></div>
			</aside>
		</section>

		<section class="era-card">
			<div class="era-body">
				<h3>The Lutherans of Missouri</h3>
				<p>A parallel German wave came from <strong>Lower Saxony, the Kingdom of Hannover, Lippe and Prussia</strong>. Many were Lutherans who refused the ${link(
					'Prussian Union of 1817',
					W.prussianUnion,
				)} &mdash; the king&rsquo;s forced merger of Lutheran and Reformed churches. These ${link(
					'Old Lutherans',
					W.oldLutherans,
				)} were suppressed for worshipping in the old way, and emigrated in the 1830s and 1840s.</p>
				<p>In America they helped build the confessional ${link(
					'Lutheran Church&ndash;Missouri Synod',
					W.lcms,
				)}, organized in 1847, and settled across <strong>Missouri, St. Louis and Iowa</strong>. Our tree still carries several of their pastors &mdash; Reverends Weyel and Noack among them &mdash; part of the wider ${link(
					'German-American',
					W.germanAmericans,
				)} story.</p>
				<p class="era-family">Here, the German crossing runs through the ${branchPhrase(
					germanBranches,
				)} ${germanBranches.length > 1 ? 'lines' : 'line'}. The Stuenkels settled the German-Lutheran colony of <strong>Concordia, in Lafayette County, Missouri</strong>; the Brueggemanns gathered around <strong>St. Louis</strong>.</p>
				${branchPills(germanBranches)}
				${chips(german, 6)}
			</div>
			<aside class="era-side">
				<div class="era-stat"><span class="es-num">${german.length}</span><span class="es-lab">ancestors, Germany &rarr; USA</span></div>
				${germanPeak ? `<div class="era-stat"><span class="es-num">${germanPeak}</span><span class="es-lab">most-common birth decade</span></div>` : ''}
				<div class="era-stat"><span class="es-num">Missouri</span><span class="es-lab">&amp; Iowa &mdash; their heartland in our tree</span></div>
			</aside>
		</section>

		<section class="factors">
			<h3>What Pushed &mdash; and Pulled &mdash; Them</h3>
			<div class="factor-grid">
				<div class="factor">
					<h4>Faith</h4>
					<p>Both waves were, at heart, about the freedom to worship. The Dutch ${link(
						'Seceders',
						W.afscheiding,
					)} and the German ${link('Old Lutherans', W.oldLutherans)} left rather than submit to a state church.</p>
				</div>
				<div class="factor">
					<h4>Hunger &amp; land</h4>
					<p>The ${link(
						'potato failures',
						W.potato,
					)} of the 1840s and shrinking, subdivided farms made survival precarious. America promised cheap, abundant soil.</p>
				</div>
				<div class="factor">
					<h4>Upheaval</h4>
					<p>The failed ${link(
						'Revolutions of 1848',
						W.fortyEighters,
					)} pushed a fresh cohort of Germans &mdash; the &ldquo;Forty-Eighters&rdquo; &mdash; toward the United States.</p>
				</div>
				<div class="factor">
					<h4>The pull of the prairie</h4>
					<p>Letters home drew kin to the same counties, and the ${link(
						'Homestead Act of 1862',
						W.homestead,
					)} later turned Midwestern farmland into something a family could actually own.</p>
				</div>
			</div>
		</section>

		<section class="history-note">
			<p><strong>A note on &ldquo;Poland.&rdquo;</strong> A few ancestors recorded as born in Poland &mdash; the Noack and Prietzel families &mdash; actually came from the ${link(
				'Province of Posen',
				W.posen,
			)}, then part of Prussia. They belonged to the same German-Lutheran migration, not a separate Polish one.</p>
		</section>

		<section class="history-note subtle">
			<p><strong>A note on dates.</strong> Our tree records where each ancestor was <em>born</em> and <em>died</em>, but not the exact day they stepped off the boat &mdash; so the &ldquo;when&rdquo; above is inferred from birth years and the founding dates of Pella (1847) and Concordia. You can see every ocean-crosser, oldest to youngest, in the <a class="goto-link" data-goto="stats" href="#">Ocean Crossers</a> list on the Statistics page. If exact immigration or naturalization dates are added in Ancestry, this page can plot the real arrivals.</p>
		</section>

		<section class="reading">
			<h3>Further Reading</h3>
			<div class="reading-grid">
				<div class="reading-col">
					<h4>The Dutch story</h4>
					<ul>
						<li>${link('Pella, Iowa', W.pella)}</li>
						<li>${link('The Secession of 1834 (Afscheiding)', W.afscheiding)}</li>
						<li>${link('Dutch Americans', W.dutchAmericans)}</li>
						<li>${link('Christian Reformed Church in North America', W.crc)}</li>
					</ul>
				</div>
				<div class="reading-col">
					<h4>The German story</h4>
					<ul>
						<li>${link('Old Lutherans', W.oldLutherans)}</li>
						<li>${link('Prussian Union of Churches', W.prussianUnion)}</li>
						<li>${link('Lutheran Church&ndash;Missouri Synod', W.lcms)}</li>
						<li>${link('German Americans', W.germanAmericans)}</li>
						<li>${link('Province of Posen', W.posen)}</li>
					</ul>
				</div>
				<div class="reading-col">
					<h4>The wider wave</h4>
					<ul>
						<li>${link('The European Potato Failure', W.potato)}</li>
						<li>${link('The Forty-Eighters', W.fortyEighters)}</li>
						<li>${link('The Homestead Acts', W.homestead)}</li>
					</ul>
				</div>
			</div>
		</section>

		<footer class="history-foot">
			<p>These are the documented movements that match the places and dates already in our tree. We can&rsquo;t prove a given ancestor sailed on a particular ship &mdash; but the pattern is unmistakable. Historical context compiled from the linked public sources. <span class="byline">(Written by Copilot)</span></p>
		</footer>
	</div>`;

	el.querySelectorAll('[data-person]').forEach((node) =>
		node.addEventListener('click', () => ctx.openPerson((node as HTMLElement).dataset.person!)),
	);

	el.querySelectorAll<HTMLElement>('[data-goto]').forEach((node) =>
		node.addEventListener('click', (e) => {
			e.preventDefault();
			ctx.showView(node.dataset.goto as 'stats');
		}),
	);

	return { el };
}
