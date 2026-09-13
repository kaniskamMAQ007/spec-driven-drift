/**
 * Orchestrates a full analysis: scan, parse, index, match, compare with Git and
 * turn the result into features and findings for the UI.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { compareTimestamps } from '../driftDetector';
import { IndexedFile, indexCodeContent } from './codeIndexer';
import { classifyChangedLines } from './changeClassifier';
import { GitContext, loadGitContext } from './git';
import { CodeCluster, FileMatch, SpecFeatureMatch, matchFeatures } from './matcher';
import { ParsedSpec, parseSpecContent } from './specParser';
import { ScannedFile, scanWorkspace } from './scanner';
import { shorten } from './text';
import {
	AnalysisResult,
	CodeLocation,
	Confidence,
	Feature,
	FeatureStatus,
	Finding,
	emptyResult,
	emptySummary
} from './types';

export interface AnalyzeOptions {
	root: string;
	maxFiles?: number;
	maxFileSize?: number;
	extraExcludes?: string[];
	additionalSourceExtensions?: string[];
	useGit?: boolean;
	cache?: AnalysisCache;
	isCancelled?: () => boolean;
}

/** Keeps parsed specs and indexed files between runs, keyed by modified time. */
export class AnalysisCache {
	private readonly specs = new Map<string, { mtimeMs: number; parsed: ParsedSpec }>();
	private readonly files = new Map<string, { mtimeMs: number; indexed: IndexedFile }>();

	getSpec(absPath: string, mtimeMs: number): ParsedSpec | undefined {
		const entry = this.specs.get(absPath);
		return entry && entry.mtimeMs === mtimeMs ? entry.parsed : undefined;
	}

	setSpec(absPath: string, mtimeMs: number, parsed: ParsedSpec): void {
		this.specs.set(absPath, { mtimeMs, parsed });
	}

	getFile(absPath: string, mtimeMs: number): IndexedFile | undefined {
		const entry = this.files.get(absPath);
		return entry && entry.mtimeMs === mtimeMs ? entry.indexed : undefined;
	}

	setFile(absPath: string, mtimeMs: number, indexed: IndexedFile): void {
		this.files.set(absPath, { mtimeMs, indexed });
	}

	invalidate(absPath: string): void {
		this.specs.delete(absPath);
		this.files.delete(absPath);
	}

	clear(): void {
		this.specs.clear();
		this.files.clear();
	}
}

class CancelledError extends Error {}

function checkCancelled(options: AnalyzeOptions): void {
	if (options.isCancelled?.()) {
		throw new CancelledError();
	}
}

async function readText(file: ScannedFile): Promise<string | undefined> {
	try {
		return await fs.readFile(file.absPath, 'utf8');
	} catch {
		return undefined;
	}
}

function toLocation(absPath: string, relPath: string, line: number, label?: string, endLine?: number): CodeLocation {
	return { absPath, relPath, line: Math.max(0, line), endLine, label };
}

function locationFromMatch(match: FileMatch): CodeLocation {
	return toLocation(match.file.absPath, match.file.relPath, match.line, match.label);
}

function specLocation(match: SpecFeatureMatch): CodeLocation {
	return toLocation(
		match.document.absPath,
		match.document.relPath,
		match.requirement.line,
		match.requirement.id ?? match.requirement.title,
		match.requirement.endLine
	);
}

function featureDisplayName(match: SpecFeatureMatch): string {
	const title = match.requirement.title.trim();
	if (!title || match.requirement.implicit) {
		return match.group.featureName;
	}
	return shorten(title, 80);
}

function unfinishedTaskCount(match: SpecFeatureMatch): number {
	const id = match.requirement.normalizedId;
	let count = 0;
	for (const document of match.group.documents) {
		for (const task of document.tasks) {
			if (task.done) {
				continue;
			}
			if (!id || task.requirementIds.includes(id)) {
				count++;
			}
		}
	}
	return count;
}

interface DriftAssessment {
	status: FeatureStatus;
	reason: string;
	changedFile?: FileMatch;
	confidence: Confidence;
	evidence: string[];
}

