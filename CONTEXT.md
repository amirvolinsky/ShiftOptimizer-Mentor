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
| First page | `כמות משמרות מבוקשת` — single-choice 1–6. Required. The optimizer uses this as the coach's weekly target (overrides `MasterData.WeeklyMax`) and applies the **+1 cap**: effective target = `min(submitted_target, submitted_days + 1)`. |
| Section **ראשון-Domingo** | שאלה אחת (תיבות סימון): כותרת **ראשון-Domingo** … **חמישי-Quinta** |
| | Morning: `7:00 עד 9:00` … `10:00 עד 12:00` + longer ranges · `לא זמין / Não disponível` |
| | Evening: `16:00 עד 18:00` … `19:00 עד 21:15` + longer ranges (Sun–Thu only) |
| | Per day: optional paragraph **הערה &lt;יום&gt;** (stored in sheet; UI later) |
| Sections **שני** … **חמישי** | בוקר + ערב + לא זמין |
| Section **שישי-Sexta** | **בוקר בלבד** (4 טווחי בוקר + לא זמין — בלי ערב; Friday morning is 7–11, no 11–12 slot) |

**חשוב:** כותרת הסקשן לא נכנסת לגיליון — כותרת השאלה חייבת להיות `ראשון`, `שני`, וכו' (לא "בוקר" בלבד).

Expected sheet columns (7 + שם + חותמת):

`Timestamp` · `שם מאמן` · `ראשון-Domingo` · `הערה ראשון` · … · `חמישי-Quinta` · `הערה חמישי` · `שישי-Sexta` · `הערה שישי`

Example cell: `7:00 עד 10:00, 16:00 עד 20:15` → זמין בוקר + ערב באותו יום.

Parser: each checkbox range maps to `{ startHour, endHour }`. Optimizer assigns a coach only to hourly trainings **fully inside** a submitted range (e.g. `7:00 עד 9:00` ⇒ 7–8 and 8–9 only).

Legacy layouts (`ראשון בוקר`/`ערב`, start/end columns, "בוקר"/"ערב" text) still supported.

Link to sheet → tab name must match `CONFIG.sheets.responses` (default: `Form Responses 2`).

### Demo / test responses (separate tab)

| Setting | Default |
|---------|---------|
| Live form tab | `Form Responses 2` — never overwritten by test seeders |
| Demo tab | `Form Responses Demo` — copy of headers + fake rows |
| `CONFIG.useDemoResponses` | `true` during testing; set `false` before go-live |

Menu: **🔧 הכן טאב תשובות דמו** creates a **plain** sheet (not Form-linked). **🧪 טען זמינות דמו לבדיקה** fills demo tab only.

Demo realism rules (see `pickFakeMentorWeek_` + `FAKE_MENTOR_FULL_WINDOW_PROB_` in [SeedData.gs](SeedData.gs)):

- A coach never gives morning **and** evening availability on the same day. The seeder picks distinct weekdays first, then chooses one block per day (~60% morning / 40% evening). Friday is morning-only and lands on its own day index.
- Full half-day windows (`7:00 עד 12:00` / `16:00 עד 21:15`) appear ~40% of the time; the remaining ~60% are partial 2–4h ranges (`8:00 עד 10:00`, `17:00 עד 19:00`, …). All form labels are 2h minimum — 1-hour availabilities never appear.

**Purple columns / Form icon on live tab:** Google links the real responses tab to a **Table**; if the form had more questions before, empty purple columns (`Column 13`…) remain. Shrink the table to columns A–L or delete extra columns on `Form Responses 2` only — not on the demo tab.

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

### Weekly shift target (per coach, per week)

Two layers, resolved every run by `getShiftTarget` in `Optimizer.gs`:

1. **Form value** — every coach picks `1`–`6` on the first page of the availability form (`כמות משמרות מבוקשת`). The value lands on the same column on the responses sheet and is parsed by `parseWeeklyTargetValue_` in `Responses.gs`. This is the **preferred** source.
2. **`MasterData.WeeklyMax`** fallback when the form value is missing (e.g. legacy response, demo data without a target, or a coach who edited the row to clear it).
3. **Dynamic fallback** (legacy): `Math.max(1, submittedDays - 1)`, capped at 5. Only used when neither of the above is set.

