# Usability Analytics — Phases 1–3

Dependency-free browser SDK, local Node.js/SQLite ingestion API, and a plain JavaScript analytics dashboard. The existing ingestion contract is preserved. Playwright is a development-only dependency for repeatable browser verification.

## Run

Requires Node.js 24+. Install and start:

```sh
npm ci
npm run build
npm start
```

For a first local setup, `npm install` is also supported; `npm ci` is preferred when reproducing the lockfile exactly.

Demo: http://localhost:3001/demo (the root URL also serves it). Dashboard: http://localhost:3001/dashboard. Tracker: http://localhost:3001/tracker.js. Health: http://localhost:3001/api/health. Events persist in `data/analytics.sqlite`. Runtime has no third-party dependencies. Node 24 may emit an experimental warning for its built-in SQLite module.

Verification commands:

```sh
npm run lint
npm test
npx playwright install chromium
npm run test:e2e
```

## Optional Chrome extension

The `extension/` folder contains a Manifest V3 wrapper for authorized testing on sites where adding a script tag is inconvenient. `npm run build` copies `dist/tracker.js` into the extension byte-for-byte, so direct integration and extension injection use one SDK implementation.

Load `extension/` with Chrome's **Load unpacked** action, open a website, and use the popup to enable that exact origin. Settings include the collector endpoint, project ID, global tracking state, and per-origin allowlist. The popup links to the local dashboard and the full options page. See [EXTENSION-SETUP.md](EXTENSION-SETUP.md) for setup, two-site testing, CORS configuration, and troubleshooting.

Direct integration is best for owned production sites: it is deployable with the website, works without an installed browser extension, and can be tied to the site's consent flow. Extension injection is best for local QA and demos: it requires no source edit, but every tester must install it and grant each site. Chrome prevents injection into internal pages, the Web Store, extension pages, and other protected schemes.

The extension requests only `storage`, `scripting`, and `activeTab`; non-local HTTP(S) access is optional and granted per origin. Its wrapper reads only extension settings. It never reads site cookies, localStorage, form values, editable contents, tokens, authentication headers, or browsing history. All SDK privacy rules described below remain in force.

The browser suite starts its own collector and a separate-origin fixture server on free local ports; it uses an isolated database under `data/integration-*`. It exercises `tests/fixtures/shop.html` and `tests/fixtures/docs.html`, saving a report, database and dashboard screenshot. Summary evidence is in `data/latest-integration-report.json`. Optional `BROWSER_PATH` selects an already installed Chromium executable. Lint checks JavaScript syntax; no TypeScript typecheck is configured.

## Embed

The build emits a standalone, dependency-free browser IIFE at `dist/tracker.js`, served by the backend at `/tracker.js`. No bundler, modules, framework or inline initialization is required. Add this one tag anywhere in the host page (including its head):

```html
<script src="http://localhost:3001/tracker.js" data-project-id="demo-project"></script>
```

Initialization waits for the DOM when necessary. `defer` is also supported. The collector defaults to `/api/events` **on the script's origin**, not on the host website. An optional `data-endpoint="https://collector.example/api/events"` overrides it. Configure the backend's `CORS_ORIGINS` with the exact website origin; the configured project must appear in `PROJECT_IDS`.

Example for a host at http://localhost:8080 (PowerShell):

```powershell
$env:CORS_ORIGINS='http://localhost:3001,http://127.0.0.1:3001,http://localhost:8080'
npm start
```

The host only needs the script tag. Buttons, links, forms, scrolling, and semantic `main`, `section`, and `article` attention are automatic. Tracking attributes are optional for stable selectors and explicitly safe labels/titles. Serve pages over HTTP(S), not file URLs. For deployment, use an HTTPS tracker/collector URL and allow it in host CSP `script-src` and `connect-src`. A site's existing CSP or consent policy can require configuration.

For advanced options, omit `data-project-id` and initialize explicitly after the DOM exists:

```html
<script src="/tracker.js"></script>
<script>
  const tracker = UsabilityTracker.init({
    projectId: 'demo-project',
    endpoint: 'http://localhost:3001/api/events',
    sanitizePath: path => path.replace(/\/users\/[^/]+/g, '/users/redacted')
  });
</script>
```