function assessDrift(
	match: SpecFeatureMatch,
	git: GitContext,
	specFilesForGroup: { relPath: string; mtimeMs: number }[]
): DriftAssessment {
	const hasTests = match.tests.length > 0;
	const inSyncReason = hasTests
		? 'The specification, the code and the tests line up.'
		: 'The specification and the code line up. We did not find tests for this feature.';

	if (git.available && git.scopeLabel) {
		const specChanged = match.group.documents.some((document) => git.changes.has(document.relPath));

		let behavioral: { match: FileMatch; reason: string; evidence: string[] } | undefined;
		let implementationOnly: { match: FileMatch; reason: string } | undefined;

		for (const implementation of match.implementations) {
			const change = git.changes.get(implementation.file.relPath);
			if (!change) {
				continue;
			}
			const classification = classifyChangedLines({
				added: change.addedLines,
				removed: change.removedLines,
				fileExtension: path.extname(implementation.file.relPath),
				requirementTokens: match.requirement.tokens,
				requirementLiterals: match.requirement.literals
			});

			if (classification.kind === 'behavioral' && !behavioral) {
				const evidence = classification.changedValues.length > 0
					? [`These values changed in the code: ${classification.changedValues.join(', ')}.`]
					: [];
				behavioral = { match: implementation, reason: classification.reason, evidence };
			} else if (classification.kind === 'implementationOnly' && !implementationOnly) {
				implementationOnly = { match: implementation, reason: classification.reason };
			}
		}

		if (behavioral && !specChanged) {
			return {
				status: 'possiblyOutdated',
				reason: `The code for this feature was ${git.scopeLabel}, but the specification was not. ${behavioral.reason}`,
				changedFile: behavioral.match,
				confidence: 'medium',
				evidence: behavioral.evidence
			};
		}
		if (behavioral && specChanged) {
			return {
				status: 'inSync',
				reason: 'The code and the specification were both updated together.',
				confidence: 'high',
				evidence: []
			};
		}
		if (implementationOnly) {
			return {
				status: 'inSync',
				reason: 'The code was rewritten, but it still does what the specification describes.',
				changedFile: implementationOnly.match,
				confidence: 'medium',
				evidence: []
			};
		}
		return { status: 'inSync', reason: inSyncReason, confidence: 'high', evidence: [] };
	}

	// Git works here, but there is no change set to compare against.
	if (git.available) {
		return {
			status: 'inSync',
			reason: hasTests
				? 'No recent code changes were found for this feature.'
				: 'No recent code changes were found for this feature. We did not find tests for it.',
			confidence: 'medium',
			evidence: []
		};
	}

	// Without Git history all we have is file times, which is a weak signal.
	const comparison = compareTimestamps(
		specFilesForGroup,
		match.implementations.map((implementation) => ({
			relPath: implementation.file.relPath,
			mtimeMs: implementation.file.mtimeMs
		}))
	);
	if (comparison.changedAfterSpec) {
		const changed = match.implementations.find(
			(implementation) => implementation.file.relPath === comparison.newestImplementation?.relPath
		);
		return {
			status: 'possiblyOutdated',
			reason:
				'The code was saved after the specification was last updated. Git history was not available, so this is based on file times only.',
			changedFile: changed,
			confidence: 'low',
			evidence: []
		};
	}
	return { status: 'inSync', reason: inSyncReason, confidence: 'medium', evidence: [] };
}

