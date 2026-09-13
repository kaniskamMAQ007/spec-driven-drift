/** Minimal `.gitignore` support: enough for the directory walk to skip noise. */

import * as fs from 'fs/promises';
import * as path from 'path';

interface IgnoreRule {
	regex: RegExp;
	negated: boolean;
	directoryOnly: boolean;
}

export interface IgnoreMatcher {
	ignores(relPath: string, isDirectory: boolean): boolean;
}

const PASS_THROUGH: IgnoreMatcher = { ignores: () => false };

function escapeRegex(value: string): string {
	return value.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

function patternToRegex(pattern: string): RegExp {
	let body = pattern;
	const anchored = body.includes('/') && !body.endsWith('/') ? body.startsWith('/') || body.slice(0, -1).includes('/') : body.startsWith('/');
	if (body.startsWith('/')) {
		body = body.slice(1);
	}
	if (body.endsWith('/')) {
		body = body.slice(0, -1);
	}

	let source = '';
	for (let i = 0; i < body.length; i++) {
		const char = body[i];
		if (char === '*') {
			if (body[i + 1] === '*') {
				const followedBySlash = body[i + 2] === '/';
				i += followedBySlash ? 2 : 1;
				source += followedBySlash ? '(?:.*/)?' : '.*';
				continue;
			}
			source += '[^/]*';
			continue;
		}
		if (char === '?') {
			source += '[^/]';
			continue;
		}
		source += escapeRegex(char);
	}

	const prefix = anchored ? '^' : '(?:^|/)';
	return new RegExp(`${prefix}${source}(?:/.*)?$`);
}

export function parseIgnoreRules(content: string): IgnoreRule[] {
	const rules: IgnoreRule[] = [];
	for (const rawLine of content.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith('#')) {
			continue;
		}
		const negated = line.startsWith('!');
		const pattern = negated ? line.slice(1) : line;
		if (!pattern) {
			continue;
		}
		rules.push({
			regex: patternToRegex(pattern),
			negated,
			directoryOnly: pattern.endsWith('/')
		});
	}
	return rules;
}

export function createIgnoreMatcher(rules: IgnoreRule[]): IgnoreMatcher {
	if (rules.length === 0) {
		return PASS_THROUGH;
	}
	return {
		ignores(relPath: string, isDirectory: boolean): boolean {
			let ignored = false;
			for (const rule of rules) {
				if (rule.directoryOnly && !isDirectory) {
					continue;
				}
				if (rule.regex.test(relPath)) {
					ignored = !rule.negated;
				}
			}
			return ignored;
		}
	};
}

/** Loads the repository-root `.gitignore`; nested ignore files are not read. */
export async function loadIgnoreMatcher(root: string): Promise<IgnoreMatcher> {
	try {
		const content = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
		return createIgnoreMatcher(parseIgnoreRules(content));
	} catch {
		return PASS_THROUGH;
	}
}
