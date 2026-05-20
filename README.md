# Shift Optimizer Mentor

Rules-based weekly shift scheduling in **Google Sheets** + **Apps Script**. Employees submit availability via a **Google Form**; the optimizer fills shift slots from **MasterData**, **ShiftTemplate**, and **Rules** — with **no wage or cost optimization**.

Based on the [Chachos Shift Optimizer](https://github.com/amirvolinsky/ShiftOptimizer-Chachos) architecture, stripped for fairness-only scheduling.

## How it works

1. Coaches fill a Hebrew availability form (morning + evening hour ranges per day, optional free-text note).
2. Manager runs **🚀 הרץ שיבוץ שבועי** from the sheet menu.
3. Output: **Schedule** tab with manual override dropdowns, fairness table, and on-demand **Share_Export** + ShiftHistory archive on **📤 הפץ לו"ז וסגור שבוע**.

## Sheet tabs

| Tab | Purpose |
|-----|---------|
| `MasterData` | Coaches: Rank 1–4 (1 = best, 4 = reserve), optional location lock |
| `ShiftTemplate` | Training slots per net / day / block |
| `Rules` | Key/value business rules |
| `Form Responses 1` | Linked form (rename in `Config.gs` if different) |
| `Schedule` | Generated schedule |
| `ShiftHistory` | Weekly satisfaction log |
| `Share_Export` | Clean view for sharing |

## Setup checklist

### 1. Google Sheet

1. Create a new spreadsheet (e.g. **Shift Optimizer Mentor**).
2. Note the Sheet ID from the URL: `/d/<SHEET_ID>/edit`.

### 2. Google Form (Hebrew)

Create a form with:

| Field | Type |
|-------|------|
| שם מאמן | Dropdown |
| ראשון … חמישי | Checkbox time ranges (morning + evening) |
| שישי | Checkbox time ranges (morning only) |
| הערה <יום> | Paragraph per day |

Link responses to the spreadsheet. Set `CONFIG.sheets.responses` in [Config.gs](Config.gs) to the **exact** linked tab name.

### 3. Apps Script + clasp

```bash
cd /path/to/ShiftOptimizer-Mentor
npm install
clasp login
clasp create --type sheets --title "Shift Optimizer Mentor" --parentId <SHEET_ID>
clasp push
```

Reload the sheet → menu **Shift Optimizer Mentor** appears.

### 4. First run in the sheet

1. **🏗️ אתחל טבלאות** — seeds the 16 Mentor coaches in MasterData + the hourly training layer in ShiftTemplate (edit for your org).
2. Update `CONFIG.locations` and `CONFIG.locationNames` in [Config.gs](Config.gs) if you rename nets.
3. **🧪 טען זמינות דמו לבדיקה** (optional).
4. **🚀 הרץ שיבוץ שבועי**.

## Deploy code changes

```bash
npm run clasp:push
```

## Data to customize

After seeding, edit in the sheet (no code change needed for most tweaks):

- **Locations** — 3 parallel training slots/nets: `Net1`–`Net3`; labels רשת 1–3. They are capacity columns in the same physical place.
- **Hebrew labels** — `CONFIG.locationNames` in [Config.gs](Config.gs).
- **Coaches** — `MasterData` tab.
- **Shift patterns** — `ShiftTemplate` tab.
- **Rules** — `Rules` tab (`min_morning_score_sitea`, etc.).

See [CONTEXT.md](CONTEXT.md) for full rule documentation.

## Menu

| Item | Action |
|------|--------|
| 🚀 הרץ שיבוץ שבועי | Build schedule from form availability + rank priority |
| 🔄 רענן לו"ז אחרי עריכה ידנית | Refresh notes + fairness after manual edits |
| 📤 הפץ לו"ז וסגור שבוע | Share_Export + ShiftHistory + archive form responses |
| ❓ מי לא מילא טופס זמינות? | Missing submissions + ready-to-copy reminder |
| 🗑️ נקה את גיליון הלו"ז | Clear Schedule tab |
| 📖 מדריך שימוש | Show the in-product guide |
| 🏗️ אתחל טבלאות | Seed MasterData / ShiftTemplate / Rules |
| 📅 עדכן תבנית אימונים | Rewrite ShiftTemplate (hourly trainings × 3 nets) |
| 📝 בנה מחדש טופס Google | Rebuild the linked Google Form from code |
| 🔧 הכן טאב תשובות דמו | Create the demo responses tab with mentor headers |
| 🧪 טען זמינות דמו לבדיקה | Fill MasterData + demo responses with fake mentor data |

## License

Same family as Chachos project — use and adapt for your organization.
