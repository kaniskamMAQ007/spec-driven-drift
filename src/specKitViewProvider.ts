import * as vscode from 'vscode';
import {
	AnalysisResult,
	CodeLocation,
	DriftFilter,
	Feature,
	Finding,
	emptyResult,
	findingMatchesFilter
} from './core/types';

export type ViewTab = 'features' | 'drift';

const TAB_KEY = 'specKit.tab';
const FILTER_KEY = 'specKit.filter';

const STATUS_LABEL: Record<Feature['status'], string> = {
	inSync: '✓ IN SYNC',
	missingSpec: '🔴 NO SPECIFICATION',
	missingImplementation: '🔴 NOT IMPLEMENTED',
	possiblyOutdated: '🟠 SPECIFICATION MAY BE OUTDATED',
	uncertain: '🟡 RELATIONSHIP UNCERTAIN'
};

const STATUS_CLASS: Record<Feature['status'], string> = {
	inSync: 'ok',
	missingSpec: 'danger',
	missingImplementation: 'danger',
	possiblyOutdated: 'warn',
	uncertain: 'unsure'
};

const FINDING_HEADING: Record<Finding['type'], string> = {
	codeWithoutSpec: '🔴 FEATURE HAS CODE BUT NO SPECIFICATION',
	specWithoutCode: '🔴 SPECIFICATION HAS FEATURE BUT NO IMPLEMENTATION',
	specMayBeOutdated: '🟠 SPECIFICATION MAY BE OUTDATED',
	uncertainRelationship: '🟡 SPEC/CODE RELATIONSHIP UNCERTAIN'
};

const FINDING_CLASS: Record<Finding['type'], string> = {
	codeWithoutSpec: 'danger',
	specWithoutCode: 'danger',
	specMayBeOutdated: 'warn',
	uncertainRelationship: 'unsure'
};

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => {
		switch (char) {
			case '&': return '&amp;';
			case '<': return '&lt;';
			case '>': return '&gt;';
			case '"': return '&quot;';
			default: return '&#39;';
		}
	});
}

function formatLocation(location: CodeLocation): string {
	return `${location.relPath}:${location.line + 1}`;
}

function nonce(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
	let value = '';
	for (let i = 0; i < 32; i++) {
		value += chars[Math.floor(Math.random() * chars.length)];
	}
	return value;
}

/**
 * Renders the SpecKit sidebar. Locations are referenced by generated id so the
 * webview never supplies a file path back to the extension.
 */
export class SpecKitViewProvider implements vscode.WebviewViewProvider {
	public static readonly viewType = 'specDriftMonitor.driftView';

