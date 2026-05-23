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

Demo realism rules (see `pickFakeMentorWeek_` + `FAKE_MENTOR_FULL_WINDOW_PROB_` in [SeedData.gs](SeedData.gs)):

- A coach never gives morning **and** evening availability on the same day. The seeder picks distinct weekdays first, then chooses one block per day (~60% morning / 40% evening). Friday is morning-only and lands on its own day index.
- Full half-day windows (`7:00 עד 12:00` / `16:00 עד 21:15`) appear ~40% of the time; the remaining ~60% are partial 2–4h ranges (`8:00 עד 10:00`, `17:00 עד 19:00`, …). All form labels are 2h minimum — 1-hour availabilities never appear.

**Purple columns / Form icon on live tab:** Google links the real responses tab to a **Table**; if the form had more questions before, empty purple columns (`Column 13`…) remain. Shrink the table to columns A–L or delete extra columns on `Form Responses 1` only — not on the demo tab.

Legacy radio/checkbox form (בוקר / ערב / לא זמין per day) still supported on the demo tab.

## ShiftTemplate (Mentor training)

Sun–Fri (`ראשון`–`שישי`). **שישי:** בוקר only, 7–11 (4 trainings) — no 11–12 on Friday, no Friday evening.

| Block | Hours (1 coach each) | Days |
|-------|----------------------|------|
| בוקר | 7–8, 8–9, 9–10, 10–11, 11–12 | Sun–Thu |
| בוקר | 7–8, 8–9, 9–10, 10–11 | Friday only (no 11–12) |
| ערב | 16–17, 17–18, 18–19, 19:15–20:15, 20:15–21:15 | Sun–Thu (no Friday evening) |

Total capacity: **162** = (5 weekdays × 5 morning × 3 nets) + (5 weekdays × 5 evening × 3 nets) + (Friday × 4 morning × 3 nets) = 75 + 75 + 12.

The sheet stores one row per Day/Block/Time with `Location = '*'`. The loader expands `*` into one slot per `CONFIG.locations` entry (Net1/Net2/Net3), so the runtime model still has 3 parallel nets without 3× duplication in the sheet. Specific locations (`Net1`) and comma/pipe-separated lists (`Net1,Net2`) are also supported.

Menu: **📅 עדכן תבנית אימונים** reloads `ShiftTemplate` only.

Two-layer model:

- **Form availability** = window the coach is willing to work (e.g. `7:00 עד 10:00`, `7:00 עד 12:00`, `16:00 עד 21:15`).
- **ShiftTemplate** = training layer inside the shift (hourly training slots on parallel nets).
- **Scheduled shift** = a contiguous run of 4 trainings (the canonical full shift) anchored at one of the rules below; coaches whose availability is shorter than 4 still get scheduled for whatever they have (2–3 trainings) under the old "min 2h" fallback. Coaches whose availability spans morning **and** evening on the same day may be assigned **both** blocks, but the existing "long day" warning fires on the cell.
- Nets are anonymous parallel capacity in the same physical place. The sheet keeps `Net1`–`Net3` for readability in `Schedule`, but coaches decide the actual net on site.

### Shift-length anchors (canonical full shift = 4 trainings)

| Block | Anchor | Trainings | Span | Allowed on |
|-------|--------|-----------|------|------------|
| בוקר | 07:00 | 7-8, 8-9, 9-10, 10-11 | 07:00–11:00 | Sun–Fri |
| בוקר | 08:00 | 8-9, 9-10, 10-11, 11-12 | 08:00–12:00 | Sun–Thu only (no 11–12 on Friday) |
| ערב | 16:00 | 16-17, 17-18, 18-19, 19:15-20:15 | 16:00–20:15 | Sun–Thu |
| ערב | 17:00 | 17-18, 18-19, 19:15-20:15, 20:15-21:15 | 17:00–21:15 | Sun–Thu |

Rules:

1. A coach submitting **5h** availability (e.g. 07:00–12:00) gets exactly **4 trainings** — the optimizer picks anchor 7 or 8 based on which fits the class plan.
2. Submitting **less than 4 trainings** (e.g. 9:00–12:00 = 3 trainings) is still accepted; the coach is scheduled for what they have. The result panel should surface this as "below full shift" (TODO).
3. Submitting **morning + evening same day** is allowed; both blocks get assigned independently. The schedule colors the cells orange via the existing "יום עבודה ארוך במיוחד" note.
4. Friday morning has only one anchor (7:00 → 7–11), because there's no 11–12 training to enable the 8:00 anchor.

**Algorithm gap (still TODO, after the May 22 staff meeting).** Today the optimizer's shift-block builder (`buildShiftBlockCandidates_` in `Optimizer.gs`) places coaches into any contiguous run of slots inside their availability — it does **not** yet snap to the 7/8/16/17 anchors or cap at 4 trainings. So a coach who submitted 7–12 can still get scheduled for the full 5. Locking down the anchor rule belongs in the algorithm redesign together with the supply-aware class-type distribution.

---

## Mentor roster (16 coaches)

