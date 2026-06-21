/**
 * GEDCOM -> normalized tree.json
 *
 * Builds a generic node tree from the GEDCOM lines, then transforms INDI / FAM /
 * SOUR / OBJE records into the shared data model. Computes derived fields
 * (years, age at death, direct-line ancestry + generation relative to the root)
 * and a per-person content hash that drives incremental re-research.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
	Family,
	LifeEvent,
	MediaRef,
	Person,
	Sex,
	SourceRecord,
	TreeData,
} from '../shared/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const GEDCOM_PATH = resolve(ROOT_DIR, 'Lourens Family Tree.ged');
const OUT_PATH = resolve(ROOT_DIR, 'data/tree.json');

// ---- Generic GEDCOM tree ----

interface GNode {
	level: number;
	tag: string;
	xref?: string; // pointer value or record id (with @)
	value?: string;
	children: GNode[];
}

function parseGedcom(text: string): GNode[] {
	const lines = text.split(/\r?\n/);
	const root: GNode = { level: -1, tag: 'ROOT', children: [] };
	const stack: GNode[] = [root];

	for (const raw of lines) {
		if (!raw.trim()) continue;
		const m = raw.match(/^(\d+)\s+(@[^@]+@)?\s*([A-Za-z0-9_]+)?\s?(.*)$/);
		if (!m) continue;
		const level = Number(m[1]);
		const idOrPtr = m[2];
		const tag = m[3];
		const rest = m[4] ?? '';

		// Two GEDCOM line shapes:
		//   "0 @I1@ INDI"  -> xref id is the record id, tag is INDI
		//   "1 FAMC @F1@"  -> tag is FAMC, value is the pointer
		let node: GNode;
		if (idOrPtr && tag) {
			node = { level, tag, xref: idOrPtr, children: [] };
		} else if (tag) {
			const ptr = rest.match(/^@[^@]+@$/) ? rest : undefined;
			node = { level, tag, xref: ptr, value: ptr ? undefined : rest, children: [] };
		} else {
			continue;
		}

		while (stack.length > 1 && stack[stack.length - 1].level >= level) {
			stack.pop();
		}
		stack[stack.length - 1].children.push(node);
		stack.push(node);
	}
	return root.children;
}

// ---- Helpers ----

const child = (n: GNode, tag: string): GNode | undefined =>
	n.children.find((c) => c.tag === tag);
const children = (n: GNode, tag: string): GNode[] =>
	n.children.filter((c) => c.tag === tag);
const stripAt = (s?: string): string => (s ? s.replace(/@/g, '') : '');

/** Concatenate CONC/CONT continuation lines onto a value. */
function fullText(n: GNode): string {
	let out = n.value ?? '';
	for (const c of n.children) {
		if (c.tag === 'CONC') out += c.value ?? '';
		else if (c.tag === 'CONT') out += '\n' + (c.value ?? '');
	}
	return out.trim();
}

function parseYear(date?: string): number | null {
	if (!date) return null;
	const m = date.match(/(\d{3,4})/g);
	if (!m) return null;
	const year = Number(m[m.length - 1]);
	return year >= 100 && year <= 2100 ? year : null;
}

function readEvent(node: GNode | undefined, type: LifeEvent['type']): LifeEvent | undefined {
	if (!node) return undefined;
	const dateNode = child(node, 'DATE');
	const placeNode = child(node, 'PLAC');
	const noteNode = child(node, 'NOTE');
	const date = dateNode?.value?.trim();
	const place = placeNode?.value?.trim();
	if (!date && !place && !noteNode) return undefined;
	const sourceIds = children(node, 'SOUR')
		.map((s) => stripAt(s.xref))
		.filter(Boolean);
	const event: LifeEvent = { type };
	if (date) {
		event.date = date;
		event.year = parseYear(date);
	}
	if (place) event.place = place;
	if (noteNode) event.note = fullText(noteNode);
	if (sourceIds.length) event.sourceIds = sourceIds;
	return event;
}

