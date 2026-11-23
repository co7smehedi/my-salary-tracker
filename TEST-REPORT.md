# Test report — My Salary Tracker 9.7.1

## Independently run in this environment
- JavaScript syntax checks: passed for app.js, service-worker.js, qa.test.js, and check.js.
- Static checks: 57/57 passed (`node check.js`).
- ZIP integrity: verified after packaging.
- Flat ZIP structure: all app and test files at archive root; no nested folders.

## Not independently run
- `npm test` / functional test suites (db.test.js, profile.test.js, qa.test.js): not run. `npm install` timed out, and the dependencies jsdom and fake-indexeddb were not available.
- Real-device browser testing on iPhone Safari or Android Chrome: not run.

## Targeted v9.7.1 change
Home monthly totals now use the current calendar month (`homeMonth` / `hc`) rather than the month selected for Work/Reports. The Home regression test was updated to navigate to previous/next month and assert current-month income, Tips and expenses remain unchanged. This test was added but not executed here because test dependencies could not be installed.

Claude's previous QA report included additional test-run claims; those are not independently verified in this report.
