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
	 * Format bytes into a human-readable size string.
	 * @param {number} bytes
	 * @returns {string}
	 */
	function formatFileSize(bytes) {
		if (bytes === 0) { return '0 B'; }
		const units = ['B', 'KB', 'MB', 'GB'];
		const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
		const size = bytes / Math.pow(1024, i);
		return `${i === 0 ? size : size.toFixed(1)} ${units[i]}`;
	}

	/**
	 * Get the byte length of an attachment's content.
	 * @param {any} content
	 * @returns {number}
	 */
	function getContentSize(content) {
		if (!content) { return 0; }
		if (content.byteLength !== undefined) { return content.byteLength; }
		if (typeof content === 'string') { return content.length; }
		return 0;
	}

	/**
	 * Trigger a download for the given attachment index.
	 * @param {number} index
	 */
	function downloadAttachment(index) {
		vscode.postMessage({ type: 'downloadAttachment', index });
	}

	/**
	 * Render the document in the webview.
	 */
	function updateContent(/** @type {import("postal-mime").Email & { textAsHtml?: string }} */ mail) {
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

		// Attachments as cards
		const attachmentEl = document.getElementById('mail-attachment');
		if (attachmentEl) {
			attachmentEl.innerHTML = '';
			if (mail.attachments && mail.attachments.length > 0) {
				const container = document.createElement('div');
				container.className = 'attachment-cards';
				for (let i = 0; i < mail.attachments.length; i++) {
					const att = mail.attachments[i];
					const card = document.createElement('div');
					card.className = 'attachment-card';
					card.addEventListener('click', () => downloadAttachment(i));

					const name = document.createElement('div');
					name.className = 'attachment-card-name';
					name.textContent = att.filename || 'unknown.txt';
					card.appendChild(name);

					const meta = document.createElement('div');
					meta.className = 'attachment-card-meta';
					const size = formatFileSize(getContentSize(att.content));
					const type = att.mimeType || 'unknown';
					meta.textContent = `${size} \u00B7 ${type}`;
					card.appendChild(meta);

					container.appendChild(card);
				}
				attachmentEl.appendChild(container);
			}
		}

		// Render HTML body in a sandboxed iframe with contentEditable
		const mailHtmlElement = document.getElementById('mail-html');
		if (mailHtmlElement) {
			// Skip recreation if user is focused inside the existing iframe
			const existingIframe = mailHtmlElement.querySelector('iframe');
			if (existingIframe && existingIframe.contentDocument && existingIframe.contentDocument.hasFocus()) {
				// Content was already synced via editHtmlBody; don't destroy the iframe
			} else {
				mailHtmlElement.innerHTML = '';
				if (mail.html) {
					// Toolbar with hint and Edit HTML Source button
					const toolbar = document.createElement('div');
					toolbar.className = 'html-body-toolbar';
					const hint = document.createElement('span');
					hint.className = 'html-body-hint';
					hint.textContent = 'Inline editing may alter formatting. Use Edit HTML Source for precise control.';
					toolbar.appendChild(hint);
					const editSourceBtn = document.createElement('button');
					editSourceBtn.className = 'edit-source-btn';
					editSourceBtn.textContent = 'Edit HTML Source';
					editSourceBtn.addEventListener('click', () => {
						vscode.postMessage({ type: 'openHtmlSource' });
					});
					toolbar.appendChild(editSourceBtn);
					mailHtmlElement.appendChild(toolbar);

					const iframe = document.createElement('iframe');
					iframe.sandbox = 'allow-same-origin';
					iframe.srcdoc = mail.html;
					iframe.style.width = '100%';
					iframe.style.border = 'none';
					iframe.style.overflow = 'hidden';
					iframe.style.minHeight = '200px';
					mailHtmlElement.appendChild(iframe);

					// After load, enable contentEditable and wire up change detection
					iframe.addEventListener('load', () => {
						const doc = iframe.contentDocument;
						if (!doc || !doc.body) { return; }

						doc.body.contentEditable = 'true';
						doc.body.style.outline = 'none';

						// Auto-resize iframe to fit content
						const resize = () => {
							const style = /** @type {Window} */ (doc.defaultView).getComputedStyle(doc.body);
							const margin = (parseInt(style.marginTop, 10) || 0) + (parseInt(style.marginBottom, 10) || 0);
							iframe.style.height = (doc.body.offsetHeight + margin) + 'px';
						};
						resize();
						const observer = new MutationObserver(resize);
						observer.observe(doc.body, { childList: true, subtree: true, attributes: true, characterData: true });
						new ResizeObserver(resize).observe(doc.body);

						// Debounced input → send changes back to extension
						/** @type {ReturnType<typeof setTimeout> | undefined} */
						let debounceTimer;
						doc.body.addEventListener('input', () => {
							clearTimeout(debounceTimer);
							debounceTimer = setTimeout(() => {
								// Clone to strip editing attributes without touching the live DOM
								const clone = doc.documentElement.cloneNode(true);
								const cloneBody = /** @type {HTMLElement} */ (/** @type {HTMLElement} */ (clone).querySelector('body'));
								cloneBody.removeAttribute('contenteditable');
								cloneBody.removeAttribute('style');
								const html = /** @type {HTMLElement} */ (clone).outerHTML;
								vscode.postMessage({
									type: 'editHtmlBody',
									newHtml: html,
								});
							}, 500);
						});
					});
				}
			}
		}

		// Text body — editable textarea, always visible
		const mailTextElement = document.getElementById('mail-text');
		if (mailTextElement) {
			const existing = mailTextElement.querySelector('textarea');
			// Skip update if textarea is focused (user is editing)
			if (existing && existing === document.activeElement) {
				// don't clobber user's in-progress edits
			} else {
				const textarea = existing || document.createElement('textarea');
				if (!existing) {
					textarea.placeholder = 'No text body. Type here to add one.';
					textarea.spellcheck = false;
					mailTextElement.appendChild(textarea);

					// Auto-resize
					const resize = () => {
						textarea.style.height = 'auto';
						textarea.style.height = textarea.scrollHeight + 'px';
					};

					// Debounced input → send changes back to extension
					/** @type {ReturnType<typeof setTimeout> | undefined} */
					let textDebounceTimer;
					textarea.addEventListener('input', () => {
						resize();
						clearTimeout(textDebounceTimer);
						textDebounceTimer = setTimeout(() => {
							vscode.postMessage({
								type: 'editTextBody',
								newText: textarea.value,
							});
						}, 500);
					});
				}
				textarea.value = mail.text || '';
				// Trigger resize after setting value
				textarea.style.height = 'auto';
				textarea.style.height = textarea.scrollHeight + 'px';
			}
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