function parseName(n: GNode): { name: string; given?: string; surname?: string; suffix?: string } {
	const givn = child(n, 'GIVN')?.value?.trim();
	const surn = child(n, 'SURN')?.value?.trim();
	const nsfx = child(n, 'NSFX')?.value?.trim();
	let given = givn;
	let surname = surn;
	// Fall back to parsing the slash-delimited NAME value.
	if (!given || !surname) {
		const v = n.value ?? '';
		const m = v.match(/^(.*?)\/(.*?)\//);
		if (m) {
			given = given || m[1].trim();
			surname = surname || m[2].trim();
		}
	}
	const parts = [given, surname].filter(Boolean).join(' ').trim();
	const name = [parts, nsfx].filter(Boolean).join(' ').trim() || (n.value ?? '').replace(/\//g, '').trim();
	return { name, given, surname, suffix: nsfx };
}

function contentHash(p: Partial<Person>): string {
	const canonical = {
		name: p.name,
		sex: p.sex,
		birth: p.birth ? { d: p.birth.date, p: p.birth.place } : null,
		death: p.death ? { d: p.death.date, p: p.death.place } : null,
		residences: (p.residences ?? []).map((r) => ({ d: r.date, p: r.place })),
		famc: p.famc ?? null,
		fams: [...(p.fams ?? [])].sort(),
		parents: [...(p.parentIds ?? [])].sort(),
		spouses: [...(p.spouseIds ?? [])].sort(),
		children: [...(p.childIds ?? [])].sort(),
	};
	return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 16);
}

// ---- Main transform ----

function main(): void {
	const text = readFileSync(GEDCOM_PATH, 'utf8');
	const records = parseGedcom(text);

	const indiNodes = records.filter((r) => r.tag === 'INDI');
	const famNodes = records.filter((r) => r.tag === 'FAM');
	const sourNodes = records.filter((r) => r.tag === 'SOUR');
	const objeNodes = records.filter((r) => r.tag === 'OBJE');

	// Media object lookup (record id -> media metadata).
	const mediaById = new Map<string, MediaRef>();
	for (const o of objeNodes) {
		const file = child(o, 'FILE');
		const ref: MediaRef = {
			oid: stripAt(o.xref),
			title: file ? child(file, 'TITL')?.value?.trim() : undefined,
			place: child(o, 'PLAC')?.value?.trim(),
			form: file ? child(file, 'FORM')?.value?.trim() : undefined,
		};
		mediaById.set(stripAt(o.xref), ref);
	}

	// Sources.
	const sources: SourceRecord[] = sourNodes.map((s) => ({
		id: stripAt(s.xref),
		title: child(s, 'TITL')?.value?.trim(),
		author: child(s, 'AUTH')?.value?.trim(),
		publication: child(s, 'PUBL')?.value?.trim(),
	}));

	// Families.
	const families: Family[] = famNodes.map((f) => {
		const marrNode = child(f, 'MARR');
		const fam: Family = {
			id: stripAt(f.xref),
			husbandId: stripAt(child(f, 'HUSB')?.xref) || undefined,
			wifeId: stripAt(child(f, 'WIFE')?.xref) || undefined,
			childIds: children(f, 'CHIL').map((c) => stripAt(c.xref)),
			marriage: readEvent(marrNode, 'marriage'),
		};
		return fam;
	});
	const familyById = new Map(families.map((f) => [f.id, f]));

	// People (first pass: facts).
	const people: Person[] = [];
	const placeSet = new Set<string>();

	for (const ind of indiNodes) {
		const id = stripAt(ind.xref);
		const { name, given, surname, suffix } = parseName(child(ind, 'NAME') ?? ind);
		const sexRaw = child(ind, 'SEX')?.value?.trim();
		const sex: Sex = sexRaw === 'M' || sexRaw === 'F' ? sexRaw : 'U';

		const birth = readEvent(child(ind, 'BIRT'), 'birth');
		const death = readEvent(child(ind, 'DEAT'), 'death');
		const residences = children(ind, 'RESI')
			.map((r) => readEvent(r, 'residence'))
			.filter((e): e is LifeEvent => Boolean(e));

		const famc = stripAt(child(ind, 'FAMC')?.xref) || undefined;
		const fams = children(ind, 'FAMS').map((f) => stripAt(f.xref));

		const media = children(ind, 'OBJE')
			.map((o) => mediaById.get(stripAt(o.xref)))
			.filter((m): m is MediaRef => Boolean(m));

		const sourceIds = children(ind, 'SOUR')
			.map((s) => stripAt(s.xref))
			.filter(Boolean);
		const notes = children(ind, 'NOTE').map((n) => fullText(n)).filter(Boolean);

		for (const ev of [birth, death, ...residences]) {
			if (ev?.place) placeSet.add(ev.place);
		}

		const person: Person = {
			id,
			name,
			given,
			surname,
			suffix,
			sex,
			birth,
			death,
			residences,
			events: [],
			famc,
			fams,
			parentIds: [],
			spouseIds: [],
			childIds: [],
			siblingIds: [],
			sourceIds,
			media,
			notes,
			birthYear: birth?.year ?? null,
			deathYear: death?.year ?? null,
			ageAtDeath: null,
			generation: null,
			directLine: false,
			hash: '',
		};
		people.push(person);
	}
	const personById = new Map(people.map((p) => [p.id, p]));

	// Second pass: relationships from families.
	for (const p of people) {
		// Parents + siblings via FAMC.
		if (p.famc) {
			const fam = familyById.get(p.famc);
			if (fam) {
				for (const parent of [fam.husbandId, fam.wifeId]) {
					if (parent && parent !== p.id) p.parentIds.push(parent);
				}
				for (const sib of fam.childIds) {
					if (sib !== p.id) p.siblingIds.push(sib);
				}
			}
		}
		// Spouses + children via FAMS.
		for (const fid of p.fams) {
			const fam = familyById.get(fid);
			if (!fam) continue;
			for (const spouse of [fam.husbandId, fam.wifeId]) {
				if (spouse && spouse !== p.id && !p.spouseIds.includes(spouse)) {
					p.spouseIds.push(spouse);
				}
			}
			for (const c of fam.childIds) {
				if (!p.childIds.includes(c)) p.childIds.push(c);
			}
		}
	}

	// Derived: age, events timeline, hash.
	for (const p of people) {
		if (p.birthYear != null && p.deathYear != null) {
			const age = p.deathYear - p.birthYear;
			p.ageAtDeath = age >= 0 && age <= 120 ? age : null;
		}
		const evs: LifeEvent[] = [];
		if (p.birth) evs.push(p.birth);
		evs.push(...p.residences);
		for (const fid of p.fams) {
			const fam = familyById.get(fid);
			if (fam?.marriage) evs.push(fam.marriage);
		}
		if (p.death) evs.push(p.death);
		evs.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999));
		p.events = evs;
		p.hash = contentHash(p);
	}

	// Root = the first INDI with a real name (Rob).
	const root = people.find((p) => p.name.toLowerCase().includes('rob') && p.surname === 'Lourens') ?? people[0];
	const rootId = root.id;

	// Direct line + generation: BFS up the parent graph from the root.
	const queue: Array<{ id: string; gen: number }> = [{ id: rootId, gen: 0 }];
	const seen = new Set<string>();
	while (queue.length) {
		const { id, gen } = queue.shift()!;
		if (seen.has(id)) continue;
		seen.add(id);
		const person = personById.get(id);
		if (!person) continue;
		person.directLine = true;
		person.generation = gen;
		for (const parent of person.parentIds) {
			if (!seen.has(parent)) queue.push({ id: parent, gen: gen + 1 });
		}
	}

	const places = [...placeSet].sort();

	const tree: TreeData = {
		generatedAt: new Date().toISOString(),
		rootId,
		counts: {
			people: people.length,
			families: families.length,
			sources: sources.length,
			places: places.length,
		},
		people,
		families,
		sources,
		places,
	};

	mkdirSync(dirname(OUT_PATH), { recursive: true });
	writeFileSync(OUT_PATH, JSON.stringify(tree, null, 2));

	const direct = people.filter((p) => p.directLine).length;
	console.log(`Parsed ${people.length} people, ${families.length} families, ${sources.length} sources.`);
	console.log(`Root: ${root.name} (${rootId}). Direct-line ancestors (incl. root): ${direct}.`);
	console.log(`Unique places: ${places.length}.`);
	console.log(`Wrote ${OUT_PATH}`);
}

main();
