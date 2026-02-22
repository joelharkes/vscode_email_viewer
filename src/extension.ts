import * as vscode from 'vscode';
import { MailViewer } from './MailViewer';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(MailViewer.register(context));
}

export function deactivate() {}
