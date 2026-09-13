import * as vscode from 'vscode';
import { AnalysisCache, CancelledError, analyzeWorkspace } from './core/analyzer';
import { LANGUAGE_RULES } from './core/languages';
import { AnalysisResult, emptyResult } from './core/types';
import { openLocation } from './navigation';
import { SpecKitViewProvider } from './specKitViewProvider';

const DEBOUNCE_MS = 600;

let viewProvider: SpecKitViewProvider;
let cache: AnalysisCache;
let debounceTimer: NodeJS.Timeout | undefined;
let runToken = 0;
let hasScannedOnce = false;

export function activate(context: vscode.ExtensionContext) {
	cache = new AnalysisCache();
	viewProvider = new SpecKitViewProvider(
		context.extensionUri,
		context.workspaceState,
		() => void runAnalysis(true),
		(location) => void openLocation(location)
	);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(SpecKitViewProvider.viewType, viewProvider),
		vscode.commands.registerCommand('spec-drift-monitor.refresh', () => runAnalysis(true)),
		vscode.commands.registerCommand('spec-drift-monitor.showFeatures', () => viewProvider.showTab('features')),
		vscode.commands.registerCommand('spec-drift-monitor.showDrift', () => viewProvider.showTab('drift')),
		vscode.commands.registerCommand('spec-drift-monitor.openFile', (uri: vscode.Uri) => {
			if (uri) {
				void vscode.window.showTextDocument(uri);
			}
		})
	);

	setupWatchers(context);

	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(() => {
			cache.clear();
			scheduleAnalysis();
		}),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('specDriftMonitor')) {
				cache.clear();
				scheduleAnalysis();
			}
		})
	);

	void runAnalysis(false);
}

function sourceGlob(): string {
	const configured = vscode.workspace
		.getConfiguration('specDriftMonitor')
		.get<string[]>('additionalSourceExtensions', []);
	const extensions = new Set<string>();
	for (const rule of LANGUAGE_RULES) {
		for (const ext of rule.extensions) {
			extensions.add(ext.replace('.', ''));
		}
	}
	for (const ext of configured) {
		extensions.add(ext.replace('.', '').toLowerCase());
	}
	return `**/*.{${[...extensions].join(',')}}`;
}

function setupWatchers(context: vscode.ExtensionContext) {
	const onChanged = (uri: vscode.Uri) => {
		cache.invalidate(uri.fsPath);
		scheduleAnalysis();
	};

	for (const pattern of [sourceGlob(), '**/*.{md,markdown}']) {
		const watcher = vscode.workspace.createFileSystemWatcher(pattern);
		watcher.onDidChange(onChanged);
		watcher.onDidCreate(onChanged);
		watcher.onDidDelete(onChanged);
		context.subscriptions.push(watcher);
	}
}

function scheduleAnalysis() {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}
	debounceTimer = setTimeout(() => void runAnalysis(false), DEBOUNCE_MS);
}

async function runAnalysis(manual: boolean): Promise<void> {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = undefined;
	}

	const folder = vscode.workspace.workspaceFolders?.[0];
	if (!folder) {
		viewProvider.setResult(emptyResult('noWorkspace'));
		return;
	}

	const token = ++runToken;
	if (manual || !hasScannedOnce) {
		viewProvider.setScanning();
	}

	const configuration = vscode.workspace.getConfiguration('specDriftMonitor');
	try {
		const result = await analyzeWorkspace({
			root: folder.uri.fsPath,
			useGit: configuration.get<boolean>('useGit', true),
			maxFiles: configuration.get<number>('maxFilesToScan', 20000),
			extraExcludes: configuration.get<string[]>('excludeGlobs', []),
			additionalSourceExtensions: configuration.get<string[]>('additionalSourceExtensions', []),
			cache,
			isCancelled: () => token !== runToken
		});

		if (token !== runToken) {
			return;
		}
		hasScannedOnce = true;
		viewProvider.setResult(withWorkspaceNotes(result));
	} catch (error) {
		if (error instanceof CancelledError || token !== runToken) {
			return;
		}
		const failed = emptyResult('ready');
		failed.notes.push('We could not finish scanning this workspace.');
		viewProvider.setResult(failed);
		console.error('Spec Drift Monitor analysis failed', error);
	}
}

function withWorkspaceNotes(result: AnalysisResult): AnalysisResult {
	const folders = vscode.workspace.workspaceFolders ?? [];
	if (folders.length > 1) {
		result.notes.push(`Only the first folder (${folders[0].name}) is analysed in a multi-root workspace.`);
	}
	return result;
}

export function deactivate() {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
		debounceTimer = undefined;
	}
}

