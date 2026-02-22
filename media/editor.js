// @ts-check

// Script run within the webview itself.
(function () {

	// Get a reference to the VS Code webview api.
	// We use this API to post messages back to our extension.

	// @ts-ignore
	const vscode = acquireVsCodeApi();

	const errorContainer = document.createElement('div');
	document.body.appendChild(errorContainer);
	errorContainer.className = 'error';
	errorContainer.style.display = 'none';

	/**
	 * Create an editable table row for a header.
	 * @param {number} index
	 * @param {string} key
	 * @param {string} value
	 * @returns {HTMLTableRowElement}
	 */
	function createEditableHeaderRow(index, key, value) {
		const tr = document.createElement('tr');
		tr.dataset.headerIndex = String(index);

		// Editable key cell
		const th = document.createElement('th');
		th.textContent = key;
		th.contentEditable = 'true';
		th.spellcheck = false;
		th.addEventListener('blur', () => {
			const newKey = (th.textContent || '').trim();
			if (newKey && newKey !== key) {
				vscode.postMessage({
					type: 'editHeader',
					index: index,
					newKey: newKey,
					newValue: (td.textContent || '').trim(),
				});
			} else if (!newKey) {
				th.textContent = key; // revert empty key
			}
		});
		th.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); th.blur(); }
			if (e.key === 'Escape') { th.textContent = key; th.blur(); }
		});

		// Editable value cell
		const td = document.createElement('td');
		td.textContent = value;
		td.contentEditable = 'true';
		td.spellcheck = false;
		td.addEventListener('blur', () => {
			const newValue = (td.textContent || '');
			if (newValue !== value) {
				vscode.postMessage({
					type: 'editHeader',
					index: index,
					newKey: (th.textContent || '').trim(),
					newValue: newValue,
				});
			}
		});
		td.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') { e.preventDefault(); td.blur(); }
			if (e.key === 'Escape') { td.textContent = value; td.blur(); }
		});

		// Delete button cell
		const tdAction = document.createElement('td');
		tdAction.className = 'header-action-cell';
		const deleteBtn = document.createElement('button');
		deleteBtn.className = 'header-delete-btn';
		deleteBtn.textContent = '\u00D7';
		deleteBtn.title = 'Delete header';
		deleteBtn.addEventListener('click', () => {
			vscode.postMessage({ type: 'deleteHeader', index: index });
		});
		tdAction.appendChild(deleteBtn);

		tr.appendChild(th);
		tr.appendChild(td);
		tr.appendChild(tdAction);
		return tr;
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

		// Build editable header table from all headers
		const headerTableBody = document.getElementById('header-table-body');
		if (headerTableBody) {
			headerTableBody.innerHTML = '';
			if (mail.headers && mail.headers.length > 0) {
				for (let i = 0; i < mail.headers.length; i++) {
					headerTableBody.appendChild(
						createEditableHeaderRow(i, mail.headers[i].key, mail.headers[i].value)
					);
				}
			}
		}

		const attachmentElement = document.getElementById('mail-attachment');
		if (attachmentElement) {
			attachmentElement.innerHTML = '';
			if (mail.attachments && mail.attachments.length > 0) {
				const ul = document.createElement('ul');
				attachmentElement.appendChild(ul);
				for (let attachmentIndex = 0; attachmentIndex < mail.attachments.length; attachmentIndex++) {
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

	// Wire up the "Add Header" button
	const addHeaderBtn = document.getElementById('add-header-btn');
	if (addHeaderBtn) {
		addHeaderBtn.addEventListener('click', () => {
			vscode.postMessage({ type: 'addHeader' });
		});
	}

	// Handle messages sent from the extension to the webview
	window.addEventListener('message', event => {
		const message = event.data;
		switch (message.type) {
			case 'update':
				const text = message.text;
				updateContent(text);
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
