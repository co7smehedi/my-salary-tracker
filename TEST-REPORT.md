# My Salary Tracker v9.5.9 — Test Report

## Changes
- Home clock date/time spacing increased while compacting the overall clock box.
- Month navigation arrows and month label reduced in size, padding, and given accent styling.
- Dialogs now focus their heading instead of a first date input, reducing the chance native date pickers open automatically.
- New remittance entries default to a country-aware editable exchange rate; Bangladesh defaults to 140 BDT per EUR (approximate, user-editable).
- Version and service-worker cache updated to 9.5.9.

## Checks
- JavaScript syntax checks passed (`app.js`, `calc.js`, `service-worker.js`).
- Automated project checks: 42 baseline checks passed plus 6 added checks.
- ZIP archive integrity checked after packaging.

## Limitations
- No real iPhone Safari UI test was performed.
- Exchange-rate defaults are approximate and editable, not live FX rates. Existing remittance rates are preserved.
- Remittance calculations/reporting remain BDT-based in the current app; other-country rates are defaults only and need country-specific remittance reporting support in a future update.
