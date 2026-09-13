/**
 * Parses SpecKit markdown into features, requirements and tasks with the exact
 * line of every heading so the UI can navigate to a requirement, not a file.
 */

import * as path from 'path';
import {
	findRequirementIds,
	normalizeRequirementId,
	shorten,
	stripMarkdown,
	titleFromSlug,
	tokenize
} from './text';

export type SpecKind = 'spec' | 'plan' | 'tasks' | 'constitution' | 'other';

export interface ParsedRequirement {
	/** Display form as written in the document, e.g. `FR-014`. */
	id?: string;
	/** Comparable form, e.g. `FR-14`. */
	normalizedId?: string;
	title: string;
	description: string;
	acceptanceCriteria: string[];
	line: number;
	endLine: number;
	tokens: string[];
	/** Numbers and quoted values the requirement commits to. */
	literals: string[];
	/** True when the whole document stands in for a single requirement. */
	implicit: boolean;
}

export interface ParsedTask {
	id?: string;
	text: string;
	done: boolean;
	line: number;
	paths: string[];
	requirementIds: string[];
}

export interface ParsedSpec {
	absPath: string;
	relPath: string;
	kind: SpecKind;
	/** Directory-based identity shared by spec.md/plan.md/tasks.md of a feature. */
	featureKey: string;
	featureSlug: string;
	featureName: string;
	titleLine: number;
	summary: string;
	requirements: ParsedRequirement[];
	tasks: ParsedTask[];
	referencedPaths: { path: string; line: number }[];
	requirementIds: string[];
	mtimeMs: number;
}

