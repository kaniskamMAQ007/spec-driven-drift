import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import { indexCodeContent, primarySymbol } from '../../core/codeIndexer';
import { FIXTURE_ROOT } from './helpers';

describe('code indexing', () => {
	it('finds exported symbols, requirement references and the leading comment', async () => {
		const absPath = path.join(FIXTURE_ROOT, 'sample-project/src/auth/login.js');
		const file = indexCodeContent(absPath, 'src/auth/login.js', await fs.readFile(absPath, 'utf8'), false);

		const login = file.symbols.find((symbol) => symbol.name === 'login');
		assert.ok(login, 'expected a login symbol');
		assert.strictEqual(login.exported, true);
		assert.strictEqual(login.kind, 'function');
		assert.strictEqual(login.line, 5);

		assert.deepStrictEqual(file.requirementIds, ['FR-1']);
		assert.deepStrictEqual(file.requirementReferences, [{ id: 'FR-1', line: 3 }]);
		assert.ok(file.docSummary.startsWith('Authenticates a registered user'), file.docSummary);
		assert.ok(file.imports.includes('./session'));
	});

	it('reads test names from test files', async () => {
		const absPath = path.join(FIXTURE_ROOT, 'sample-project/tests/auth/login.test.js');
		const file = indexCodeContent(absPath, 'tests/auth/login.test.js', await fs.readFile(absPath, 'utf8'), true);

		assert.strictEqual(file.isTest, true);
		assert.strictEqual(file.testNames[0].name, 'login (FR-001)');
		assert.strictEqual(file.testNames[0].line, 2);
		assert.ok(file.testNames.some((test) => test.name.includes('wrong')));
	});

	it('supports other languages through the language registry', () => {
		const python = indexCodeContent(
			'/tmp/app/exporter.py',
			'app/exporter.py',
			['def export_user_data(user_id):', '    """Writes the user export file."""', '    return True', ''].join('\n'),
			false
		);
		assert.strictEqual(python.language, 'python');
		assert.strictEqual(python.symbols[0].name, 'export_user_data');
		assert.strictEqual(python.symbols[0].exported, true);
		assert.strictEqual(python.docSummary, 'Writes the user export file.');

		const csharp = indexCodeContent(
			'/tmp/App/RefundService.cs',
			'App/RefundService.cs',
			['namespace App;', '', 'public class RefundService', '{', '    public void Refund(string paymentId) { }', '}'].join('\n'),
			false
		);
		assert.strictEqual(csharp.language, 'csharp');
		assert.ok(csharp.symbols.some((symbol) => symbol.name === 'RefundService' && symbol.exported));

		const python2 = indexCodeContent('/tmp/app/_private.py', 'app/_private.py', 'def _hidden():\n    pass\n', false);
		assert.strictEqual(python2.symbols[0].exported, false);
	});

	it('prefers the symbol that matches the wording of a requirement', () => {
		const file = indexCodeContent(
			'/tmp/src/payment/refund.js',
			'src/payment/refund.js',
			['export function chargeCard(id) {}', '', 'export function refundPayment(id) {}'].join('\n'),
			false
		);

		const symbol = primarySymbol(file, new Set(['refund', 'payment']));
		assert.strictEqual(symbol?.name, 'refundPayment');
		assert.strictEqual(symbol?.line, 2);
	});
});
