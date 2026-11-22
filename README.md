# My Salary Tracker — version 9.2

A private salary, expense and money tracker that works offline on iPhone and Android.
**Your records stay on your phone. Nothing is sent to any server.**

## What is in this package (15 files, all in one flat folder)

`index.html` `style.css` `app.js` `calc.js` `backup-rules.js` `i18n.js` `service-worker.js` `manifest.json` `recover.html` `recover.js`
`icon-192.png` `icon-512.png` `icon-maskable-512.png` `apple-touch-icon.png` `README.md`

The file list is the same as 9.1 (no new files). Upload all 15 files (see step 1 below).

There is **no `icons` folder**. All icons sit next to the other files.

## 1. Update the app on GitHub (iPhone only)

1. In the **Files** app, tap the ZIP file once. A folder with the 15 files appears.
2. Open **Safari** → `github.com/co7smehedi/my-salary-tracker` → sign in.
3. Tap **Add file** → **Upload files**.
4. Tap **choose your files**, open the new folder and **select all 15 files**, then tap **Add**.
5. Scroll down, tap **Commit changes**.
6. Wait 1–2 minutes. GitHub Pages then publishes it at `https://co7smehedi.github.io/my-salary-tracker/`.

Files with the same names are replaced automatically. Do not delete anything first.

## 1b. What changed in 9.1 (safety release — no records or calculations were changed)

- **Restore (Merge)** can no longer create a second work record for a date that already has one. The existing record is kept and the app tells you how many records were skipped.
- **Delete** now works for every kind of record ID, and the app checks that the record is really gone.
- **Restore checks are stricter.** A backup file is refused (and nothing is changed) if it has a negative amount, a remittance rate of 0 or invalid, a bus allowance larger than its payment, an invalid date, a missing ID, or no records at all. The message says which record is wrong, in your language.
- **Backups always read your saved records fresh**, so a second open window can never leave records out of a backup.
- **Storage protection:** the app asks the browser to keep your data safe from automatic clearing. **Settings → Storage & backup** shows whether the browser agreed ("Protected" or "Not guaranteed"), how much space is used, and the date of your last exported backup.
- **Backup reminder:** if records exist and you have not exported a backup for 7 days (or ever), a banner appears at the top. "Remind me tomorrow" hides it for the rest of the day. The date is saved only on your phone and counts only the **Export backup** button (not the safety copy made during a restore).
- **Update offer:** when a new version is installed while the app is open, you are offered **Export backup first** before reloading.
- **Bus allowance Paid / Unpaid / Partly paid** for each month, shown under Salary payments and in Reports. It is worked out from the “Bus allowance included” amounts you enter on salary payments. It is separate from salary and is never added to *Earned*.
- **Security:** a Content-Security-Policy blocks injected scripts and any connection to other websites. The recovery page was changed only to move its script into `recover.js`.
- Error messages and notices that are already on screen switch language immediately when you change the language.
- An automated test suite (74 checks) was added. It is delivered as a separate ZIP and is not part of the app.

## 1c. What changed in 9.2 (bug-fix and Reports release — no records, settings or database structure were changed)

**Fixed: totals wrong after adding records**
- **Double tap on Save** could store the same record twice, so a day was counted twice (€50 instead of €25) or a payment was counted twice. Saving is now locked while it is in progress, and the “one work record per date” check and the write happen together in one database transaction, so even a second open window cannot create a second record for the same day.
- **A record saved in a different month** than the one on screen was saved correctly but the screen still showed the old month’s totals, which looked like “the total did not change”. The app now switches to the month the record belongs to (a payment goes to its *salary month*) and says “Saved to <month>”.
- **Existing duplicate days:** if your data already has two work records for the same date, they are **not changed or deleted**. A warning above Work records lists the dates so you can delete the extra one yourself.

**New: live date and time** at the top of the dashboard, updated every second, in the selected language and your phone’s local time. Only the clock text changes each second; the page is not redrawn. When midnight passes, the page refreshes once so “Today’s duty” moves to the new day.

