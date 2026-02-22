import * as vscode from 'vscode';
import { createHash } from 'crypto';
import { getNonce } from './util';
import { findHtmlBodyRange, decodeMimeContent, encodeMimeContent } from './mime-utils';

async function parseEmail(raw: string) {
	const PostalMime = (await import('postal-mime')).default;
	return PostalMime.parse(raw);
}

type Email = Awaited<ReturnType<typeof parseEmail>>;

interface HeaderRange {
	/** Offset of the first character of the header line */
	headerStart: number;
	/** Offset of the colon separating key from value */
	colonOffset: number;
	/** Offset one past the last character of the header (including continuation lines) */
	headerEnd: number;
}

/**
 * Find the character range of the Nth header in a raw .eml text.
 * Handles folded (multi-line) headers and both \r\n and \n line endings.
 */
function findHeaderRange(rawText: string, headerIndex: number): HeaderRange | null {
	// Find end of header block (first blank line)
	const headerBlockEndMatch = rawText.match(/\r?\n\r?\n/);
	const headerBlockEnd = headerBlockEndMatch?.index ?? rawText.length;
	const headerBlock = rawText.substring(0, headerBlockEnd);

	// Parse lines with their offsets
	const lines: Array<{ text: string; offset: number }> = [];
	let lineStart = 0;
	for (let i = 0; i <= headerBlock.length; i++) {
		if (i === headerBlock.length || headerBlock[i] === '\n') {
			let lineEnd = i;
			if (lineEnd > lineStart && headerBlock[lineEnd - 1] === '\r') {
				lineEnd--;
			}
			lines.push({ text: headerBlock.substring(lineStart, lineEnd), offset: lineStart });
			lineStart = i + 1;
		}
	}

	let headerCount = -1;
	let result: HeaderRange | null = null;

	for (const line of lines) {
		const isContinuation = line.text.length > 0 && (line.text[0] === ' ' || line.text[0] === '\t');

		if (!isContinuation && line.text.includes(':')) {
			headerCount++;
			if (headerCount === headerIndex) {
				const colonPos = line.text.indexOf(':');
				result = {
					headerStart: line.offset,
					colonOffset: line.offset + colonPos,
					headerEnd: line.offset + line.text.length,
				};
			} else if (headerCount > headerIndex && result) {
				break;
			}
		} else if (isContinuation && headerCount === headerIndex && result) {
			result.headerEnd = line.offset + line.text.length;
		}
	}

	return result;
}

/**
 * Detect the line ending style used in the text.
 */
function detectLineEnding(text: string): string {
	return text.includes('\r\n') ? '\r\n' : '\n';
}

export class MailViewer implements vscode.CustomTextEditorProvider {

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new MailViewer(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(MailViewer.viewType, provider);
		return providerRegistration;
	}

	private static readonly viewType = 'emlviewer.eml';

	constructor(
		private readonly context: vscode.ExtensionContext
	) { }

