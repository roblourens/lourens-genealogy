// Shared data-model types used by both the pipeline tools and the website.

export type Sex = 'M' | 'F' | 'U';

export type LifeEventType = 'birth' | 'death' | 'residence' | 'marriage';

export interface LifeEvent {
	type: LifeEventType;
	/** Raw GEDCOM date string, e.g. "23 Jan 1919", "abt 1913". */
	date?: string;
	/** Parsed 4-digit year if one could be extracted. */
	year?: number | null;
	/** Raw place string from the GEDCOM. */
	place?: string;
	note?: string;
	sourceIds?: string[];
}

export interface MediaRef {
	oid?: string;
	title?: string;
	place?: string;
	form?: string;
}

export interface Person {
	/** Stable Ancestry xref id (without surrounding @), e.g. "I272780690463". */
	id: string;
	name: string;
	given?: string;
	surname?: string;
	suffix?: string;
	sex: Sex;
	birth?: LifeEvent;
	death?: LifeEvent;
	residences: LifeEvent[];
	/** All events sorted chronologically (birth, residences, marriage, death). */
	events: LifeEvent[];
	/** Family id where this person appears as a child. */
	famc?: string;
	/** Family ids where this person appears as a spouse. */
	fams: string[];
	parentIds: string[];
	spouseIds: string[];
	childIds: string[];
	siblingIds: string[];
	sourceIds: string[];
	media: MediaRef[];
	notes: string[];
	// Derived
	birthYear?: number | null;
	deathYear?: number | null;
	ageAtDeath?: number | null;
	/** Generation distance up the direct line from the root (0 = root). */
	generation?: number | null;
	/** True if this person is the root or a direct ancestor of the root. */
	directLine: boolean;
	/** SHA-256 content hash of canonical facts; drives incremental re-research. */
	hash: string;
}

export interface Family {
	id: string;
	husbandId?: string;
	wifeId?: string;
	childIds: string[];
	marriage?: LifeEvent;
}

export interface SourceRecord {
	id: string;
	title?: string;
	author?: string;
	publication?: string;
}

export interface TreeData {
	generatedAt: string;
	rootId: string;
	counts: { people: number; families: number; sources: number; places: number };
	people: Person[];
	families: Family[];
	sources: SourceRecord[];
	/** Unique place strings referenced anywhere in the tree. */
	places: string[];
}

// ---- Geocoding ----

export interface GeoPoint {
	place: string;
	lat: number;
	lng: number;
	/** Normalized full place name returned by the geocoder. */
	displayName?: string;
	country?: string;
	source?: string;
}

export interface PlacesData {
	generatedAt: string;
	places: Record<string, GeoPoint>;
}

// ---- Enrichment (research layer, additive, keyed by person id) ----

export interface Citation {
	label: string;
	url?: string;
}

export interface EnrichmentEntry {
	personId: string;
	personName?: string;
	/** Free-form occupation(s) discovered through research. */
	occupations?: string[];
	/** Short researched biography paragraph(s). */
	bio?: string;
	/** Bullet fun facts. */
	funFacts?: string[];
	/** Immigration / migration notes. */
	immigration?: string;
	/** Census or record findings. */
	records?: string[];
	citations?: Citation[];
	/** Hash of the person at the time research was done (change detection). */
	researchedHash?: string;
	researchedAt?: string;
}

export interface EnrichmentData {
	generatedAt: string;
	entries: Record<string, EnrichmentEntry>;
}

// ---- Famous-person connections ----

export type ConnectionConfidence = 'confirmed' | 'plausible' | 'speculative';

export interface Connection {
	id: string;
	surname: string;
	famousPerson: string;
	famousDescription: string;
	/** Family member(s) the connection runs through (person ids). */
	relatedPersonIds: string[];
	confidence: ConnectionConfidence;
	reasoning: string;
	citations?: Citation[];
}

export interface ConnectionsData {
	generatedAt: string;
	connections: Connection[];
}

// ---- Sync state ----

export interface SyncState {
	generatedAt: string;
	/** Map of person id -> last-seen content hash. */
	hashes: Record<string, string>;
}
