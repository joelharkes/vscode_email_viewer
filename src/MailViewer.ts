import * as vscode from 'vscode';
import { getNonce } from './util';

async function parseEmail(raw: string) {
	const PostalMime = (await import('postal-mime')).default;
	return PostalMime.parse(raw);
}

type Email = Awaited<ReturnType<typeof parseEmail>>;

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
		};
		webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);


		let mail = await parseEmail(document.getText());
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

		// Hook up event handlers so that we can synchronize the webview with the text document.
		//
		// The text document acts as our model, so we have to sync change in the document to our
		// editor and sync changes in the editor back to the document.
		//
		// Remember that a single text document can also be shared between multiple custom
		// editors (this happens for example when you split a custom editor)

		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(async e => {
			if (e.document.uri.toString() === document.uri.toString()) {
				mail = await parseEmail(document.getText());
				updateWebview();
			}
		});

		// Make sure we get rid of the listener when our editor is closed.
		webviewPanel.onDidDispose(() => {
			changeDocumentSubscription.dispose();
		});

		// Receive message from the webview.
		webviewPanel.webview.onDidReceiveMessage(e => {
			switch (e.type) {
				case 'downloadAttachement':
					this.downloadAttachment(document, mail, e.index);
					return;
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
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

				<meta name="viewport" content="width=device-width, initial-scale=1.0">

				<title>Cat Scratch</title>
			</head>
			<body>
				<h1>Subject: <span id="mail-subject"></span></h1>
				from: <span id="mail-from"></span><br/>
				to: <span id="mail-to"></span><br/>
				cc: <span id="mail-cc"></span><br/>
				bcc: <span id="mail-bcc"></span><br/>
				attachment:
				<div id="mail-attachment">
				</div>
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
