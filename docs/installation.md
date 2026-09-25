# Installation and deployment

## Source checkout

Install Node.js 22.13+ and npm, then run `npm ci`, `npm run build`, and `npm start`. For source development use `npm run dev`. Rebuild after changing frontend source.

The first personal-mode launch is local-only at `http://127.0.0.1:4310`. App data defaults to `.codewith` in the checkout. Do not commit that directory or a configured `.env`.

## Release ZIP

Extract the application ZIP, enter `codewith-0.1.0`, run `npm ci --omit=dev`, then `npm start`. The frontend is prebuilt; build tools and a separate IDE extension are unnecessary. This is a Node application distribution, not a native executable with Node included.

To verify downloads on Linux:

```sh
sha256sum -c SHA256SUMS
```

Keep the downloaded tarball and ZIP beside `SHA256SUMS`, or verify the individual file's listed hash. macOS offers `shasum -a 256`; PowerShell offers `Get-FileHash -Algorithm SHA256`.

## GitHub Packages

GitHub's npm registry requires authentication even for public packages. Use your own GitHub username and a classic personal access token with `read:packages` for installation. Never commit the token or paste it into an issue.

```sh
npm login --scope=@jjjuuuun --auth-type=legacy --registry=https://npm.pkg.github.com
npm install --global @jjjuuuun/codewith@0.1.0 --registry=https://npm.pkg.github.com
mkdir my-codewith
cd my-codewith
codewith
```

The npm CLI stores runtime data in the current directory's `.codewith`, not inside `node_modules`. A `.env` in that directory may set `CODEWITH_DATA_DIR` and other deployment settings. `codewith --port 4312` changes the port; `codewith --version` reports the application version.

If you prefer no registry authentication, use the release ZIP or install the downloaded npm tarball locally.

Registry behavior is documented by [GitHub Packages](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-npm-registry).

## Shared or server operation

Use `.env.example` and the in-app deployment guide as configuration references. Set the mode, fixed origin, permitted authentication methods, data location, and listener deliberately. For server mode, registration and invitations follow the configured access policy; the first setup key is stored in the private data directory.

For trusted HTTPS, either terminate TLS at a reverse proxy or set both `CODEWITH_TLS_CERT` and `CODEWITH_TLS_KEY`. The public origin must match the address used by clients. A loopback listener behind a proxy prevents bypassing the proxy. LAN clients must trust your issuing CA when using a private certificate; no test CA or private key is shipped.

Passkeys require a domain and a trusted secure context. `http://localhost` is the development exception. Physical-phone/QR hand-off depends on browser, platform, and authenticator support.

## AI and projects

Official CLI connections require their CLI on the server's PATH; alternatively set `CODEWITH_CODEX_BIN` or `CODEWITH_CLAUDE_BIN`. API connections require the user's provider credentials instead. CodeWith does not include a subscription, model weights, or API credits.

A server filesystem connection refers to the server's filesystem. Use browser folder import or an explicitly permitted server project directory; do not expose system directories as project roots. AI requests may send selected project content to the configured provider.

## Data, backups and upgrades

Back up the entire data directory and any external database together. Credentials, uploaded attachments, project metadata, skills, and history may live outside the single document database. Keep one running server per store.

Stop the old instance before upgrading. Install the next version into a separate location and point it at the backed-up data directory. Do not copy old `node_modules`, test certificates, or a local `.env` into a public artifact. There is no automatic downgrade guarantee for future schema changes.

The deprecated bridge's challenge/verify sign-in is retired. Existing accounts using that old identity can receive a supported login key through the operator's `account:key` command; current login-key/passkey accounts are unchanged.
