import * as vscode from 'vscode';
import { getNonce } from './util';
import { ParsedMail, simpleParser } from 'mailparser';
import { writeFileSync, writeSync } from 'fs';
import { dirname, join } from 'path';

/**
 * Provider for cat scratch editors.
 * 
 * Cat scratch editors are used for `.cscratch` files, which are just json files.
 * To get started, run this extension and open an empty `.cscratch` file in VS Code.
 * 
 * This provider demonstrates:
 * 
 * - Setting up the initial webview for a custom editor.
 * - Loading scripts and styles in a custom editor.
 * - Synchronizing changes between a text document and a custom editor.
 */
export class MailViewer implements vscode.CustomTextEditorProvider {

	public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new MailViewer(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(MailViewer.viewType, provider);
		return providerRegistration;
	}

	private static readonly viewType = 'emlviewer.eml';


	private static readonly scratchCharacters = ['😸', '😹', '😺', '😻', '😼', '😽', '😾', '🙀', '😿', '🐱'];

	constructor(
		private readonly context: vscode.ExtensionContext
	) { }

	/**
	 * Called when our custom editor is opened.
	 * 
	 * 
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


		const mail = await simpleParser(document.getText())
		function updateWebview() {
			webviewPanel.webview.postMessage({
				type: 'update',
				text: mail,
			});
		}

		// Hook up event handlers so that we can synchronize the webview with the text document.
		//
		// The text document acts as our model, so we have to sync change in the document to our
		// editor and sync changes in the editor back to the document.
		// 
		// Remember that a single text document can also be shared between multiple custom
		// editors (this happens for example when you split a custom editor)

		const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.toString() === document.uri.toString()) {
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

		// const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(
			// this.context.extensionUri, 'media', 'reset.css'));

		// const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(
			// this.context.extensionUri, 'media', 'vscode.css'));

		// const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(
			// this.context.extensionUri, 'media', 'catScratch.css'));

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
				<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">

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

	/**
	 * Add a new scratch to the current document.
	 */
	private downloadAttachment(document: vscode.TextDocument, mail: ParsedMail, index: number) {
		const attachement = mail.attachments[index];
		const directory = dirname(document.fileName);
		const filename = attachement.filename || 'unkown.txt';
		const filePath = join(directory, filename);
		// add attachement as file in same directory
		// TODO find proper way to add file, this probably does not work for remote editors.
		writeFileSync(filePath, attachement.content);
		// vscode.workspace.applyEdit(edit);
		vscode.window.showInformationMessage(`Attachment saved as ${filePath}`);
	}
	
}