# Test report - My Salary Tracker 9.5.4

Run: `cd tests && npm i && npm test` (Node 22, jsdom + fake-indexeddb).

- tests/db.test.js: 23 tests, 23 pass, 0 fail. Runs the real index.html + app.js in jsdom against a real IndexedDB implementation.
- tests/check.js (older suite): 39 pass, 0 fail.
- The same 23 tests run against the uploaded 9.5.3 code: 21 fail, 2 pass. That is the evidence for the root cause.

Covered: fresh DB, existing v1 DB, missing stores (v3 -> v4, records kept), open failure + Retry, blocked upgrade + Retry, one init for concurrent calls, render crash not shown as DB failure, work add + duplicate date, Home duty button, payments/expenses/gifts/remittances saved and reloaded, closed connection reopened, bad-record transaction failure, duty program photo save on a Wednesday, backup -> restore, legacy migration without overwrite, Details/View all buttons, rendering in 6 languages x 5 views, zero network calls, service worker install/activate/network-first/offline fallback (real service-worker.js executed in a sandbox with a fake cache).

NOT tested (cannot be done here): real Safari/iOS Home Screen behaviour, real Safari IndexedDB quirks, real service worker in a browser, CSS layout of the Details pages, camera/photo-library pickers on a phone, OCR (does not exist).
