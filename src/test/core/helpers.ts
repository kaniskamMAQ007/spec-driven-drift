import { execFileSync } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export const FIXTURE_ROOT = path.resolve(__dirname, '..', '..', '..', 'test-fixtures');

const created: string[] = [];

/** Copies a fixture project into a temp folder so tests never mutate the repo. */
export async function prepareFixture(name: string): Promise<string> {
	const target = await fs.mkdtemp(path.join(os.tmpdir(), `speckit-${name}-`));
	await fs.cp(path.join(FIXTURE_ROOT, name), target, { recursive: true });
	created.push(target);
	return target;
}

export async function cleanupFixtures(): Promise<void> {
	for (const dir of created.splice(0)) {
		await fs.rm(dir, { recursive: true, force: true });
	}
}

async function walk(dir: string, files: string[] = []): Promise<string[]> {
	for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== '.git') {
				await walk(full, files);
			}
		} else {
			files.push(full);
		}
	}
	return files;
}

/**
 * Makes every specification newer than every source file so the timestamp
 * fallback reports no drift and structural assertions stay deterministic.
 */
export async function makeSpecsNewer(root: string): Promise<void> {
	const now = Date.now();
	for (const file of await walk(root)) {
		const isSpec = file.endsWith('.md');
		const time = new Date(isSpec ? now : now - 60 * 60 * 1000);
		await fs.utimes(file, time, time);
	}
}

export function runGit(root: string, args: string[]): string {
	return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true });
}

export function initGitRepo(root: string): void {
	runGit(root, ['init', '-b', 'main']);
	runGit(root, ['config', 'user.email', 'tests@example.com']);
	runGit(root, ['config', 'user.name', 'SpecKit Tests']);
	runGit(root, ['config', 'commit.gpgsign', 'false']);
	runGit(root, ['add', '.']);
	runGit(root, ['commit', '-m', 'Initial commit']);
}

export function isGitAvailable(): boolean {
	try {
		execFileSync('git', ['--version'], { stdio: 'ignore', windowsHide: true });
		return true;
	} catch {
		return false;
	}
}
