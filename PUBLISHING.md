# Publishing the Extension

## Prerequisites

- A VS Code Marketplace publisher account (`joelharkes`)
- Node.js and npm installed
- `@vscode/vsce` (used via `npx`, no global install needed)

## Personal Access Token (PAT)

Both manual and CI publishing require a PAT from Azure DevOps.

1. Go to https://joelharkes.visualstudio.com/_usersSettings/tokens
2. Click **New Token**
3. Set **Organization** to **All accessible organizations**
4. Set **Scopes** → **Custom defined** → check **Marketplace > Manage**
5. Set expiration (max 1 year)
6. Click **Create** and copy the token immediately

## Publishing via GitHub Actions (recommended)

A workflow is already configured in `.github/workflows/publish.yml`. It triggers on GitHub releases and:

1. Sets the package version from the release tag
2. Packages the extension
3. Publishes to the VS Code Marketplace
4. Uploads the `.vsix` file to the GitHub release

### Setup

1. Create a PAT as described above
2. In the GitHub repo, go to **Settings → Secrets and variables → Actions**
3. Add a new secret named `VS_MARKETPLACE_TOKEN` with the PAT value

### Usage

1. Make sure all changes are pushed to `main`
2. Create a new GitHub release with a semver tag (e.g. `1.0.3`)
3. The workflow runs automatically — the tag version is used as the package version

## Manual Publishing

```sh
# Login (paste your PAT when prompted)
npx @vscode/vsce login joelharkes

# Package only (creates a .vsix file)
npx @vscode/vsce package

# Publish directly
npx @vscode/vsce publish
```

To bump the version and publish in one step:

```sh
npx @vscode/vsce publish patch  # 1.0.2 → 1.0.3
npx @vscode/vsce publish minor  # 1.0.2 → 1.1.0
npx @vscode/vsce publish major  # 1.0.2 → 2.0.0
```

After manually publishing, create a matching GitHub release so the repo stays in sync:

```sh
# Tag and push
git tag 1.0.3
git push origin 1.0.3
```

Then create a release for the tag on GitHub at https://github.com/joelharkes/vscode_email_viewer/releases/new.
