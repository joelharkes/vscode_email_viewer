# Email Viewer - VSCode Extension

VSCode custom editor for `.eml` files using `postal-mime` for parsing.

## Structure

- `src/extension.ts` — Entry point, registers the custom editor provider
- `src/MailViewer.ts` — Main logic: parses EML, builds webview HTML, handles attachments
- `src/util.ts` — `getNonce()` for CSP
- `media/editor.js` — Webview JS: renders email data, handles UI interactions
- `media/editor.css` — Webview styles using VSCode theme variables
- `examples/` — Sample `.eml` files for testing
- `SPEC.md` — Functional specification

## Build & Dev

```sh
npm run compile   # Build TS → out/
npm run lint      # ESLint
npm run test      # VSCode test suite
```

Debug: F5 launches Extension Development Host (see `.vscode/launch.json`).

## Conventions

- TypeScript strict mode, ES2022 target
- Conventional commits (`feat:`, `fix:`, `refactor:`)
- Webview ↔ extension communication via `postMessage`
- Security: CSP with crypto nonce, sandboxed iframe for HTML body, `localResourceRoots` restricted to `media/`
