# My Salary Tracker v9.4.2 — Build / Test Report

Date: 22 Nov 2026

## Implemented in this build
- Settings now expose monthly basic salary, weekly working days, standard hours, and OT/hour; daily basic is calculated from monthly salary ÷ (weekly days × 52 ÷ 12). €650 and 6 days/week calculate to €25/day.
- Home duty button moved directly below the salary/balance summary. It is red before duty, green after marking, and disabled with a status note when today's record is a non-work status.
- Sticky app header/Menu remains visible across secondary views.
- Compact typography/card spacing.
- Persistent people directory, add/rename names, and recipient dropdown with an Add New option.
- Historical remittance and money-given records from the project handoff imported idempotently (only when explicitly requested in this conversation). Unknown remittance dates are stored with month precision and displayed as month, not a fabricated exact day.
- Optional receipt image/PDF attachment on money records (5 MB per file); receipt details remain collapsed until tapped; included in local backup JSON.
- Person profile includes separate EUR and BDT totals and monthly totals; BDT amount alongside EUR for Riyad retained separately.
- Service-worker cache version bumped to 9.4.0.

## Verification
- JavaScript syntax: app.js, calc.js, service-worker.js — passed.
- Calculation/static suite: 27/27 checks passed.
- CSS brace balance — passed.
- ZIP integrity — passed (no compressed-file errors).
- Full real iPhone interaction test — not performed.
- Headless Chromium attempt — environment timed out before rendering; not counted as a pass.

## Known limitations
- The current browser can restrict file attachments or local storage quota. Receipts are stored locally, not sent anywhere; export a backup regularly.
- Monthly-precision historical transfers show a month, not an exact day.
- Reminder notifications, OCR schedule import, fully translated added labels, and advanced profile editing remain future work.


## v9.4.2 regression checks
- Today's duty card appears immediately before Quick Actions.
- All form-opening flows close the calendar; the calendar opens only when its explicit toggle is tapped.
- Existing calculations and data structures remain unchanged.
