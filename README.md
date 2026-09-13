# SpecKit Explorer &amp; Drift Detector

**See which features your SpecKit specifications describe, where they are implemented and tested, and what needs your attention.**

[![GitHub](https://img.shields.io/badge/GitHub-kaniskamMAQ007-blue?style=flat&logo=github)](https://github.com/kaniskamMAQ007)

## Overview

Open a project and the extension reads your SpecKit specifications, your source code, your tests and your Git history. It then shows one sidebar with two views:

- **Features** — every feature the specifications describe, with its summary, its specification, its implementation, its tests and a clear status.
- **Drift** — only the things that need attention, in plain English, with a suggested action.

Every path is clickable and opens the file at the exact requirement, symbol or test, not at line 1.

## What it reports

| Status | Meaning |
| --- | --- |
| 🔴 **Feature has code but no specification** | Code that looks like a feature, with no specification describing it. |
| 🔴 **Specification has feature but no implementation** | A requirement with no code implementing it. |
| 🟠 **Specification may be outdated** | The code for a feature changed, the specification did not, and the change looks like a change in behaviour. |
| 🟡 **Spec/code relationship uncertain** | A specification and some code may describe the same feature, but the link could not be confirmed. |
| ✓ **In sync** | The specification, the code and the tests line up. |

If no SpecKit specification is found, the view says so instead of claiming that nothing has drifted.

## How features are detected

1. **Specifications** — markdown named `spec.md`, `plan.md`, `tasks.md`, `constitution.md`, `research.md`, `data-model.md` or `quickstart.md`, plus any markdown inside a `specs/`, `spec/`, `.specify/` or `.speckit/` folder.
2. **Requirements** — requirement IDs such as `FR-014`, requirement headings and requirement bullets, along with their descriptions, acceptance criteria and exact line numbers.
3. **Code and tests** — exported functions, classes and methods, test names, and any requirement IDs mentioned in comments or test titles.

## How code is matched to a specification

Deterministic signals are used first, and each one is explained in the card:

1. The requirement ID appears in the file (for example `FR-014` in a comment or test name).
2. `tasks.md` links a task for that requirement to a file path.
3. The specification names the file path directly.
4. The names in the path, the symbols and the tests match the wording of the requirement.

Strong signals produce a confirmed link. Weak signals produce a **relationship uncertain** finding instead of a false claim of drift. No language model is required, and the extension works offline.

## How drift is decided

Drift is **not** decided by file timestamps. For each feature the extension compares the change set reported by Git (branch changes, uncommitted changes, or the last commit) and looks at the changed lines:

- Comment, import, logging and formatting-only changes are ignored.
- A change that does not touch the wording of the requirement is not attributed to it.
- A rewrite that still does what the requirement describes is reported as an implementation change, not drift. Replacing an in-memory sort with `ORDER BY created_at ASC` does not raise a finding.
- A changed condition, or a changed value the specification commits to, raises **specification may be outdated** — unless the specification was changed as well.

If Git is unavailable, the extension falls back to comparing file times and says clearly that it did so.

## Settings

| Setting | Default | Purpose |
| --- | --- | --- |
| `specDriftMonitor.useGit` | `true` | Use Git history instead of file times. |
| `specDriftMonitor.maxFilesToScan` | `20000` | Upper bound for a scan. |
| `specDriftMonitor.excludeGlobs` | `[]` | Extra gitignore-style patterns to skip. |
| `specDriftMonitor.additionalSourceExtensions` | `[]` | Extra source extensions, for example `.rb`. |

Built-in language support: TypeScript, JavaScript, Python, C#, Go and Java. `.gitignore` and common build, cache and dependency folders are skipped.

## Usage

1. Open a folder containing SpecKit specifications.
2. Open the **SpecKit** view in the activity bar.
3. Switch between **Features** and **Drift**, and filter findings with **All / Missing / Outdated / Uncertain / In Sync**.
4. Click any spec, code or test path to jump straight to it.
5. Use the refresh button, or `SpecKit: Rescan Workspace`, to scan again.

Results refresh automatically when specifications or source files change, with debouncing and caching so only changed files are re-read.

## Developing and testing

```powershell
npm install
npm run compile      # type-check, lint and bundle
npm run test:core    # analysis tests (no VS Code needed)
npm test             # VS Code integration tests
npm run watch        # then press F5 to launch the extension host
```

`test-fixtures/` holds small example projects used by the tests: `sample-project` (all four finding types), `ordering-project` (Git behaviour vs refactor) and `no-specs`.

> On Windows, `npm test` fails if the project path contains spaces. This is a limitation of `@vscode/test-electron`, which passes paths to the test host unquoted. Run it from a path without spaces.

## Known limitations

- Only the first folder of a multi-root workspace is analysed.
- Only the repository-root `.gitignore` is read; nested ignore files are not.
- Symbols are found with per-language patterns rather than a full parser, so unusual declarations can be missed.
- Name-based matching is weaker in repositories whose folder names do not resemble the specification wording; those cases are reported as uncertain rather than guessed.
- A requirement that is implemented across many files may only list the strongest matches.


## Release Notes

### 0.2.0

- Features view: every specification requirement with its summary, spec, implementation, tests and status
- Drift view: code without a specification, specification without code, specification possibly outdated, and uncertain relationships
- Matching by requirement ID, task list, spec-referenced paths and name similarity
- Drift decided from Git changes instead of file timestamps, with formatting and refactor changes ignored
- Click-to-open at the exact requirement, symbol or test

### 0.1.0

- Initial release, comparing source file timestamps against SpecKit artifacts

---

## Author

**kaniskamMAQ007** — [GitHub](https://github.com/kaniskamMAQ007)

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
