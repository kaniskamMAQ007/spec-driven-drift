import * as assert from 'assert';
import { analyzeWorkspace } from '../../core/analyzer';
import { Feature, Finding, findingMatchesFilter } from '../../core/types';
import { cleanupFixtures, makeSpecsNewer, prepareFixture } from './helpers';
import { AnalysisResult } from '../../core/types';

function feature(result: AnalysisResult, name: string): Feature {
	const found = result.features.find((item) => item.name === name);
	assert.ok(found, `expected a feature named "${name}", found: ${result.features.map((item) => item.name).join(', ')}`);
	return found;
}

function finding(result: AnalysisResult, type: Finding['type']): Finding {
	const found = result.findings.find((item) => item.type === type);
	assert.ok(found, `expected a ${type} finding, found: ${result.findings.map((item) => item.type).join(', ')}`);
	return found;
}

describe('workspace analysis', () => {
	let result: AnalysisResult;

	before(async function () {
		this.timeout(20000);
		const root = await prepareFixture('sample-project');
		await makeSpecsNewer(root);
		result = await analyzeWorkspace({ root });
	});

	after(async () => cleanupFixtures());

	it('links a requirement to its implementation and tests at exact lines', () => {
		const login = feature(result, 'Login');

		assert.strictEqual(login.group, 'Authentication');
		assert.strictEqual(login.requirementId, 'FR-001');
		assert.strictEqual(login.status, 'inSync');
		assert.strictEqual(login.summarySource, 'spec');
		assert.ok(login.summary.includes('email address and password'));

		assert.strictEqual(login.specLocation?.relPath, 'specs/001-authentication/spec.md');
		assert.strictEqual(login.specLocation?.line, 8);

		assert.strictEqual(login.implementationLocations[0].relPath, 'src/auth/login.js');
		assert.strictEqual(login.implementationLocations[0].line, 3);

		assert.strictEqual(login.testLocations[0].relPath, 'tests/auth/login.test.js');
		assert.strictEqual(login.testLocations[0].line, 2);
	});

	it('matches code through the task list even without a requirement id in the file', () => {
		const logout = feature(result, 'Logout');

		assert.strictEqual(logout.implementationLocations[0].relPath, 'src/auth/logout.js');
		assert.strictEqual(logout.implementationLocations[0].line, 3);
		assert.strictEqual(logout.status, 'inSync');
		assert.ok(
			logout.evidence.some((item) => item.includes('task list')),
			logout.evidence.join(' | ')
		);
	});

	it('reports a specification that has no implementation', () => {
		const exportFeature = feature(result, 'User Data Export');
		assert.strictEqual(exportFeature.status, 'missingImplementation');
		assert.strictEqual(exportFeature.implementationLocations.length, 0);

		const item = finding(result, 'specWithoutCode');
		assert.strictEqual(item.featureName, 'User Data Export');
		assert.ok(item.explanation.includes('could not find code'), item.explanation);
		assert.strictEqual(item.specLocation?.relPath, 'specs/002-user-export/spec.md');
		assert.ok(item.suggestedAction.length > 0);
	});

	it('reports code that no specification describes', () => {
		const item = finding(result, 'codeWithoutSpec');

		assert.strictEqual(item.featureName, 'Monthly Report');
		assert.strictEqual(item.codeLocation?.relPath, 'src/reporting/monthlyReport.js');
		assert.strictEqual(item.codeLocation?.line, 1);
		assert.ok(item.explanation.includes('no matching SpecKit specification'), item.explanation);

		const asFeature = feature(result, 'Monthly Report');
		assert.strictEqual(asFeature.status, 'missingSpec');
		assert.strictEqual(asFeature.summarySource, 'code');
		assert.ok(asFeature.summary.includes('monthly revenue report'), asFeature.summary);
	});

	it('reports an uncertain relationship instead of claiming drift', () => {
		const item = finding(result, 'uncertainRelationship');

		assert.strictEqual(item.featureName, 'Notification Service');
		assert.strictEqual(item.codeLocation?.relPath, 'src/messaging/orderMessenger.js');
		assert.strictEqual(item.confidence, 'low');
		assert.ok(item.explanation.includes('could not confirm'), item.explanation);

		assert.strictEqual(feature(result, 'Notification Service').status, 'uncertain');
	});

	it('never mentions files excluded by .gitignore', () => {
		const paths = [
			...result.features.flatMap((item) => item.implementationLocations.map((location) => location.relPath)),
			...result.findings.map((item) => item.codeLocation?.relPath ?? '')
		];
		assert.ok(!paths.some((relPath) => relPath.startsWith('generated/')));
	});

	it('counts what it found', () => {
		assert.strictEqual(result.state, 'ready');
		assert.strictEqual(result.summary.specFiles, 4);
		assert.strictEqual(result.summary.sourceFiles, 4);
		assert.strictEqual(result.summary.testFiles, 1);
		assert.strictEqual(result.summary.features, result.features.length);
		assert.strictEqual(result.summary.inSync, 2);
		assert.strictEqual(result.summary.missingImplementation, 1);
		assert.strictEqual(result.summary.missingSpec, 1);
		assert.strictEqual(result.summary.uncertain, 1);
	});

	it('filters findings without rescanning', () => {
		const missing = result.findings.filter((item) => findingMatchesFilter(item, 'missing'));
		const uncertain = result.findings.filter((item) => findingMatchesFilter(item, 'uncertain'));
		const outdated = result.findings.filter((item) => findingMatchesFilter(item, 'outdated'));

		assert.strictEqual(missing.length, 2);
		assert.strictEqual(uncertain.length, 1);
		assert.strictEqual(outdated.length, 0);
		assert.strictEqual(result.findings.filter((item) => findingMatchesFilter(item, 'all')).length, 3);
	});

	it('says so when there is no specification at all', async () => {
		const root = await prepareFixture('no-specs');
		const empty = await analyzeWorkspace({ root });

		assert.strictEqual(empty.state, 'noSpecs');
		assert.strictEqual(empty.features.length, 0);
		assert.strictEqual(empty.findings.length, 0);
		assert.strictEqual(empty.summary.sourceFiles, 1);
		assert.ok(empty.notes[0].includes('could not find any SpecKit specification'), empty.notes.join(' | '));
	});
});