	/**
	 * Called when our custom editor is opened.
	 */
	public async resolveCustomTextEditor(
		document: vscode.TextDocument,
		webviewPanel: vscode.WebviewPanel,
		_token: vscode.CancellationToken
	): Promise<void> {
		// Setup initial content for the webview
		webviewPanel.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
		};
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);


		let mail = await parseEmail(document.getText());
		const selfEditVersions = new Set<number>();
		let tempFileUri: vscode.Uri | undefined;
		let tempFileWatcher: vscode.Disposable | undefined;

		function updateWebview() {
			webviewPanel.webview.postMessage({
				type: 'update',
				text: {
					...mail,
					html: inlineCidImages(mail),
					textAsHtml: textToHtml(mail.text),
				},
			});
		}

		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(async e => {
			if (e.document.uri.toString() === document.uri.toString()) {
				mail = await parseEmail(document.getText());
				// Skip webview update for self-initiated edits to avoid flicker
				if (selfEditVersions.delete(e.document.version)) {
					return;
				}
				updateWebview();
			}
		});

		// Make sure we get rid of the listener when our editor is closed.
		webviewPanel.onDidDispose(() => {
			changeDocumentSubscription.dispose();
			tempFileWatcher?.dispose();
			if (tempFileUri) {
				vscode.workspace.fs.delete(tempFileUri).then(undefined, () => {/* ignore */});
			}
		});

		// Receive message from the webview.
		webviewPanel.webview.onDidReceiveMessage(async e => {
			switch (e.type) {
				case 'downloadAttachment':
					this.downloadAttachment(document, mail, e.index);
					return;

				case 'editHeader': {
					const { index, newKey, newValue } = e as { index: number; newKey: string; newValue: string };
					const rawText = document.getText();
					const range = findHeaderRange(rawText, index);
					if (!range) { return; }

					// Preserve original key casing if user didn't change the key
					const originalKey = rawText.substring(range.headerStart, range.colonOffset);
					const finalKey = newKey.toLowerCase() === originalKey.toLowerCase() ? originalKey : newKey;

					const newLine = `${finalKey}: ${newValue}`;
					const editRange = new vscode.Range(
						document.positionAt(range.headerStart),
						document.positionAt(range.headerEnd),
					);
					const edit = new vscode.WorkspaceEdit();
					edit.replace(document.uri, editRange, newLine);
					selfEditVersions.add(document.version + 1);
					await vscode.workspace.applyEdit(edit);
					return;
				}

				case 'deleteHeader': {
					const { index } = e as { index: number };
					const rawText = document.getText();
					const range = findHeaderRange(rawText, index);
					if (!range) { return; }

					// Delete the header including its trailing line ending
					let deleteEnd = range.headerEnd;
					if (rawText[deleteEnd] === '\r' && rawText[deleteEnd + 1] === '\n') {
						deleteEnd += 2;
					} else if (rawText[deleteEnd] === '\n') {
						deleteEnd += 1;
					}

					const editRange = new vscode.Range(
						document.positionAt(range.headerStart),
						document.positionAt(deleteEnd),
					);
					const edit = new vscode.WorkspaceEdit();
					edit.delete(document.uri, editRange);
					selfEditVersions.add(document.version + 1);
					await vscode.workspace.applyEdit(edit);
					return;
				}

				case 'addHeader': {
					const rawText = document.getText();
					const lineEnding = detectLineEnding(rawText);
					// Insert before the blank line separator
					const blankLineMatch = rawText.match(/\r?\n\r?\n/);
					if (!blankLineMatch || blankLineMatch.index === undefined) { return; }
					const insertOffset = blankLineMatch.index + (rawText[blankLineMatch.index] === '\r' ? 2 : 1);
					const insertText = `X-New-Header: value${lineEnding}`;

					const edit = new vscode.WorkspaceEdit();
					edit.insert(document.uri, document.positionAt(insertOffset), insertText);
					selfEditVersions.add(document.version + 1);
					await vscode.workspace.applyEdit(edit);
					// Re-parse and update webview to show the new header
					mail = await parseEmail(document.getText());
					updateWebview();
					return;
				}

				case 'editHtmlBody': {
					const { newHtml } = e as { newHtml: string };
					const rawText = document.getText();
					const bodyRange = findHtmlBodyRange(rawText);
					if (!bodyRange) { return; }

					// Reverse CID inlining so data: URIs become cid: refs again
					const restoredHtml = uninlineCidImages(newHtml, mail);
					const encoded = encodeMimeContent(restoredHtml, bodyRange.encoding);
					const editRange = new vscode.Range(
						document.positionAt(bodyRange.contentStart),
						document.positionAt(bodyRange.contentEnd),
					);
					const edit = new vscode.WorkspaceEdit();
					edit.replace(document.uri, editRange, encoded);
					selfEditVersions.add(document.version + 1);
					await vscode.workspace.applyEdit(edit);
					return;
				}

				case 'openHtmlSource': {
					const rawText = document.getText();
					const bodyRange = findHtmlBodyRange(rawText);
					if (!bodyRange) {
						vscode.window.showWarningMessage('No HTML body found in this email.');
						return;
					}

					const rawContent = rawText.substring(bodyRange.contentStart, bodyRange.contentEnd);
					const decodedHtml = decodeMimeContent(rawContent, bodyRange.encoding);

					// Create temp file in extension storage
					const tempDir = vscode.Uri.joinPath(this.context.globalStorageUri, 'temp');
					await vscode.workspace.fs.createDirectory(tempDir);
					const hash = createHash('md5').update(document.uri.toString()).digest('hex').substring(0, 8);
					tempFileUri = vscode.Uri.joinPath(tempDir, `email-body-${hash}.html`);

					// If already open, just focus it
					const existing = vscode.workspace.textDocuments.find(
						d => d.uri.toString() === tempFileUri!.toString()
					);
					if (existing) {
						await vscode.window.showTextDocument(existing, vscode.ViewColumn.Beside);
						return;
					}

					await vscode.workspace.fs.writeFile(tempFileUri, Buffer.from(decodedHtml, 'utf-8'));
					const htmlDoc = await vscode.workspace.openTextDocument(tempFileUri);
					await vscode.window.showTextDocument(htmlDoc, vscode.ViewColumn.Beside);

					// Watch for saves on the temp file → sync back to .eml
					tempFileWatcher?.dispose();
					tempFileWatcher = vscode.workspace.onDidSaveTextDocument(async (savedDoc) => {
						if (savedDoc.uri.toString() !== tempFileUri?.toString()) { return; }
						const currentRaw = document.getText();
						const currentRange = findHtmlBodyRange(currentRaw);
						if (!currentRange) { return; }

						const encoded = encodeMimeContent(savedDoc.getText(), currentRange.encoding);
						const editRange = new vscode.Range(
							document.positionAt(currentRange.contentStart),
							document.positionAt(currentRange.contentEnd),
						);
						const edit = new vscode.WorkspaceEdit();
						edit.replace(document.uri, editRange, encoded);
						selfEditVersions.add(document.version + 1);
						await vscode.workspace.applyEdit(edit);
					});
					return;
				}
			}
		});

		updateWebview();
	}

	/**
	 * Get the static html used for the editor webviews.
	 */
	private getHtmlForWebview(webview: vscode.Webview): string {
		// Local path to script and css for the webview
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, 'media', 'editor.js'));
		const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, 'media', 'editor.css'));

		// Use a nonce to whitelist which scripts can be run
		const nonce = getNonce();

		return /* html */`
			<!DOCTYPE html>
			<html lang="en">
			<head>
				<meta charset="UTF-8">

				<!--
				Use a content security policy to only allow loading images from https or from our extension directory,
				and only allow scripts that have a specific nonce.
				-->
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; frame-src 'self' about: blob:;">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<title>Email Viewer</title>
				<link rel="stylesheet" href="${styleUri}">
			</head>
			<body>
				<table class="header-table"><tbody id="header-table-body"></tbody></table>
				<button class="add-header-btn" id="add-header-btn">+ Add Header</button>
				<div id="mail-attachment"></div>
				<h2>HTML body</h2>
				<div id="mail-html">
				</div>
				<h2>Text body</h2>
				<div id="mail-text">
				</div>
				<script nonce="${nonce}" src="${scriptUri}"></script>
			</body>
			</html>`;
	}

	private async downloadAttachment(document: vscode.TextDocument, mail: Email, index: number) {
		const attachment = mail.attachments[index];
		const filename = attachment.filename || 'unknown.txt';
		const emlPath = vscode.Uri.file(document.fileName);
		const attachmentPath = vscode.Uri.joinPath(emlPath, '../' + filename);

		const content = toUint8Array(attachment.content);
		await vscode.workspace.fs.writeFile(attachmentPath, content);
		vscode.window.showInformationMessage(`Attachment saved as ${attachmentPath.path}`);
		vscode.commands.executeCommand('vscode.openWith', attachmentPath, 'default');
	}
}