Load the auto-start tag only after any required consent, or call explicit init after consent. Repeated init and repeated script tags do not duplicate tracking listeners. Call `UsabilityTracker.destroy()` before reconfiguring. Modern browsers with crypto.randomUUID (HTTPS or localhost), fetch, and URL are required; attention tracking gracefully skips if IntersectionObserver is unavailable.

## Privacy contract

No input/textarea values, editable contents, DOM text, keystrokes, cookies, headers, or browser storage contents are collected. Visitor/session IDs are independent random IDs held **only in memory**, stable across SPA navigation and renewed on reload. This MVP does not identify returning visitors or join sessions across tabs.

URLs contain origin and pathname only. Referrer is origin only. Pathnames can themselves contain private data: configure `sanitizePath` for your routes (use `() => '/redacted'` to omit all path detail). Query strings and fragments are always removed. A trusted sanitizer must return a pathname.

Metadata is deliberately conservative: tags are automatic; IDs require `data-track-id`; labels for buttons/links require `data-track-label`; page titles use `<html data-track-title="Public-title">` rather than potentially sensitive document.title. All annotation values must be safe static identifiers (letters first, then letters, digits, hyphens or underscores; maximum 64 characters). Never annotate with user data. `data-track` provides a stable selector. Generic tag selectors need not be unique. `data-track-ignore` excludes an entire subtree from element/mouse tracking.

Semantic `main`, `section`, and `article` elements are observed automatically; `data-track-attention` can opt in other elements. Attention measures time at least 50% visible while the document is visible and focused (a proxy for attention, not proof of reading). At most 100 elements are observed. Call `UsabilityTracker.init().refresh()` after dynamically adding/removing sections; SPA navigation also refreshes. Very tall sections may never be 50% visible. No mutation observer scans the whole DOM. Unannotated elements share tag selectors and are aggregated together.

## Events and delivery

Events: `page_view`, `page_active`, `click`, `scroll_depth`, `focus`, `form_interaction`, `form_submit`, `mouse_move`, `element_attention`.

Every event has an event ID, project/session/visitor IDs, ISO timestamp, page view ID, sanitized URL/path/title, and viewport. Page views include coarse browser/device metadata and referrer origin. Clicks include safe element metadata and relative/page coordinates. Scroll thresholds fire once per page view at 25/50/75/100% of scrollable travel. Focus events represent focusin/focusout. Form interactions use delegated change events (no per-keystroke events); submits record attempts, not server-confirmed success. Programmatic `form.submit()` does not dispatch a submit event. Page and element durations are incremental milliseconds; sum by page view ID/element. Hidden and unfocused time is excluded.

History pushState/replaceState URL changes and popstate start new page views. Optional `trackHashChanges: true` tracks hashchange events; fragments never enter payloads. Repeated notifications for the same URL are deduplicated. Configure title annotations before SPA navigation.

Defaults: 20 events/batch, 5-second flush, mouse sampling every 250ms, scroll sampling every 150ms, maximum 200 queued events (oldest discarded under sustained failure). Options: `batchSize` (1–50), `flushIntervalMs` (1000–60000), `mouseSampleMs` (100–5000). `tracker.flush()` attempts one fetch batch. Hidden/pagehide events use sendBeacon. Failed fetch batches are requeued with stable IDs for later retry; failed beacon admission leaves events queued. Delivery is best effort: no disk persistence, guaranteed unload delivery, or automatic replay after closing a tab. Collector should deduplicate event IDs. Beacon admission does not confirm server receipt.

Payload: `{ "schema_version": 1, "events": [...] }`. Both transports POST JSON as `text/plain;charset=UTF-8` to avoid unnecessary CORS preflights. Fetch omits credentials and referrer; the browser's beacon API can still attach cookies/referrer according to browser policy. Use a dedicated cookieless collector origin and a restrictive host Referrer-Policy if needed. The SDK never reads those values. Cross-origin collectors must allow the host origin via CORS for fetch responses, parse the JSON body, validate project IDs/schema, and apply rate/size limits. Permit the endpoint in host CSP `connect-src`.

## Structure