Loaded automatically into `MasterData` by **🏗️ אתחל טבלאות** or **🧪 טען זמינות דמו לבדיקה** (Name + Rank 1–4; no site lock). Edit roster in `FAKE_MENTOR_ROSTER_` in [SeedData.gs](SeedData.gs):

רון · מנש · איתם · בבה · יובל כץ · דורון · עומר אופק · קורין · שירי · לילוש · סהר כהן · מיתר · תומר אסף · טומי · טל נחמיאס · ינון שוב

Rank per coach (1–4, 1 = best; 4 = out-of-town reserve) set in `MasterData`. Business rules pending staff meeting.

Menu **📝 בנה מחדש טופס Google** rebuilds the linked form (roster names + Sun–Fri hour-range checkboxes + per-day note field). Requires re-authorizing the script (forms scope) once.

---

## MasterData columns (basic mode)

| Column | Meaning |
|--------|---------|
| Name | Hebrew display name |
| Rank | 1–4 — `1` = best, `4` = reserve (fills gaps after 1–3); default `1`. |
| WeeklyMin / WeeklyMax | Soft weekly shift target window. WeeklyMax is the upper bound used for the "יעד" column; Rank 1 still gets every shift they sign up for via `rank_1_unconditional`. |
| Gender | `M` / `F`. Used by class-type eligibility (E classes are male-only per Mentor staff). Defaults to `M` when the cell or column is blank. |
| LocationRestriction | _(optional column later)_ blank = any site |

## Basic mode (`CONFIG.basicMode: true`)

- Optimizer uses **form availability windows**, **rank priority (1→2→3→4)**, and a soft preference against back-to-back shifts for ranks 2–4.
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

Example keys for later: `no_juniors_alone`, `min_morning_score_sitea`, etc.

Active toggles already in the sheet (default `TRUE`):

| Key | Meaning |
|-----|---------|
| `rank_1_unconditional` | Rank 1 receives every shift they signed up for, even past `WeeklyMax`. |
| `rank_priority_enabled` | Rank 1 sorts before 2 before 3 in every candidate ordering. |
| `soft_cap_weekly_max` | Ranks 2–4 at-max go to the back of the queue. |
| `avoid_back_to_back` | Penalize evening→morning <10h rests and same-day morning+evening for ranks 2–4. |
| `suggest_outside_availability` | Blue "system suggestion" for empty slots. |
| `class_type_eligibility_enabled` | Enforce `ClassTypeRules` against `ShiftTemplate.ClassType`. Kill-switch — turn off to bypass class-type filtering entirely on go-live day. |

---

## Class types & eligibility

The 8 class levels Mentor runs (easiest → hardest):

`Childs` (ילדים) → `Hi-Tech` (הייטק) → `A` → `B` → `C` → `D` → `E` → `League` (ליגה).

Two new sheet tabs, both seeded by **🏗️ אתחל טבלאות**:

### `ClassTypeRules` (policy — changes rarely)

| Column | Meaning |
|--------|---------|
| `ClassType` | One of the 8 ids above. |
| `EligibleRule` | DSL string (see below). |
| `PriorityRank` | Rank preferred inside the eligible set (or blank). |
| `AllowSplit` | `TRUE` allows a shift's classes to be split between coaches. |
| `תיאור` | Readable Hebrew description. |

Eligibility DSL (used in the `EligibleRule` cell):

- `*` — every coach in MasterData.
- `*,-<name>` — everyone except listed names (e.g. `*,-קורין`).
- `Rank<=N` — coaches with `Rank` ≤ N.
- `Gender=M` / `Gender=F` — coaches matching the MasterData Gender column.
- `<name1>,<name2>,...` — explicit allow-list.
- Predicates combine with `,` as AND, and `-<name>` subtracts a name from the result.

Defaults seeded today (per Mentor staff 2026-05-21):

| Class | EligibleRule | PriorityRank | AllowSplit |
|-------|--------------|--------------|------------|
| Childs | `*,-קורין` | — | FALSE |
| Hi-Tech | `*` | — | FALSE |
| A | `*` | — | FALSE |
| B | `*` | — | FALSE |
| C | `*` | — | FALSE |
| D | `*` | — | FALSE |
| E | `Rank<=2,Gender=M` | 1 | TRUE |
| League | `בבה,יובל כץ` | 1 | FALSE |

Master kill switch: `class_type_eligibility_enabled` (Rules sheet). `FALSE` bypasses all class-type filtering.

### `WeeklyClasses` (weekly headline counts)

One row per class type plus a `סה״כ` row at the bottom that sums the `Count` column. Seeded blank (zeros) — the staff fills the values via the **🚀 הרץ שיבוץ שבועי** dialog every week, which writes the entered counts into this sheet before kicking off the optimizer.

Flow:

