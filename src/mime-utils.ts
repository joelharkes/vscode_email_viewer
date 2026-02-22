export interface HtmlBodyRange {
	/** Offset of the first character of HTML content (after the part's blank-line separator) */
	contentStart: number;
	/** Offset one past the last character of HTML content (before the boundary line's preceding newline) */
	contentEnd: number;
	/** Content-Transfer-Encoding of this part */
	encoding: string;
}

/**
 * Locate the inline text/html MIME part in a raw .eml string.
 * Returns byte-offset range + encoding, or null if no HTML body exists.
 */
export function findHtmlBodyRange(rawText: string): HtmlBodyRange | null {
	const rootCT = extractHeaderValue(rawText, 'content-type', 0);
	if (!rootCT) { return null; }

	const rootBoundary = extractBoundaryParam(rootCT);
	if (!rootBoundary) {
		// Single-part message — check if the whole thing is text/html
		if (!/text\/html/i.test(rootCT)) { return null; }
		const bodyStart = findBodyStart(rawText, 0);
		if (bodyStart === -1) { return null; }
		const encoding = extractHeaderValue(rawText, 'content-transfer-encoding', 0) || '7bit';
		return { contentStart: bodyStart, contentEnd: rawText.length, encoding: encoding.trim().toLowerCase() };
	}

	return walkMultipart(rawText, rootBoundary);
}

function walkMultipart(rawText: string, boundary: string): HtmlBodyRange | null {
	const dash = '--' + boundary;
	const term = dash + '--';
	let pos = rawText.indexOf(dash);

	while (pos !== -1) {
		// Skip to end of the boundary line
		const lineEnd = rawText.indexOf('\n', pos);
		if (lineEnd === -1) { break; }

		const line = rawText.substring(pos, lineEnd).replace(/\r$/, '');
		if (line === term) { break; } // terminator

		const partHeaderStart = lineEnd + 1;
		const bodyStart = findBodyStart(rawText, partHeaderStart);
		if (bodyStart === -1) { break; }

		// Find next boundary
		const nextBoundary = rawText.indexOf(dash, bodyStart);
		if (nextBoundary === -1) { break; }

		// Content ends just before the newline preceding the next boundary line
		const contentEnd = trimTrailingNewline(rawText, nextBoundary);

		// Parse part headers
		const partHeaders = rawText.substring(partHeaderStart, bodyStart);
		const ct = extractHeaderFromBlock(partHeaders, 'content-type') || 'text/plain';
		const cte = extractHeaderFromBlock(partHeaders, 'content-transfer-encoding') || '7bit';
		const disposition = extractHeaderFromBlock(partHeaders, 'content-disposition') || '';

		if (/text\/html/i.test(ct) && !/attachment/i.test(disposition)) {
			return {
				contentStart: bodyStart,
				contentEnd,
				encoding: cte.trim().toLowerCase(),
			};
		}

		// Recurse into nested multipart
		if (/multipart\//i.test(ct)) {
			const nested = extractBoundaryParam(ct);
			if (nested) {
				const result = walkMultipart(rawText, nested);
				if (result) { return result; }
			}
		}

		pos = nextBoundary;
	}

	return null;
}

/**
 * Decode MIME-encoded content to a plain string.
 */
export function decodeMimeContent(raw: string, encoding: string): string {
	switch (encoding) {
		case 'base64': {
			const cleaned = raw.replace(/[\r\n\s]/g, '');
			return Buffer.from(cleaned, 'base64').toString('utf-8');
		}
		case 'quoted-printable':
			return raw
				.replace(/=\r?\n/g, '')
				.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) =>
					String.fromCharCode(parseInt(hex, 16)));
		default:
			return raw;
	}
}

/**
 * Encode a string back to the given MIME encoding.
 */
export function encodeMimeContent(text: string, encoding: string): string {
	switch (encoding) {
		case 'base64': {
			const b64 = Buffer.from(text, 'utf-8').toString('base64');
			return b64.match(/.{1,76}/g)?.join('\r\n') ?? '';
		}
		case 'quoted-printable':
			return encodeQuotedPrintable(text);
		default:
			return text;
	}
}

function encodeQuotedPrintable(str: string): string {
	const buf = Buffer.from(str, 'utf-8');
	let result = '';
	let lineLen = 0;

	for (let i = 0; i < buf.length; i++) {
		const byte = buf[i];
		let ch: string;

		if (byte === 0x0D || byte === 0x0A) {
			ch = String.fromCharCode(byte);
			lineLen = 0;
		} else if (byte === 0x09 || (byte >= 0x20 && byte <= 0x7E && byte !== 0x3D)) {
			ch = String.fromCharCode(byte);
		} else {
			ch = '=' + byte.toString(16).toUpperCase().padStart(2, '0');
		}

		if (lineLen + ch.length > 75 && byte !== 0x0D && byte !== 0x0A) {
			result += '=\r\n';
			lineLen = 0;
		}
		result += ch;
		lineLen += ch.length;
	}

	return result;
}

// ---- Header / MIME parsing helpers ----

/** Extract the value of a header by name from a raw message starting at `offset`. */
function extractHeaderValue(rawText: string, headerName: string, offset: number): string | null {
	const headerBlockEnd = rawText.indexOf('\n\n', offset);
	const crlfEnd = rawText.indexOf('\r\n\r\n', offset);
	let end = rawText.length;
	if (headerBlockEnd !== -1) { end = Math.min(end, headerBlockEnd); }
	if (crlfEnd !== -1) { end = Math.min(end, crlfEnd); }
	const block = rawText.substring(offset, end);
	return extractHeaderFromBlock(block, headerName);
}

/** Extract a header value from a block of header text, handling folded lines. */
function extractHeaderFromBlock(block: string, headerName: string): string | null {
	const lines = block.split(/\r?\n/);
	const prefix = headerName.toLowerCase() + ':';
	for (let i = 0; i < lines.length; i++) {
		if (lines[i].toLowerCase().startsWith(prefix)) {
			let value = lines[i].substring(prefix.length).trim();
			// Collect continuation lines (start with whitespace)
			while (i + 1 < lines.length && /^[ \t]/.test(lines[i + 1])) {
				i++;
				value += ' ' + lines[i].trim();
			}
			return value;
		}
	}
	return null;
}

/** Extract boundary parameter from a Content-Type value. */
function extractBoundaryParam(ct: string): string | null {
	const match = ct.match(/boundary\s*=\s*"?([^";,\s]+)"?/i);
	return match ? match[1] : null;
}

/** Find the offset where the body starts (after the first blank line from `offset`). */
function findBodyStart(rawText: string, offset: number): number {
	// Look for \n\n or \r\n\r\n
	let pos = offset;
	while (pos < rawText.length) {
		const nl = rawText.indexOf('\n', pos);
		if (nl === -1) { return -1; }
		const next = nl + 1;
		if (next < rawText.length && rawText[next] === '\n') {
			return next + 1;
		}
		if (next < rawText.length && rawText[next] === '\r' && next + 1 < rawText.length && rawText[next + 1] === '\n') {
			return next + 2;
		}
		pos = next;
	}
	return -1;
}

/** Step backward from a boundary position to find where the content ends (before the preceding line break). */
function trimTrailingNewline(rawText: string, boundaryPos: number): number {
	let end = boundaryPos;
	if (end > 0 && rawText[end - 1] === '\n') { end--; }
	if (end > 0 && rawText[end - 1] === '\r') { end--; }
	return end;
}
