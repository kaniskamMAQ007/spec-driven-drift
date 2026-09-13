import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { AnalysisResult, CodeLocation, emptyResult } from '../core/types';
import { openLocation } from '../navigation';
import { SpecKitViewProvider } from '../specKitViewProvider';

const FIXTURE_SPEC = path.resolve(
	__dirname,
	'..',
	'..',
	'test-fixtures',
	'sample-project',
	'specs',
	'001-authentication',
	'spec.md'
);

class MemoryMemento implements vscode.Memento {
	private readonly store = new Map<string, unknown>();

	keys(): readonly string[] {
		return [...this.store.keys()];
	}

	get<T>(key: string, defaultValue?: T): T {
		return (this.store.has(key) ? this.store.get(key) : defaultValue) as T;
	}

	async update(key: string, value: unknown): Promise<void> {
		this.store.set(key, value);
	}
}

interface FakeView {
	view: vscode.WebviewView;
	messages: { type: string; tab: string; filter: string; header: string; body: string }[];
	send: (message: { type: string; value?: string }) => void;
}

function createFakeView(): FakeView {
	const messages: FakeView['messages'] = [];
	let handler: (message: { type: string; value?: string }) => void = () => undefined;

	const view = {
		webview: {
			options: {},
			html: '',
			cspSource: '',
			asWebviewUri: (uri: vscode.Uri) => uri,
			onDidReceiveMessage(callback: (message: { type: string; value?: string }) => void) {
				handler = callback;
				return { dispose: () => undefined };
			},
			postMessage(message: FakeView['messages'][number]) {
				messages.push(message);
				return Promise.resolve(true);
			}
		}
	} as unknown as vscode.WebviewView;

	return { view, messages, send: (message) => handler(message) };
}

function location(relPath: string, line: number, label?: string): CodeLocation {
	return { absPath: FIXTURE_SPEC, relPath, line, label };
}

function sampleResult(): AnalysisResult {
	const result = emptyResult('ready');
	result.features = [
		{
			id: 'feature-1',
			group: 'Payments',
			// Workspace content must never be trusted as markup.
			name: 'Refund <script>alert(1)</script>',
			summary: 'Allows eligible payments to be refunded.',
			summarySource: 'spec',
			requirementId: 'FR-014',
			specLocation: location('specs/payment/spec.md', 86, 'FR-014'),
			implementationLocations: [location('src/payment/refund.ts', 41, 'refundPayment')],
			testLocations: [],
			status: 'possiblyOutdated',
			statusReason: 'The code changed, but the specification did not.',
			confidence: 'medium',
			evidence: []
		}
	];
	result.findings = [
		{
			id: 'finding-1',
			type: 'specMayBeOutdated',
			featureId: 'feature-1',
			featureName: 'Refund Payment',
			group: 'Payments',
			explanation: 'The refund implementation changed, but the specification was not changed.',
			suggestedAction: 'Review whether the specification still describes the current behaviour.',
			specLocation: location('specs/payment/spec.md', 86, 'FR-014'),
			codeLocation: location('src/payment/refund.ts', 41, 'refundPayment'),
			confidence: 'medium',
			evidence: ['These values changed in the code: 50.']
		}
	];
	result.summary.features = 1;
	result.summary.possiblyOutdated = 1;
	return result;
}

