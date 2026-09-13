/**
 * Links specifications to implementation and tests.
 *
 * Deterministic signals first (requirement IDs in code, task lists, explicit
 * paths in the spec), then name-based similarity. Nothing here needs a model;
 * a semantic pass can later re-rank only the weak matches.
 */

import * as path from 'path';
import { IndexedFile, primarySymbol } from './codeIndexer';
import { ParsedSpec, ParsedRequirement } from './specParser';
import { joinReadable, shorten, similarity, titleFromSlug, tokenize } from './text';
import { Confidence } from './types';

/** Score thresholds tuned against the fixture projects in `test-fixtures`. */
export const SCORE_STRONG = 75;
export const SCORE_MEDIUM = 45;
export const SCORE_WEAK = 28;

export interface SpecGroup {
	featureKey: string;
	featureName: string;
	featureSlug: string;
	summary: string;
	documents: ParsedSpec[];
	primaryDocument: ParsedSpec;
}

export interface FileMatch {
	file: IndexedFile;
	score: number;
	line: number;
	label?: string;
	evidence: string[];
}

export interface SpecFeatureMatch {
	id: string;
	group: SpecGroup;
	document: ParsedSpec;
	requirement: ParsedRequirement;
	implementations: FileMatch[];
	tests: FileMatch[];
	confidence: Confidence;
	evidence: string[];
}

export interface CodeCluster {
	id: string;
	directory: string;
	name: string;
	summary: string;
	files: IndexedFile[];
	primaryFile: IndexedFile;
	primaryLine: number;
	primaryLabel?: string;
}

export interface MatchResult {
	groups: SpecGroup[];
	matches: SpecFeatureMatch[];
	clusters: CodeCluster[];
}

/** File names that are wiring rather than product behaviour. */
const INFRASTRUCTURE_BASENAMES = new Set([
	'index', 'main', '__init__', 'types', 'type', 'constants', 'const', 'config', 'configuration',
	'settings', 'setup', 'program', 'startup', 'module', 'bootstrap', 'polyfills', 'globals',
	'interfaces', 'models', 'dto', 'enums', 'errors', 'logger', 'di', 'container'
]);

/** Folder names that describe layout rather than a feature. */
const GENERIC_DIRECTORY_NAMES = new Set([
	'src', 'lib', 'libs', 'app', 'apps', 'core', 'source', 'sources', 'code', 'main', 'packages',
	'modules', 'internal', 'pkg', 'server', 'client', 'common', 'shared', 'utils', 'helpers'
]);

function buildWeightFn(files: IndexedFile[]): (token: string) => number {
	const documentFrequency = new Map<string, number>();
	for (const file of files) {
		const tokens = new Set([...file.pathTokens, ...file.symbolTokens]);
		for (const token of tokens) {
			documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
		}
	}
	const total = Math.max(files.length, 1);
	return (token: string) => {
		const df = documentFrequency.get(token) ?? 0;
		const weight = Math.log2((total + 1) / (df + 1));
		return Math.max(0.25, Math.min(2, weight));
	};
}

