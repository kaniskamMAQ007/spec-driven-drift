import * as vscode from 'vscode';
import { CodeLocation } from './core/types';

/** Opens a file and reveals the exact line a finding points at. */
export async function openLocation(location: CodeLocation): Promise<void> {
	try {
		const document = await vscode.workspace.openTextDocument(vscode.Uri.file(location.absPath));
		const editor = await vscode.window.showTextDocument(document, { preview: true });

		const lastLine = Math.max(document.lineCount - 1, 0);
		const line = Math.min(Math.max(location.line, 0), lastLine);
		const endLine = Math.min(Math.max(location.endLine ?? line, line), lastLine);
		const column = document.lineAt(line).firstNonWhitespaceCharacterIndex;
		const position = new vscode.Position(line, column);

		editor.selection = new vscode.Selection(position, position);
		editor.revealRange(
			new vscode.Range(line, 0, endLine, document.lineAt(endLine).text.length),
			vscode.TextEditorRevealType.InCenter
		);
	} catch {
		void vscode.window.showWarningMessage(`Spec Drift Monitor could not open ${location.relPath}.`);
	}
}