const HEADING = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const BULLET = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/;
const TASK_LINE = /^\s*[-*+]\s*\[( |x|X)\]\s*(.*)$/;
const METADATA_LINE = /^\s*(?:\*\*[^*]+\*\*\s*[:：]|\||<!--|<|\[!)/;
const INLINE_ID = /\b((?:FR|NFR|SC|BR|TR|US|AC|REQ)[-_ ]?\d{1,4})\b/i;
const PATH_LIKE = /(?:^|[\s(`'"|,])((?:\.\/)?(?:[\w.@-]+\/)+[\w.@-]+\.\w{1,6})/g;
const LITERAL = /"([^"]{1,40})"|'([^']{1,40})'|\b(\d+(?:\.\d+)?\s*(?:ms|s|m|h|kb|mb|gb|%)?)\b/gi;

const TITLE_PREFIXES = [
	/^feature\s+specification\s*[:\-–]\s*/i,
	/^specification\s*[:\-–]\s*/i,
	/^spec\s*[:\-–]\s*/i,
	/^implementation\s+plan\s*[:\-–]\s*/i,
	/^plan\s*[:\-–]\s*/i,
	/^tasks?\s*[:\-–]\s*/i,
	/^tasks?\s+for\s+/i
];

const REQUIREMENT_SECTION = /requirement|user stor|user scenario|acceptance|functional|behaviou?r|capabilit/i;
const ACCEPTANCE_SECTION = /acceptance|scenario|criteria/i;
const SUMMARY_SECTION = /^(overview|summary|purpose|description|objective|intent|context|primary user story)$/i;
const GENERIC_DIRECTORIES = new Set(['specs', 'spec', '.specify', '.speckit', '.spec-kit', 'speckit', 'memory', 'docs', 'documentation']);

function specKindFor(fileName: string): SpecKind {
	const lower = fileName.toLowerCase();
	if (lower === 'spec.md') { return 'spec'; }
	if (lower === 'plan.md') { return 'plan'; }
	if (lower === 'tasks.md') { return 'tasks'; }
	if (lower === 'constitution.md') { return 'constitution'; }
	return 'other';
}

function cleanTitle(raw: string): string {
	let title = stripMarkdown(raw);
	for (const prefix of TITLE_PREFIXES) {
		title = title.replace(prefix, '');
	}
	return title.trim();
}

function extractLiterals(text: string): string[] {
	const literals = new Set<string>();
	LITERAL.lastIndex = 0;
	let match = LITERAL.exec(text);
	while (match) {
		const value = (match[1] ?? match[2] ?? match[3] ?? '').trim();
		if (value) {
			literals.add(value.toLowerCase());
		}
		match = LITERAL.exec(text);
	}
	return [...literals];
}

function splitIdAndTitle(text: string): { id?: string; title: string } {
	const clean = stripMarkdown(text);
	const match = INLINE_ID.exec(clean);
	if (!match) {
		return { title: clean };
	}
	const id = match[1].toUpperCase().replace(/[_ ]/, '-');
	const remainder = clean
		.slice(match.index + match[1].length)
		.replace(/^\s*[:：\-–—.)]\s*/, '')
		.trim();
	return { id, title: remainder || clean };
}

/** Separates `Login — Allow a user to sign in` into a name and a sentence. */
function splitTitleAndDescription(raw: string): { title: string; rest: string } {
	const match = /^(.{2,48}?)\s*(?:[—–]|:)\s+(.+)$/.exec(raw);
	if (match && match[1].trim().split(/\s+/).length <= 6) {
		return { title: match[1].trim(), rest: match[2].trim() };
	}
	return { title: raw, rest: '' };
}

/** Parses one markdown document. Content is passed in so this stays testable. */
export function parseSpecContent(
	absPath: string,
	relPath: string,
	content: string,
	mtimeMs = 0
): ParsedSpec {
	const lines = content.split(/\r?\n/);
	const fileName = path.basename(relPath);
	const kind = specKindFor(fileName);

	const directory = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
	const directoryName = directory ? directory.slice(directory.lastIndexOf('/') + 1) : '';
	const useDirectoryIdentity = Boolean(directoryName) && !GENERIC_DIRECTORIES.has(directoryName.toLowerCase());
	const featureSlug = useDirectoryIdentity ? directoryName : fileName.replace(/\.(md|markdown)$/i, '');
	const featureKey = useDirectoryIdentity ? directory : relPath;

	const headings: { level: number; text: string; line: number }[] = [];
	const referencedPaths: { path: string; line: number }[] = [];
	const tasks: ParsedTask[] = [];
	let inFence = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (FENCE.test(line)) {
			inFence = !inFence;
			continue;
		}

		PATH_LIKE.lastIndex = 0;
		let pathMatch = PATH_LIKE.exec(line);
		while (pathMatch) {
			referencedPaths.push({ path: pathMatch[1].replace(/^\.\//, ''), line: i });
			pathMatch = PATH_LIKE.exec(line);
		}

		if (inFence) {
			continue;
		}

		const headingMatch = HEADING.exec(line);
		if (headingMatch) {
			headings.push({ level: headingMatch[1].length, text: headingMatch[2], line: i });
			continue;
		}

		const taskMatch = TASK_LINE.exec(line);
		if (taskMatch) {
			const text = stripMarkdown(taskMatch[2]);
			const idMatch = /^(T\d{1,4})\b/i.exec(text);
			const taskPaths: string[] = [];
			PATH_LIKE.lastIndex = 0;
			let taskPath = PATH_LIKE.exec(line);
			while (taskPath) {
				taskPaths.push(taskPath[1].replace(/^\.\//, ''));
				taskPath = PATH_LIKE.exec(line);
			}
			tasks.push({
				id: idMatch?.[1].toUpperCase(),
				text,
				done: taskMatch[1].toLowerCase() === 'x',
				line: i,
				paths: taskPaths,
				requirementIds: findRequirementIds(text).filter((id) => !id.startsWith('T-'))
			});
		}
	}

	const titleHeading = headings.find((heading) => heading.level === 1) ?? headings[0];
	const titleLine = titleHeading?.line ?? 0;
	const headingTitle = titleHeading ? cleanTitle(titleHeading.text) : '';
	const featureName = headingTitle && headingTitle.length > 2 ? headingTitle : titleFromSlug(featureSlug);

	const summary = extractSummary(lines, headings, titleLine);
	const requirements = extractRequirements(lines, headings, kind, featureName, summary, titleLine);

	const requirementIds = new Set<string>();
	for (const requirement of requirements) {
		if (requirement.normalizedId) {
			requirementIds.add(requirement.normalizedId);
		}
	}

	return {
		absPath,
		relPath,
		kind,
		featureKey,
		featureSlug,
		featureName,
		titleLine,
		summary,
		requirements,
		tasks,
		referencedPaths,
		requirementIds: [...requirementIds],
		mtimeMs
	};
}

function extractSummary(
	lines: string[],
	headings: { level: number; text: string; line: number }[],
	titleLine: number
): string {
	const summarySection = headings.find((heading) => SUMMARY_SECTION.test(stripMarkdown(heading.text)));
	const startLine = summarySection ? summarySection.line + 1 : titleLine + 1;
	const paragraph = readParagraph(lines, startLine);
	if (paragraph) {
		return shorten(paragraph, 200);
	}
	if (summarySection) {
		const fallback = readParagraph(lines, titleLine + 1);
		if (fallback) {
			return shorten(fallback, 200);
		}
	}
	return '';
}

function readParagraph(lines: string[], startLine: number): string {
	const collected: string[] = [];
	for (let i = startLine; i < lines.length && i < startLine + 40; i++) {
		const line = lines[i];
		if (HEADING.test(line)) {
			if (collected.length > 0) {
				break;
			}
			continue;
		}
		if (!line.trim()) {
			if (collected.length > 0) {
				break;
			}
			continue;
		}
		if (METADATA_LINE.test(line) || FENCE.test(line)) {
			if (collected.length > 0) {
				break;
			}
			continue;
		}
		collected.push(stripMarkdown(line));
	}
	return collected.join(' ').trim();
}

function extractRequirements(
	lines: string[],
	headings: { level: number; text: string; line: number }[],
	kind: SpecKind,
	featureName: string,
	summary: string,
	titleLine: number
): ParsedRequirement[] {
	const requirements: ParsedRequirement[] = [];
	const seen = new Map<string, ParsedRequirement>();

	const add = (requirement: ParsedRequirement): void => {
		const key = requirement.normalizedId ?? `title:${requirement.title.toLowerCase()}`;
		const existing = seen.get(key);
		if (existing) {
			if (requirement.description.length > existing.description.length) {
				existing.description = requirement.description;
				existing.literals = extractLiterals(`${existing.title} ${existing.description}`);
			}
			if (requirement.acceptanceCriteria.length > existing.acceptanceCriteria.length) {
				existing.acceptanceCriteria = requirement.acceptanceCriteria;
			}
			return;
		}
		seen.set(key, requirement);
		requirements.push(requirement);
	};

	// Heading-based requirements, e.g. `### FR-014 — Refund Payment`.
	for (let index = 0; index < headings.length; index++) {
		const heading = headings[index];
		if (heading.level === 1) {
			continue;
		}
		const headingText = stripMarkdown(heading.text);
		const hasId = INLINE_ID.test(headingText);
		const insideRequirementSection = isInsideRequirementSection(headings, index);
		if (!hasId && !insideRequirementSection) {
			continue;
		}
		if (!hasId && ACCEPTANCE_SECTION.test(headingText)) {
			continue;
		}
		if (!hasId && REQUIREMENT_SECTION.test(headingText) && headingText.split(/\s+/).length <= 3) {
			continue;
		}

		const endLine = sectionEnd(headings, index, lines.length);
		const { id, title: rawTitle } = splitIdAndTitle(headingText);
		const { title: shortTitle, rest } = splitTitleAndDescription(rawTitle || headingText);
		const body = readParagraph(lines, heading.line + 1);
		const criteria = collectCriteria(lines, heading.line + 1, endLine);
		const description = body || rest || criteria[0] || '';
		add({
			id,
			normalizedId: id ? normalizeRequirementId(id) : undefined,
			title: shortTitle || headingText,
			description,
			acceptanceCriteria: criteria,
			line: heading.line,
			endLine,
			tokens: tokenize(`${shortTitle} ${description}`),
			literals: extractLiterals(`${shortTitle} ${description} ${criteria.join(' ')}`),
			implicit: false
		});
	}

	// Bullet-based requirements, e.g. `- **FR-001**: The system MUST ...`.
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		if (FENCE.test(lines[i])) {
			inFence = !inFence;
			continue;
		}
		if (inFence || TASK_LINE.test(lines[i])) {
			continue;
		}
		const bullet = BULLET.exec(lines[i]);
		if (!bullet) {
			continue;
		}
		const text = stripMarkdown(bullet[2]);
		const idMatch = INLINE_ID.exec(text);
		if (!idMatch || idMatch.index > 4) {
			continue;
		}
		const indent = bullet[1].length;
		const { id, title: rawTitle } = splitIdAndTitle(text);
		const { title: shortTitle, rest } = splitTitleAndDescription(rawTitle);
		const criteria = collectNestedBullets(lines, i + 1, indent);
		const description = rest || rawTitle;
		add({
			id,
			normalizedId: id ? normalizeRequirementId(id) : undefined,
			title: shorten(shortTitle, 90),
			description,
			acceptanceCriteria: criteria,
			line: i,
			endLine: i + criteria.length,
			tokens: tokenize(`${shortTitle} ${description}`),
			literals: extractLiterals(`${rawTitle} ${criteria.join(' ')}`),
			implicit: false
		});
	}

	// A spec with no explicit requirements still describes one feature.
	if (requirements.length === 0 && (kind === 'spec' || kind === 'other')) {
		requirements.push({
			title: featureName,
			description: summary,
			acceptanceCriteria: [],
			line: titleLine,
			endLine: lines.length - 1,
			tokens: tokenize(`${featureName} ${summary}`),
			literals: extractLiterals(`${featureName} ${summary}`),
			implicit: true
		});
	}

	requirements.sort((a, b) => a.line - b.line);
	return requirements;
}

function isInsideRequirementSection(
	headings: { level: number; text: string; line: number }[],
	index: number
): boolean {
	const current = headings[index];
	for (let i = index - 1; i >= 0; i--) {
		if (headings[i].level < current.level) {
			// The document title is not a requirements section.
			if (headings[i].level === 1) {
				return false;
			}
			return REQUIREMENT_SECTION.test(stripMarkdown(headings[i].text));
		}
	}
	return false;
}

function sectionEnd(
	headings: { level: number; text: string; line: number }[],
	index: number,
	totalLines: number
): number {
	const current = headings[index];
	for (let i = index + 1; i < headings.length; i++) {
		if (headings[i].level <= current.level) {
			return Math.max(current.line, headings[i].line - 1);
		}
	}
	return totalLines - 1;
}

function collectCriteria(lines: string[], startLine: number, endLine: number): string[] {
	const criteria: string[] = [];
	for (let i = startLine; i <= endLine && i < lines.length; i++) {
		const bullet = BULLET.exec(lines[i]);
		if (bullet) {
			const text = stripMarkdown(bullet[2]);
			if (text) {
				criteria.push(text);
			}
			continue;
		}
		const line = stripMarkdown(lines[i]);
		if (/^(given|when|then|and)\b/i.test(line)) {
			criteria.push(line);
		}
	}
	return criteria.slice(0, 12);
}

function collectNestedBullets(lines: string[], startLine: number, parentIndent: number): string[] {
	const criteria: string[] = [];
	for (let i = startLine; i < lines.length; i++) {
		if (!lines[i].trim()) {
			break;
		}
		const bullet = BULLET.exec(lines[i]);
		if (!bullet || bullet[1].length <= parentIndent) {
			break;
		}
		criteria.push(stripMarkdown(bullet[2]));
	}
	return criteria.slice(0, 12);
}