```text
sdk/tracker.js          Browser source and public API
dist/tracker.js         Generated deployable script
demo/index.html        Interactive example
scripts/build.js       Dependency-free artifact build
scripts/e2e.js         Two-site real-browser integration suite
extension/             Optional Manifest V3 injector, popup and options UI
scripts/test-extension.js  Unpacked-extension browser integration suite
tests/extension.test.js    Manifest, permissions and artifact identity tests
tests/fixtures/        Unannotated shop and documentation host pages
backend/start.js       Local API entry point and configuration
backend/server.js      HTTP routes, CORS, limits, analytics queries
backend/validation.js  Schema validation and privacy projection
backend/database.js    SQLite schema, transactions and summaries
backend/analytics.js   Dashboard aggregations from stored events
dashboard/index.html   Dashboard at /dashboard
dashboard/app.js       Live API rendering and canvas heatmap
dashboard/style.css    Responsive dashboard styles
scripts/serve.js       Compatibility entry point for persistent server
scripts/check.js       JavaScript syntax checks
scripts/verify-storage.js  Assert browser-generated database/API evidence
tests/tracker.test.js  Node tests with browser API doubles
tests/backend.test.js  HTTP/SQLite integration and persistence tests
data/analytics.sqlite  Local database (generated, ignored by Git)
package.json
README.md
EXTENSION-SETUP.md     Extension installation and testing guide
VERIFICATION.md        Browser and automated verification report
```

Tests cover SDK behavior, real HTTP ingestion, privacy projection, atomic rollback, duplicate retries, filters, analytics, CORS, request limits and database reopen persistence. SDK unit tests use browser API doubles; `test:e2e` uses real Chromium, real cross-origin HTTP requests, and SQLite. See `FINAL-MVP-REPORT.md` for final evidence and `VERIFICATION.md` for earlier runs.

## Backend configuration

The server binds to `127.0.0.1`. Environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3001` | Local HTTP port |
| `DB_PATH` | `data/analytics.sqlite` | Persistent SQLite file |
| `PROJECT_IDS` | `demo-project` | Comma-separated allowed projects, provisioned at startup |
| `CORS_ORIGINS` | `http://localhost:3001,http://127.0.0.1:3001` | Exact allowed website origins, no wildcard |
| `MAX_REQUEST_BYTES` | `65536` | Maximum request body bytes (up to 1 MiB) |
| `MAX_BATCH_SIZE` | `50` | Maximum events per batch (up to 500) |

PowerShell example: `$env:CORS_ORIGINS='http://localhost:3001,https://your-site.example'; npm start`.

SQLite uses WAL, foreign keys, a busy timeout, atomic transactions and indexes for project/time, session, page and event type. Events are unique by `(project_id,event_id)`. Only new events update session duration; retries cannot inflate it. A session cannot change visitor identity. Restarting the process keeps existing data.

## API

`POST /api/events` accepts `application/json` and SDK/beacon `text/plain` JSON with `{schema_version:1,events:[...]}`. Required IDs: `event_id`, `project_id`, `session_id`, `visitor_id`. Supply the unchanged SDK `type` and `page:{url,path,view_id,title}` or flat `event_type`, `page_url`, `page_path`. Each event needs an ISO UTC timestamp and `viewport:{width,height}`. Event-specific metadata is validated; SDK `depth` maps to `scroll_percentage`, and durations use `duration_ms`. Device metadata remains optional, as the SDK sends it on page views.

Success: `{accepted:20,inserted:18,duplicates:2}`. Invalid batches are rejected in full. Errors return `{error:"..."}` with 400 (validation/JSON), 403 (origin/project), 409 (session conflict), 413 (body limit), or 415 (content type/encoding). Unknown fields are discarded at every metadata level rather than stored. Only validated JSON data is persisted, SQL parameters are bound, selectors are rebuilt from safe annotations, URL queries/fragments are removed and script/markup URLs rejected. No request bodies or sensitive headers are logged. As with the SDK, pathnames and annotations must not contain personal data; the backend cannot infer whether an otherwise valid path/identifier is sensitive.

