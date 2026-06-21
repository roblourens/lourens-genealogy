import type { LifeEvent, Person } from '../../shared/types';
import { BRANCHES, type AppData, type BranchKey } from './data';

export function branchColor(key: BranchKey | undefined): string {
	return BRANCHES[key ?? 'root'].color;
}

/** "1919–2009", "b. 1919", "1808–?" or "" when nothing is known. */
export function lifespanLabel(p: Person): string {
	const b = p.birthYear ?? null;
	const d = p.deathYear ?? null;
	if (b && d) return `${b}\u2013${d}`;
	if (b && !d) return `b. ${b}`;
	if (!b && d) return `d. ${d}`;
	return '';
}

export function ageLabel(p: Person): string | null {
	if (p.ageAtDeath != null) return `${p.ageAtDeath} years`;
	return null;
}

/** Tidy a raw GEDCOM date string for display. */
export function formatDate(date?: string): string {
	if (!date) return '';
	return date
		.replace(/\babt\b/i, 'c.')
		.replace(/\bbef\b/i, 'before')
		.replace(/\baft\b/i, 'after')
		.replace(/\bcal\b/i, 'c.')
		.trim();
}

export function eventVerb(ev: LifeEvent): string {
	switch (ev.type) {
		case 'birth':
			return 'Born';
		case 'death':
			return 'Died';
		case 'marriage':
			return 'Married';
		case 'residence':
			return 'Lived';
	}
}

/** Short place: keep the two most-significant comma segments. */
export function shortPlace(place?: string): string {
	if (!place) return '';
	const segs = place
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	if (segs.length <= 2) return segs.join(', ');
	return `${segs[0]}, ${segs[segs.length - 1]}`;
}

/**
 * Place strings that only resolve to a whole state or country centroid. They are not real
 * locations, so we avoid anchoring a person there when a more specific event place exists.
 */
const VAGUE_PLACES = new Set([
	'nebraska',
	'iowa',
	'iowa?',
	'illinois',
	'indiana',
	'missouri',
	'kansas',
	'michigan',
	'ohio',
	'minnesota',
	'wisconsin',
	'california',
	'germany',
	'deutschland',
	'germany, allemagne',
	'allemagne',
	'netherlands',
	'nederland',
	'the netherlands',
	'holland',
	'pays-bas',
	'prussia',
	'preussen',
	'pruisen',
	'usa',
	'united states',
	'united states of america',
	'america',
]);

/** True when a raw place string only pins to a state/country centroid. */
export function isVaguePlace(place: string | undefined | null): boolean {
	return !!place && VAGUE_PLACES.has(place.trim().toLowerCase());
}

export function firstPlacePoint(
	data: AppData,
	person: Person,
	prefer: LifeEvent['type'][] = ['birth', 'residence', 'death'],
): { lat: number; lng: number; place: string } | null {
	// Two passes: first honour the preference order but skip vague state/country centroids,
	// then fall back to allowing them so people whose only place is "Germany" still appear.
	for (const allowVague of [false, true]) {
		for (const type of prefer) {
			for (const ev of person.events) {
				if (ev.type !== type || !ev.place) continue;
				if (!allowVague && isVaguePlace(ev.place)) continue;
				const pt = data.places[ev.place];
				if (pt) return { lat: pt.lat, lng: pt.lng, place: ev.place };
			}
		}
		// Any event with a known point (still respecting the vague gate).
		for (const ev of person.events) {
			if (!ev.place) continue;
			if (!allowVague && isVaguePlace(ev.place)) continue;
			const pt = data.places[ev.place];
			if (pt) return { lat: pt.lat, lng: pt.lng, place: ev.place };
		}
	}
	return null;
}

export function escapeHtml(s: string): string {
	return s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

