/**
 * Geocode unique place strings from tree.json -> data/places.json.
 *
 * Uses the free OpenStreetMap Nominatim service (no API key) at build time;
 * the runtime map rendering uses Mapbox tiles separately. Results are cached so
 * re-runs only geocode places not already resolved. Includes progressive
 * fallback (dropping the most-specific leading segments) and polite rate limiting.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GeoPoint, PlacesData, TreeData } from '../shared/types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(__dirname, '..');
const TREE_PATH = resolve(ROOT_DIR, 'data/tree.json');
const PLACES_PATH = resolve(ROOT_DIR, 'data/places.json');
const OVERRIDES_PATH = resolve(ROOT_DIR, 'data/place-overrides.json');

const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const USER_AGENT = 'LourensFamilyTree/1.0 (genealogy hobby project)';
const DELAY_MS = 1100;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Normalize a raw GEDCOM place into cleaner query candidates, most-specific first. */
function candidates(raw: string): string[] {
	let s = raw
		.replace(/\bThe Netherlands\b/gi, 'Netherlands')
		.replace(/\bNederland\b/gi, 'Netherlands')
		.replace(/\bPays-Bas\b/gi, 'Netherlands')
		.replace(/\bUnited States of America\b/gi, 'USA')
		.replace(/\bFrysl[aâ]n\b/gi, 'Friesland')
		.replace(/\s*\|\s*/g, ', ')
		.replace(/\s+/g, ' ')
		.replace(/\s*,\s*/g, ', ')
		.replace(/(,\s*)+,/g, ', ')
		.replace(/^,\s*|,\s*$/g, '')
		.trim();

	const segs = s.split(',').map((x) => x.trim()).filter(Boolean);
	// Dedupe consecutive duplicate segments (e.g. "Fremont, Fremont, Dodge").
	const dedup: string[] = [];
	for (const seg of segs) {
		if (dedup[dedup.length - 1]?.toLowerCase() !== seg.toLowerCase()) dedup.push(seg);
	}

	const out: string[] = [];
	// Try full, then progressively drop the leading (most specific) segment.
	for (let i = 0; i < dedup.length; i++) {
		const candidate = dedup.slice(i).join(', ');
		if (candidate.split(',').length >= 1) out.push(candidate);
		if (dedup.length - i <= 2) break; // don't drop down to just a country if avoidable
	}
	// Always include the cleaned full string first.
	return [...new Set([dedup.join(', '), ...out])].filter(Boolean);
}

async function geocodeOne(raw: string): Promise<GeoPoint | null> {
	for (const q of candidates(raw)) {
		const url = `${NOMINATIM}?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
		try {
			const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
			if (!res.ok) {
				await sleep(DELAY_MS);
				continue;
			}
			const data = (await res.json()) as Array<{
				lat: string;
				lon: string;
				display_name: string;
			}>;
			await sleep(DELAY_MS);
			if (data.length) {
				const hit = data[0];
				const display = hit.display_name;
				const country = display.split(',').pop()?.trim();
				return {
					place: raw,
					lat: Number(hit.lat),
					lng: Number(hit.lon),
					displayName: display,
					country,
					source: 'nominatim',
				};
			}
		} catch {
			await sleep(DELAY_MS);
		}
	}
	return null;
}

/** Apply manual coordinate corrections / exclusions from place-overrides.json. */
function applyOverrides(cache: PlacesData): void {
	if (!existsSync(OVERRIDES_PATH)) return;
	const raw = JSON.parse(readFileSync(OVERRIDES_PATH, 'utf8')) as {
		overrides: Record<string, { lat: number; lng: number; displayName?: string; country?: string } | null>;
	};
	let applied = 0;
	let removed = 0;
	for (const [place, val] of Object.entries(raw.overrides)) {
		if (val === null) {
			if (place in cache.places) {
				delete cache.places[place];
				removed++;
			}
			continue;
		}
		cache.places[place] = {
			place,
			lat: val.lat,
			lng: val.lng,
			displayName: val.displayName,
			country: val.country ?? val.displayName?.split(',').pop()?.trim(),
			source: 'override',
		};
		applied++;
	}
	console.log(`Applied ${applied} place overrides, removed ${removed} excluded places.`);
}

async function main(): Promise<void> {
	const tree = JSON.parse(readFileSync(TREE_PATH, 'utf8')) as TreeData;
	const cache: PlacesData = existsSync(PLACES_PATH)
		? (JSON.parse(readFileSync(PLACES_PATH, 'utf8')) as PlacesData)
		: { generatedAt: new Date().toISOString(), places: {} };

	const todo = tree.places.filter((p) => !(p in cache.places));
	console.log(`${tree.places.length} unique places; ${todo.length} need geocoding.`);

	let resolved = 0;
	let failed = 0;
	for (let i = 0; i < todo.length; i++) {
		const place = todo[i];
		const point = await geocodeOne(place);
		if (point) {
			cache.places[place] = point;
			resolved++;
			console.log(`[${i + 1}/${todo.length}] OK   ${place} -> ${point.lat.toFixed(3)},${point.lng.toFixed(3)}`);
		} else {
			failed++;
			console.log(`[${i + 1}/${todo.length}] MISS ${place}`);
		}
		// Persist incrementally so a crash doesn't lose progress.
		if (i % 10 === 0) {
			cache.generatedAt = new Date().toISOString();
			mkdirSync(dirname(PLACES_PATH), { recursive: true });
			writeFileSync(PLACES_PATH, JSON.stringify(cache, null, 2));
		}
	}

	cache.generatedAt = new Date().toISOString();
	applyOverrides(cache);
	mkdirSync(dirname(PLACES_PATH), { recursive: true });
	writeFileSync(PLACES_PATH, JSON.stringify(cache, null, 2));
	console.log(`Done. Resolved ${resolved}, missed ${failed}. Total cached: ${Object.keys(cache.places).length}.`);
}

main();
