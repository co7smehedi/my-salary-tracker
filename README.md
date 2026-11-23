## v9.7.6 — Flag language switcher, six Quick Actions, five-tab nav, compact home
- Sticky header now shows app logo/name, language flags (Bangla, English, Greek, Bulgarian) and Menu; tapping a flag switches language immediately.
- Home Quick Actions restored to six buttons in a 3-column x 2-row grid.
- Bottom navigation now has Home, Work, centered Add, Money, Reports.
- Clock and date use matching grey pill padding; home summary spacing is tighter.

- Home monthly savings amount shown in the open fourth summary tile, using current-month balance; an optional Settings checkbox hides/shows it.
- Restored six Quick Actions: Add Work, Overtime, Salary, Expense, Send Home, Give Money. Tips remain accessible from the Tips tile’s plus button.
- Bottom navigation now includes Money alongside Home, Work, centered Add and Reports.
- Reports is a dedicated bottom-nav destination and menu shortcut.
- App name/menu header remains sticky while scrolling across screens.

## v9.7.4 — Home savings, Quick Actions, sticky header

- Money page now groups Salary, Expenses, Remittance, Money Given, People & Profiles, Reports, Balance & Savings, and Recent Transactions in closed-by-default accordions.
- Bottom navigation reduced to Home, Work, Add, Money; Quick Actions reduced to Add Work, Overtime, Expense, Tips.
- Simplified menu; profile/account opens from Settings.
- Remittance form previews BDT conversion with fee and bonus, and optional actual BDT override.
- Money Given form supports exchange rate and optional actual BDT; estimated BDT is shown live, people selection has a blank placeholder, and missing person has a clear error.
- People totals and reports include the gift BDT conversion estimate/actual.
- Time/date padded grey blocks are balanced on both sides.

## v9.7.3 — simplified navigation and compact Money page

- Reduced bottom navigation to Home, Work, Add, and Money.
- Quick Actions now contain Add Work, Overtime, Expense, and Tips only.
- Money page consolidates Salary, Expenses, Remittance, Money Given, People, Reports, Balance, and Recent Transactions in closed-by-default accordions.
- Removed the separate menu shortcuts for Reports, Remittance, Money Given, People, and Profile; Profile & Account is available in Settings.
- Reduced menu items and compacted menu layout.
- Clock and date use matching grey padded blocks, balanced on both sides.
- All app/test files remain at ZIP root (flat package).

# My Salary Tracker — version 9.7.6

## v9.7.3 — Home duty income and total income

Home main income now shows basic duty wages plus overtime (bus allowance and tips excluded). A compact “This month total income” line adds basic duty, OT and tips. Both figures use the current calendar month, independent of Work calendar selection.

## v9.7.3 — current-month Home totals correction
- v9.7.0 features retained: hourly pay, overtime, Tips, calendar multi-date Add Work, settings/menu navigation, and local backup/restore.
- Home dashboard monthly totals (basic income, worked days, overtime, Tips, expense, and bus allowance) are now fixed to the current calendar month, regardless of the selected Work/Report month.
- Work lists and reports continue to use the selected month. Today's Earnings continues to show today's total.
- A regression test was updated to check that navigating to another month and back does not change Home's current-month figures.

**Changed as you asked:**
- **Home:** *Today's Earnings* and the *Tips / This month's expense / OT income* tiles swapped places. Today's Earnings now sits inside the month card; the three tiles are the card below it. Nothing else on Home moved.
- **Add work** (button, and Quick-add → Work) opens a **calendar**: Sunday-first, status dots like the Work page, today marked. Tap any days, including past days; each selected day gets its own hours (or one common value), or a status such as Rest/Holiday. *Today*, *Empty days up to today* and *Clear* buttons. A day that already has a record opens that record for editing instead of being overwritten. Saving is all-or-nothing and tolerates double taps. The old "many days" range screen is still there.

**Not changed:** salary rules, existing records, backup format, design. No sample data is included.


## v9.6.4 — Earnings calculation and menu navigation
- Basic pay for worked days now prorates by hours worked up to standard hours (7h at €25/8h = €21.88); OT above standard hours is calculated separately.
- Quick action label changed from Add OT to Overtime.
- Menu shortcuts now include Remittance, Money given, People, and Profile & account; the shortcuts switch to the correct screen and scroll to the section.
- Profile shortcut opens My Account directly.