After picking the raw value, the **+1 cap** is applied unconditionally:

```
effective_target = min(raw_target, submitted_days + 1)
```

Examples:

| Submitted days | Form target | MasterData.WeeklyMax | Effective target |
|----------------|-------------|----------------------|------------------|
| 3              | 4           | —                    | 4                |
| 3              | 6           | —                    | 4 (cap)          |
| 2              | 5           | 5                    | 3 (cap)          |
| 5              | 4           | 5                    | 4 (form wins)    |
| 0 (didn't submit) | any      | any                  | 0 (never auto-scheduled) |

The cap implements the staff rule "no coach gets more than one suggested 🔵 day beyond what they submitted". A coach who picked 2 days but answered "6" on the form is still scheduled for at most 3 days that week.

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

**Implementation (May 23 2026).** `findBestContiguousAssignment_` in `Optimizer.gs` enforces:

- **Cap at 4 trainings.** Longer availability windows still produce at most a 4-training assignment.
- **Minimum 2 trainings.** Coaches whose longest contiguous teachable run is below 2 are skipped this week — no isolated 1-training shifts.
- **Time-contiguous only.** The function refuses fragmented assignments (e.g. 8–9 + 10–11 with a 9–10 gap). It finds the contiguous runs in the candidate's `timeKeys`, tries the longest first, and within each window prefers same-net (sticky) before falling back to a spread placement across nets.

**Shift-vision multi-pass (May 23 2026).** `assignShiftBlock_` runs three passes per (day, block) group:

1. **Pass 1 — full shifts only.** Candidates whose longest contiguous teachable run reaches the 4-training cap enter; `findBestContiguousAssignment_` is forced to return a 4-training assignment or nothing. Rank-1 priority and the usual sort still apply *within* the pass.
2. **Pass 2 — 3-training shifts.** Coaches whose longest run is < 4 (so they CAN'T fit a full shift) but ≥ 3. **A coach who could deliver 4 is excluded** — if pass 1 couldn't place them, they don't fall back to a 3-shift; they stay unassigned for this (day, block). This implements the staff rule: "if a coach gives 4+ hours, give them exactly 4 trainings or none".
3. **Pass 3 — 2-training shifts.** Same exclusion for 4h+ coaches. 3h coaches that pass 2 couldn't place do get a 2-shift fallback here.

Trade-off (deliberate, per staff): we'd rather have a net sit empty for a whole block than break a fuller shift into two-training fragments. So the schedule may show entire net columns of `אין אימון` on quiet mornings — that's intentional. The `WeeklyClasses` totals still drive how many slots are *opened* (via `distributeClassesIntoSlots_`); pass-based assignment then chooses *which* of those slots get a coach.

**Post-pass fairness (May 23 2026).** After the main 3-pass assignment, in order:

1. **Stage A — Rank 3+ floor (guarded).** `enforce_min_shift_rank3plus` with `protect_under_target_rank12` (default TRUE): will not place into or swap for a contiguous run if an under-target Rank 1–2 coach is eligible for that same run (time + class-type + not already in that day/block).
2. **Under-target Rank 1–2 placement.** Coaches rank 1–2 with `assigned < target` may fill still-unassigned runs via `placeUnderTargetRank12IntoUnassignedRuns_`.
3. **Stage B — Rank 3+ floor (unguarded fallback).** Any Rank 3+ coach still at 0 shifts retries without the guard — preserves “every Rank 3+ with availability gets ≥1 shift”.
4. Suggester (unchanged).

Kill switches: `enforce_min_shift_rank3plus`, `protect_under_target_rank12` on the Rules sheet.

**Fairness table יעד (May 23 2026).** The **יעד** column shows the coach’s single form number (`כמות משמרות מבוקשת` from `SHIFT_TARGET_FORM_CACHE_`, else capped `getShiftTarget`). **סטטוס** compares **קיבל** to that number only: `ביעד =)` when equal; `כמעט ביעד` when one below; `מתחת ליעד` / `מעל היעד` otherwise. MasterData WeeklyMin–WeeklyMax range is no longer shown in יעד.

**Anchor-first distribution (May 23 2026).** `buildSlotFillPriority_` opens slots as full 4-training anchor blocks (3 on Friday morning), one net at a time across the whole week:

1. **Round 1 — Net1** for every (day, block) unit, then **Round 2 — Net2**, then **Round 3 — Net3**.
2. **Default anchors** (`MENTOR_NET_ANCHORS_` in `ClassTypes.gs`): morning 7 / 8 / 7, evening 17 / 16 / 17 — used as tie-breakers when supply is equal.
3. **Staff rule — morning only:** at least **one** net per (day, morning) must start at **07:00**. Other nets may start at 07:00 or 08:00 (or all at the same hour); 2–3 nets starting together is fine.
4. **Evening:** no required start hour. Every net may anchor at **16:00** or **17:00** independently; multiple nets at 16:00 is fine.

**Supply-aware anchors (May 23 2026).** When `availability` is passed, each net picks its anchor per (day, block) from the block’s candidate hours — morning **{07:00, 08:00}**, evening **{16:00, 17:00}** — by counting coaches who can fully cover that window (`countCoachesCoveringSlots_`). Higher supply wins; equal supply keeps the default from `MENTOR_NET_ANCHORS_` for that net. After all nets choose, the morning **≥1 at 07:00** rule runs: if every net picked 08:00, the net with the smallest loss (largest supply(7)−supply(8)) is forced back to 07:00. Friday morning still allows an 08:00 partial block (3 cells, no 11–12). Implementation: `precomputeUnitAnchorHours_`, `pickSupplyAwareAnchorHour_`, `enforceAtLeastOneMorningSevenAm_` in `ClassTypes.gs`.

**Example wins:** Sunday morning Net 3 anchors at 08 when supply there beats 07 (תומר 8–11). Sunday evening Net 1 anchors at **16:00** when בבה + לילוש both submitted 16:00–20:15 (supply 2 vs 0 at 17:00–21:15), so both get a real shift instead of one net empty + a blue suggestion.

Maximum anchor-aligned capacity = 11 units × 3 nets × 4 trainings = **132** classes/week (Friday evening doesn't exist at Mentor). The raw ShiftTemplate still has 162 cells; the extra 30 (Net1@11–12, Net2@7–8, etc.) only open if the user pins them manually via `ShiftTemplate.ClassType` or asks for >132 classes (tail fill).

**Suggester contiguity guard (May 23 2026).** `rankSuggestionCandidates_` refuses to suggest a coach unless they already have a same-net adjacent assignment on this day+block (`neighbor === 2`) AND the resulting same-net run stays ≤ 4 trainings. So the suggester can only EXTEND an existing 2- or 3-training shift to a 3- or 4-training shift, never create an isolated 1-training cell. If no coach qualifies, the slot stays red unfilled — the staff can see it needs a manual phone call.

Still TODO:

- **Anchor preference.** The function picks the longest fittable window but doesn't yet *prefer* anchor-aligned windows (7→11 / 8→12 / 16→20:15 / 17→21:15) over other valid contiguous windows. In practice the anchor windows usually win because they're the longest, but it's not guaranteed.
- **Re-considering coaches after their first run.** If a coach has two contiguous teachable runs (e.g. 7–9 and 10–12 because the middle hour was a class type they can't teach), only the longest is assigned today; the other run is left for someone else even though the coach is there.
- **Supply-aware distribution.** Today `distributeClassesIntoSlots_` opens active slots without checking which hours actually have eligible-coach supply; restricted types (League / E) can land at hours where no eligible coach signed up — that becomes an empty red slot the multi-pass can't rescue.

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
| WeeklyMin / WeeklyMax | MasterData soft bounds. Optimizer cap uses form target first (`getShiftTarget`). Fairness **יעד** column shows only the form number (`getFormShiftTarget_`). WeeklyMin is not used for status anymore. Rank 1 still gets every shift they sign up for via `rank_1_unconditional`. Final optimizer cap is `min(target, submitted_days + 1)`. |
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
| League | `Rank<=1,בבה,יובל כץ` | 1 | FALSE |

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
- `getEligibleCandidates`, `findBestContiguousAssignment_` (sticky + spread inside one window), and `rankSuggestionCandidates_` all consult `coachEligibleForClassType_` before adding a candidate.
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
