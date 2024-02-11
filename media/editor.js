// @ts-check

// Script run within the webview itself.
(function () {

	// Get a reference to the VS Code webview api.
	// We use this API to post messages back to our extension.

	// @ts-ignore
	const vscode = acquireVsCodeApi();




	const errorContainer = document.createElement('div');
	document.body.appendChild(errorContainer);
	errorContainer.className = 'error'
	errorContainer.style.display = 'none'

	/**
	 * Render the document in the webview.
	 */
	function updateContent(/** @type {import("mailparser").ParsedMail} */ mail) {
		const subjectELement = document.getElementById('mail-subject');
		if(subjectELement){
			subjectELement.innerText = mail.subject || '';
		}
		const attachmentElement = document.getElementById('mail-attachment');
		if(attachmentElement){
			attachmentElement.innerHTML = '';
			if(mail.attachments && mail.attachments.length > 0){
				const ul = document.createElement('ul');
				attachmentElement.appendChild(ul);
				for(const attachmentIndex in mail.attachments){
					const attachment = mail.attachments[attachmentIndex];
					const li = document.createElement('li');
					ul.appendChild(li);
					const a = document.createElement('a');
					li.appendChild(a);
					a.onclick = (e) => {
						e.preventDefault();
						vscode.postMessage({
							type: 'downloadAttachement',
							index: attachmentIndex
						});
					};
					a.href = '#';
					// a.href = `data:${attachment.contentType};base64,${attachment.content.toString('base64')}`;
					// a.download = attachment.filename;
					a.innerText = attachment.filename || 'unkown.txt';
				}
			}
		}

		const textMap = {
			'mail-from': mailsToText(mail.from),
			'mail-to': mailsToText(mail.to),
			'mail-cc': mailsToText(mail.cc),
			'mail-bcc': mailsToText(mail.bcc),
			
		};
		for(const id in textMap){
			const element = document.getElementById(id);
			if(element){
				element.textContent = textMap[id];
			}
		}

		const htmlMap = {
			'mail-html': mail.html || '',
			'mail-text': mail.textAsHtml || '',
		}

		for(const id in htmlMap){
			const element = document.getElementById(id);
			if(element){
				element.innerHTML = htmlMap[id];
			}
		}

	}

	function mailsToText(/** @type {import("mailparser").AddressObject | import("mailparser").AddressObject[] | undefined} */ emails){
		if(Array.isArray(emails)){
			return emails.map(mailToText).join(', ');
		}
		if(!emails){
			return '';
		}
		return mailToText(emails);
	}

	function mailToText(/** @type {import("mailparser").AddressObject} */ address){
		return address.text;
	}

	// Handle messages sent from the extension to the webview
	window.addEventListener('message', event => {
		const message = event.data; // The json data that the extension sent
		switch (message.type) {
			case 'update':
				const text = message.text;

				// Update our webview's content
				updateContent(text);

				// Then persist state information.
				// This state is returned in the call to `vscode.getState` below when a webview is reloaded.
				vscode.setState({ text });

				return;
		}
	});

	// Webviews are normally torn down when not visible and re-created when they become visible again.
	// State lets us save information across these re-loads
	const state = vscode.getState();
	if (state) {
		updateContent(state.text);
	}
}());