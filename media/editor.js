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
	 * Create a table row with a label and text value, using textContent for safety.
	 * @param {string} label
	 * @param {string} value
	 * @returns {HTMLTableRowElement}
	 */
	function createHeaderRow(label, value) {
		const tr = document.createElement('tr');
		const th = document.createElement('th');
		th.textContent = label;
		const td = document.createElement('td');
		td.textContent = value;
		tr.appendChild(th);
		tr.appendChild(td);
		return tr;
	}

	/**
	 * Format an ISO/RFC 2822 date string into a human-readable locale format.
	 * @param {string} dateStr
	 * @returns {string}
	 */
	function formatDate(dateStr) {
		try {
			const date = new Date(dateStr);
			if (isNaN(date.getTime())) {
				return dateStr;
			}
			return date.toLocaleString(undefined, {
				weekday: 'short',
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit',
				timeZoneName: 'short',
			});
		} catch {
			return dateStr;
		}
	}

	/**
	 * Render the document in the webview.
	 */
	function updateContent(/** @type {import("postal-mime").Email & { textAsHtml?: string }} */ mail) {
		// Subject as page title
		const subjectElement = document.getElementById('mail-subject');
		if (subjectElement) {
			subjectElement.textContent = mail.subject || '(no subject)';
		}

		// Build standard header rows, skipping empty values
		const headerTableBody = document.getElementById('header-table-body');
		if (headerTableBody) {
			headerTableBody.innerHTML = '';
			/** @type {Array<{label: string, value: string}>} */
			const standardHeaders = [
				{ label: 'From',     value: mail.from ? formatAddress(mail.from) : '' },
				{ label: 'To',       value: formatAddresses(mail.to) },
				{ label: 'Date',     value: mail.date ? formatDate(mail.date) : '' },
				{ label: 'CC',       value: formatAddresses(mail.cc) },
				{ label: 'BCC',      value: formatAddresses(mail.bcc) },
				{ label: 'Reply-To', value: formatAddresses(mail.replyTo) },
				{ label: 'Sender',   value: mail.sender ? formatAddress(mail.sender) : '' },
			];
			for (const header of standardHeaders) {
				if (header.value) {
					headerTableBody.appendChild(createHeaderRow(header.label, header.value));
				}
			}
		}

		// Build raw headers table
		const rawHeadersBody = document.getElementById('raw-headers-table-body');
		if (rawHeadersBody) {
			rawHeadersBody.innerHTML = '';
			if (mail.headers && mail.headers.length > 0) {
				for (const header of mail.headers) {
					rawHeadersBody.appendChild(createHeaderRow(header.key, header.value));
				}
			}
		}

		// Show/hide the toggle button based on whether there are raw headers
		const toggleButton = document.getElementById('raw-headers-toggle');
		if (toggleButton) {
			toggleButton.style.display = (mail.headers && mail.headers.length > 0) ? '' : 'none';
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
							type: 'downloadAttachment',
							index: attachmentIndex
						});
					};
					a.href = '#';
					a.innerText = attachment.filename || 'unknown.txt';
				}
			}
		}

		// Render HTML body in a sandboxed iframe to prevent XSS
		const mailHtmlElement = document.getElementById('mail-html');
		if (mailHtmlElement) {
			mailHtmlElement.innerHTML = '';
			if (mail.html) {
				const iframe = document.createElement('iframe');
				iframe.sandbox = '';
				iframe.srcdoc = mail.html;
				iframe.style.width = '100%';
				iframe.style.border = 'none';
				iframe.style.minHeight = '200px';
				mailHtmlElement.appendChild(iframe);
			}
		}

		// Text body is safe (pre-escaped by textToHtml on the extension side)
		const mailTextElement = document.getElementById('mail-text');
		if (mailTextElement) {
			mailTextElement.innerHTML = mail.textAsHtml || '';
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

	// Wire up the raw headers toggle
	const rawHeadersToggle = document.getElementById('raw-headers-toggle');
	const rawHeadersContent = document.getElementById('raw-headers-content');
	if (rawHeadersToggle && rawHeadersContent) {
		rawHeadersToggle.addEventListener('click', () => {
			const isExpanded = rawHeadersToggle.classList.toggle('expanded');
			rawHeadersContent.classList.toggle('visible', isExpanded);
			rawHeadersToggle.textContent = isExpanded ? 'Hide all headers' : 'Show all headers';
		});
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
