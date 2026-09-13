import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import { parseSpecContent } from '../../core/specParser';
import { FIXTURE_ROOT } from './helpers';

async function parseFixture(relPath: string) {
	const absPath = path.join(FIXTURE_ROOT, relPath);
	const content = await fs.readFile(absPath, 'utf8');
	const workspaceRelative = relPath.split('/').slice(1).join('/');
	return parseSpecContent(absPath, workspaceRelative, content, 1000);
}

describe('spec parsing', () => {
	it('reads the feature name, summary and bullet requirements with exact lines', async () => {
		const spec = await parseFixture('sample-project/specs/001-authentication/spec.md');

		assert.strictEqual(spec.kind, 'spec');
		assert.strictEqual(spec.featureName, 'Authentication');
		assert.strictEqual(spec.featureSlug, '001-authentication');
		assert.ok(spec.summary.startsWith('Registered users can sign in'), spec.summary);
		assert.strictEqual(spec.requirements.length, 2);

		const [login, logout] = spec.requirements;
		assert.strictEqual(login.id, 'FR-001');
		assert.strictEqual(login.normalizedId, 'FR-1');
		assert.strictEqual(login.title, 'Login');
		assert.strictEqual(login.line, 8);
		assert.ok(login.description.includes('email address and password'), login.description);

		assert.strictEqual(logout.id, 'FR-002');
		assert.strictEqual(logout.title, 'Logout');
		assert.strictEqual(logout.line, 9);
	});

	it('reads heading requirements together with their acceptance criteria', async () => {
		const spec = await parseFixture('sample-project/specs/003-notifications/spec.md');

		assert.strictEqual(spec.featureName, 'Order Notifications');
		assert.strictEqual(spec.requirements.length, 1);

		const [requirement] = spec.requirements;
		assert.strictEqual(requirement.id, 'FR-031');
		assert.strictEqual(requirement.title, 'Notification Service');
		assert.strictEqual(requirement.line, 8);
		assert.strictEqual(requirement.description, 'Customers receive a message when an order ships.');
		assert.strictEqual(requirement.acceptanceCriteria.length, 1);
		assert.ok(requirement.acceptanceCriteria[0].startsWith('Given an order that has shipped'));
	});

	it('does not turn overview or acceptance headings into requirements', async () => {
		const spec = await parseFixture('sample-project/specs/002-user-export/spec.md');
		const titles = spec.requirements.map((requirement) => requirement.title);

		assert.deepStrictEqual(titles, ['User Data Export']);
	});

	it('reads task lists, their file paths and requirement links', async () => {
		const tasks = await parseFixture('sample-project/specs/001-authentication/tasks.md');

		assert.strictEqual(tasks.kind, 'tasks');
		assert.strictEqual(tasks.tasks.length, 2);
		assert.strictEqual(tasks.tasks[0].id, 'T001');
		assert.strictEqual(tasks.tasks[0].done, true);
		assert.deepStrictEqual(tasks.tasks[0].paths, ['src/auth/login.js']);
		assert.deepStrictEqual(tasks.tasks[0].requirementIds, ['FR-1']);
		assert.strictEqual(tasks.tasks[1].done, false);
		assert.deepStrictEqual(tasks.tasks[1].paths, ['src/auth/logout.js']);
	});

	it('treats a specification without requirement ids as one feature', () => {
		const spec = parseSpecContent(
			'/tmp/specs/search/spec.md',
			'specs/search/spec.md',
			['# Saved Searches', '', 'People can save a search and run it again later.', ''].join('\n')
		);

		assert.strictEqual(spec.requirements.length, 1);
		assert.strictEqual(spec.requirements[0].implicit, true);
		assert.strictEqual(spec.requirements[0].title, 'Saved Searches');
		assert.strictEqual(spec.requirements[0].line, 0);
	});

	it('collects values the specification commits to', () => {
		const spec = parseSpecContent(
			'/tmp/specs/uploads/spec.md',
			'specs/uploads/spec.md',
			['# Uploads', '', '## Requirements', '', '- **FR-012**: Reject uploads larger than 5 MB.'].join('\n')
		);

		assert.ok(spec.requirements[0].literals.includes('5 mb'), spec.requirements[0].literals.join(','));
	});
});
