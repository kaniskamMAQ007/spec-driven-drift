/**
 * Shared data model for SpecKit analysis.
 *
 * Nothing in `src/core` may import `vscode` so the analysis can be unit tested
 * with plain Node (see `src/test/core`).
 */

export type Confidence = 'high' | 'medium' | 'low';

/** A precise place in a file that the UI can navigate to. */
export interface CodeLocation {
	absPath: string;
	/** Workspace-relative path using `/` separators. */
	relPath: string;
	/** Zero-based line number. */
	line: number;
	/** Zero-based inclusive end line, when a range is known. */
	endLine?: number;
	/** Heading, symbol or test name found at `line`. */
	label?: string;
}

export type FeatureStatus =
	| 'inSync'
	| 'missingImplementation'
	| 'missingSpec'
	| 'possiblyOutdated'
	| 'uncertain';

export interface Feature {
	id: string;
	/** Grouping label, usually the spec document or module name. */
	group: string;
	name: string;
	summary: string;
	/** Whether `summary` came from the specification or was inferred from code. */
	summarySource: 'spec' | 'code';
	requirementId?: string;
	specLocation?: CodeLocation;
	implementationLocations: CodeLocation[];
	testLocations: CodeLocation[];
	status: FeatureStatus;
	/** Plain-English sentence explaining the status. */
	statusReason: string;
	confidence: Confidence;
	/** Plain-English statements describing why code was linked to the spec. */
	evidence: string[];
}

export type FindingType =
	| 'codeWithoutSpec'
	| 'specWithoutCode'
	| 'specMayBeOutdated'
	| 'uncertainRelationship';

export interface Finding {
	id: string;
	type: FindingType;
	featureId: string;
	featureName: string;
	group: string;
	/** Plain-English explanation shown to the developer. */
	explanation: string;
	suggestedAction: string;
	specLocation?: CodeLocation;
	codeLocation?: CodeLocation;
	testLocation?: CodeLocation;
	confidence: Confidence;
	evidence: string[];
}

export type AnalysisState = 'scanning' | 'ready' | 'noWorkspace' | 'noSpecs';

export interface AnalysisSummary {
	features: number;
	inSync: number;
	missingSpec: number;
	missingImplementation: number;
	possiblyOutdated: number;
	uncertain: number;
	specFiles: number;
	sourceFiles: number;
	testFiles: number;
}

export interface AnalysisResult {
	state: AnalysisState;
	features: Feature[];
	findings: Finding[];
	summary: AnalysisSummary;
	gitAvailable: boolean;
	/** Plain-English description of which changes were compared, if any. */
	changeScope: string | null;
	scannedAt: number;
	/** True when the scan hit its file limit and stopped early. */
	truncated: boolean;
	notes: string[];
}

export type DriftFilter = 'all' | 'missing' | 'outdated' | 'uncertain' | 'inSync';

export function emptySummary(): AnalysisSummary {
	return {
		features: 0,
		inSync: 0,
		missingSpec: 0,
		missingImplementation: 0,
		possiblyOutdated: 0,
		uncertain: 0,
		specFiles: 0,
		sourceFiles: 0,
		testFiles: 0
	};
}

export function emptyResult(state: AnalysisState): AnalysisResult {
	return {
		state,
		features: [],
		findings: [],
		summary: emptySummary(),
		gitAvailable: false,
		changeScope: null,
		scannedAt: Date.now(),
		truncated: false,
		notes: []
	};
}

/** Shared filter logic so the counts and the webview always agree. */
export function findingMatchesFilter(finding: Finding, filter: DriftFilter): boolean {
	switch (filter) {
		case 'all':
			return true;
		case 'missing':
			return finding.type === 'codeWithoutSpec' || finding.type === 'specWithoutCode';
		case 'outdated':
			return finding.type === 'specMayBeOutdated';
		case 'uncertain':
			return finding.type === 'uncertainRelationship';
		case 'inSync':
			return false;
		default:
			return true;
	}
}
