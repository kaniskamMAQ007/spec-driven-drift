import * as assert from 'assert';
import { scanWorkspace } from '../../core/scanner';
import { cleanupFixtures, prepareFixture } from './helpers';

describe('workspace scanning', () => {
	after(async () => cleanupFixtures());

	it('classifies specifications, source files and tests', async () => {
		const root = await prepareFixture('sample-project');
		const { files } = await scanWorkspace({ root });

		const byRole = (role: string) => files.filter((file) => file.role === role).map((file) => file.relPath);

		assert.deepStrictEqual(byRole('spec').sort(), [
			'specs/001-authentication/spec.md',
			'specs/001-authentication/tasks.md',
			'specs/002-user-export/spec.md',
			'specs/003-notifications/spec.md'
		]);
		assert.deepStrictEqual(byRole('test'), ['tests/auth/login.test.js']);
		assert.deepStrictEqual(byRole('source').sort(), [
			'src/auth/login.js',
			'src/auth/logout.js',
			'src/messaging/orderMessenger.js',
			'src/reporting/monthlyReport.js'
		]);
	});

	it('skips files excluded by .gitignore', async () => {
		const root = await prepareFixture('sample-project');
		const { files } = await scanWorkspace({ root });

		assert.ok(!files.some((file) => file.relPath.startsWith('generated/')), 'generated/ should be ignored');
	});

	it('stops once the file limit is reached', async () => {
		const root = await prepareFixture('sample-project');
		const { files, truncated } = await scanWorkspace({ root, maxFiles: 2 });

		assert.strictEqual(files.length, 2);
		assert.strictEqual(truncated, true);
	});
});