## v9.6.4 — Home summary and duty-hours popup
- Removed the small monthly income tile from Home; Tips now occupies its position.
- Monthly income is shown inside the Add Tips dialog.
- Add Tips now saves standalone tip entries to the existing local IndexedDB tips store.
- Worked-today opens a popup with only worked-hours input (default 8); saving records today. Hours above standard hours add overtime.
- ZIP contains every app and test file at its root, with no enclosing project directory or tests subfolder.
- Cache/version updated to 9.6.4.


## v9.6.0 — My Account profile, simpler work form, new design layer
- **Local profile** (My Account): full name, profile photo (Photo Library, Camera or Files through the normal iPhone picker), preview before saving, Change / Remove photo, Save / Cancel. Name and photo show in My Account and at the top of the menu. No photo: initials, or a default avatar.
- **Privacy:** the profile is saved only in this browser's local storage (`mst-profile`). It is never uploaded. Photos are cropped to a square and shrunk to 256 px (JPEG) before saving. Storage errors (full, blocked) show a message and keep the old profile. IndexedDB (your salary records) is not touched.
- **Backup / restore:** the backup file now has an optional `profile` field. Older backups without it still restore. Merge keeps the profile on the phone and only fills blanks; Replace takes the profile from the backup.
- **Work form:** date, status and *Hours worked* only. The Overtime field is gone from this form (use the OT button). Editing a record keeps its overtime and tips.
- **Work page:** big *Add work* button, quick buttons, two summary cards. Date fields no longer stretch past the edge of the dialog.
- **Design:** new colours, SVG line icons instead of emoji (navigation, quick actions, menu), smoother dialogs.
- **Sign-in / cloud accounts: NOT configured.** There are no sign-in buttons because nothing could honour them. See the notes in the chat reply about Firebase Authentication or Supabase.
- New file: `profile.js` (upload it together with the others).


## v9.5.12 fixes
- Rest Day, Holiday and Unpaid Leave hide Basic Duty hours and overtime fields. Non-work statuses save zero basic hours and zero overtime.
- Added multi-date work entry for older dates, including Worked, Rest Day, Holiday and Unpaid Leave. Existing dates are skipped to prevent overwriting.
- Expanded currency choices for money-given records.
- Replaced Quick Actions emoji with consistent line SVG icons.


## Changes in 9.5.12
- Home clock: compact time on the left and date on the right.
- Backup screen action now clearly supports importing/restoring backup JSON. Standard backups and recovery-export JSON are supported; recovery exports can also restore settings from the saved localStorage snapshot.
- About profile text for Mehedi Hasan, a waiter working in Cyprus (localized in Bengali and English).
- ZIP contains only the app folder; no tests or test reports.

A private salary, expense and money tracker that works offline on iPhone and Android.
**Your records stay on your phone. Nothing is sent to any server.**

## What is in this package (15 files, all in one flat folder)

`index.html` `style.css` `app.js` `calc.js` `backup-rules.js` `i18n.js` `service-worker.js` `manifest.json` `recover.html` `recover.js`
`icon-192.png` `icon-512.png` `icon-maskable-512.png` `apple-touch-icon.png` `README.md`

The file list is the same as 9.1 (no new files). Upload all 15 files (see step 1 below). The `tests` folder and `TEST-REPORT.md` are NOT uploaded to GitHub.

There is **no `icons` folder**. All icons sit next to the other files.

## What changed in 9.5.5 (basic duty / overtime / tips fix)

**Fixes**
- Basic Duty always earns the full daily Basic amount. Explicit OT hours are used as the OT total and are not counted twice from the shift-length field.
- Legacy work entries without an explicit OT value retain their old total-hours OT calculation.
- Added a separate manual Tips entry (date, amount, optional note) inside Quick Add. Tips are saved in a separate IndexedDB store and counted in the month and today totals.
- Tips from older work records remain included; no historical work records are rewritten.
- Added My Account to the Menu, but email sign-in and Google Drive backup are not connected. Those require authentication/OAuth configuration and will be completed separately.
- The Home page layout remains the same; the Tips button is inside Quick Add and My Account is in the Menu.

**If the banner says BLOCKED:** fully close the Home Screen app (swipe it away) and every Safari tab of this app, wait a few seconds, open the app again and tap Retry.

