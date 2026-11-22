# My Salary Tracker v9.5.0 — Test Report

Automated checks run with Node.js 22 in the project `tests` folder.

- JavaScript syntax checks: app.js, calc.js, backup-rules.js, service-worker.js — PASS
- Existing regression checks plus new income, manual OT/tips, schedule storage, and home-panel checks — 31/31 PASS
- ZIP archive integrity check — PASS

Not yet verified in a real iPhone Safari session: visual layout, camera/gallery permissions, IndexedDB quota behavior with large photos, offline install/update, and end-to-end backup/restore of schedule photos.

Important limitation: the Monday Duty Program saves a paper photo locally and lets the user manually confirm schedule details. On-device OCR is not included in this build; no schedule image is sent to a cloud service.