**Reports, redesigned for phones**
- **Month / Year / All time** buttons; the arrows move month by month (Month) or year by year (Year).
- Summary cards: **Earned**, **Received**, **Outstanding** (or **Overpaid**), **Expenses**, **Cash left**.
- A bar chart (month) or Earned / Received / Expenses chart (year and all time).
- Sections: **Salary**, **Work days & overtime** (worked days, hours, overtime hours, leave / holiday / sick / rest days), **Bus allowance (separate from salary)**, **Money flow** (money received, expenses, sent home with fee, bonus and BDT, money given, cash left).
- **Monthly breakdown** for a year report and **Yearly breakdown** for all time, as one readable block per month or year. Nothing is a wide table, so nothing scrolls sideways on iPhone.
- **CSV (this report):** plain numbers (for example `77.77`, no currency symbol) with a unit column, so Excel / Numbers read it in any region, plus a second table with the monthly or yearly breakdown.
- **Print / PDF:** title, period, creation time, summary, chart, sections and breakdown table, laid out for A4 with print-safe colours.

Earned salary, salary received, outstanding / overpaid and bus allowance are always shown as separate numbers. The calculation rules did not change.

The automated tests for 9.2 are delivered as a separate ZIP (they are not part of the app).

## 2. Very important — first use after updating

Your data is **not deleted** by this update (the database structure is unchanged). Still, the very first thing to do:

1. Open the app (the Home Screen icon if you normally use that).
2. Tap **⋮ → Backup & restore → Export backup** and save the file to **iCloud Drive** (choose *Save to Files*).
3. Check that your old records are visible. If something looks wrong or empty:
   **⋮ → About → Recover data (read-only)**. That page only reads your data, changes nothing, and lets you save or copy everything.
   Also try **Export everything (recovery)** in the Backup section.

**Safari tab and Home Screen icon do not share data on iPhone.** Use the one you used before (normally the Home Screen icon).
Do not delete the app and do not clear Safari data — that would erase records on the phone.

## 3. Install on the Home Screen

- **iPhone:** open the address in **Safari** → **Share** button → **Add to Home Screen** → **Add**.
- **Android:** open in **Chrome** → ⋮ menu → **Install app** (or *Add to Home screen*).

## 4. How updates reach your phone

Open the app while online. The new version downloads automatically. If it finishes while the app is open, a window offers **Export backup first**, **Reload now** or **Later**.
If you do not see the change, fully close the app (swipe it away) and open it again.
Your records are never touched by updates.

**Honest limit:** the app loads the newest files whenever it opens while online, so an update deployed while the app was closed takes effect at the next launch *without* a prompt. That is why the weekly backup reminder matters. A fully staged “approve before updating” system is planned for the later Update System phase.

## 5. Backup and restore

- **Export backup** creates one `.json` file with all records and settings. Save it to iCloud Drive. Do this every week.
- **Restore backup:** choose the file. The app checks the whole file first. If anything is wrong it stops and **changes nothing**.
  Then:
  1. Tap **Save a safety backup of your current data** (required — it protects you).
  2. Choose **Merge** (keeps your current records, adds/updates from the file) or **Replace all** (asks again before replacing).
- The restore is all-or-nothing: if it fails halfway, everything stays as it was.
- Backups from earlier app versions (RC v6 / v8) can be restored. Merge keeps one work record per date: if the file has a different record for a date you already have, your current record is kept.
- A backup with no records at all is refused (it could only be used to wipe real data).

## 6. What the app does

