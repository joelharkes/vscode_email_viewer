# Functional Specification: VSCode Email Viewer Extension

**Version:** 1.0 Draft
**Date:** 2026-02-16
**Author:** Joel Harkes
**Extension ID:** `emlviewer`

---

## 1. Overview

The VSCode Email Viewer is a Visual Studio Code extension that provides a rich editing and preview experience for `.eml` (RFC 5322) email files. It allows users to view, edit, and preview email messages directly within VSCode using a structured editor with a side-by-side preview, similar to VSCode's built-in Markdown experience.

### 1.1 Goals

- Provide a structured, form-based editor for `.eml` files as the default editor
- Offer a sandboxed email preview that can simulate how emails render in Gmail and Outlook
- Support side-by-side editing and preview (like Markdown preview)
- Allow editing of email headers, HTML body, and attachment management
- Maintain full compatibility with VSCode's "Open With..." fallback to the raw text editor
- Match VSCode's active theme (light, dark, high contrast)

### 1.2 Non-Goals

- Sending or receiving emails
- Support for non-`.eml` formats (`.msg`, `.mbox`, `.mhtml`)
- Decryption of encrypted emails
- Verification of digital signatures
- Editing attachment file contents
- WYSIWYG inline editing in the preview pane
- Email client compatibility warnings or HTML validation
- Email header analysis (SPF/DKIM/DMARC)

---

## 2. File Support

### 2.1 Supported Format

- **`.eml` files** — RFC 5322 formatted email messages, including MIME multipart

### 2.2 Editor Registration

- The extension registers as the **default custom editor** for `*.eml` files
- VSCode's built-in text editor remains accessible via **"Open With... > Text Editor"** for raw `.eml` viewing and editing
- The extension must not prevent or override the "Open With..." fallback

### 2.3 Character Encoding

- The extension must correctly handle emails in any character encoding (UTF-8, ISO-8859-1, Windows-1252, etc.)
- Charset declarations in MIME headers (`Content-Type: text/html; charset=...`) must be respected
- Display and editing must preserve the original encoding on save

---

## 3. View Modes

The extension provides two view modes and a combined side-by-side mode.

### 3.1 Structured View (Default)

The structured view is the primary editing interface. It opens by default when a user opens an `.eml` file. It consists of three sections:

#### 3.1.1 Email Headers Section

A key-value table displaying all email headers, editable via form inputs.

**Required headers with dedicated UI:**

| Header | UI Element |
|--------|-----------|
| Subject | Text input |
| From | Email address input (name + address) |
| To | Multi-value email address input |
| CC | Multi-value email address input |
| BCC | Multi-value email address input |
| Date | Date/time picker |
| Reply-To | Email address input |

**All other headers:**

- Displayed in a collapsible "All Headers" section as a key-value table
- Each row is editable (both key and value)
- Users can add new headers and remove existing ones

#### 3.1.2 Email Body Section

An embedded code editor panel for the email body content.

- Displays the HTML body of the email in an embedded editor with syntax highlighting
- If the email has only a plain text body, that is displayed instead
- If the email has both HTML and plain text parts, a tab or toggle switches between them
- The embedded editor should provide HTML-appropriate features (syntax highlighting at minimum)
- Changes in the body editor are reflected in the preview pane when in side-by-side mode

#### 3.1.3 Attachments Section

A list of all email attachments with management capabilities.

**For each attachment, display:**

- File name
- File size (human-readable, e.g., "2.4 MB")
- MIME type

**Actions per attachment:**

- **Download/Export** — Save the attachment to the local filesystem
- **Remove** — Remove the attachment from the email (with confirmation)

**Global attachment actions:**

- **Add Attachment** — Opens a file picker to add one or more files as new attachments to the email

**Out of scope:** Editing the contents of attachments, inline preview of attachment contents.

### 3.2 Preview Mode

A read-only, sandboxed rendering of the email as it would appear in an email client.

#### 3.2.1 Default Preview

- Renders the HTML body of the email in a sandboxed iframe
- Inline images (CID references) are resolved and displayed
- External images are loaded (with a toggle to block external content for privacy)
- If the email is plain text only, it is rendered with preserved whitespace and clickable links

#### 3.2.2 Render Mode Options

A dropdown or toggle in the preview toolbar allows selecting the rendering context:

| Mode | Description |
|------|-------------|
| **Default** | Renders the raw HTML as-is in the webview |
| **Gmail** | Applies Gmail's CSS resets, clipping behavior, and known rendering quirks to simulate Gmail's rendering |
| **Outlook** | Applies Outlook's (Word-based) rendering constraints to simulate how Outlook would display the email |

> **Note:** Gmail and Outlook simulation modes are best-effort approximations. They apply known CSS overrides, element restrictions, and rendering quirks of each client but cannot perfectly replicate proprietary rendering engines.

#### 3.2.3 Preview Constraints

- The preview pane is **read-only** — no inline editing
- All content is rendered inside a **sandboxed iframe** for security
- Scripts within the email HTML are **not executed**

### 3.3 Side-by-Side Mode

Mirrors VSCode's Markdown preview behavior:

- **Default:** Only the Structured View is shown
- **Preview button** in the editor toolbar (top-right icon area) opens the Preview pane to the side
- The layout becomes: Structured View (left) | Preview (right)
- Changes made in the Structured View are reflected in the Preview in real-time (or on a short debounce)
- Closing the preview returns to the Structured View only
- The preview button toggles the side-by-side mode on/off

---

## 4. Editing & Saving

### 4.1 Save Behavior

- The email file is saved with **Cmd+S** (macOS) / **Ctrl+S** (Windows/Linux), consistent with VSCode's standard save behavior
- The extension participates in VSCode's standard document lifecycle (dirty indicator, save prompts on close)
- On save, the extension serializes the current state (headers, body, attachments) back into valid RFC 5322 `.eml` format

