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
	function updateContent(/** @type {import("postal-mime").Email & { textAsHtml?: string }} */ mail) {
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
				for(let attachmentIndex = 0; attachmentIndex < mail.attachments.length; attachmentIndex++){
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
					a.innerText = attachment.filename || 'unknown.txt';
				}
			}
		}

		const textMap = {
			'mail-from': mail.from ? formatAddress(mail.from) : '',
			'mail-to': formatAddresses(mail.to),
			'mail-cc': formatAddresses(mail.cc),
			'mail-bcc': formatAddresses(mail.bcc),
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

	/**
	 * Format a single postal-mime Address (Mailbox or group).
	 * @param {import("postal-mime").Address} address
	 * @returns {string}
	 */
	function formatAddress(address) {
		if ('group' in address && address.group) {
			return `${address.name}: ${address.group.map(formatMailbox).join(', ')};`;
		}
		return formatMailbox(/** @type {import("postal-mime").Mailbox} */ (address));
	}

	/**
	 * @param {import("postal-mime").Mailbox} mailbox
	 * @returns {string}
	 */
	function formatMailbox(mailbox) {
		if (mailbox.name && mailbox.address) {
			return `${mailbox.name} <${mailbox.address}>`;
		}
		return mailbox.address || mailbox.name || '';
	}

	/**
	 * Format an array of addresses into a comma-separated string.
	 * @param {import("postal-mime").Address[] | undefined} addresses
	 * @returns {string}
	 */
	function formatAddresses(addresses) {
		if (!addresses || addresses.length === 0) { return ''; }
		return addresses.map(formatAddress).join(', ');
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