suite('SpecKit Explorer & Drift Detector', () => {
	test('activates and registers its commands', async () => {
		const extension = vscode.extensions.getExtension('KaniskaMaity.spec-drift-monitor');
		assert.ok(extension, 'extension should be installed in the test host');
		await extension.activate();

		const commands = await vscode.commands.getCommands(true);
		for (const command of [
			'spec-drift-monitor.refresh',
			'spec-drift-monitor.showFeatures',
			'spec-drift-monitor.showDrift'
		]) {
			assert.ok(commands.includes(command), `${command} should be registered`);
		}
	});

	test('opens a specification at the exact requirement line', async () => {
		await openLocation({
			absPath: FIXTURE_SPEC,
			relPath: 'specs/001-authentication/spec.md',
			line: 8,
			label: 'FR-001'
		});

		const editor = vscode.window.activeTextEditor;
		assert.ok(editor, 'a document should be open');
		assert.strictEqual(editor.selection.active.line, 8);
		assert.ok(editor.document.lineAt(8).text.includes('FR-001'));
	});

	test('clamps navigation to the end of the file instead of failing', async () => {
		await openLocation({
			absPath: FIXTURE_SPEC,
			relPath: 'specs/001-authentication/spec.md',
			line: 9999
		});

		const editor = vscode.window.activeTextEditor;
		assert.ok(editor);
		assert.strictEqual(editor.selection.active.line, editor.document.lineCount - 1);
	});

	test('renders features, escapes workspace text and switches tabs', () => {
		const fake = createFakeView();
		const provider = new SpecKitViewProvider(
			vscode.Uri.file(__dirname),
			new MemoryMemento(),
			() => undefined,
			() => undefined
		);

		provider.resolveWebviewView(fake.view);
		provider.setResult(sampleResult());

		const featuresView = fake.messages[fake.messages.length - 1];
		assert.strictEqual(featuresView.tab, 'features');
		assert.ok(featuresView.body.includes('Payments'), 'the group should be shown');
		assert.ok(featuresView.body.includes('FR-014'));
		assert.ok(featuresView.body.includes('specs/payment/spec.md:87'), 'lines are shown 1-based');
		assert.ok(!featuresView.body.includes('<script>alert(1)</script>'), 'workspace text must be escaped');
		assert.ok(featuresView.body.includes('&lt;script&gt;'), 'escaped text should still be visible');

		fake.send({ type: 'tab', value: 'drift' });
		const driftView = fake.messages[fake.messages.length - 1];
		assert.strictEqual(driftView.tab, 'drift');
		assert.ok(driftView.body.includes('SPECIFICATION MAY BE OUTDATED'));
		assert.ok(driftView.body.includes('Suggested action'));
		assert.ok(driftView.body.includes('data-filter="uncertain"'), 'filters should be available');
	});

	test('filters findings in place and opens the location behind a card', () => {
		const opened: CodeLocation[] = [];
		const fake = createFakeView();
		const provider = new SpecKitViewProvider(
			vscode.Uri.file(__dirname),
			new MemoryMemento(),
			() => undefined,
			(target) => opened.push(target)
		);

		provider.resolveWebviewView(fake.view);
		provider.setResult(sampleResult());
		provider.showTab('drift');

		fake.send({ type: 'filter', value: 'missing' });
		const missing = fake.messages[fake.messages.length - 1];
		assert.ok(missing.body.includes('No findings match this filter.'));

		fake.send({ type: 'filter', value: 'outdated' });
		const outdated = fake.messages[fake.messages.length - 1];
		assert.ok(outdated.body.includes('Refund Payment'));

		const match = /data-open="(loc-\d+)"/.exec(outdated.body);
		assert.ok(match, 'a clickable location should be rendered');
		fake.send({ type: 'open', value: match[1] });

		assert.strictEqual(opened.length, 1);
		assert.strictEqual(opened[0].relPath, 'src/payment/refund.ts');
		assert.strictEqual(opened[0].line, 41);
	});

	test('explains that no specifications were found instead of reporting no drift', () => {
		const fake = createFakeView();
		const provider = new SpecKitViewProvider(
			vscode.Uri.file(__dirname),
			new MemoryMemento(),
			() => undefined,
			() => undefined
		);

		provider.resolveWebviewView(fake.view);
		const empty = emptyResult('noSpecs');
		empty.summary.sourceFiles = 12;
		provider.setResult(empty);

		const rendered = fake.messages[fake.messages.length - 1];
		assert.ok(rendered.body.includes('No SpecKit specifications found'));
		assert.ok(!rendered.body.includes('No Drift Detected'));
	});
});


