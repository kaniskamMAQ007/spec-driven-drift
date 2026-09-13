import * as assert from 'assert';
import { classifyChangedLines } from '../../core/changeClassifier';

describe('change classification', () => {
	it('ignores comment, import and logging changes', () => {
		const result = classifyChangedLines({
			added: ['// updated note', "import { helper } from './helper';", 'console.log("here");'],
			removed: ['// old note'],
			fileExtension: '.ts'
		});

		assert.strictEqual(result.kind, 'formattingOnly');
	});

	it('ignores reordered or reformatted code', () => {
		const result = classifyChangedLines({
			added: ['  return total * rate;', 'const rate = 0.2;'],
			removed: ['const rate = 0.2;', 'return total * rate;'],
			fileExtension: '.ts'
		});

		assert.strictEqual(result.kind, 'formattingOnly');
	});

	it('treats a rewrite that keeps the described behaviour as an implementation change', () => {
		const result = classifyChangedLines({
			added: ['const ordered = queryOrderedByCreatedAt(records);'],
			removed: ['const ordered = [...records].sort((a, b) => a.createdAt - b.createdAt);'],
			fileExtension: '.ts',
			requirementTokens: ['record', 'order', 'ordered', 'created', 'time', 'ascending']
		});

		assert.strictEqual(result.kind, 'implementationOnly');
		assert.ok(result.preservedConcepts.includes('created'));
	});

	it('flags a change to a value the specification commits to', () => {
		const result = classifyChangedLines({
			added: ['export const PAGE_SIZE = 10;'],
			removed: ['export const PAGE_SIZE = 50;'],
			fileExtension: '.ts',
			requirementTokens: ['page', 'size', 'record'],
			requirementLiterals: ['50']
		});

		assert.strictEqual(result.kind, 'behavioral');
		assert.deepStrictEqual(result.changedValues, ['50']);
	});

	it('does not blame a requirement for a change that does not touch it', () => {
		const result = classifyChangedLines({
			added: ['export const PAGE_SIZE = 10;'],
			removed: ['export const PAGE_SIZE = 50;'],
			fileExtension: '.ts',
			requirementTokens: ['record', 'order', 'created', 'ascending']
		});

		assert.strictEqual(result.kind, 'unrelated');
	});

	it('flags a changed condition as a behaviour change', () => {
		const result = classifyChangedLines({
			added: ['if (attempts > 5) { lockAccount(user); }'],
			removed: ['if (attempts >= 5) { lockAccount(user); }'],
			fileExtension: '.ts',
			requirementTokens: ['lock', 'account', 'attempt', 'failed']
		});

		assert.strictEqual(result.kind, 'behavioral');
	});
});