1. Menu → **🚀 הרץ שיבוץ שבועי** opens `WeeklyClassCountsDialog.html` (RTL, 8 number inputs + live `סה״כ` + capacity hint).
2. Inputs pre-fill with whatever's currently in `WeeklyClasses` (zeros after a fresh seed, last-week's values afterwards).
3. The dialog shows the `ShiftTemplate` capacity (today: 165 = 5 morning hours × 6 days × 3 nets + 5 evening hours × 5 weekdays × 3 nets). If the entered total exceeds capacity the OK button locks and a red warning appears. `runOptimizeWithClassCounts` re-checks the cap server-side.
4. On "אישור והרץ שיבוץ" the counts are written to the sheet and `optimizeShiftsRun_()` runs. The result panel renders inside the dialog.
5. The dialog can also be reopened any time without running by using **⚙️ הגדרה ובדיקה → 📊 כמויות אימונים שבועיות** (re-seeds the tab to zero counts only — does not run the optimizer).

### Auto-distribution into `ShiftTemplate` (live, never written back to the sheet)

`distributeClassesIntoSlots_()` in `ClassTypes.gs` runs inside `optimizeShiftsRunCore_()` after `loadShiftTemplates()` and decides which of the 165 capacity slots actually run a class this week:

- **Slot priority** (filled first → last). Rounds 1–5 pair morning + evening peaks:
  - Round 1: morning 9–10 + evening 18–19
  - Round 2: morning 10–11 + evening 17–18
  - Round 3: morning 8–9 + evening 19:15–20:15
  - Round 4: morning 11–12 + evening 16–17
  - Round 5: morning 7–8 + evening 20:15–21:15
  - Within each round: day cycle Sun→Thu→Fri (Friday skipped for evening), then Net1→Net2→Net3.
- **Class-type assignment**: types are ordered by level descending (League → E → D → C → B → A → Hi-Tech → Childs), and dealt out into the priority-ordered slots in big contiguous blocks. Highest tiers land in the most-popular slots first, which keeps League / E off the late edge hours.
- **Manual `ShiftTemplate.ClassType` pins win**: any row that already has a `ClassType` set is treated as a pin, counted against the user's requested counts, and never moved. The auto pass only fills the unpinned remainder.
- **Inactive slots**: every capacity slot not picked by the distribution is tagged `inactive: true`. The optimizer never sees them. `writeSchedule` renders them as a grey "אין אימון" cell (no coach, no override dropdown, no hover note). Distinct from red `⚠` unfilled — those are slots that should have run a class but no coach matched.
- **Capacity overflow**: if the user enters more than 165 the dialog blocks submission; if a stale POST sneaks through, `runOptimizeWithClassCounts` throws before saving. If pins exceed the user's request for a given type the system keeps the pins and surfaces a warning in the summary.

The `אין אימון` cells survive `refreshSchedule` — the manual-edit refresh path re-detects them from the cell text in `readUnifiedScheduleAssignments_` and re-applies the grey style.

### `ShiftTemplate.ClassType` column

Last column of `ShiftTemplate`. Blank cell = no class-type filter (anyone available may teach the slot). Tag a row with a class id to gate it to the rule above.

### Behavior in the optimizer

- `assignContinuousShiftBlocks_` drops timeKeys where the coach can't teach any of the parallel-net classes at that time. The shift is naturally truncated to the teachable subset and the rest falls to another eligible coach in the same pass (gives "split within a shift" for free for E).
- `getEligibleCandidates`, `findStickyNetAssignment_`, `findSpreadAssignment_`, and `rankSuggestionCandidates_` all consult `coachEligibleForClassType_` before adding a candidate.
- The hover tooltip on the Schedule sheet shows `🚫 לא מוסמך/ת לאמן <classType>` for filtered-out coaches.

### Pending (next round)

- **Fixed weekly classes** (~30 rows the staff will pin in `ShiftTemplate.ClassType`, e.g. "Childs always Sun 17:00 Net1"):
  - Pin mechanism already works end-to-end (`distributeClassesIntoSlots_` treats any tagged row as a fixed pin, subtracts it from the user's request, never moves it).
  - **Still to wire**: the `🚀 הרץ שיבוץ שבועי` dialog needs to read the current pin counts per class type and use them as the **floor** (and prefill) for each input. So if 8 B-rows are pinned in `ShiftTemplate`, the B input shows `8` with a small "🔒 8 קבועים" hint and the input can't drop below 8. Pending agreement on exact UX after staff meeting (May 22 2026).
- **Shift-anchor enforcement.** Cap the optimizer's per-coach assignment at 4 trainings and snap the run to anchors 7/8/16/17 (see "Shift-length anchors" above). Today the optimizer still happily schedules a 5-training run when the coach gave 7–12.
- **Supply-aware class-type distribution.** Today `distributeClassesIntoSlots_` chooses slots and types **without** looking at coach availability or eligibility, so League / E can land at hours where no eligible coach submitted — guaranteed red. Plan: build a per-(day, block, time) eligible-coach-supply map per class type, then place restricted types first into hours with the highest supply; flexible types fill what's left. Add a second pass that swaps an unfilled slot's class type with a placed one if that unblocks it.
- Render the class type per cell on `Schedule` (color stripe / superscript) so the staff can read the live distribution at a glance.
- Per-class warning when a manual edit puts a coach into a slot they can't teach.
- Per-day / per-block manual override of the auto-distribution (today the algorithm is opaque — the only override is to pre-tag `ShiftTemplate.ClassType` rows).

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
