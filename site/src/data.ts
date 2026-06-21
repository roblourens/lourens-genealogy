import type {
	ConnectionsData,
	EnrichmentData,
	EnrichmentEntry,
	Family,
	Person,
	PlacesData,
	GeoPoint,
	TreeData,
	Connection,
	ImagesData,
	ResearchImage,
} from '../../shared/types';

export type BranchKey = 'lourens' | 'roorda' | 'stuenkel' | 'brueggemann' | 'root';

export interface BranchInfo {
	key: BranchKey;
	label: string;
	color: string;
}

export const BRANCHES: Record<BranchKey, BranchInfo> = {
	lourens: { key: 'lourens', label: 'Lourens (Dutch)', color: '#d98a4e' },
	roorda: { key: 'roorda', label: 'Roorda (Frisian)', color: '#5aa9b8' },
	stuenkel: { key: 'stuenkel', label: 'Stuenkel (German)', color: '#8a7fc9' },
	brueggemann: { key: 'brueggemann', label: 'Brueggemann (German)', color: '#b8657f' },
	root: { key: 'root', label: 'Recent generations', color: '#e6c878' },
};

export interface AppData {
	tree: TreeData;
	people: Person[];
	personById: Map<string, Person>;
	familyById: Map<string, Family>;
	places: Record<string, GeoPoint>;
	enrichmentById: Record<string, EnrichmentEntry>;
	connections: Connection[];
	imagesById: Record<string, ResearchImage[]>;
	branchOf: Map<string, BranchKey>;
	root: Person;
}

async function loadJson<T>(url: string, fallback: T): Promise<T> {
	try {
		const res = await fetch(url);
		if (!res.ok) return fallback;
		return (await res.json()) as T;
	} catch {
		return fallback;
	}
}

/** Assign every person to one of the four grandparent branches (or 'root'). */
function computeBranches(tree: TreeData, personById: Map<string, Person>): Map<string, BranchKey> {
	const branchOf = new Map<string, BranchKey>();
	const root = personById.get(tree.rootId);
	if (!root) return branchOf;

	const parents = root.parentIds.map((id) => personById.get(id)).filter((p): p is Person => !!p);
	const grandparents = parents.flatMap((p) =>
		p.parentIds.map((id) => personById.get(id)).filter((g): g is Person => !!g),
	);

	const surnameToBranch: Record<string, BranchKey> = {
		lourens: 'lourens',
		roorda: 'roorda',
		stuenkel: 'stuenkel',
		brueggemann: 'brueggemann',
	};

	// Walk ancestors of each grandparent and tag them with that branch.
	for (const gp of grandparents) {
		const branch = surnameToBranch[(gp.surname ?? '').toLowerCase()];
		if (!branch) continue;
		const queue = [gp.id];
		const seen = new Set<string>();
		while (queue.length) {
			const id = queue.shift()!;
			if (seen.has(id)) continue;
			seen.add(id);
			if (!branchOf.has(id)) branchOf.set(id, branch);
			const p = personById.get(id);
			p?.parentIds.forEach((pid) => queue.push(pid));
		}
	}

	// Collateral relatives inherit their parent's branch; everyone else is 'root'.
	for (const p of tree.people) {
		if (branchOf.has(p.id)) continue;
		const fromParent = p.parentIds.map((id) => branchOf.get(id)).find(Boolean);
		branchOf.set(p.id, (fromParent as BranchKey) ?? 'root');
	}
	return branchOf;
}

export async function loadAppData(): Promise<AppData> {
	const [tree, placesData, enrichment, connectionsData, imagesData] = await Promise.all([
		loadJson<TreeData | null>('data/tree.json', null),
		loadJson<PlacesData>('data/places.json', { generatedAt: '', places: {} }),
		loadJson<EnrichmentData>('data/enrichment.json', { generatedAt: '', entries: {} }),
		loadJson<ConnectionsData>('data/connections.json', { generatedAt: '', connections: [] }),
		loadJson<ImagesData>('data/images.json', { generatedAt: '', images: {} }),
	]);

	if (!tree) throw new Error('tree.json could not be loaded — run `npm run parse` first.');

	const personById = new Map(tree.people.map((p) => [p.id, p]));
	const familyById = new Map(tree.families.map((f) => [f.id, f]));
	const branchOf = computeBranches(tree, personById);
	const root = personById.get(tree.rootId)!;

	return {
		tree,
		people: tree.people,
		personById,
		familyById,
		places: placesData.places,
		enrichmentById: enrichment.entries,
		connections: connectionsData.connections,
		imagesById: imagesData.images,
		branchOf,
		root,
	};
}
