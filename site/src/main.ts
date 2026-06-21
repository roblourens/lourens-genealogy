import './styles/main.css';
import { loadAppData, type AppData } from './data';
import { lifespanLabel } from './util';
import { createTreeView } from './views/tree';
import { createMapView } from './views/map';
import { createTimelineView } from './views/timeline';
import { createStatsView } from './views/stats';
import { createConnectionsView } from './views/connections';
import { openPersonPanel } from './views/person';

export type ViewName = 'tree' | 'map' | 'timeline' | 'stats' | 'connections';

export interface ViewController {
	el: HTMLElement;
	show?(): void;
	hide?(): void;
}

export interface AppContext {
	data: AppData;
	openPerson(id: string): void;
	focusInTree(id: string): void;
	showView(view: ViewName): void;
}

async function main(): Promise<void> {
	const viewRoot = document.getElementById('view-root')!;
	const loading = document.getElementById('loading')!;
	const tabs = document.getElementById('tabs')!;

	let data: AppData;
	try {
		data = await loadAppData();
	} catch (err) {
		loading.innerHTML = `<p style="color:var(--branch-brueggemann)">Could not load family data.<br><small>${(err as Error).message}</small></p>`;
		return;
	}

	const views = new Map<ViewName, ViewController>();
	let current: ViewName = 'tree';

	updateBrandSub(data);

	const ctx: AppContext = {
		data,
		openPerson: (id) => openPersonPanel(data, id, ctx),
		focusInTree: (id) => {
			ctx.showView('tree');
			const tv = views.get('tree') as (ViewController & { focus?: (id: string) => void }) | undefined;
			tv?.focus?.(id);
		},
		showView: (view) => switchView(view),
	};

	// Lazily build each view the first time it is shown (map/tree are heavy).
	const builders: Record<ViewName, () => ViewController> = {
		tree: () => createTreeView(ctx),
		map: () => createMapView(ctx),
		timeline: () => createTimelineView(ctx),
		stats: () => createStatsView(ctx),
		connections: () => createConnectionsView(ctx),
	};

	function switchView(view: ViewName): void {
		if (view === current && views.has(view)) return;
		// Build on demand.
		if (!views.has(view)) {
			const vc = builders[view]();
			vc.el.classList.add('view');
			vc.el.style.display = 'none';
			viewRoot.appendChild(vc.el);
			views.set(view, vc);
		}
		for (const [name, vc] of views) {
			const active = name === view;
			vc.el.style.display = active ? '' : 'none';
			if (active) vc.show?.();
			else vc.hide?.();
		}
		current = view;
		for (const t of tabs.querySelectorAll('.tab')) {
			t.classList.toggle('is-active', (t as HTMLElement).dataset.view === view);
		}
	}

	tabs.addEventListener('click', (e) => {
		const btn = (e.target as HTMLElement).closest('.tab') as HTMLElement | null;
		if (btn?.dataset.view) switchView(btn.dataset.view as ViewName);
	});

	setupSearch(data, ctx);
	loading.remove();
	switchView('tree');
}

function setupSearch(data: AppData, ctx: AppContext): void {
	const input = document.getElementById('search-input') as HTMLInputElement;
	const results = document.getElementById('search-results') as HTMLElement;

	function render(q: string): void {
		const query = q.trim().toLowerCase();
		if (!query) {
			results.hidden = true;
			results.innerHTML = '';
			return;
		}
		const matches = data.people
			.filter((p) => p.name.toLowerCase().includes(query))
			.sort((a, b) => (a.birthYear ?? 9999) - (b.birthYear ?? 9999))
			.slice(0, 12);
		if (!matches.length) {
			results.hidden = false;
			results.innerHTML = `<div class="search-result"><span style="color:var(--muted-text)">No matches</span></div>`;
			return;
		}
		results.hidden = false;
		results.innerHTML = matches
			.map(
				(p) =>
					`<div class="search-result" data-id="${p.id}"><span>${p.name}</span><span class="yr">${lifespanLabel(p)}</span></div>`,
			)
			.join('');
	}

	input.addEventListener('input', () => render(input.value));
	input.addEventListener('focus', () => {
		if (input.value) render(input.value);
	});
	results.addEventListener('click', (e) => {
		const row = (e.target as HTMLElement).closest('.search-result') as HTMLElement | null;
		if (row?.dataset.id) {
			ctx.openPerson(row.dataset.id);
			results.hidden = true;
			input.value = '';
		}
	});
	document.addEventListener('click', (e) => {
		if (!(e.target as HTMLElement).closest('.search')) results.hidden = true;
	});
}

function updateBrandSub(data: AppData): void {
	const el = document.getElementById('brand-sub');
	if (!el) return;
	const people = data.tree.people;
	const gens = people.map((p) => p.generation).filter((g): g is number => g != null);
	const generationCount = gens.length ? Math.max(...gens) + 1 : 0;
	const births = people.map((p) => p.birthYear).filter((y): y is number => !!y);
	const earliest = births.length ? Math.min(...births) : null;
	const words = [
		'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
		'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen',
		'eighteen', 'nineteen', 'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four',
	];
	const genWord = words[generationCount] ?? String(generationCount);
	const parts = ['Four lines'];
	if (generationCount) parts.push(`${genWord} generations`);
	if (earliest) parts.push(`back to ${earliest}`);
	el.textContent = parts.join(' · ');
}

main();