# Shift Optimizer Mentor — Project Context

Living knowledge base for rules, form shape, and setup. **No cost or wage fields** in scheduling logic.

## DO NOT CHANGE (after go-live)

1. **Google Form** field semantics (day + block availability).
2. **Form responses sheet column headers** for day columns and `שם העובד`.

Code adapts to the sheet; do not rename form columns once employees use the form.

---

## Deployment IDs (fill in after setup)

| Item | Value |
|------|--------|
| Google Sheet URL | _paste after creation_ |
| Sheet ID | _from URL_ |
| Apps Script ID | _script.google.com → Project settings_ |
| GitHub | https://github.com/amirvolinsky/ShiftOptimizer-Mentor |
| Form (employees) | _paste view URL_ |

---

## Google Form (recommended)

| Field | Type | Options |
|-------|------|---------|
| שם העובד | Dropdown | From MasterData names |
| ראשון … חמישי | Radio | בוקר / ערב / לא זמין |
| שישי, שבת | Checkbox | בוקר / אמצע / ערב / לא זמין |
| הערות | Free text | Personal requests |

Link to sheet → tab name must match `CONFIG.sheets.responses` (default: `Form Responses 1`).

---

## MasterData columns

| Column | Meaning |
|--------|---------|
| Name | Hebrew display name |
| Rank | 1–4 (א–ד); 4 = most senior |
| IsPriority | TRUE = must get MinShifts/week (mentors/leads) |
| MinShifts / MaxShifts | Weekly bounds |
| LocationRestriction | Blank, `SiteA`, or `SiteB` |
| RequestedShifts | Soft fairness hint |
| BlockRestriction | Optional: `בוקר` or `ערב` only |

---

## Locations (default)

| ID | Hebrew label |
|----|----------------|
| SiteA | סניף א |
| SiteB | סניף ב |

Edit in [Config.gs](Config.gs) `CONFIG.locations` and `CONFIG.locationNames`. Every `ShiftTemplate.Location` value must match an ID exactly.

---

## Rules (sheet tab)

| Key | Default | Description |
|-----|---------|-------------|
| no_juniors_alone | TRUE | Rank ≤2 needs rank ≥3 overlap |
| min_morning_score | 7 | Fallback morning score minimum |
| min_morning_score_sitea | 7 | Per-location morning minimum |
| min_morning_score_siteb | 6 | Per-location morning minimum |
| default_target_shifts_per_week | 5 | Soft target cap |
| max_shifts_per_week | 6 | Hard weekly cap |
| min_rest_hours | 0 | Rest between shifts |
| allow_double_shift | FALSE | Same-day double shifts |

---

## Optimizer (Mentor)

- **Phase 1:** Priority staff (`IsPriority` + `MinShifts`).
- **Phase 2:** Fill slots by fairness (most under shift target first), then rank / name tie-break.
- **No** economical/balanced/cost modes.
- Constraints: availability, one shift/day, no juniors alone, morning score, Friday rank-4 morning, Fri/Sat closing ≥2, location restrictions.

---

## Schedule output

- RTL sheet, color-coded cells (green / blue suggestion / yellow junior risk / red unfilled).
- Fairness table: target vs received vs available days.
- **No** daily or weekly ₪ rows.

---

## What we need from you to go live

1. Real location IDs + Hebrew names.
2. Employee roster in `MasterData`.
3. `ShiftTemplate` rows for your real shift patterns.
4. `Rules` values for your policy.
5. Form link + confirmation of responses tab name.
6. (Optional) Apps Script ID for clasp verification.

---

## clasp

```bash
clasp push
```

`.clasp.json` is gitignored; each machine links its own copy to the bound spreadsheet project.