	private view?: vscode.WebviewView;
	private result: AnalysisResult = emptyResult('scanning');
	private tab: ViewTab;
	private filter: DriftFilter;
	private readonly locations = new Map<string, CodeLocation>();
	private locationCounter = 0;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly memento: vscode.Memento,
		private readonly onRefreshRequested: () => void,
		private readonly onOpenLocation: (location: CodeLocation) => void
	) {
		this.tab = this.memento.get<ViewTab>(TAB_KEY, 'features');
		this.filter = this.memento.get<DriftFilter>(FILTER_KEY, 'all');
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
		webviewView.webview.html = this.buildShell(webviewView.webview);

		webviewView.webview.onDidReceiveMessage((message: { type: string; value?: string }) => {
			switch (message.type) {
				case 'ready':
					this.render();
					break;
				case 'refresh':
					this.onRefreshRequested();
					break;
				case 'tab':
					if (message.value === 'features' || message.value === 'drift') {
						this.tab = message.value;
						void this.memento.update(TAB_KEY, this.tab);
						this.render();
					}
					break;
				case 'filter':
					this.filter = (message.value ?? 'all') as DriftFilter;
					void this.memento.update(FILTER_KEY, this.filter);
					this.render();
					break;
				case 'open': {
					const location = message.value ? this.locations.get(message.value) : undefined;
					if (location) {
						this.onOpenLocation(location);
					}
					break;
				}
			}
		});
	}

	setResult(result: AnalysisResult): void {
		this.result = result;
		this.render();
	}

	setScanning(): void {
		this.result = { ...emptyResult('scanning'), summary: this.result.summary };
		this.render();
	}

	showTab(tab: ViewTab): void {
		this.tab = tab;
		void this.memento.update(TAB_KEY, tab);
		this.render();
	}

	private trackLocation(location: CodeLocation): string {
		const id = `loc-${this.locationCounter++}`;
		this.locations.set(id, location);
		return id;
	}

	private render(): void {
		if (!this.view) {
			return;
		}
		this.locations.clear();
		this.locationCounter = 0;
		void this.view.webview.postMessage({
			type: 'update',
			tab: this.tab,
			filter: this.filter,
			header: this.renderHeader(),
			body: this.tab === 'features' ? this.renderFeatures() : this.renderDrift()
		});
	}

	private renderHeader(): string {
		const { state, summary, changeScope } = this.result;
		if (state === 'scanning') {
			return '<div class="summary">Scanning SpecKit project…</div>';
		}
		if (state === 'noWorkspace' || state === 'noSpecs') {
			return '';
		}
		const parts = [
			`<span class="stat"><b>${summary.features}</b> features</span>`,
			`<span class="stat ok"><b>${summary.inSync}</b> in sync</span>`,
			`<span class="stat danger"><b>${summary.missingSpec}</b> missing spec</span>`,
			`<span class="stat danger"><b>${summary.missingImplementation}</b> not implemented</span>`,
			`<span class="stat warn"><b>${summary.possiblyOutdated}</b> possible drift</span>`,
			`<span class="stat unsure"><b>${summary.uncertain}</b> uncertain</span>`
		];
		const scope = changeScope
			? `<div class="scope">Comparing code ${escapeHtml(changeScope)}.</div>`
			: '';
		return `<div class="summary">${parts.join('')}</div>${scope}`;
	}

	private renderEmptyStates(): string | undefined {
		const { state, summary, notes } = this.result;
		if (state === 'scanning') {
			return `<div class="notice"><div class="spinner"></div><div><b>Scanning SpecKit project…</b><p>Reading specifications, source files and tests.</p></div></div>`;
		}
		if (state === 'noWorkspace') {
			return `<div class="notice"><b>No folder is open</b><p>Open the folder that contains your project to see its features.</p></div>`;
		}
		if (state === 'noSpecs') {
			return `<div class="notice warn-notice"><b>⚠ No SpecKit specifications found</b>
				<p>We couldn't find any SpecKit specification files in this workspace, so we cannot tell whether the code matches a specification.</p>
				<p class="muted">We looked for spec.md, plan.md, tasks.md and constitution.md, and for markdown inside spec folders. We did find ${summary.sourceFiles} source files and ${summary.testFiles} test files.</p>
				${notes.map((note) => `<p class="muted">${escapeHtml(note)}</p>`).join('')}</div>`;
		}
		return undefined;
	}

	private renderFeatures(): string {
		const empty = this.renderEmptyStates();
		if (empty) {
			return empty;
		}
		if (this.result.features.length === 0) {
			return `<div class="notice"><b>No features found</b><p>Specifications were found, but no requirements could be read from them.</p></div>`;
		}

		const groups = new Map<string, Feature[]>();
		for (const feature of this.result.features) {
			const list = groups.get(feature.group) ?? [];
			list.push(feature);
			groups.set(feature.group, list);
		}

		const sections: string[] = [];
		for (const [group, features] of groups) {
			const worst = features.some((feature) => feature.status === 'missingSpec' || feature.status === 'missingImplementation')
				? 'danger'
				: features.some((feature) => feature.status === 'possiblyOutdated')
					? 'warn'
					: features.some((feature) => feature.status === 'uncertain')
						? 'unsure'
						: 'ok';
			sections.push(`<div class="group">
				<h2 class="group-header"><span class="dot ${worst}"></span>${escapeHtml(group)}<span class="count">${features.length}</span></h2>
				${features.map((feature) => this.renderFeatureCard(feature)).join('')}
			</div>`);
		}
		return sections.join('') + this.renderNotes();
	}

	private renderFeatureCard(feature: Feature): string {
		const rows: string[] = [];
		if (feature.specLocation) {
			rows.push(this.renderLocationRow('📄', 'Spec', feature.specLocation));
		}
		for (const location of feature.implementationLocations.slice(0, 3)) {
			rows.push(this.renderLocationRow('💻', 'Implementation', location));
		}
		for (const location of feature.testLocations.slice(0, 2)) {
			rows.push(this.renderLocationRow('🧪', 'Tests', location));
		}
		if (feature.implementationLocations.length === 0 && feature.status !== 'missingImplementation') {
			rows.push('<div class="loc-empty">No implementation found.</div>');
		}
		if (feature.testLocations.length === 0) {
			rows.push('<div class="loc-empty">No tests found.</div>');
		}

		const summaryNote = feature.summarySource === 'code'
			? '<div class="inferred">Summary taken from the code, because no specification was found.</div>'
			: '';

		return `<section class="card ${STATUS_CLASS[feature.status]}" title="${escapeHtml(this.tooltipFor(feature))}">
			<h3 class="name">${escapeHtml(feature.name)}</h3>
			${feature.requirementId ? `<div class="req-id">${escapeHtml(feature.requirementId)}</div>` : ''}
			<p class="summary-text">${escapeHtml(feature.summary)}</p>
			${summaryNote}
			<div class="locations">${rows.join('')}</div>
			<div class="status-box ${STATUS_CLASS[feature.status]}">${escapeHtml(STATUS_LABEL[feature.status])}</div>
			<p class="reason">${escapeHtml(feature.statusReason)}</p>
		</section>`;
	}

	private tooltipFor(feature: Feature): string {
		const lines = [feature.name, '', feature.summary, ''];
		if (feature.requirementId) {
			lines.push(`Specification: ${feature.requirementId}${feature.specLocation ? ` — ${formatLocation(feature.specLocation)}` : ''}`);
		} else if (feature.specLocation) {
			lines.push(`Specification: ${formatLocation(feature.specLocation)}`);
		} else {
			lines.push('Specification: none found');
		}
		lines.push(
			`Implementation: ${feature.implementationLocations.length > 0
				? feature.implementationLocations.map(formatLocation).slice(0, 3).join(', ')
				: 'none found'}`
		);
		lines.push(
			`Tests: ${feature.testLocations.length > 0
				? feature.testLocations.map(formatLocation).slice(0, 2).join(', ')
				: 'none found'}`
		);
		lines.push('', `Status: ${feature.statusReason}`);
		if (feature.evidence.length > 0) {
			lines.push('', `Why we matched this: ${feature.evidence.join(' ')}`);
		}
		return lines.join('\n');
	}

	private renderDrift(): string {
		const empty = this.renderEmptyStates();
		if (empty) {
			return empty;
		}

		const counts = {
			all: this.result.findings.length,
			missing: this.result.findings.filter((finding) => findingMatchesFilter(finding, 'missing')).length,
			outdated: this.result.findings.filter((finding) => findingMatchesFilter(finding, 'outdated')).length,
			uncertain: this.result.findings.filter((finding) => findingMatchesFilter(finding, 'uncertain')).length,
			inSync: this.result.features.filter((feature) => feature.status === 'inSync').length
		};

		const chips: [DriftFilter, string, number][] = [
			['all', 'All', counts.all],
			['missing', '🔴 Missing', counts.missing],
			['outdated', '🟠 Outdated', counts.outdated],
			['uncertain', '🟡 Uncertain', counts.uncertain],
			['inSync', '🟢 In Sync', counts.inSync]
		];

		const filterBar = `<div class="chips" role="group" aria-label="Filter findings">${chips
			.map(
				([value, label, count]) =>
					`<button class="chip${this.filter === value ? ' active' : ''}" data-filter="${value}" aria-pressed="${this.filter === value}">${escapeHtml(label)} <span class="count">${count}</span></button>`
			)
			.join('')}</div>`;

		if (this.filter === 'inSync') {
			const inSync = this.result.features.filter((feature) => feature.status === 'inSync');
			const body = inSync.length === 0
				? `<div class="notice"><b>Nothing is confirmed in sync yet</b><p>No feature has both a specification and matching code without open questions.</p></div>`
				: inSync.map((feature) => this.renderFeatureCard(feature)).join('');
			return filterBar + body + this.renderNotes();
		}

		const visible = this.result.findings.filter((finding) => findingMatchesFilter(finding, this.filter));
		if (visible.length === 0) {
			return `${filterBar}<div class="notice ok-notice"><b>Nothing needs your attention here</b><p>No findings match this filter.</p></div>${this.renderNotes()}`;
		}
		return filterBar + visible.map((finding) => this.renderFindingCard(finding)).join('') + this.renderNotes();
	}

	private renderFindingCard(finding: Finding): string {
		const rows: string[] = [];
		if (finding.codeLocation) {
			rows.push(this.renderLocationRow('💻', 'Code', finding.codeLocation));
		}
		if (finding.specLocation) {
			rows.push(this.renderLocationRow('📄', 'Spec', finding.specLocation));
		}
		if (finding.testLocation) {
			rows.push(this.renderLocationRow('🧪', 'Tests', finding.testLocation));
		}
		const evidence = finding.evidence.length > 0
			? `<details class="evidence"><summary>Why we are showing this</summary><ul>${finding.evidence
				.map((item) => `<li>${escapeHtml(item)}</li>`)
				.join('')}</ul></details>`
			: '';

		return `<section class="card finding ${FINDING_CLASS[finding.type]}">
			<div class="status-box ${FINDING_CLASS[finding.type]}">${escapeHtml(FINDING_HEADING[finding.type])}</div>
			<h3 class="name">${escapeHtml(finding.featureName)}</h3>
			<p class="explanation">${escapeHtml(finding.explanation)}</p>
			<div class="locations">${rows.join('')}</div>
			${evidence}
			<div class="action"><span class="action-label">Suggested action</span><p>${escapeHtml(finding.suggestedAction)}</p></div>
		</section>`;
	}

	private renderLocationRow(icon: string, label: string, location: CodeLocation): string {
		const id = this.trackLocation(location);
		const detail = location.label ? ` — ${location.label}` : '';
		return `<button class="loc" data-open="${id}" title="${escapeHtml(`Open ${formatLocation(location)}${detail}`)}">
			<span class="loc-icon" aria-hidden="true">${icon}</span>
			<span class="loc-label">${escapeHtml(label)}</span>
			<span class="loc-path">${escapeHtml(formatLocation(location))}${location.label ? `<span class="loc-symbol">${escapeHtml(location.label)}</span>` : ''}</span>
		</button>`;
	}

	private renderNotes(): string {
		if (this.result.notes.length === 0) {
			return '';
		}
		return `<div class="notes">${this.result.notes.map((note) => `<p>${escapeHtml(note)}</p>`).join('')}</div>`;
	}

	private buildShell(webview: vscode.Webview): string {
		const scriptNonce = nonce();
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${scriptNonce}'; script-src 'nonce-${scriptNonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${scriptNonce}">
	:root { --ok: var(--vscode-charts-green, #89d185); --danger: var(--vscode-charts-red, #f14c4c); --warn: var(--vscode-charts-orange, #e0a336); --unsure: var(--vscode-charts-yellow, #d7ba7d); }
	body { padding: 0 8px 16px; font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); }
	.tabs { display: flex; gap: 4px; position: sticky; top: 0; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); padding: 8px 0 6px; z-index: 2; }
	.tab { flex: 1; padding: 6px 10px; border: 1px solid var(--vscode-panel-border, transparent); border-radius: 4px; background: transparent; color: var(--vscode-foreground); cursor: pointer; font-size: 12px; font-weight: 600; }
	.tab[aria-selected="true"] { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
	.tab:focus-visible, .chip:focus-visible, .loc:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
	.summary { display: flex; flex-wrap: wrap; gap: 4px 10px; font-size: 11px; color: var(--vscode-descriptionForeground); padding: 2px 0 4px; }
	.stat.ok b { color: var(--ok); } .stat.danger b { color: var(--danger); } .stat.warn b { color: var(--warn); } .stat.unsure b { color: var(--unsure); }
	.scope { font-size: 11px; color: var(--vscode-descriptionForeground); padding-bottom: 6px; font-style: italic; }
	.chips { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 0 10px; }
	.chip { padding: 3px 8px; border-radius: 10px; border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.4)); background: transparent; color: var(--vscode-foreground); cursor: pointer; font-size: 11px; }
	.chip.active { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border-color: var(--vscode-button-background); }
	.chip .count, .group-header .count { opacity: .75; margin-left: 2px; }
	.group { margin-bottom: 14px; }
	.group-header { display: flex; align-items: center; gap: 6px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--vscode-descriptionForeground); margin: 6px 0; font-weight: 600; }
	.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
	.dot.ok { background: var(--ok); } .dot.danger { background: var(--danger); } .dot.warn { background: var(--warn); } .dot.unsure { background: var(--unsure); }
	.card { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); border-left-width: 3px; border-radius: 6px; padding: 10px; margin-bottom: 10px; background: var(--vscode-editorWidget-background, transparent); }
	.card.ok { border-left-color: var(--ok); } .card.danger { border-left-color: var(--danger); } .card.warn { border-left-color: var(--warn); } .card.unsure { border-left-color: var(--unsure); }
	.name { margin: 0 0 2px; font-size: 13px; font-weight: 600; }
	.req-id { font-size: 11px; color: var(--vscode-textLink-foreground); margin-bottom: 4px; }
	.summary-text, .explanation { margin: 0 0 8px; font-size: 12px; line-height: 1.45; color: var(--vscode-descriptionForeground); }
	.explanation { color: var(--vscode-foreground); }
	.inferred, .loc-empty { font-size: 11px; color: var(--vscode-descriptionForeground); font-style: italic; padding: 2px 0; }
	.locations { display: flex; flex-direction: column; gap: 2px; margin-bottom: 8px; }
	.loc { display: grid; grid-template-columns: 16px 92px 1fr; align-items: baseline; gap: 6px; width: 100%; text-align: left; background: transparent; border: none; border-radius: 4px; padding: 3px 4px; color: var(--vscode-foreground); cursor: pointer; font-size: 11px; font-family: inherit; }
	.loc:hover { background: var(--vscode-list-hoverBackground); }
	.loc-label { color: var(--vscode-descriptionForeground); text-transform: uppercase; font-size: 10px; letter-spacing: .04em; }
	.loc-path { font-family: var(--vscode-editor-font-family); color: var(--vscode-textLink-foreground); overflow-wrap: anywhere; }
	.loc-symbol { display: block; color: var(--vscode-descriptionForeground); font-family: var(--vscode-font-family); overflow-wrap: break-word; }
	.status-box { text-align: center; font-weight: 700; font-size: 11px; letter-spacing: .05em; padding: 7px 6px; border-radius: 4px; border: 1px solid; margin: 8px 0 6px; }
	.status-box.ok { color: var(--ok); border-color: var(--ok); }
	.status-box.danger { color: var(--danger); border-color: var(--danger); }
	.status-box.warn { color: var(--warn); border-color: var(--warn); }
	.status-box.unsure { color: var(--unsure); border-color: var(--unsure); }
	.finding .status-box { margin-top: 0; }
	.reason { margin: 0; font-size: 11px; color: var(--vscode-descriptionForeground); line-height: 1.4; }
	.action { border-top: 1px dashed var(--vscode-panel-border, rgba(128,128,128,.35)); padding-top: 6px; }
	.action-label { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: var(--vscode-descriptionForeground); }
	.action p { margin: 2px 0 0; font-size: 12px; }
	.evidence { margin-bottom: 8px; font-size: 11px; color: var(--vscode-descriptionForeground); }
	.evidence summary { cursor: pointer; }
	.evidence ul { margin: 4px 0 0; padding-left: 16px; }
	.notice { border: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); border-radius: 6px; padding: 12px; display: flex; gap: 10px; align-items: flex-start; font-size: 12px; }
	.notice p { margin: 4px 0 0; color: var(--vscode-descriptionForeground); line-height: 1.45; }
	.notice.warn-notice { border-color: var(--warn); }
	.notice.ok-notice { border-color: var(--ok); }
	.muted { opacity: .8; }
	.notes { font-size: 11px; color: var(--vscode-descriptionForeground); border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.25)); margin-top: 10px; padding-top: 6px; }
	.notes p { margin: 2px 0; }
	.spinner { width: 14px; height: 14px; border: 2px solid var(--vscode-descriptionForeground); border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite; flex: none; margin-top: 2px; }
	@keyframes spin { to { transform: rotate(360deg); } }
	@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
