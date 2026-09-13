/**
 * Tokenisation and similarity helpers used to match specification wording
 * against file paths, symbol names and test names.
 */

/** Structural words that carry no feature meaning. */
const GENERIC_TOKENS = new Set([
	'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'use', 'using', 'via', 'per',
	'should', 'must', 'shall', 'will', 'can', 'may', 'when', 'then', 'given', 'able',
	'system', 'systems', 'service', 'services', 'module', 'modules', 'component', 'components',
	'handler', 'handlers', 'manager', 'managers', 'controller', 'controllers', 'provider',
	'util', 'utils', 'helper', 'helpers', 'impl', 'implementation', 'implementations',
	'common', 'core', 'shared', 'lib', 'libs', 'library', 'src', 'app', 'apps', 'index', 'main',
	'test', 'tests', 'spec', 'specs', 'feature', 'features', 'requirement', 'requirements',
	'function', 'functions', 'class', 'classes', 'method', 'methods', 'interface', 'interfaces',
	'get', 'set', 'run', 'make', 'new', 'base', 'default', 'file', 'files', 'code',
	'internal', 'external', 'support', 'supports', 'provide', 'provides', 'allow', 'allows'
]);

const ID_PATTERN = /\b((?:FR|NFR|SC|BR|TR|US|AC|REQ|T)[-_ ]?\d{1,4})\b/gi;

/** Splits camelCase, PascalCase, snake_case, kebab-case and paths into raw words. */
export function splitWords(value: string): string[] {
	if (!value) {
		return [];
	}
	return value
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.split(/[^A-Za-z0-9]+/)
		.filter(Boolean);
}

/** Reduces simple English plurals so `users` and `user` match. */
export function singularize(token: string): string {
	if (token.length <= 3) {
		return token;
	}
	if (token.endsWith('ies')) {
		return `${token.slice(0, -3)}y`;
	}
	if (token.endsWith('ss') || token.endsWith('us') || token.endsWith('is')) {
		return token;
	}
	if (token.endsWith('s')) {
		return token.slice(0, -1);
	}
	return token;
}

/** Meaningful, normalised tokens for matching. */
export function tokenize(value: string): string[] {
	const tokens: string[] = [];
	for (const word of splitWords(value)) {
		const lower = singularize(word.toLowerCase());
		if (lower.length < 3 && !/^\d+$/.test(lower)) {
			continue;
		}
		if (GENERIC_TOKENS.has(lower)) {
			continue;
		}
		if (/^\d+$/.test(lower)) {
			continue;
		}
		tokens.push(lower);
	}
	return tokens;
}

export function tokenSet(value: string): Set<string> {
	return new Set(tokenize(value));
}

export type WeightFn = (token: string) => number;

const EQUAL_WEIGHT: WeightFn = () => 1;

/**
 * Similarity between two token sets in the range 0..1, blending how much of the
 * smaller set is covered with overall agreement so a single shared word does
 * not produce a perfect score.
 */
export function similarity(a: Set<string>, b: Set<string>, weightFor: WeightFn = EQUAL_WEIGHT): number {
	if (a.size === 0 || b.size === 0) {
		return 0;
	}
	let sharedWeight = 0;
	let unionWeight = 0;
	const seen = new Set<string>();
	for (const token of a) {
		seen.add(token);
		unionWeight += weightFor(token);
		if (b.has(token)) {
			sharedWeight += weightFor(token);
		}
	}
	for (const token of b) {
		if (!seen.has(token)) {
			unionWeight += weightFor(token);
		}
	}
	if (sharedWeight === 0) {
		return 0;
	}
	let smallerWeight = 0;
	const smaller = a.size <= b.size ? a : b;
	for (const token of smaller) {
		smallerWeight += weightFor(token);
	}
	const coverage = smallerWeight === 0 ? 0 : sharedWeight / smallerWeight;
	const jaccard = unionWeight === 0 ? 0 : sharedWeight / unionWeight;
	return 0.6 * coverage + 0.4 * jaccard;
}

export function sharedTokens(a: Set<string>, b: Set<string>): string[] {
	const shared: string[] = [];
	for (const token of a) {
		if (b.has(token)) {
			shared.push(token);
		}
	}
	return shared;
}

/** `001-user-export` becomes `User Export`. */
export function titleFromSlug(slug: string): string {
	const withoutOrder = slug.replace(/^\d+[-_]/, '');
	const words = splitWords(withoutOrder);
	if (words.length === 0) {
		return slug;
	}
	return words.map(capitalize).join(' ');
}

export function capitalize(word: string): string {
	if (!word) {
		return word;
	}
	return word[0].toUpperCase() + word.slice(1);
}

/** Normalises `FR-014`, `fr 14` and `FR_014` to a comparable `FR-14`. */
export function normalizeRequirementId(raw: string): string {
	const match = /^([A-Za-z]+)[-_ ]?(\d+)$/.exec(raw.trim());
	if (!match) {
		return raw.trim().toUpperCase();
	}
	return `${match[1].toUpperCase()}-${String(Number(match[2]))}`;
}

export function findRequirementIds(text: string): string[] {
	const ids = new Set<string>();
	ID_PATTERN.lastIndex = 0;
	let match = ID_PATTERN.exec(text);
	while (match) {
		ids.add(normalizeRequirementId(match[1]));
		match = ID_PATTERN.exec(text);
	}
	return [...ids];
}

/** Removes markdown decoration so summaries read as plain sentences. */
export function stripMarkdown(text: string): string {
	return text
		.replace(/`{1,3}([^`]*)`{1,3}/g, '$1')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
		.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
		.replace(/^\s*#+\s*/, '')
		.replace(/^\s*[-*+]\s+/, '')
		.replace(/<[^>]+>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export function shorten(text: string, maxLength = 180): string {
	const clean = text.trim();
	if (clean.length <= maxLength) {
		return clean;
	}
	const cut = clean.slice(0, maxLength);
	const lastSpace = cut.lastIndexOf(' ');
	return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Builds a readable sentence from a list, e.g. `a, b and c`. */
export function joinReadable(items: string[]): string {
	if (items.length === 0) {
		return '';
	}
	if (items.length === 1) {
		return items[0];
	}
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}
