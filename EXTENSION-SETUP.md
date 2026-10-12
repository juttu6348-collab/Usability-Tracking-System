# Chrome extension setup

The optional Manifest V3 extension injects the same generated `tracker.js` used by direct website integration. It is intended for local demos, QA, and websites where you have permission to run usability testing.

## Build and load

1. Install dependencies and build the tracker:

   ```powershell
   npm ci
   npm run build
   npm start
   ```

2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose this project's `extension` folder.
5. Pin **Usability Tracker - Local MVP** if you want quick access to its popup.

The build copies `dist/tracker.js` byte-for-byte to `extension/tracker.js`; do not edit the packaged copy. Run `npm run build` after changing the SDK, then click **Reload** on the extension card.

## Configure and enable a site

1. Open the extension's **Settings** page.
2. Set the collector endpoint, normally `http://localhost:3001/api/events`.
3. Set a project configured by the backend, normally `demo-project`.
4. Open the website to test, click the extension, and choose **Enable on this site**.
5. Accept Chrome's permission prompt. Reload the page if Chrome does not inject immediately.

Enablement uses exact origins, including the port. Enabling `http://localhost:3001` does not enable `http://localhost:8080`. The extension requests access only for a site when you enable it. Localhost and `127.0.0.1` access is declared for predictable local testing.

The backend must allow the website's exact origin in `CORS_ORIGINS`. For example:

```powershell
$env:CORS_ORIGINS='http://localhost:3001,http://127.0.0.1:3001,http://localhost:8080'
npm start
```

## Test two local websites

Test the built-in demo at `http://localhost:3001/demo` first. Click buttons and links, use the form with non-sensitive test data, scroll, and submit. Open `http://localhost:3001/dashboard` and refresh analytics.

For a second origin, serve any authorized static page on another port:

```powershell
npx --yes http-server tests/fixtures -p 8080
```

Open `http://localhost:8080/shop.html`, enable that origin in the popup, interact with it, then refresh the dashboard. Both origins send to the same configured project and collector.

## Controls

- The popup reports the current origin and whether it is enabled.
- **Enable on this site** requests that origin and adds it to the allowlist.
- **Disable on this site** removes it from the allowlist and stops the active tracker.
- The options page changes the endpoint, project, global enabled state, and allowed origins.
- **Clear saved settings** removes optional site permissions and restores defaults.

Chrome match patterns do not distinguish ports, so the registered content script may be offered to another port on the same hostname. `content.js` performs a second exact-origin allowlist check before starting the tracker.

## Privacy and permissions

The wrapper reads only its own `chrome.storage.sync` settings. It does not read website cookies, localStorage, authentication headers, browsing history, clipboard data, passwords, input values, textarea contents, editable text, or messages. The reused SDK records only its documented safe metadata and delegated interaction events. It does not keylog.

Manifest permissions are limited to `storage`, `scripting`, and `activeTab`. Other HTTP(S) origins are optional permissions granted one site at a time. Review a site's consent policy and obtain authorization before enabling it.

## Troubleshooting

- Confirm `http://localhost:3001/api/health` returns JSON.
- Confirm the project ID exists in `PROJECT_IDS` and the site origin exists in `CORS_ORIGINS`.
- Check the popup status and options allowlist.
- Reload the extension after `npm run build`.
- A restrictive website CSP does not block the packaged isolated-world content script, but network/CORS policy can still block delivery.
- Chrome internal pages, the Chrome Web Store, other extension pages, `file:` pages, and non-HTTP(S) pages cannot be tracked.

This local MVP has no signed Chrome Web Store package, managed policy deployment, extension auto-update, consent UI, authenticated backend, or production TLS configuration.