- `GET /api/projects/demo-project/summary`: total sessions/page views, average **active** session duration in milliseconds (sum of `page_active`, excluding attention time), top 20 pages/elements, scroll threshold counts and distinct sessions/page views. Sessions with no duration events contribute zero. Scroll statistics represent recorded thresholds, not inferred reading completion.
- `GET /api/projects/demo-project/events?session=SESSION_ID&page=%2F&event_type=click&limit=100&offset=0`: intersecting exact filters; `page` is a pathname. Returns normalized events, total count, limit and offset. Limit is capped at 500, ordered by ingestion ID.
- `GET /api/projects/demo-project/heatmap?page=%2F&bin=20&limit=500&offset=0`: click counts in pixel bins (top-left coordinates), separated by page URL and viewport dimensions. Returns `points`, `has_more`, `coordinate_space:"page"` and `bin_size`. Bin range 1–200; maximum 2000 points per page. Same filters are supported. Render different viewport groups separately; Phase 1 does not capture document dimensions for cross-layout normalization.

This is a local MVP, with no read authentication or rate limiter. CORS restricts browser origins, not non-browser callers; requests without Origin are accepted for local tools. Keep analytics endpoints local or place them behind authentication before exposing the server publicly. Hosting is not configured.

## Dashboard

Run `npm start` with Node 24+, then open **http://localhost:3001/dashboard**. The tracked test website remains at **http://localhost:3001/**. Select a configured project and click **Refresh data** after interacting with the demo. The dashboard itself does not load the tracker, so viewing analytics does not add events.

Features: sessions/page views/total events/active duration/scroll depth cards, visited pages with session counts and average active time, top interactions with safe selector/tag/label, latest sessions, safe click-through event timelines, accumulated and average section attention, scroll milestone reach, and a page/viewport-selectable canvas click heatmap. Simple page, event-type and session filters apply to tables. All numbers are queried from SQLite; no sample analytics are injected. Loading, empty and request-error states are included. Tables scroll within their panels and the layout adapts to mobile.

Additional read routes: `GET /api/health` reports local server health; `GET /api/projects` lists configured project IDs; `GET /api/projects/:projectId/dashboard` returns dashboard aggregates. Existing summary/events/heatmap and ingestion routes remain compatible. Heatmap data comes from the existing `/heatmap` endpoint, paged in batches of 2,000 bins. Session timelines use the existing filtered events endpoint with a 500-event display cap.

Metric definitions:

- Average scroll depth: average maximum recorded depth per page view, with no scroll events treated as zero. Reach percentages count page views whose maximum meets each threshold, divided by all measured page views. Repeated milestones do not increase reach.
- Page active time: sum of `page_active` increments matched by project, session, page URL and page-view ID, divided by page views. Missing duration increments contribute zero. Flat external events without page-view IDs cannot associate duration/scroll increments with a view; use the unchanged SDK for complete metrics.
- Session duration: accumulated active time, not wall-clock time. Interactions include clicks, focusin/out, form edits and submit attempts; mouse samples and duration checkpoints are excluded. Pages visited counts page views, including repeats.
- Attention: sum of element attention increments; multiple visible sections may overlap, so this is not a partition of session duration.

MVP limits: all-time reporting and manual refresh; top 500 pages, top 20 interaction/attention groups, latest 50 sessions; heatmap loads up to 20,000 bins with an explicit truncation message. Heatmap is a schematic observed area, not a screenshot: viewport groups stay separate and height extends only to the deepest click or viewport height. There are no historical layout snapshots or document-height measurements. Scrolling is quantized to 25% milestones. IDs still reset on reload. No login, date filters or real-time streaming.

Verification: `npm run verify:dashboard` independently recomputes metrics from database event payloads and compares them with the API, writing `data/dashboard-verification.json`. For browser assertions, load the dashboard then pipe `scripts/check-dashboard-browser.js` to `agent-browser eval --stdin` in that browser session. See `VERIFICATION.md` for the recorded real-browser run.

## Remaining follow-up work (not implemented)

The earlier Phase 2 ingestion/persistence work is complete. A future production phase would add authenticated project access, rate limiting, retention/deletion policies, production hosting/TLS and consent integration. Analytics enhancements such as date filters, historical layout snapshots and finer heatmap normalization remain outside this MVP. Cross-browser testing beyond Chromium, load testing and guaranteed offline delivery have not been performed or implemented.
