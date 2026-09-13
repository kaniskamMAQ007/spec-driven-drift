/** Workspace file discovery: decides which files are specs, source or tests. */

import * as fs from 'fs/promises';
import * as path from 'path';
import { IgnoreMatcher, createIgnoreMatcher, loadIgnoreMatcher, parseIgnoreRules } from './ignore';
import { LANGUAGE_BY_EXTENSION } from './languages';

/** Canonical SpecKit artefact names. */
export const SPECKIT_FILENAMES = new Set([
	'spec.md',
	'plan.md',
	'tasks.md',
	'constitution.md',
	'research.md',
	'data-model.md',
	'quickstart.md'
]);

/** Directory names that commonly hold SpecKit artefacts. */
const SPEC_DIRECTORY_NAMES = new Set(['specs', 'spec', '.specify', '.speckit', '.spec-kit', 'speckit']);

const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
	'node_modules', '.git', '.hg', '.svn', 'dist', 'out', 'build', 'bin', 'obj', 'target',
	'coverage', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.parcel-cache',
	'__pycache__', '.mypy_cache', '.pytest_cache', '.tox', 'venv', '.venv', 'env',
	'vendor', '.gradle', '.idea', '.vscode-test', '.vs', 'Pods', 'DerivedData'
]);

const TEST_DIRECTORY_NAMES = new Set(['test', 'tests', '__tests__', 'spec', 'specs', 'testing', 'e2e', 'it']);

export type FileRole = 'spec' | 'source' | 'test';

export interface ScannedFile {
	absPath: string;
	relPath: string;
	name: string;
	ext: string;
	size: number;
	mtimeMs: number;
	role: FileRole;
	language?: string;
}

export interface ScanOptions {
	root: string;
	maxFiles?: number;
	maxFileSize?: number;
	extraExcludes?: string[];
	additionalSourceExtensions?: string[];
	respectGitignore?: boolean;
}

export interface ScanResult {
	files: ScannedFile[];
	truncated: boolean;
}

export function toPosix(value: string): string {
	return value.split(path.sep).join('/');
}

function isSpecDirectoryPath(relPath: string): boolean {
	return relPath
		.split('/')
		.some((segment) => SPEC_DIRECTORY_NAMES.has(segment.toLowerCase()));
}

/** A markdown file counts as a spec by canonical name or by living in a spec folder. */
export function classifyMarkdown(relPath: string, name: string): FileRole | undefined {
	const lower = name.toLowerCase();
	if (SPECKIT_FILENAMES.has(lower)) {
		return 'spec';
	}
	const directory = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
	if (directory && isSpecDirectoryPath(directory)) {
		return 'spec';
	}
	return undefined;
}

export function isTestPath(relPath: string, name: string): boolean {
	const lowerName = name.toLowerCase();
	if (/\.(test|spec)\.[cm]?[jt]sx?$/.test(lowerName)) {
		return true;
	}
	if (/(^test_.*|_test)\.(py|go|rb)$/.test(lowerName)) {
		return true;
	}
	if (/tests?\.cs$/.test(lowerName) || /test\.java$/.test(lowerName)) {
		return true;
	}
	const segments = relPath.split('/');
	segments.pop();
	return segments.some((segment) => TEST_DIRECTORY_NAMES.has(segment.toLowerCase()));
}

export async function scanWorkspace(options: ScanOptions): Promise<ScanResult> {
	const {
		root,
		maxFiles = 20000,
		maxFileSize = 512 * 1024,
		extraExcludes = [],
		additionalSourceExtensions = [],
		respectGitignore = true
	} = options;

	const gitignore = respectGitignore ? await loadIgnoreMatcher(root) : undefined;
	const extraMatcher: IgnoreMatcher | undefined =
		extraExcludes.length > 0 ? createIgnoreMatcher(parseIgnoreRules(extraExcludes.join('\n'))) : undefined;
	const extraExtensions = new Set(
		additionalSourceExtensions.map((ext) => (ext.startsWith('.') ? ext.toLowerCase() : `.${ext.toLowerCase()}`))
	);

	const files: ScannedFile[] = [];
	let truncated = false;

	const isIgnored = (relPath: string, isDirectory: boolean): boolean =>
		Boolean(gitignore?.ignores(relPath, isDirectory)) || Boolean(extraMatcher?.ignores(relPath, isDirectory));

	async function walk(directory: string, depth: number): Promise<void> {
		if (truncated || depth > 24) {
			return;
		}
		let entries;
		try {
			entries = await fs.readdir(directory, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (truncated) {
				return;
			}
			const absPath = path.join(directory, entry.name);
			const relPath = toPosix(path.relative(root, absPath));
			if (!relPath || relPath.startsWith('..')) {
				continue;
			}

			if (entry.isDirectory()) {
				if (DEFAULT_EXCLUDED_DIRECTORIES.has(entry.name) || isIgnored(relPath, true)) {
					continue;
				}
				await walk(absPath, depth + 1);
				continue;
			}
			if (!entry.isFile()) {
				continue;
			}
			if (isIgnored(relPath, false)) {
				continue;
			}

			const ext = path.extname(entry.name).toLowerCase();
			const language = LANGUAGE_BY_EXTENSION.get(ext);
			let role: FileRole | undefined;
			if (ext === '.md' || ext === '.markdown') {
				role = classifyMarkdown(relPath, entry.name);
			} else if (language || extraExtensions.has(ext)) {
				role = isTestPath(relPath, entry.name) ? 'test' : 'source';
			}
			if (!role) {
				continue;
			}

			let stats;
			try {
				stats = await fs.stat(absPath);
			} catch {
				continue;
			}
			if (stats.size > maxFileSize) {
				continue;
			}

			files.push({
				absPath,
				relPath,
				name: entry.name,
				ext,
				size: stats.size,
				mtimeMs: stats.mtimeMs,
				role,
				language: language?.id
			});

			if (files.length >= maxFiles) {
				truncated = true;
				return;
			}
		}
	}

	await walk(root, 0);
	files.sort((a, b) => a.relPath.localeCompare(b.relPath));
	return { files, truncated };
}
