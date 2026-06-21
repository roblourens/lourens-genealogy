/**
 * Merge per-branch research fragments (data/enrichment-partial/*.json) into a
 * single data/enrichment.json keyed by person id. Validates that every entry
 * references a real person, and stamps each with the person's current content
 * hash so the sync step can tell when research has gone stale.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EnrichmentData, EnrichmentEntry, TreeData } from '../shared/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const TREE_PATH = resolve(ROOT_DIR, 'data/tree.json');
const PARTIAL_DIR = resolve(ROOT_DIR, 'data/enrichment-partial');
const OUT_PATH = resolve(ROOT_DIR, 'data/enrichment.json');

export function mergeEnrichment(): EnrichmentData {
	const tree = JSON.parse(readFileSync(TREE_PATH, 'utf8')) as TreeData;
	const hashById = new Map(tree.people.map((p) => [p.id, p.hash]));
	const nameById = new Map(tree.people.map((p) => [p.id, p.name]));

	const entries: Record<string, EnrichmentEntry> = {};
	let skipped = 0;

	if (existsSync(PARTIAL_DIR)) {
		const files = readdirSync(PARTIAL_DIR).filter((f) => f.endsWith('.json'));
		for (const file of files) {
			const arr = JSON.parse(readFileSync(resolve(PARTIAL_DIR, file), 'utf8')) as EnrichmentEntry[];
			for (const raw of arr) {
				if (!raw.personId || !hashById.has(raw.personId)) {
					skipped++;
					continue;
				}
				// If two fragments mention the same person, merge their fields.
				const existing = entries[raw.personId];
				const merged: EnrichmentEntry = existing ? mergeEntries(existing, raw) : { ...raw };
				merged.personName = nameById.get(raw.personId);
				merged.researchedHash = hashById.get(raw.personId);
				merged.researchedAt = merged.researchedAt ?? new Date().toISOString();
				entries[raw.personId] = merged;
			}
		}
	}

	const data: EnrichmentData = { generatedAt: new Date().toISOString(), entries };
	writeFileSync(OUT_PATH, JSON.stringify(data, null, 2));
	console.log(
		`Merged ${Object.keys(entries).length} enrichment entries${skipped ? ` (skipped ${skipped} with unknown ids)` : ''}.`,
	);
	return data;
}

function mergeEntries(a: EnrichmentEntry, b: EnrichmentEntry): EnrichmentEntry {
	const uniq = (xs?: string[], ys?: string[]) => [...new Set([...(xs ?? []), ...(ys ?? [])])];
	return {
		personId: a.personId,
		occupations: uniq(a.occupations, b.occupations),
		bio: [a.bio, b.bio].filter(Boolean).join(' '),
		funFacts: uniq(a.funFacts, b.funFacts),
		immigration: a.immigration ?? b.immigration,
		records: uniq(a.records, b.records),
		citations: [...(a.citations ?? []), ...(b.citations ?? [])],
	};
}

// Run directly.
if (import.meta.url === `file://${process.argv[1]}`) {
	mergeEnrichment();
}