- **Dashboard:** live date and time, earned, received, outstanding (or *Overpaid*), expenses, worked days, overtime.
- **Work records:** worked, rest day, paid leave, unpaid leave, sick leave, holiday. Add, edit, delete. One record per date.
- **Salary:** €25 per day for up to 8 hours, €2.77 for each extra hour (all editable). Example: 10 hours = €25.00 + 2 × €2.77 = **€30.54**.
- **Salary payments:** partial payments, outstanding balance, overpayments. Pick the salary month for every payment.
- **Bus allowance (€50, editable):** kept separate. It is “due” for a month with at least one worked day. If a payment includes bus allowance, enter it in the “Bus allowance included” field so it is not mixed into salary.
- **Expenses:** categories; **Rent is off by default** (turn it on in Settings).
- **Remittance:** EUR → BDT with exchange rate, fee, bonus % (default 2.5 %), optional “actual BDT received”.
- **Money given:** gifts/help, in EUR or BDT. It is **not** a loan and is never counted as money owed to you.
- **Reports:** month, year and all-time, with summary cards, charts and monthly / yearly breakdown; CSV export; Print / PDF (use the Share button → *Save to Files* in the print preview on iPhone).
- **Languages:** English, বাংলা, Türkçe, Български, हिन्दी, Ελληνικά. **Dark and light mode** (Settings → Appearance).

## 7. Not included yet (honest list)

My Account / My Profile, schedule photo import (OCR), reminders (other than the backup banner), recipient directory, real PDF export, advanced charts, app lock. Google Drive / cloud backup is deliberately not planned.
The Menu only lists things that really work.

## 8. Privacy

No servers, no analytics, no tracking, no outside scripts, no cloud backup. Records are stored in the phone’s IndexedDB; settings and the last-backup date in local storage.
The only files that leave the app are the ones **you** export.

## v9.3.0 consolidated navigation and work-calendar update

- Work screen now includes a month calendar with status colors, month navigation, month earned/worked summary, and editable dates.
- One-tap Basic Duty is available on Home and Work. It records the configured standard hours and rate snapshot; duplicate work for today is prevented. Undo is offered after a new quick record.
- Work entries now snapshot basic wage, standard hours, and OT rate when saved, so new entries do not silently recalculate when rates change later. Older records without snapshots continue using the current settings until edited.
- People summary groups Money Given entries by person, shows EUR/BDT totals and transaction count, and opens a profile with history and per-currency totals. Existing entries can be edited/deleted; names can be renamed across records.
- Added Money page jump buttons, App Update check, Language shortcut, Privacy/Security explainer, Export shortcut, and additional Money Given currencies.
- Removed the Rent setting from the visible Settings page. Existing rent records are preserved but excluded by the default setting.
- Version: 9.3.0. Data stores are unchanged; no user records are intentionally deleted.

Known limitations in this build: weekly schedule program/OCR import, background reminder scheduling, and a full multi-currency report/dashboard have not been implemented. Browser/iPhone end-to-end interaction tests could not be run in this environment; see TEST-REPORT.md.

## v9.4.0 update notes
- Salary Settings: monthly basic and weekly days determine the daily base rate (e.g., €650 / 26 workdays = €25). Duty marking adds one day once; OT uses the configured hourly rate.
- Home duty action has red/green/disabled states and a small status reason.
- Sticky menu/header, more compact typography, persistent people directory with Add New name picker.
- Optional receipt image/PDF on money records; details are collapsed until opened. Files are device-local and included in backup.
- Historical remittance and money-given amounts from the handoff are imported once; uncertain days are stored as month-precision, not invented.


## v9.4.1 UI refinement
- Compact professional layout and reduced card spacing.
- Work section moved above Quick Actions in document layout.
- Work calendar is collapsed by default and opens only on explicit tap.
- Received and outstanding dashboard tiles replaced by a compact, non-interactive monthly income display; expense shortcut remains available.
- Existing financial records, names, formulas, and calculation modules are unchanged.


## v9.4.2 requested layout and calendar behavior
- Moved the Today's duty card directly above Quick Actions on the Home screen.
- Ensured every form-opening action (including Work and OT) closes the calendar first; calendar opens only from its explicit Show calendar control.
- No data schema, records, salary formulas, or backup behavior changed.