### 4.2 Edit Tracking

- Any modification (header change, body edit, attachment add/remove) marks the document as **dirty** (unsaved indicator dot on the tab)
- The dirty state clears on save

### 4.3 Undo / Redo

- **Minimum requirement:** Each individual section (headers, body) supports undo/redo within its own context
- **Nice-to-have (v2):** Unified undo/redo stack across all sections

### 4.4 Serialization

When saving, the extension must produce a valid `.eml` file that:

- Preserves all original headers (including ones not displayed in the dedicated UI)
- Correctly encodes the HTML and/or plain text body parts
- Preserves all remaining attachments with their original encoding (base64)
- Includes any newly added attachments as properly encoded MIME parts
- Maintains valid MIME multipart structure and boundaries

---

## 5. S/MIME Support

### 5.1 Signed Emails

- **Detection:** The extension detects S/MIME signed emails (Content-Type: `multipart/signed` or `application/pkcs7-mime` with `smime-type=signed-data`)
- **Display:** A visible banner/badge at the top of both Structured View and Preview indicating: "This email is digitally signed"
- **Signer info displayed:**
  - Signer common name (CN)
  - Issuer
  - Certificate expiry date (if available from the PKCS#7 data)
- **No verification:** The extension does not verify the signature against a trust store
- **Edit warning:** When the user modifies a signed email, a warning is displayed: "Editing this email will invalidate its digital signature"

### 5.2 Encrypted Emails

- **Detection:** The extension detects S/MIME encrypted emails (Content-Type: `application/pkcs7-mime` with `smime-type=enveloped-data`)
- **Display:** A visible banner indicating: "This email is encrypted — content cannot be displayed"
- **Metadata displayed:**
  - Encryption algorithm (if parseable from headers)
  - Recipient key info (if available)
- **No decryption:** The extension does not attempt to decrypt the email
- **Body section:** Shows a placeholder message instead of the body editor

---

## 6. Search

### 6.1 Text Search

- **Ctrl+F / Cmd+F** activates search within the active view
- In the **Structured View**: searches across header values and body content
- In the **Preview Mode**: searches within the rendered text content
- Search supports:
  - Case-insensitive matching (default)
  - Case-sensitive matching (toggle)
  - Whole word matching (toggle)
- Matches are highlighted in the view with navigation (next/previous)

---

## 7. Theme Support

### 7.1 VSCode Theme Integration

- The Structured View UI (header table, attachment list, section labels, borders, backgrounds) inherits VSCode's active theme colors using CSS custom properties (`var(--vscode-editor-background)`, etc.)
- Supported theme categories:
  - Light themes
  - Dark themes
  - High Contrast themes
- The embedded body editor panel should also follow the theme
- The Preview pane renders the email's own HTML/CSS and is **not** themed (email content is displayed as-is)

---

## 8. New Email Creation (Nice-to-Have)

### 8.1 Command

- **Command Palette:** "Email Viewer: New Email" (`emlviewer.newEmail`)
- Creates a new untitled `.eml` file with a minimal valid structure:
  - Empty Subject, From, To headers
  - Current date as the Date header
  - Empty HTML body with a basic structure (`<html><body></body></html>`)
  - MIME-Version and Content-Type headers pre-filled

### 8.2 Behavior

- The new file opens in the Structured View for immediate editing
- The file is unsaved (dirty) and the user chooses where to save it

---

## 9. Commands & Keybindings

| Command | ID | Keybinding | Description |
|---------|----|------------|-------------|
| Toggle Preview | `emlviewer.togglePreview` | (toolbar button) | Opens/closes the side-by-side preview |
| New Email | `emlviewer.newEmail` | — | Creates a new blank `.eml` file |
| Download Attachment | `emlviewer.downloadAttachment` | — | Saves selected attachment to disk |
| Add Attachment | `emlviewer.addAttachment` | — | Opens file picker to add attachments |
| Remove Attachment | `emlviewer.removeAttachment` | — | Removes selected attachment from email |

---

## 10. Extension Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `emlviewer.preview.renderMode` | enum | `default` | Default render mode for preview (`default`, `gmail`, `outlook`) |
| `emlviewer.preview.loadExternalImages` | boolean | `true` | Whether to load external images in the preview |

---

## 11. Technical Constraints

### 11.1 VSCode API

- Uses **Custom Text Editor Provider** (`vscode.CustomTextEditorProvider`) to register as the default `.eml` editor
- Uses **Webview Panel** for the structured view and preview rendering
- Participates in VSCode's standard document model for save, dirty state, and undo

### 11.2 Security

- All email HTML is rendered inside a **sandboxed iframe** with restricted permissions
- Scripts in email HTML are never executed
- Content Security Policy (CSP) headers are applied to all webviews
- Attachment downloads go through VSCode's file save dialog (no silent writes)

### 11.3 Dependencies

- **mailparser** — For parsing `.eml` files into structured data
- Email serialization library (TBD) — For writing modified emails back to valid `.eml` format

---

## 12. Out of Scope (Future Considerations)

The following features are explicitly out of scope for this version but may be considered in future iterations:

- Support for `.msg`, `.mbox`, `.mhtml` file formats
- S/MIME signature verification and encrypted email decryption
- Sending emails from the extension
- WYSIWYG inline editing in the preview pane
- Email client HTML compatibility warnings
- Email header authentication analysis (SPF/DKIM/DMARC)
- Template variable highlighting
- Mobile viewport preview
- Link validation / inspector
- Export to PDF
- Diff view for comparing two `.eml` files
- Editing attachment contents
- Drag-and-drop attachment management
