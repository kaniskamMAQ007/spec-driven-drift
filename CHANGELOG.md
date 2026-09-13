# Change Log

All notable changes to the "spec-drift-monitor" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.2.0]

### Added

- SpecKit sidebar with a **Features** / **Drift** toggle, feature cards and filters.
- Specification parsing: requirements, requirement IDs, acceptance criteria and task lists with exact line numbers.
- Code and test indexing for TypeScript, JavaScript, Python, C#, Go and Java.
- Matching of requirements to code and tests using requirement IDs, task lists, spec-referenced paths and name similarity.
- Four findings: code without a specification, specification without code, specification possibly outdated, and uncertain relationship.
- Git-based change analysis that ignores comment, import, logging, formatting and behaviour-preserving refactors.
- Click-to-open navigation to the exact requirement, symbol or test.
- Settings for Git use, scan limits, extra excludes and extra source extensions.
- Real tests for parsing, indexing, scanning, matching, drift detection, navigation, filtering and the empty states.

### Changed

- Drift is no longer decided by comparing file timestamps. Timestamps are now only a fallback when Git is unavailable, and the UI says when that fallback was used.
- An empty workspace no longer reports "No Drift Detected"; it explains that no specifications were found.

## [0.1.0]

- Initial release.
