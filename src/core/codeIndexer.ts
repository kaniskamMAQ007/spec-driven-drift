/**
 * Builds a lightweight index of source and test files: exported symbols with
 * their line numbers, referenced requirement IDs and leading documentation.
 */

import * as path from 'path';
import { LanguageRule, SymbolKind, languageForExtension } from './languages';
import { findRequirementIds, shorten, tokenize } from './text';

export interface CodeSymbol {
	name: string;
	kind: SymbolKind;
	line: number;
	exported: boolean;
	tokens: string[];
}

export interface TestName {
	name: string;
	line: number;
}

export interface RequirementReference {
	id: string;
	line: number;
}

export interface IndexedFile {
	absPath: string;
	relPath: string;
	language: string;
	isTest: boolean;
	symbols: CodeSymbol[];
	testNames: TestName[];
	/** Requirement IDs mentioned anywhere in the file (comments, test titles). */
	requirementIds: string[];
	/** Where each referenced requirement ID first appears, for navigation. */
	requirementReferences: RequirementReference[];
	imports: string[];
	pathTokens: string[];
	symbolTokens: string[];
	/** Leading comment of the first exported symbol, used for inferred summaries. */
	docSummary: string;
	mtimeMs: number;
	lineCount: number;
}

function isCommentLine(line: string, rule: LanguageRule): boolean {
	const trimmed = line.trim();
	if (!trimmed) {
		return false;
	}
	if (rule.lineCommentPrefixes.some((prefix) => trimmed.startsWith(prefix))) {
		return true;
	}
	return rule.blockCommentDelimiters.some((delimiter) => trimmed.startsWith(delimiter));
}

function stripCommentMarkers(line: string, rule: LanguageRule): string {
	let text = line.trim();
	for (const prefix of [...rule.lineCommentPrefixes, ...rule.blockCommentDelimiters]) {
		if (text.startsWith(prefix)) {
			text = text.slice(prefix.length);
		}
	}
	return text.replace(/\*\/$/, '').replace(/^[*\s]+/, '').trim();
}

function extractDoc(lines: string[], symbolLine: number, rule: LanguageRule): string {
	// Python documents below the definition, most other languages above it.
	if (rule.id === 'python') {
		const next = lines[symbolLine + 1]?.trim() ?? '';
		const quote = next.startsWith('"""') ? '"""' : next.startsWith("'''") ? "'''" : undefined;
		if (!quote) {
			return '';
		}
		const single = next.slice(3).trim();
		if (single.endsWith(quote) && single.length > 3) {
			return single.slice(0, -3).trim();
		}
		const collected = [single];
		for (let i = symbolLine + 2; i < lines.length && i < symbolLine + 12; i++) {
			const line = lines[i].trim();
			if (line.endsWith(quote)) {
				collected.push(line.slice(0, -3).trim());
				break;
			}
			collected.push(line);
		}
		return collected.filter(Boolean).join(' ').trim();
	}

	const collected: string[] = [];
	for (let i = symbolLine - 1; i >= 0 && i >= symbolLine - 12; i--) {
		const line = lines[i];
		if (!line.trim()) {
			if (collected.length > 0) {
				break;
			}
			continue;
		}
		if (!isCommentLine(line, rule)) {
			break;
		}
		const text = stripCommentMarkers(line, rule);
		if (text) {
			collected.unshift(text);
		}
	}
	return collected.join(' ').trim();
}

export function indexCodeContent(
	absPath: string,
	relPath: string,
	content: string,
	isTest: boolean,
	mtimeMs = 0
): IndexedFile {
	const rule = languageForExtension(path.extname(relPath));
	const lines = content.split(/\r?\n/);
	const symbols: CodeSymbol[] = [];
	const testNames: TestName[] = [];
	const imports: string[] = [];
	const seenSymbols = new Set<string>();
	const requirementReferences: RequirementReference[] = [];
	const seenRequirementIds = new Set<string>();

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (!line.trim()) {
			continue;
		}

		for (const id of findRequirementIds(line)) {
			if (!/^T-/.test(id) && !seenRequirementIds.has(id)) {
				seenRequirementIds.add(id);
				requirementReferences.push({ id, line: i });
			}
		}

		for (const pattern of rule.importPatterns) {
			const match = pattern.exec(line);
			if (match) {
				const value = match[1] ?? match[2];
				if (value) {
					imports.push(value.trim());
				}
				break;
			}
		}

		for (const pattern of rule.symbolPatterns) {
			const match = pattern.regex.exec(line);
			if (!match) {
				continue;
			}
			const name = match[1];
			if (!name) {
				break;
			}
			const key = `${name}:${i}`;
			if (seenSymbols.has(key)) {
				break;
			}
			seenSymbols.add(key);
			const exported =
				pattern.exported === 'auto' ? (rule.isExported?.(name, line) ?? true) : pattern.exported;
			symbols.push({ name, kind: pattern.kind, line: i, exported, tokens: tokenize(name) });
			break;
		}

		if (isTest) {
			for (const pattern of rule.testNamePatterns) {
				const match = pattern.exec(line);
				if (match) {
					const name = (match[2] ?? match[1] ?? '').trim();
					if (name) {
						testNames.push({ name, line: i });
					}
					break;
				}
			}
		}
	}

	const firstExported = symbols.find((symbol) => symbol.exported) ?? symbols[0];
	const docSummary = firstExported ? shorten(extractDoc(lines, firstExported.line, rule), 200) : '';

	const symbolTokens = new Set<string>();
	for (const symbol of symbols) {
		if (!symbol.exported && symbols.some((other) => other.exported)) {
			continue;
		}
		for (const token of symbol.tokens) {
			symbolTokens.add(token);
		}
	}

	const fileNameTokens = tokenize(path.basename(relPath, path.extname(relPath)));
	const pathTokens = new Set([...tokenize(relPath), ...fileNameTokens]);

	return {
		absPath,
		relPath,
		language: rule.id,
		isTest,
		symbols,
		testNames,
		requirementIds: [...seenRequirementIds],
		requirementReferences,
		imports,
		pathTokens: [...pathTokens],
		symbolTokens: [...symbolTokens],
		docSummary,
		mtimeMs,
		lineCount: lines.length
	};
}

/** Best line to open for a file, preferring a named symbol over line 1. */
export function primarySymbol(file: IndexedFile, preferredTokens?: Set<string>): CodeSymbol | undefined {
	const exported = file.symbols.filter((symbol) => symbol.exported);
	const pool = exported.length > 0 ? exported : file.symbols;
	if (pool.length === 0) {
		return undefined;
	}
	if (!preferredTokens || preferredTokens.size === 0) {
		return pool[0];
	}
	let best = pool[0];
	let bestScore = -1;
	for (const symbol of pool) {
		const score = symbol.tokens.filter((token) => preferredTokens.has(token)).length;
		if (score > bestScore) {
			best = symbol;
			bestScore = score;
		}
	}
	return best;
}