function textToHtml(text: string | undefined): string {
	if (!text) { return ''; }
	const escaped = text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
	return '<p>' + escaped
		.replace(/\r?\n/g, '\n')
		.trim()
		.replace(/\n\n+/g, '</p><p>')
		.replace(/\n/g, '<br/>') + '</p>';
}

function inlineCidImages(mail: Email): string {
	let html = mail.html || '';
	for (const attachment of mail.attachments) {
		if (!attachment.contentId) { continue; }
		const cid = attachment.contentId.replace(/^<|>$/g, '');
		const base64 = bufferToBase64(attachment.content);
		html = html.replace(
			new RegExp(`cid:${cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'),
			`data:${attachment.mimeType};base64,${base64}`
		);
	}
	return html;
}

function uninlineCidImages(html: string, mail: Email): string {
	for (const attachment of mail.attachments) {
		if (!attachment.contentId) { continue; }
		const cid = attachment.contentId.replace(/^<|>$/g, '');
		const base64 = bufferToBase64(attachment.content);
		const dataUri = `data:${attachment.mimeType};base64,${base64}`;
		html = html.replaceAll(dataUri, `cid:${cid}`);
	}
	return html;
}

function bufferToBase64(content: ArrayBuffer | Uint8Array | string): string {
	if (typeof content === 'string') { return Buffer.from(content).toString('base64'); }
	if (content instanceof ArrayBuffer) { return Buffer.from(new Uint8Array(content)).toString('base64'); }
	return Buffer.from(content).toString('base64');
}

function toUint8Array(content: ArrayBuffer | Uint8Array | string): Uint8Array {
	if (content instanceof Uint8Array) { return content; }
	if (typeof content === 'string') { return new TextEncoder().encode(content); }
	return new Uint8Array(content);
}