function buildSpecFeature(
	match: SpecFeatureMatch,
	git: GitContext,
	specFilesForGroup: { relPath: string; mtimeMs: number }[]
): { feature: Feature; finding?: Finding } {
	const name = featureDisplayName(match);
	const summary =
		match.requirement.description || match.group.summary || `Described in ${match.document.relPath}.`;
	const spec = specLocation(match);
	const implementations = match.implementations.map(locationFromMatch);
	const tests = match.tests.map(locationFromMatch);

	const base: Feature = {
		id: match.id,
		group: match.group.featureName,
		name,
		summary: shorten(summary, 220),
		summarySource: 'spec',
		requirementId: match.requirement.id,
		specLocation: spec,
		implementationLocations: implementations,
		testLocations: tests,
		status: 'inSync',
		statusReason: '',
		confidence: match.confidence,
		evidence: match.evidence
	};

	if (match.implementations.length === 0) {
		const pending = unfinishedTaskCount(match);
		const explanation =
			`The specification describes ${name}, but we could not find code that implements it.` +
			(pending > 0 ? ` The task list still has ${pending} unfinished task${pending === 1 ? '' : 's'} for this feature.` : '');
		const feature: Feature = {
			...base,
			status: 'missingImplementation',
			statusReason: explanation,
			confidence: 'medium'
		};
		return {
			feature,
			finding: {
				id: `specWithoutCode:${match.id}`,
				type: 'specWithoutCode',
				featureId: match.id,
				featureName: name,
				group: match.group.featureName,
				explanation,
				suggestedAction:
					'Implement this requirement, or remove it from the specification if it is no longer planned.',
				specLocation: spec,
				confidence: 'medium',
				evidence: []
			}
		};
	}

	if (match.confidence === 'low') {
		const codeLocation = implementations[0];
		const explanation =
			`We found code and a specification that may both describe ${name}, but we could not confirm they belong together.`;
		const feature: Feature = { ...base, status: 'uncertain', statusReason: explanation, confidence: 'low' };
		return {
			feature,
			finding: {
				id: `uncertain:${match.id}`,
				type: 'uncertainRelationship',
				featureId: match.id,
				featureName: name,
				group: match.group.featureName,
				explanation,
				suggestedAction: match.requirement.id
					? `Open both and confirm the link. Mentioning ${match.requirement.id} in the code makes this certain.`
					: 'Open both and confirm the link, or name the code after the feature so it can be matched.',
				specLocation: spec,
				codeLocation,
				testLocation: tests[0],
				confidence: 'low',
				evidence: match.evidence
			}
		};
	}

	const assessment = assessDrift(match, git, specFilesForGroup);
	const feature: Feature = {
		...base,
		status: assessment.status,
		statusReason: assessment.reason,
		confidence: assessment.confidence
	};

	if (assessment.status === 'possiblyOutdated') {
		const changed = assessment.changedFile ? locationFromMatch(assessment.changedFile) : implementations[0];
		return {
			feature,
			finding: {
				id: `outdated:${match.id}`,
				type: 'specMayBeOutdated',
				featureId: match.id,
				featureName: name,
				group: match.group.featureName,
				explanation: assessment.reason,
				suggestedAction:
					'Check whether the specification still describes what the code does, and update it if it does not.',
				specLocation: spec,
				codeLocation: changed,
				testLocation: tests[0],
				confidence: assessment.confidence,
				evidence: [...match.evidence, ...assessment.evidence].slice(0, 5)
			}
		};
	}

	return { feature };
}

function buildClusterFeature(cluster: CodeCluster): { feature: Feature; finding: Finding } {
	const location = toLocation(
		cluster.primaryFile.absPath,
		cluster.primaryFile.relPath,
		cluster.primaryLine,
		cluster.primaryLabel
	);
	const explanation = `We found code that appears to implement ${cluster.name}, but no matching SpecKit specification was found.`;
	const otherFiles = cluster.files.slice(1, 5).map((file) =>
		toLocation(file.absPath, file.relPath, 0)
	);

	const feature: Feature = {
		id: cluster.id,
		group: cluster.directory === '.' ? 'Code without a specification' : cluster.directory,
		name: cluster.name,
		summary: cluster.summary,
		summarySource: 'code',
		implementationLocations: [location, ...otherFiles],
		testLocations: [],
		status: 'missingSpec',
		statusReason: explanation,
		confidence: 'medium',
		evidence: [`This summary was read from the code, because no specification was found.`]
	};

	return {
		feature,
		finding: {
			id: `codeWithoutSpec:${cluster.id}`,
			type: 'codeWithoutSpec',
			featureId: cluster.id,
			featureName: cluster.name,
			group: feature.group,
			explanation,
			suggestedAction: 'Create a specification describing this feature, or link the code to an existing one.',
			codeLocation: location,
			confidence: 'medium',
			evidence: feature.evidence
		}
	};
}

const FINDING_ORDER = {
	codeWithoutSpec: 0,
	specWithoutCode: 1,
	specMayBeOutdated: 2,
	uncertainRelationship: 3
};