</head>
<body>
	<div class="tabs" role="tablist" aria-label="SpecKit views">
		<button class="tab" id="tab-features" role="tab" data-tab="features" aria-selected="true">Features</button>
		<button class="tab" id="tab-drift" role="tab" data-tab="drift" aria-selected="false">Drift</button>
	</div>
	<div id="header"></div>
	<main id="body" role="tabpanel" aria-labelledby="tab-features"></main>
<script nonce="${scriptNonce}">
	const vscode = acquireVsCodeApi();
	const body = document.getElementById('body');
	const header = document.getElementById('header');

	document.addEventListener('click', (event) => {
		const tab = event.target.closest('.tab');
		if (tab) { vscode.postMessage({ type: 'tab', value: tab.dataset.tab }); return; }
		const chip = event.target.closest('.chip');
		if (chip) { vscode.postMessage({ type: 'filter', value: chip.dataset.filter }); return; }
		const loc = event.target.closest('.loc');
		if (loc) { vscode.postMessage({ type: 'open', value: loc.dataset.open }); }
	});

	window.addEventListener('message', (event) => {
		const message = event.data;
		if (message.type !== 'update') { return; }
		header.innerHTML = message.header;
		body.innerHTML = message.body;
		body.setAttribute('aria-labelledby', 'tab-' + message.tab);
		for (const tab of document.querySelectorAll('.tab')) {
			tab.setAttribute('aria-selected', String(tab.dataset.tab === message.tab));
		}
	});

	vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
	}
}

