# Shift Optimizer Mentor — Project Context

Living knowledge base for rules, form shape, and setup. **No cost or wage fields** in scheduling logic.

## DO NOT CHANGE (after go-live)

1. **Google Form** field semantics (day + block availability).
2. **Form responses sheet column headers** for day columns and `שם העובד`.

Code adapts to the sheet; do not rename form columns once employees use the form.

---

## Deployment IDs

| Item | Value |
|------|--------|
| Google Sheet URL | https://docs.google.com/spreadsheets/d/1Th-f8K71HWErAixuHOMmklychZLZOV6BMSzoJ2-VNVk/edit |
| Sheet ID | `1Th-f8K71HWErAixuHOMmklychZLZOV6BMSzoJ2-VNVk` |
| Apps Script ID | `1kFAUE_fUVUsEi223x5rKep-VA00wZJQV-GI0lWnJdSmxZ8i6Dvtpk0TU` |
| Apps Script editor | https://script.google.com/d/1kFAUE_fUVUsEi223x5rKep-VA00wZJQV-GI0lWnJdSmxZ8i6Dvtpk0TU/edit |
| GitHub | https://github.com/amirvolinsky/ShiftOptimizer-Mentor |
| Form (employees) | https://docs.google.com/forms/d/1_8coyaLHL13nvYBncd3lZg_ep33EnQnw1Fs5Vn24ASs/edit |
| Form ID (`CONFIG.googleFormId`) | `1_8coyaLHL13nvYBncd3lZg_ep33EnQnw1Fs5Vn24ASs` |

**Note:** Apps Script must be container-bound to this spreadsheet (not a standalone clasp `create` copy). Use script ID above in `.clasp.json` for deploys.

---

## Google Form (current Mentor layout)

| Part | Content |
|------|---------|
| First page | `שם מאמן` (dropdown) |
| Section **ראשון-Domingo** | שאלה אחת (תיבות סימון): כותרת **ראשון-Domingo** … **חמישי-Quinta** |
| | Morning: `7:00 עד 9:00` … `10:00 עד 12:00` + longer ranges · `לא זמין / Não disponível` |
| | Evening: `16:00 עד 18:00` … `19:00 עד 21:15` + longer ranges (Sun–Thu only) |
| | Per day: optional paragraph **הערה &lt;יום&gt;** (stored in sheet; UI later) |
| Sections **שני** … **חמישי** | בוקר + ערב + לא זמין |
| Section **שישי-Sexta** | **בוקר בלבד** (4 טווחי בוקר + לא זמין — בלי ערב) |

**חשוב:** כותרת הסקשן לא נכנסת לגיליון — כותרת השאלה חייבת להיות `ראשון`, `שני`, וכו' (לא "בוקר" בלבד).

Expected sheet columns (7 + שם + חותמת):

`Timestamp` · `שם מאמן` · `ראשון-Domingo` · `הערה ראשון` · … · `חמישי-Quinta` · `הערה חמישי` · `שישי-Sexta` · `הערה שישי`

Example cell: `7:00 עד 10:00, 16:00 עד 20:15` → זמין בוקר + ערב באותו יום.

Parser: each checkbox range maps to `{ startHour, endHour }`. Optimizer assigns a coach only to hourly trainings **fully inside** a submitted range (e.g. `7:00 עד 9:00` ⇒ 7–8 and 8–9 only).

Legacy layouts (`ראשון בוקר`/`ערב`, start/end columns, "בוקר"/"ערב" text) still supported.

Link to sheet → tab name must match `CONFIG.sheets.responses` (default: `Form Responses 1`).

### Demo / test responses (separate tab)

| Setting | Default |
|---------|---------|
| Live form tab | `Form Responses 1` — never overwritten by test seeders |
| Demo tab | `Form Responses Demo` — copy of headers + fake rows |
| `CONFIG.useDemoResponses` | `true` during testing; set `false` before go-live |

Menu: **🔧 הכן טאב תשובות דמו** creates a **plain** sheet (not Form-linked). **🧪 טען זמינות דמו לבדיקה** fills demo tab only.

**Purple columns / Form icon on live tab:** Google links the real responses tab to a **Table**; if the form had more questions before, empty purple columns (`Column 13`…) remain. Shrink the table to columns A–L or delete extra columns on `Form Responses 1` only — not on the demo tab.

Legacy radio/checkbox form (בוקר / ערב / לא זמין per day) still supported on the demo tab.

## ShiftTemplate (Mentor training)

Sun–Fri (`ראשון`–`שישי`). **שישי:** בוקר only (no evening slots).

| Block | Hours (1 coach each) |
|-------|----------------------|
| בוקר | 7–8, 8–9, 9–10, 10–11, 11–12 |
| ערב | 16–17, 17–18, 18–19, 19:15–20:15, 20:15–21:15 |

The sheet stores one row per Day/Block/Time (≈55 rows) with `Location = '*'`. The loader expands `*` into one slot per `CONFIG.locations` entry (Net1/Net2/Net3), so the runtime model still has 3 parallel nets without 3× duplication in the sheet. Specific locations (`Net1`) and comma/pipe-separated lists (`Net1,Net2`) are also supported.

Menu: **📅 עדכן תבנית אימונים** reloads `ShiftTemplate` only.

Two-layer model:

