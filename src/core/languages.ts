/**
 * Language support registry. Adding a language means adding an entry here;
 * nothing else in the analysis is language specific.
 */

export type SymbolKind = 'function' | 'class' | 'method' | 'const' | 'type';

export interface SymbolPattern {
	regex: RegExp;
	kind: SymbolKind;
	/** `auto` defers to the language's own visibility convention. */
	exported: boolean | 'auto';
}

export interface LanguageRule {
	id: string;
	label: string;
	extensions: string[];
	lineCommentPrefixes: string[];
	blockCommentDelimiters: string[];
	importPatterns: RegExp[];
	symbolPatterns: SymbolPattern[];
	testNamePatterns: RegExp[];
	logPatterns: RegExp[];
	/** Decides visibility for `exported: 'auto'` patterns. */
	isExported?: (name: string, line: string) => boolean;
}

const TS_JS: LanguageRule = {
	id: 'typescript-javascript',
	label: 'TypeScript/JavaScript',
	extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'],
	lineCommentPrefixes: ['//'],
	blockCommentDelimiters: ['/*', '*/', '*'],
	importPatterns: [/^\s*import\s.+from\s+['"](.+)['"]/, /require\(\s*['"](.+)['"]\s*\)/],
	symbolPatterns: [
		{ regex: /^\s*export\s+(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: 'function', exported: true },
		{ regex: /^\s*export\s+(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class', exported: true },
		{ regex: /^\s*export\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/, kind: 'type', exported: true },
		{ regex: /^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/, kind: 'const', exported: true },
		{ regex: /^\s*(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/, kind: 'function', exported: false },
		{ regex: /^\s*(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/, kind: 'class', exported: false },
		{ regex: /^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/, kind: 'function', exported: false }
	],
	testNamePatterns: [/\b(?:describe|context|suite|it|test)\s*(?:\.\w+)?\s*\(\s*(['"`])([^'"`]+)\1/],
	logPatterns: [/^\s*console\.\w+\(/, /^\s*logger?\.\w+\(/]
};

const PYTHON: LanguageRule = {
	id: 'python',
	label: 'Python',
	extensions: ['.py'],
	lineCommentPrefixes: ['#'],
	blockCommentDelimiters: ['"""', "'''"],
	importPatterns: [/^\s*(?:from\s+([\w.]+)\s+)?import\s+([\w.,\s*]+)/],
	symbolPatterns: [
		{ regex: /^def\s+([A-Za-z_]\w*)/, kind: 'function', exported: 'auto' },
		{ regex: /^class\s+([A-Za-z_]\w*)/, kind: 'class', exported: 'auto' },
		{ regex: /^\s+def\s+([A-Za-z_]\w*)/, kind: 'method', exported: false }
	],
	testNamePatterns: [/^\s*def\s+(test_\w+)/, /^\s*class\s+(Test\w+)/],
	logPatterns: [/^\s*print\(/, /^\s*logg(?:er|ing)\.\w+\(/],
	isExported: (name) => !name.startsWith('_')
};

const CSHARP: LanguageRule = {
	id: 'csharp',
	label: 'C#',
	extensions: ['.cs'],
	lineCommentPrefixes: ['//'],
	blockCommentDelimiters: ['/*', '*/', '*'],
	importPatterns: [/^\s*using\s+([\w.]+)\s*;/],
	symbolPatterns: [
		{ regex: /^\s*(?:public|internal)\s+(?:static\s+|abstract\s+|sealed\s+|partial\s+)*(?:class|struct|interface|record)\s+([A-Za-z_]\w*)/, kind: 'class', exported: true },
		{ regex: /^\s*(?:private|protected)\s+(?:static\s+|abstract\s+|sealed\s+|partial\s+)*(?:class|struct|interface|record)\s+([A-Za-z_]\w*)/, kind: 'class', exported: false },
		{ regex: /^\s*(?:public|internal)\s+(?:static\s+|async\s+|virtual\s+|override\s+|sealed\s+)*[\w<>[\],\s?]+?\s+([A-Za-z_]\w*)\s*\(/, kind: 'method', exported: true }
	],
	testNamePatterns: [/^\s*public\s+(?:async\s+)?(?:void|Task)\s+(\w+)\s*\(/],
	logPatterns: [/^\s*Console\.\w+\(/, /^\s*_?[Ll]ogger\.\w+\(/]
};

const GO: LanguageRule = {
	id: 'go',
	label: 'Go',
	extensions: ['.go'],
	lineCommentPrefixes: ['//'],
	blockCommentDelimiters: ['/*', '*/'],
	importPatterns: [/^\s*import\s+(?:\(|")/],
	symbolPatterns: [
		{ regex: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/, kind: 'function', exported: 'auto' },
		{ regex: /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/, kind: 'class', exported: 'auto' }
	],
	testNamePatterns: [/^func\s+(Test\w+)/],
	logPatterns: [/^\s*fmt\.Print\w*\(/, /^\s*log\.\w+\(/],
	isExported: (name) => /^[A-Z]/.test(name)
};

const JAVA: LanguageRule = {
	id: 'java',
	label: 'Java',
	extensions: ['.java'],
	lineCommentPrefixes: ['//'],
	blockCommentDelimiters: ['/*', '*/', '*'],
	importPatterns: [/^\s*import\s+([\w.]+)\s*;/],
	symbolPatterns: [
		{ regex: /^\s*(?:public|protected)\s+(?:static\s+|final\s+|abstract\s+)*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/, kind: 'class', exported: true },
		{ regex: /^\s*(?:public|protected)\s+(?:static\s+|final\s+|synchronized\s+)*[\w<>[\],\s?]+?\s+([A-Za-z_]\w*)\s*\(/, kind: 'method', exported: true }
	],
	testNamePatterns: [/^\s*public\s+void\s+(\w+)\s*\(/],
	logPatterns: [/^\s*System\.out\.print\w*\(/, /^\s*(?:log|LOGGER)\.\w+\(/]
};

export const LANGUAGE_RULES: LanguageRule[] = [TS_JS, PYTHON, CSHARP, GO, JAVA];

export const LANGUAGE_BY_EXTENSION = new Map<string, LanguageRule>(
	LANGUAGE_RULES.flatMap((rule) => rule.extensions.map((ext) => [ext, rule] as const))
);

/** Falls back to C-style conventions for extensions added via settings. */
export const GENERIC_LANGUAGE: LanguageRule = {
	id: 'generic',
	label: 'Other',
	extensions: [],
	lineCommentPrefixes: ['//', '#', '--'],
	blockCommentDelimiters: ['/*', '*/', '*'],
	importPatterns: [],
	symbolPatterns: [
		{ regex: /^\s*(?:public\s+|export\s+)?(?:function|func|def|class|sub)\s+([A-Za-z_]\w*)/, kind: 'function', exported: true }
	],
	testNamePatterns: [],
	logPatterns: []
};

export function languageForExtension(ext: string): LanguageRule {
	return LANGUAGE_BY_EXTENSION.get(ext.toLowerCase()) ?? GENERIC_LANGUAGE;
}