function normalizeReference(reference: string): string {
	return reference.replace(/^\.\//, '').replace(/^\//, '').toLowerCase();
}

/** True when a path written in a spec or task refers to this file. */
export function referenceMatchesFile(reference: string, relPath: string): boolean {
	const ref = normalizeReference(reference);
	const target = relPath.toLowerCase();
	if (!ref || ref.length < 3) {
		return false;
	}
	if (ref === target || target.endsWith(`/${ref}`) || ref.endsWith(`/${target}`)) {
		return true;
	}
	const refBase = ref.slice(ref.lastIndexOf('/') + 1);
	const targetBase = target.slice(target.lastIndexOf('/') + 1);
	if (refBase !== targetBase) {
		return false;
	}
	// Same file name: require a shared directory segment to avoid false links.
	const refDirs = new Set(ref.split('/').slice(0, -1));
	if (refDirs.size === 0) {
		return true;
	}
	return target.split('/').slice(0, -1).some((segment) => refDirs.has(segment));
}

export function buildSpecGroups(specs: ParsedSpec[]): SpecGroup[] {
	const byKey = new Map<string, ParsedSpec[]>();
	for (const spec of specs) {
		if (spec.kind === 'constitution') {
			continue; // Project principles, not a feature.
		}
		const documents = byKey.get(spec.featureKey) ?? [];
		documents.push(spec);
		byKey.set(spec.featureKey, documents);
	}

	const groups: SpecGroup[] = [];
	for (const [featureKey, documents] of byKey) {
		const primary =
			documents.find((doc) => doc.kind === 'spec') ??
			documents.find((doc) => doc.kind === 'other') ??
			documents.find((doc) => doc.kind === 'plan') ??
			documents[0];
		groups.push({
			featureKey,
			featureName: primary.featureName,
			featureSlug: primary.featureSlug,
			summary: primary.summary,
			documents,
			primaryDocument: primary
		});
	}
	groups.sort((a, b) => a.featureName.localeCompare(b.featureName));
	return groups;
}

interface ScoreContext {
	group: SpecGroup;
	requirement: ParsedRequirement;
	requirementTokens: Set<string>;
	groupTokens: Set<string>;
	weightFor: (token: string) => number;
}

function scoreFile(file: IndexedFile, context: ScoreContext): FileMatch | undefined {
	const { group, requirement, requirementTokens, groupTokens, weightFor } = context;
	const evidence: string[] = [];
	let score = 0;
	let line: number | undefined;
	let label: string | undefined;

	const normalizedId = requirement.normalizedId;
	if (normalizedId) {
		const reference = file.requirementReferences.find((item) => item.id === normalizedId);
		if (reference) {
			score += 100;
			line = reference.line;
			label = requirement.id ?? normalizedId;
			evidence.push(`${requirement.id ?? normalizedId} is mentioned in ${path.basename(file.relPath)}.`);
		}
	}

	for (const document of group.documents) {
		for (const task of document.tasks) {
			if (!task.paths.some((taskPath) => referenceMatchesFile(taskPath, file.relPath))) {
				continue;
			}
			const linkedById = Boolean(normalizedId && task.requirementIds.includes(normalizedId));
			const linkedByWords = similarity(new Set(tokenize(task.text)), requirementTokens, weightFor) >= 0.45;
			if (linkedById) {
				score += 95;
				evidence.push(`The task list links this file to ${requirement.id ?? 'this requirement'}.`);
			} else if (linkedByWords) {
				score += 55;
				evidence.push(`A task for this feature points to ${path.basename(file.relPath)}.`);
			}
		}

		for (const reference of document.referencedPaths) {
			if (!referenceMatchesFile(reference.path, file.relPath)) {
				continue;
			}
			const insideRequirement =
				document === context.group.primaryDocument &&
				reference.line >= requirement.line &&
				reference.line <= requirement.endLine;
			score += insideRequirement ? 85 : 60;
			evidence.push(
				insideRequirement
					? `The requirement text names ${path.basename(file.relPath)}.`
					: `${document.relPath} names ${path.basename(file.relPath)}.`
			);
			break;
		}
	}

	const pathScore = similarity(requirementTokens, new Set(file.pathTokens), weightFor);
	if (pathScore > 0) {
		score += 45 * pathScore;
	}

	let bestSymbolScore = 0;
	let bestSymbol = primarySymbol(file, requirementTokens);
	for (const symbol of file.symbols) {
		const symbolScore = similarity(requirementTokens, new Set(symbol.tokens), weightFor) + (symbol.exported ? 0.05 : 0);
		if (symbolScore > bestSymbolScore) {
			bestSymbolScore = symbolScore;
			bestSymbol = symbol;
		}
	}
	if (bestSymbolScore > 0) {
		score += 45 * Math.min(bestSymbolScore, 1);
	}

	const directorySegments = new Set(tokenize(path.dirname(file.relPath)));
	if (groupTokens.size > 0 && [...groupTokens].every((token) => directorySegments.has(token))) {
		score += 18;
		evidence.push(`It lives in a folder named after ${group.featureName}.`);
	}

	if (score < SCORE_WEAK) {
		return undefined;
	}

	if (line === undefined) {
		if (file.isTest) {
			let bestTest = file.testNames[0];
			let bestTestScore = 0;
			for (const testName of file.testNames) {
				const testScore = similarity(requirementTokens, new Set(tokenize(testName.name)), weightFor);
				if (testScore > bestTestScore) {
					bestTestScore = testScore;
					bestTest = testName;
				}
			}
			if (bestTest) {
				line = bestTest.line;
				label = bestTest.name;
			}
		}
		if (line === undefined && bestSymbol) {
			line = bestSymbol.line;
			label = bestSymbol.name;
		}
	}

	if (evidence.length === 0 && (pathScore > 0 || bestSymbolScore > 0)) {
		evidence.push(`The names in ${path.basename(file.relPath)} match the wording of this requirement.`);
	}

	return { file, score, line: line ?? 0, label, evidence };
}

function confidenceFor(bestScore: number): Confidence {
	if (bestScore >= SCORE_STRONG) {
		return 'high';
	}
	if (bestScore >= SCORE_MEDIUM) {
		return 'medium';
	}
	return 'low';
}

function selectMatches(candidates: FileMatch[]): { matches: FileMatch[]; confidence: Confidence } {
	if (candidates.length === 0) {
		return { matches: [], confidence: 'low' };
	}
	const sorted = [...candidates].sort((a, b) => b.score - a.score);
	const best = sorted[0].score;
	const confidence = confidenceFor(best);
	const cutoff = confidence === 'high' ? Math.max(SCORE_MEDIUM, best * 0.6) : confidence === 'medium' ? SCORE_MEDIUM : SCORE_WEAK;
	const limit = confidence === 'low' ? 3 : 6;
	return { matches: sorted.filter((match) => match.score >= cutoff).slice(0, limit), confidence };
}

export function matchFeatures(specs: ParsedSpec[], files: IndexedFile[]): MatchResult {
	const groups = buildSpecGroups(specs);
	const sourceFiles = files.filter((file) => !file.isTest);
	const testFiles = files.filter((file) => file.isTest);
	const weightFor = buildWeightFn(files);

	const matches: SpecFeatureMatch[] = [];
	const consideredFiles = new Set<string>();

	for (const group of groups) {
		const groupTokens = new Set(tokenize(`${group.featureName} ${group.featureSlug}`));
		const requirementDocuments = group.documents.filter((doc) => doc.kind === 'spec' || doc.kind === 'other');
		const documents = requirementDocuments.length > 0 ? requirementDocuments : [group.primaryDocument];

		for (const document of documents) {
			for (const requirement of document.requirements) {
				const requirementTokens = new Set([
					...requirement.tokens,
					...(requirement.implicit ? groupTokens : [])
				]);
				const context: ScoreContext = { group, requirement, requirementTokens, groupTokens, weightFor };

				const implementationCandidates: FileMatch[] = [];
				for (const file of sourceFiles) {
					const match = scoreFile(file, context);
					if (match) {
						implementationCandidates.push(match);
					}
				}
				const { matches: implementations, confidence } = selectMatches(implementationCandidates);

				const implementationBasenames = new Set(
					implementations.map((match) => path.basename(match.file.relPath).replace(/\.\w+$/, '').toLowerCase())
				);
				const testCandidates: FileMatch[] = [];
				for (const file of testFiles) {
					const match = scoreFile(file, context);
					const testBase = path
						.basename(file.relPath)
						.replace(/\.(test|spec)\.\w+$/, '')
						.replace(/\.\w+$/, '')
						.replace(/^test_/, '')
						.toLowerCase();
					if (match && implementationBasenames.has(testBase)) {
						match.score += 70;
						match.evidence.push('It tests the file linked to this feature.');
					}
					if (match) {
						testCandidates.push(match);
					}
				}
				const { matches: tests } = selectMatches(testCandidates);

				for (const match of [...implementationCandidates, ...testCandidates]) {
					consideredFiles.add(match.file.relPath);
				}

				const evidence = [...new Set(implementations.flatMap((match) => match.evidence))].slice(0, 4);
				matches.push({
					id: `${document.relPath}#${requirement.normalizedId ?? requirement.line}`,
					group,
					document,
					requirement,
					implementations,
					tests,
					confidence: implementations.length === 0 ? 'high' : confidence,
					evidence
				});
			}
		}
	}

	const clusters = buildCodeClusters(sourceFiles, consideredFiles);
	return { groups, matches, clusters };
}

/** Groups source files that no specification appears to describe. */
export function buildCodeClusters(sourceFiles: IndexedFile[], consideredFiles: Set<string>): CodeCluster[] {
	const byDirectory = new Map<string, IndexedFile[]>();

	for (const file of sourceFiles) {
		if (consideredFiles.has(file.relPath)) {
			continue;
		}
		const basename = path.basename(file.relPath).replace(/\.\w+$/, '').toLowerCase();
		if (INFRASTRUCTURE_BASENAMES.has(basename)) {
			continue;
		}
		if (!file.symbols.some((symbol) => symbol.exported)) {
			continue;
		}
		const directory = path.dirname(file.relPath);
		const group = byDirectory.get(directory) ?? [];
		group.push(file);
		byDirectory.set(directory, group);
	}

	const clusters: CodeCluster[] = [];
	for (const [directory, clusterFiles] of byDirectory) {
		const sorted = [...clusterFiles].sort(
			(a, b) => b.symbols.filter((symbol) => symbol.exported).length - a.symbols.filter((symbol) => symbol.exported).length
		);
		const primaryFile = sorted[0];
		const symbol = primarySymbol(primaryFile);
		const directoryName = directory === '.' ? '' : path.basename(directory);
		const directoryIsGeneric = !directoryName || GENERIC_DIRECTORY_NAMES.has(directoryName.toLowerCase());
		const name =
			clusterFiles.length > 1 && !directoryIsGeneric
				? titleFromSlug(directoryName)
				: titleFromSlug(path.basename(primaryFile.relPath).replace(/\.\w+$/, ''));

		const exportedNames = sorted
			.flatMap((file) => file.symbols.filter((item) => item.exported).map((item) => item.name))
			.slice(0, 4);
		const summary = primaryFile.docSummary
			? primaryFile.docSummary
			: exportedNames.length > 0
				? `This code defines ${joinReadable(exportedNames)}.`
				: `This code has no matching specification.`;

		clusters.push({
			id: `code:${directory}`,
			directory,
			name,
			summary: shorten(summary, 200),
			files: sorted,
			primaryFile,
			primaryLine: symbol?.line ?? 0,
			primaryLabel: symbol?.name
		});
	}

	clusters.sort((a, b) => b.files.length - a.files.length || a.directory.localeCompare(b.directory));
	return clusters.slice(0, 25);
}
