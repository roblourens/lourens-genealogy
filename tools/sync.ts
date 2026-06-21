/**
 * Incremental re-import pipeline.
 *
 * Run this after replacing `Lourens Family Tree.ged` with an updated export.
 * It re-parses the GEDCOM, geocodes any new places, re-merges research, then
 * diffs the new tree against the last sync to report which people are NEW,
 * CHANGED, or have STALE research — i.e. exactly who needs (re)researching.
 * Existing research for unchanged people is preserved untouched.
 *
 *   npm run sync
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EnrichmentData, SyncState, TreeData } from '../shared/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const TREE_PATH = resolve(ROOT_DIR, 'data/tree.json');
const STATE_PATH = resolve(ROOT_DIR, 'data/sync-state.json');
const ENRICH_PATH = resolve(ROOT_DIR, 'data/enrichment.json');
const QUEUE_PATH = resolve(ROOT_DIR, 'data/research-queue.json');

function run(cmd: string): void {
	console.log(`\n$ ${cmd}`);
	execSync(cmd, { cwd: ROOT_DIR, stdio: 'inherit' });
}

function loadState(): SyncState {
	if (!existsSync(STATE_PATH)) return { generatedAt: '', hashes: {} };
	return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as SyncState;
}

function main(): void {
	const prev = loadState();

	// 1. Re-run the pipeline stages.
	run('tsx tools/parse-gedcom.ts');
	run('tsx tools/geocode.ts');
	run('tsx tools/merge-enrichment.ts');

	// 2. Diff the freshly parsed tree against the previous sync.
	const tree = JSON.parse(readFileSync(TREE_PATH, 'utf8')) as TreeData;
	const enrichment = existsSync(ENRICH_PATH)
		? (JSON.parse(readFileSync(ENRICH_PATH, 'utf8')) as EnrichmentData)
		: { generatedAt: '', entries: {} };

	const currentHashes: Record<string, string> = {};
	const added: string[] = [];
	const changed: string[] = [];
	for (const p of tree.people) {
		currentHashes[p.id] = p.hash;
		if (!(p.id in prev.hashes)) added.push(p.id);
		else if (prev.hashes[p.id] !== p.hash) changed.push(p.id);
	}
	const removed = Object.keys(prev.hashes).filter((id) => !(id in currentHashes));

	// Research is stale when a researched person's facts changed since research.
	const stale = Object.values(enrichment.entries)
		.filter((e) => e.researchedHash && currentHashes[e.personId] && e.researchedHash !== currentHashes[e.personId])
		.map((e) => e.personId);

	// People that should be (re)researched: new + changed + stale, minus removed.
	const needResearch = [...new Set([...added, ...changed, ...stale])].filter((id) => id in currentHashes);
	const nameOf = (id: string) => tree.people.find((p) => p.id === id)?.name ?? id;

	const queue = {
		generatedAt: new Date().toISOString(),
		added: added.map((id) => ({ id, name: nameOf(id) })),
		changed: changed.map((id) => ({ id, name: nameOf(id) })),
		removed,
		stale: stale.map((id) => ({ id, name: nameOf(id) })),
		needResearch: needResearch.map((id) => ({ id, name: nameOf(id), hasResearch: id in enrichment.entries })),
	};
	mkdirSync(dirname(QUEUE_PATH), { recursive: true });
	writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));

	// 3. Persist the new state.
	const state: SyncState = { generatedAt: new Date().toISOString(), hashes: currentHashes };
	writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

	// 4. Report.
	const first = !prev.generatedAt;
	console.log('\n──────────────────────────────────────────');
	console.log(first ? 'Initial sync complete.' : 'Re-import sync complete.');
	console.log(`People: ${tree.people.length} | Added: ${added.length} | Changed: ${changed.length} | Removed: ${removed.length} | Stale research: ${stale.length}`);
	if (!first && needResearch.length) {
		console.log(`\n${needResearch.length} people need (re)research:`);
		for (const id of needResearch) console.log(`  - [${id}] ${nameOf(id)}`);
		console.log(`\nWrote queue -> ${QUEUE_PATH}`);
		console.log('Next: dispatch research for these ids, drop fragments into data/enrichment-partial/, then run `npm run merge`.');
	} else if (first) {
		console.log('Baseline recorded. Future re-imports will list only new/changed people here.');
	} else {
		console.log('Everything is up to date — no new research needed.');
	}
	console.log('──────────────────────────────────────────');
}

main();