**Not included:** automatic reading of schedule photos (OCR). It does not exist in this app. Schedule details are typed in by hand after the photo is attached; the photo stays on the phone.

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


## v9.5.0 update
- Added compact monthly basic income, today's earnings breakdown, and monthly OT/tips totals.
- Tips are stored on each existing work record and included in monthly calculations. Existing records default to zero tips.
- Added Monday Duty Program in the menu. Paper photos and confirmed schedule rows are stored locally in IndexedDB and included in backups. Schedule dates are unique; replacing a date requires confirmation.
- Schedule details are entered manually after photo upload. No cloud OCR or external upload is performed; OCR is not included in this build.
- Added a small home schedule preview for today only; rest days display as Rest Day. Planned schedules do not mark attendance or add salary.

## v9.5.2 rebuild from v9.4.2 baseline
- Monday Duty Program photo picker now permits Camera or Photo Library (removed camera-only capture hint).
- Fixed Quick Action labels across all six languages.
- Hides Duty Hours unless Work status is Worked.
- Storage usage/quota values are safely handled when unavailable; never displays `null`.
- IndexedDB blocked upgrade no longer rejects prematurely; writes show a readable database-not-ready error instead of null exceptions.
- Fresh installs no longer import hard-coded historical transactions or names. Existing local records/settings are not deleted.


## v9.5.3 database recovery and dashboard actions
- Database startup shows a persistent loading/error banner and a Retry button if local IndexedDB cannot open.
- A blocked database upgrade times out with a clear instruction to close other app tabs; it does not silently leave data-entry controls active.
- Work, quick-add, and Monday schedule actions stay disabled until local records finish loading. Existing records are never deleted or reset.
- Balance panel now shows received and outgoing totals, with a working Reports shortcut. Recent Transactions has a View All shortcut to the Money page.
- The Monday program still stores the photo locally and requires manual entry of schedule details; automatic OCR is not bundled in this build.


## 9.5.10 changes
- Monthly bus allowance is included in total earned salary and outstanding; the bus paid/unpaid breakdown remains separately visible.
- Added a Tips + button on the Home page beside the Tips amount.
- Backup & Restore is hidden in normal screens and appears only after selecting it from the Menu.
- Home layout otherwise unchanged.

## 9.5.10 requested fixes
- Backup & Restore is hidden outside its menu-opened section.
- OT quick action uses a dedicated overtime-only form (date + OT hours to add), removing the Basic Duty hours field.
- Tips dialog opens without automatically triggering the date picker; calendar controls are compact.


### Country and currency (v9.5.10)
Country selection is independent from language. It changes the displayed currency and default remittance bonus; it does not convert existing numeric amounts. The remittance calculator remains EUR-based for its exchange-rate input.

## 9.5.10 requested refinements
- Compact home date/time panel with more separation between the two values.
- Smaller, accented month navigation controls.
- Dialogs focus the title, not date inputs, to avoid native date-picker popups opening automatically.
- New remittance entries use editable approximate country exchange-rate defaults (Bangladesh: 140 BDT per EUR).


## v9.5.14
- Home dashboard income totals are always calculated for the current calendar month, independent of Work-page month navigation.
- Historical work saves no longer jump the app month.
- Today duty button becomes disabled whenever a record already exists for today.
- Bulk work entry supports date ranges with a per-date selection preview and skips existing dates.


## v9.7.3 correction
- Home dashboard monthly totals (basic income, worked days, OT, tips, expenses and bus allowance) are fixed to the current calendar month, independent of the selected Work/Report month. Work lists and report views continue to follow the selected month.
- Added a regression test for month isolation when navigating previous/next months.

## v9.7.3 Home income display update
- Main Home income is labeled **This Month's Duty Income** and equals Basic Duty wages + OT pay. Tips and bus allowance are excluded.
- A compact **This month total income** line directly below the main amount equals Basic Duty wages + OT pay + Tips.
- Both figures use the current calendar month, regardless of Work calendar month navigation.


## v9.7.6 — Quick Add icon fix and fixed header
- Restored visible local SVG icons in the Add modal for all six actions.
- Add modal icons appear above each label in a compact 3×2 grid.
- Header/menu is fixed to the viewport with safe-area support and remains accessible while scrolling.
- All icons are bundled SVG symbols and work offline.
