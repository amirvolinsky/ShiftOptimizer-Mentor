# Shift Optimizer Mentor

Rules-based weekly shift scheduling in **Google Sheets** + **Apps Script**. Employees submit availability via a **Google Form**; the optimizer fills shift slots from **MasterData**, **ShiftTemplate**, and **Rules** — with **no wage or cost optimization**.

Based on the [Chachos Shift Optimizer](https://github.com/amirvolinsky/ShiftOptimizer-Chachos) architecture, stripped for fairness-only scheduling.

## How it works

1. Employees fill a Hebrew availability form (בוקר / ערב / אמצע per day).
2. Manager runs **הרץ אופטימייזר** from the sheet menu.
3. Output: **Schedule** tab with manual override dropdowns, fairness table, and optional **Share_Export**.

## Sheet tabs

| Tab | Purpose |
|-----|---------|
| `MasterData` | Employees: Rank, IsPriority, Min/Max shifts, location |
| `ShiftTemplate` | Slots per location / day / block |
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
| שם העובד | Dropdown |
| ראשון … חמישי | Radio: בוקר / ערב / לא זמין |
| שישי, שבת | Checkbox: בוקר / אמצע / ערב / לא זמין |
| הערות | Paragraph |

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

1. **הגדר טבלאות** — seeds sample data (edit for your org).
2. Update `CONFIG.locations` and `CONFIG.locationNames` in [Config.gs](Config.gs) if you rename sites.
3. **טען תשובות בדיקה** (optional).
4. **הרץ אופטימייזר**.

## Deploy code changes

```bash
npm run clasp:push
```

## Data to customize

After seeding, edit in the sheet (no code change needed for most tweaks):

- **Locations** — `ShiftTemplate.Location` must match `CONFIG.locations` (`SiteA`, `SiteB` by default).
- **Hebrew labels** — `CONFIG.locationNames` in [Config.gs](Config.gs).
- **Employees** — `MasterData` tab.
- **Shift patterns** — `ShiftTemplate` tab.
- **Rules** — `Rules` tab (`min_morning_score_sitea`, etc.).

See [CONTEXT.md](CONTEXT.md) for full rule documentation.

## Menu

| Item | Action |
|------|--------|
| הרץ אופטימייזר | Build schedule from form + rules |
| רענן שיבוץ | Refresh notes + fairness after manual edits |
| הפץ משמרות | Share_Export + ShiftHistory + archive form |
| מי לא הגיש זמינות? | Missing submissions |
| הגדר טבלאות | Seed MasterData / ShiftTemplate / Rules |
| טען תשובות בדיקה | Sample form rows |

## License

Same family as Chachos project — use and adapt for your organization.
