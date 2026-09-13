/**
 * Git integration. Answers "what changed, and which lines" for the current
 * branch or working tree. Everything degrades gracefully when Git is missing.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const run = promisify(execFile);

export type ChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed';

export interface GitFileChange {
	relPath: string;
	status: ChangeStatus;
	addedLines: string[];
	removedLines: string[];
}

export interface GitContext {
	available: boolean;
	root?: string;
	/** Plain-English description of what was compared. */
	scopeLabel: string | null;
	changes: Map<string, GitFileChange>;
}

export interface GitOptions {
	timeoutMs?: number;
	maxBuffer?: number;
}

const UNAVAILABLE: GitContext = { available: false, scopeLabel: null, changes: new Map() };

async function git(root: string, args: string[], options: GitOptions): Promise<string | undefined> {
	try {
		const { stdout } = await run('git', ['-C', root, ...args], {
			timeout: options.timeoutMs ?? 10000,
			maxBuffer: options.maxBuffer ?? 24 * 1024 * 1024,
			windowsHide: true
		});
		return stdout;
	} catch {
		return undefined;
	}
}

/** Parses `git diff -U0` output into per-file added/removed lines. */
export function parseUnifiedDiff(diff: string): Map<string, GitFileChange> {
	const changes = new Map<string, GitFileChange>();
	let current: GitFileChange | undefined;

	for (const line of diff.split(/\r?\n/)) {
		if (line.startsWith('diff --git ')) {
			current = undefined;
			continue;
		}
		if (line.startsWith('--- ')) {
			continue;
		}
		if (line.startsWith('+++ ')) {
			const target = line.slice(4).trim();
			if (target === '/dev/null') {
				current = undefined;
				continue;
			}
			const relPath = target.replace(/^b\//, '');
			current = changes.get(relPath) ?? { relPath, status: 'modified', addedLines: [], removedLines: [] };
			changes.set(relPath, current);
			continue;
		}
		if (!current || line.startsWith('@@') || line.startsWith('index ')) {
			continue;
		}
		if (line.startsWith('+')) {
			current.addedLines.push(line.slice(1));
		} else if (line.startsWith('-')) {
			current.removedLines.push(line.slice(1));
		}
	}

	for (const change of changes.values()) {
		if (change.removedLines.length === 0 && change.addedLines.length > 0) {
			change.status = 'added';
		}
	}
	return changes;
}

async function resolveBase(root: string, options: GitOptions): Promise<{ base: string; label: string } | undefined> {
	const head = (await git(root, ['rev-parse', 'HEAD'], options))?.trim();
	if (!head) {
		return undefined;
	}

	const candidates: string[] = [];
	const originHead = (await git(root, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], options))?.trim();
	if (originHead) {
		candidates.push(originHead.replace('refs/remotes/', ''));
	}
	candidates.push('origin/main', 'origin/master', 'main', 'master', 'develop');

	for (const candidate of candidates) {
		const resolved = (await git(root, ['rev-parse', '--verify', '--quiet', candidate], options))?.trim();
		if (!resolved || resolved === head) {
			continue;
		}
		const mergeBase = (await git(root, ['merge-base', 'HEAD', candidate], options))?.trim();
		if (mergeBase && mergeBase !== head) {
			return { base: mergeBase, label: `changed on this branch compared with ${candidate}` };
		}
	}

	const status = (await git(root, ['status', '--porcelain'], options))?.trim();
	if (status) {
		return { base: 'HEAD', label: 'changed but not yet committed' };
	}

	const previous = (await git(root, ['rev-parse', '--verify', '--quiet', 'HEAD~1'], options))?.trim();
	if (previous) {
		return { base: previous, label: 'changed in the most recent commit' };
	}
	return undefined;
}

export async function loadGitContext(root: string, options: GitOptions = {}): Promise<GitContext> {
	const topLevel = (await git(root, ['rev-parse', '--show-toplevel'], options))?.trim();
	if (!topLevel) {
		return UNAVAILABLE;
	}

	const resolved = await resolveBase(root, options);
	if (!resolved) {
		return { available: true, root: topLevel, scopeLabel: null, changes: new Map() };
	}

	const diff = await git(root, ['diff', '-U0', '--no-color', '--no-ext-diff', resolved.base], options);
	const changes = diff ? parseUnifiedDiff(diff) : new Map<string, GitFileChange>();

	const untracked = await git(root, ['ls-files', '--others', '--exclude-standard'], options);
	if (untracked) {
		for (const relPath of untracked.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
			if (!changes.has(relPath)) {
				changes.set(relPath, { relPath, status: 'added', addedLines: [], removedLines: [] });
			}
		}
	}

	return { available: true, root: topLevel, scopeLabel: resolved.label, changes };
}