export async function analyzeWorkspace(options: AnalyzeOptions): Promise<AnalysisResult> {
	const cache = options.cache ?? new AnalysisCache();

	const { files, truncated } = await scanWorkspace({
		root: options.root,
		maxFiles: options.maxFiles,
		maxFileSize: options.maxFileSize,
		extraExcludes: options.extraExcludes,
		additionalSourceExtensions: options.additionalSourceExtensions
	});
	checkCancelled(options);

	const specs: ParsedSpec[] = [];
	const indexed: IndexedFile[] = [];

	for (const file of files) {
		checkCancelled(options);
		if (file.role === 'spec') {
			const cached = cache.getSpec(file.absPath, file.mtimeMs);
			if (cached) {
				specs.push(cached);
				continue;
			}
			const content = await readText(file);
			if (content === undefined) {
				continue;
			}
			const parsed = parseSpecContent(file.absPath, file.relPath, content, file.mtimeMs);
			cache.setSpec(file.absPath, file.mtimeMs, parsed);
			specs.push(parsed);
			continue;
		}

		const cachedFile = cache.getFile(file.absPath, file.mtimeMs);
		if (cachedFile) {
			indexed.push(cachedFile);
			continue;
		}
		const content = await readText(file);
		if (content === undefined) {
			continue;
		}
		const indexedFile = indexCodeContent(
			file.absPath,
			file.relPath,
			content,
			file.role === 'test',
			file.mtimeMs
		);
		cache.setFile(file.absPath, file.mtimeMs, indexedFile);
		indexed.push(indexedFile);
	}

	const summary = emptySummary();
	summary.specFiles = specs.length;
	summary.sourceFiles = indexed.filter((file) => !file.isTest).length;
	summary.testFiles = indexed.filter((file) => file.isTest).length;

	if (specs.length === 0) {
		const result = emptyResult('noSpecs');
		result.summary = summary;
		result.truncated = truncated;
		result.notes.push('We could not find any SpecKit specification files in this workspace.');
		return result;
	}

	checkCancelled(options);
	const matchResult = matchFeatures(specs, indexed);

	const git: GitContext = options.useGit === false
		? { available: false, scopeLabel: null, changes: new Map() }
		: await loadGitContext(options.root);
	checkCancelled(options);

	const specTimesByGroup = new Map<string, { relPath: string; mtimeMs: number }[]>();
	for (const group of matchResult.groups) {
		specTimesByGroup.set(
			group.featureKey,
			group.documents.map((document) => ({ relPath: document.relPath, mtimeMs: document.mtimeMs }))
		);
	}

	const features: Feature[] = [];
	const findings: Finding[] = [];

	for (const match of matchResult.matches) {
		const { feature, finding } = buildSpecFeature(
			match,
			git,
			specTimesByGroup.get(match.group.featureKey) ?? []
		);
		features.push(feature);
		if (finding) {
			findings.push(finding);
		}
	}

	for (const cluster of matchResult.clusters) {
		const { feature, finding } = buildClusterFeature(cluster);
		features.push(feature);
		findings.push(finding);
	}

	for (const feature of features) {
		switch (feature.status) {
			case 'inSync': summary.inSync++; break;
			case 'missingSpec': summary.missingSpec++; break;
			case 'missingImplementation': summary.missingImplementation++; break;
			case 'possiblyOutdated': summary.possiblyOutdated++; break;
			case 'uncertain': summary.uncertain++; break;
		}
	}
	summary.features = features.length;

	features.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
	findings.sort(
		(a, b) => FINDING_ORDER[a.type] - FINDING_ORDER[b.type] || a.featureName.localeCompare(b.featureName)
	);

	const notes: string[] = [];
	if (!git.available) {
		notes.push('Git was not available, so changes were compared using file times.');
	} else if (!git.scopeLabel) {
		notes.push('No recent code changes were found to compare.');
	}
	if (truncated) {
		notes.push('This workspace is large, so only part of it was scanned.');
	}

	return {
		state: 'ready',
		features,
		findings,
		summary,
		gitAvailable: git.available,
		changeScope: git.scopeLabel,
		scannedAt: Date.now(),
		truncated,
		notes
	};
}

export { CancelledError };
