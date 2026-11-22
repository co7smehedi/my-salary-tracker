# My Salary Tracker v9.3.0 — Test Report

## Passed
- JavaScript syntax check: app.js, calc.js, service-worker.js
- 16 automated checks in `tests/check.js`
- Calculation checks: 8-hour basic duty (€25), 9-hour/10-hour overtime, work and bus allowance snapshots, remittance fee/bonus, earned/received/outstanding/expense separation
- Static checks: work calendar and quick duty controls, people profile UI, edit/delete controls, main navigation destinations, rent setting removed, version/cache, CSS brace balance
- HTML ID uniqueness: no duplicate IDs
- JavaScript DOM ID references: no missing app DOM IDs
- ZIP integrity: to be checked at packaging

## Not tested
- Live browser/device interactions, iPhone Safari layout, IndexedDB write/edit/delete workflows, install/offline behavior. Chromium screenshot attempt failed in the execution environment.

## Known incomplete features
- Weekly schedule/program + OCR import
- Background reminders (iOS PWA restrictions)
- Complete multi-currency reporting/dashboard
