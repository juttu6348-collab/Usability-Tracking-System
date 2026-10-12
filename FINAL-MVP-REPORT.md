# Final MVP integration evidence — 2026-10-08

**Result: PASS for the exercised MVP features.** A reproducible Chromium run used two different HTML apps on a separate origin from the collector, real SDK delivery, real HTTP ingestion, an isolated SQLite file, and the real dashboard. The production/demo database was not replaced.

## Integration

```html
<script src="http://localhost:3001/tracker.js" data-project-id="demo-project"></script>
```

Run `npm ci`, `npm run build`, `npm start`. Add the host website's exact origin to `CORS_ORIGINS` and its project to `PROJECT_IDS`. The tag initializes after DOM readiness and sends to `/api/events` on the script origin. No framework, inline initializer, or DOM tracking attributes are needed. Use HTTPS URLs for HTTPS hosts. Dashboard: http://localhost:3001/dashboard.

## Feature evidence

| Feature | Result | Exercised evidence |
| --- | --- | --- |
| Page views | PASS | 3 stored views: shop, documentation, SPA guide |
| Active page duration | PASS | 3 duration events; positive dashboard duration; hidden-time and pagehide/restore unit tests |
| Click tracking | PASS | 9 stored clicks across both apps |
| Button interactions | PASS | Real button clicks plus a final delegated button click before unload |
| Link interactions | PASS | Real anchor clicks on both apps; fragment navigation does not create extra views |
| Scroll depth | PASS | 8 events; 25/50/75/100 milestones present |
| Form interactions without values | PASS | 6 edit events; canary form values absent from received JSON and SQLite |
| Form submission | PASS | 2 submit attempts; host preventDefault behavior preserved |
| Mouse sampling | PASS | Each burst of 1,000 mouse events produced 1 recorded sample |
| Scroll throttling | PASS | Each burst of 1,000 scroll events executed 1 scroll calculation |
| Element attention | PASS | 9 events from unannotated semantic sections/articles |
| SPA navigation | PASS | History pushState produced /docs/guide; replaceState covered by unit test |
| Session creation | PASS | Exactly 2 anonymous sessions; SPA retains its session |
| Event batching | PASS | 6 fetch batches; largest batch 20 events, all HTTP 200 |
| sendBeacon flushing | PASS | Real page exits produced 2 beacon batches with 4 and 3 events; collector returned 200 and stored them |
| Listener reuse | PASS | Reloading script did not increase delegated-listener counts or page-view counts |
| Backend persistence | PASS | All 76 received events stored; database closed and reopened with count intact |
| Dashboard analytics | PASS | Rendered 2 sessions and 3 views; attention and active duration present; separate integration tests verify exact averages/reach |
| Click heatmap | PASS | Selected shop page; canvas rendered click data; aggregate click counts equalled stored clicks |
| Two-site reuse | PASS | Shop and documentation app use only the remote script tag, one blocking/head tag and one defer tag |
| Browser errors | PASS | No JavaScript page errors reported |

Latest isolated snapshot: 3 page views, 4 mouse samples, 36 focus events, 9 clicks, 9 attention events, 8 form edits, 2 form submissions, 11 scroll milestones and 3 duration events = **85 events**.

Evidence artifacts: `data/integration-wa41rI/report.json`, `analytics.sqlite`, and `dashboard.png`. `data/latest-integration-report.json` points to the latest run and is overwritten on a rerun. Test artifacts are local and Git-ignored.

## Privacy and security

PASS: planted password, name/input, textarea/message, contenteditable, OTP, card, URL token/fragment, cookie and localStorage canaries were absent from received analytics JSON and SQLite. Both apps recorded **0 SDK cookie reads and 0 storage reads**. No key logging is implemented. Backend tests also cover unknown-field removal, validation, CORS rejection, request/batch limits, atomic rollback and deduplication.

Scope matters: these checks concern analytics payloads and persisted data. Browsers may attach cookie/referrer HTTP headers to native sendBeacon requests; the SDK does not read them and the collector does not persist them. Use a dedicated cookieless collector origin and appropriate Referrer-Policy. User data deliberately placed in URL pathnames or opt-in metadata cannot be inferred automatically; use `sanitizePath` and static annotations. No claim is made that arbitrary host-provided identifiers can always be classified as sensitive.

## Executed checks and fixes

- `npm run build`: PASS; standalone browser artifact regenerated.
- `npm run lint`: PASS (syntax validation).
- `npm test`: **12/12 PASS**, including new pagehide/restore and fragment-navigation regressions.
- `npm run test:e2e`: PASS with Playwright's installed Chromium; same flow also passed with the existing Chromium executable.
- Typecheck: not configured for this JavaScript project.

Fixed: missing automatic script-tag initialization; missing default collector-origin resolution; attention requiring host annotations; timer-based duration resuming after pagehide; fragment-only popstate incorrectly creating page views. The first beacon test falsely failed because automation detached before receiving unload network/console notifications; the harness now uses collector-side received requests, HTTP status and SQLite persistence as delivery evidence. No delivery success is inferred solely from sendBeacon returning true.

## Remaining phase / limitations

The earlier Phase 2 ingestion and persistence scope is complete. Remaining production work: authenticated project access, rate limits, retention/deletion policies, TLS hosting and consent integration. Other future analytics work: date filters, historical layout snapshots and better layout normalization.

MVP limitations: best-effort delivery, in-memory IDs reset on reload, attention needs semantic or opt-in elements and may miss very tall sections, generic selectors merge similar elements, dynamic elements need refresh, schematic heatmaps, manual all-time dashboard refresh. Cross-browser compatibility beyond Chromium, load testing, hostile-site security auditing and crash/offline delivery guarantees were not verified. Lifecycle restore timing was tested with browser API doubles; a native browser back-forward-cache round trip was not claimed.