- **Form availability** = shift window the coach can work (e.g. `7:00 עד 10:00`).
- **ShiftTemplate** = training layer inside the shift (hourly training slots on parallel nets).
- Optimizer schedules the coach to the **continuous training slots fully inside** the submitted window.
- Nets are anonymous parallel capacity in the same physical place. The sheet keeps `Net1`–`Net3` for readability in `Schedule`, but coaches decide the actual net on site.

---

## Mentor roster (16 coaches)

Loaded automatically into `MasterData` by **🏗️ אתחל טבלאות** or **🧪 טען זמינות דמו לבדיקה** (Name + Rank 1–3; no site lock). Edit roster in `FAKE_MENTOR_ROSTER_` in [SeedData.gs](SeedData.gs):

רון · מנש · איתם · בבה · יובל כץ · דורון · עומר אופק · קורין · שירי · לילוש · סהר כהן · מיתר · תומר אסף · טומי · טל נחמיאס · ינון שוב

Rank per coach (1–3, 1 = best) set in `MasterData`. Business rules pending staff meeting.

Menu **📝 בנה מחדש טופס Google** rebuilds the linked form (roster names + Sun–Fri hour-range checkboxes + per-day note field). Requires re-authorizing the script (forms scope) once.

---

## MasterData columns (basic mode)

| Column | Meaning |
|--------|---------|
| Name | Hebrew display name |
| Rank | 1–3 — `1` = best; default `1`. Three tiers only. |
| LocationRestriction | _(optional column later)_ blank = any site |

## Basic mode (`CONFIG.basicMode: true`)

- Optimizer uses **form availability windows**, **rank priority (1→2→3)**, and a soft preference against back-to-back shifts for ranks 2–3.
- **Rules** sheet can stay empty.
- Set `CONFIG.basicMode` to `false` in `Config.gs` after adding rules with the team.

---

## Locations (Mentor — 3 beach volleyball nets)

| ID | Hebrew label | Meaning |
|----|----------------|---------|
| Net1 | רשת 1 | מגרש / רשת פוצ'יוולי בחוף |
| Net2 | רשת 2 | |
| Net3 | רשת 3 | |

**Net** = רשת המשחק על החוף (לא "network" / רשת תקשורת). אותה תבנית משמרות בכל רשת. **אין נעילה** של מאמן לרשת — `MasterData`: Name + Rank בלבד.

After changing locations, run **תבנית אימונים** so `ShiftTemplate` uses `Net1` / `Net2` / `Net3` (not legacy `SiteA` / `SiteB`).

---

## Rules (sheet tab)

Empty for now. When ready: add key/value rows and set `CONFIG.basicMode = false` in `Config.gs`.

Example keys for later: `no_juniors_alone`, `min_morning_score_sitea`, `max_shifts_per_week`, etc.

---

## Optimizer (Mentor)

- **Basic mode:** availability → fairness (under soft target) → name tie-break.
- **No overlapping hours** same day; respects `LocationRestriction`.
- **No** cost modes; business rules off until `basicMode` is false.

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

## OAuth — "This app is blocked" / sensitive info

Google shows this when the script’s **Cloud OAuth consent screen** is missing or your Gmail is not a **Test user**. The HTML confirm dialog (`script.container.ui`) triggers it most often.

### Fix (permanent — do once)

1. [Mentor Apps Script](https://script.google.com/d/1kFAUE_fUVUsEi223x5rKep-VA00wZJQV-GI0lWnJdSmxZ8i6Dvtpk0TU/edit) → **Project settings** (gear).
2. Under **Google Cloud Platform (GCP) project**:
   - If it says **Default** or you cannot add test users → **Change project** → create a new project in [Google Cloud Console](https://console.cloud.google.com/) (e.g. `Shift Optimizer Mentor`) → copy its **Project number** → paste in Apps Script → **Set project**.
3. **Open in Google Cloud Console** (same linked project).
4. **APIs & Services** → **OAuth consent screen**:
   - **User type:** External (personal Gmail) or Internal (Workspace only).
   - **App name**, **User support email**, **Developer contact** — fill required fields → Save.
   - **Publishing status:** **Testing** (not In production).
   - **Test users** → **Add users** → the **exact Gmail** you use for the sheet → Save.
5. Apps Script: Run **`authorizeForDialogs`** (Run ▶) → Allow (works from editor; only spreadsheet + triggers).
6. Open the sheet → menu **🔐 אשר הרשאות חלונות** → Allow (grants dialog scope; **cannot** run from editor).
7. Use normal **🏗️ אתחל טבלאות** or other menu items.

### Workaround (seed data while OAuth is broken)

| Step | Action |
|------|--------|
| A | Script editor → function **`setupTablesFromEditor`** → **Run** → Allow (spreadsheet only, no HTML dialog). |
| B | Reload sheet → menu **🏗️ אתחל טבלאות (ללא חלון — אם חסום)** — uses toast, no ConfirmDialog. |
| C | After step 1–5 above, all menu items (including dialogs) should work. |

**Do not** use Chachos sheet/script for Mentor OAuth — each project has its own GCP link.

Advanced Protection or Workspace “block third-party apps” needs admin allowlist (same as Chachos).

---

## clasp

```bash
clasp push
```

`.clasp.json` is gitignored; each machine links its own copy to the bound spreadsheet project.
