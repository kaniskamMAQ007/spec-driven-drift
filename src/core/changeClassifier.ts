/**
 * Decides whether a code change plausibly changed the behaviour a requirement
 * describes, or only how that behaviour is implemented.
 *
 * This is the guard against the classic false positive: rewriting an in-memory
 * sort as `ORDER BY created_at ASC` changes the code but not the promise the
 * specification makes.
 */

import { LanguageRule, languageForExtension } from './languages';
import { tokenize } from './text';

export type ChangeKind = 'none' | 'formattingOnly' | 'unrelated' | 'implementationOnly' | 'behavioral';

export interface ChangeClassification {
	kind: ChangeKind;
	/** Plain-English reason, safe to show to a developer. */
	reason: string;
	/** Requirement wording that survived the change. */
	preservedConcepts: string[];
	/** Requirement values that disappeared from the code. */
	changedValues: string[];
}

export interface ClassifyInput {
	added: string[];
	removed: string[];
	/** File extension or language id used to recognise comments and logging. */
	fileExtension?: string;
	requirementTokens?: string[];
	requirementLiterals?: string[];
}

function normalize(line: string): string {
	return line.replace(/\s+/g, ' ').trim().replace(/[;,]$/, '');
}

function isIgnorableLine(line: string, rule: LanguageRule): boolean {
	const trimmed = line.trim();
	if (!trimmed) {
		return true;
	}
	if (rule.lineCommentPrefixes.some((prefix) => trimmed.startsWith(prefix))) {
		return true;
	}
	if (rule.blockCommentDelimiters.some((delimiter) => trimmed.startsWith(delimiter))) {
		return true;
	}
	if (/^[)}\]{(]+$/.test(trimmed)) {
		return true;
	}
	if (rule.importPatterns.some((pattern) => pattern.test(line))) {
		return true;
	}
	return rule.logPatterns.some((pattern) => pattern.test(line));
}

function multisetEquals(a: string[], b: string[]): boolean {
	if (a.length !== b.length) {
		return false;
	}
	const counts = new Map<string, number>();
	for (const value of a) {
		counts.set(value, (counts.get(value) ?? 0) + 1);
	}
	for (const value of b) {
		const count = counts.get(value);
		if (!count) {
			return false;
		}
		counts.set(value, count - 1);
	}
	return true;
}

function literalPresent(literal: string, lines: string[]): boolean {
	const needle = literal.toLowerCase().replace(/\s+/g, '');
	return lines.some((line) => line.toLowerCase().replace(/\s+/g, '').includes(needle));
}

const OPERATOR_PATTERN = /===|!==|==|!=|<=|>=|&&|\|\||=>|[<>]/g;
const NUMBER_PATTERN = /\b\d+(?:\.\d+)?\b/g;
const VALUE_PATTERN = /\b(?:true|false|null|none|nil|undefined)\b/gi;

/**
 * Comparisons and literal values decide behaviour but disappear when a line is
 * reduced to words, so they are compared separately.
 */
function behaviourSignature(lines: string[]): string {
	const text = lines.join('\n');
	const parts: string[] = [];
	const collect = (pattern: RegExp, prefix: string): void => {
		pattern.lastIndex = 0;
		let match = pattern.exec(text);
		while (match) {
			if (match[0] !== '=>') {
				parts.push(prefix + match[0].toLowerCase());
			}
			match = pattern.exec(text);
		}
	};
	collect(OPERATOR_PATTERN, 'op:');
	collect(NUMBER_PATTERN, 'num:');
	collect(VALUE_PATTERN, 'val:');
	return parts.sort().join(' ');
}

export function classifyChangedLines(input: ClassifyInput): ChangeClassification {
	const rule = languageForExtension(input.fileExtension ?? '');
	const addedRaw = input.added ?? [];
	const removedRaw = input.removed ?? [];

	if (addedRaw.length === 0 && removedRaw.length === 0) {
		return { kind: 'none', reason: 'The code did not change.', preservedConcepts: [], changedValues: [] };
	}

	const added = addedRaw.filter((line) => !isIgnorableLine(line, rule)).map(normalize).filter(Boolean);
	const removed = removedRaw.filter((line) => !isIgnorableLine(line, rule)).map(normalize).filter(Boolean);

	if (added.length === 0 && removed.length === 0) {
		return {
			kind: 'formattingOnly',
			reason: 'Only comments, imports or logging changed.',
			preservedConcepts: [],
			changedValues: []
		};
	}

	if (multisetEquals(added, removed)) {
		return {
			kind: 'formattingOnly',
			reason: 'The same code was reformatted or moved.',
			preservedConcepts: [],
			changedValues: []
		};
	}

	const requirementTokens = new Set(input.requirementTokens ?? []);
	const requirementLiterals = input.requirementLiterals ?? [];

	// A value the specification commits to disappeared from the code.
	const changedValues = requirementLiterals.filter(
		(literal) => literalPresent(literal, removed) && !literalPresent(literal, added)
	);
	if (changedValues.length > 0) {
		return {
			kind: 'behavioral',
			reason: 'A value described by the specification was changed in the code.',
			preservedConcepts: [],
			changedValues
		};
	}

	if (requirementTokens.size > 0) {
		const removedTokens = new Set(removed.flatMap((line) => tokenize(line)));
		const addedTokens = new Set(added.flatMap((line) => tokenize(line)));
		const touchesRequirement = [...requirementTokens].some(
			(token) => removedTokens.has(token) || addedTokens.has(token)
		);
		if (!touchesRequirement) {
			return {
				kind: 'unrelated',
				reason: 'The change does not appear to touch what this part of the specification describes.',
				preservedConcepts: [],
				changedValues: []
			};
		}

		const conceptsInRemoved = [...requirementTokens].filter((token) => removedTokens.has(token));
		const stillPresent = conceptsInRemoved.filter((token) => addedTokens.has(token));

		if (behaviourSignature(removed) !== behaviourSignature(added)) {
			return {
				kind: 'behavioral',
				reason: 'A condition or value in this code changed.',
				preservedConcepts: [],
				changedValues: []
			};
		}

		if (conceptsInRemoved.length > 0 && stillPresent.length === conceptsInRemoved.length) {
			return {
				kind: 'implementationOnly',
				reason: 'The code was rewritten but still does what the specification describes.',
				preservedConcepts: stillPresent,
				changedValues: []
			};
		}
	}

	return {
		kind: 'behavioral',
		reason: 'The change affects what this part of the code does.',
		preservedConcepts: [],
		changedValues: []
	};
}
