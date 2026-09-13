import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import { analyzeWorkspace } from '../../core/analyzer';
import { parseUnifiedDiff } from '../../core/git';
import { AnalysisResult } from '../../core/types';
import { cleanupFixtures, initGitRepo, isGitAvailable, prepareFixture } from './helpers';

const RECORDS_FILE = 'src/records/listRecords.js';
const SPEC_FILE = 'specs/005-record-list/spec.md';

async function edit(root: string, relPath: string, from: string, to: string): Promise<void> {
	const absPath = path.join(root, relPath);
	const content = await fs.readFile(absPath, 'utf8');
	assert.ok(content.includes(from), `fixture should contain: ${from}`);
	await fs.writeFile(absPath, content.replace(from, to), 'utf8');
}

function statusOf(result: AnalysisResult, name: string): string {
	const feature = result.features.find((item) => item.name === name);
	assert.ok(feature, `expected feature ${name}`);
	return feature.status;
}

describe('git-based drift detection', () => {
	after(async () => cleanupFixtures());

	it('parses added and removed lines per file', () => {
		const changes = parseUnifiedDiff(
			[
				'diff --git a/src/a.ts b/src/a.ts',
				'index 111..222 100644',
				'--- a/src/a.ts',
				'+++ b/src/a.ts',
				'@@ -1 +1 @@',
				'-const limit = 50;',
				'+const limit = 10;'
			].join('\n')
		);

		const change = changes.get('src/a.ts');
		assert.ok(change);
		assert.deepStrictEqual(change.removedLines, ['const limit = 50;']);
		assert.deepStrictEqual(change.addedLines, ['const limit = 10;']);
	});

	it('flags the specification when a value it commits to changes', async function () {
		if (!isGitAvailable()) {
			this.skip();
		}
		this.timeout(30000);

		const root = await prepareFixture('ordering-project');
		initGitRepo(root);
		await edit(root, RECORDS_FILE, 'export const PAGE_SIZE = 50;', 'export const PAGE_SIZE = 10;');

		const result = await analyzeWorkspace({ root });

		assert.strictEqual(result.gitAvailable, true);
		assert.ok(result.changeScope, 'expected a change scope');

		const outdated = result.findings.filter((item) => item.type === 'specMayBeOutdated');
		assert.strictEqual(outdated.length, 1);
		assert.strictEqual(outdated[0].featureName, 'Page Size');
		assert.strictEqual(outdated[0].codeLocation?.relPath, RECORDS_FILE);
		assert.ok(outdated[0].explanation.includes('was not'), outdated[0].explanation);
		assert.ok(
			outdated[0].evidence.some((item) => item.includes('50')),
			outdated[0].evidence.join(' | ')
		);

		// The unrelated requirement in the same file must not be blamed.
		assert.strictEqual(statusOf(result, 'Record Order'), 'inSync');
	});

	it('does not flag a rewrite that still does what the specification describes', async function () {
		if (!isGitAvailable()) {
			this.skip();
		}
		this.timeout(30000);

		const root = await prepareFixture('ordering-project');
		initGitRepo(root);
		await edit(
			root,
			RECORDS_FILE,
			'const ordered = [...records].sort((a, b) => a.createdAt - b.createdAt);',
			'const ordered = queryOrderedByCreatedAt(records);'
		);

		const result = await analyzeWorkspace({ root });

		assert.strictEqual(result.findings.filter((item) => item.type === 'specMayBeOutdated').length, 0);
		assert.strictEqual(statusOf(result, 'Record Order'), 'inSync');

		const recordOrder = result.features.find((item) => item.name === 'Record Order');
		assert.ok(recordOrder?.statusReason.includes('still does what the specification describes'), recordOrder?.statusReason);
	});

	it('does not flag anything when the specification was updated with the code', async function () {
		if (!isGitAvailable()) {
			this.skip();
		}
		this.timeout(30000);

		const root = await prepareFixture('ordering-project');
		initGitRepo(root);
		await edit(root, RECORDS_FILE, 'export const PAGE_SIZE = 50;', 'export const PAGE_SIZE = 10;');
		await edit(root, SPEC_FILE, 'at most 50 records per page', 'at most 10 records per page');

		const result = await analyzeWorkspace({ root });

		assert.strictEqual(result.findings.filter((item) => item.type === 'specMayBeOutdated').length, 0);
		assert.strictEqual(statusOf(result, 'Page Size'), 'inSync');
	});
});
