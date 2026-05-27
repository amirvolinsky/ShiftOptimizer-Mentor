/**
 * Mentor class-type ladder + per-class eligibility rules.
 *
 * The 8 class types, easiest → hardest:
 *   Childs → Hi-Tech → A → B → C → D → E → League
 *
 * Each ClassType has an eligibility rule expressed in a small DSL (see
 * parseClassTypeEligibility_ below). The defaults below are the policy the
 * Mentor staff handed over (2026-05-21):
 *
 *   • Childs   — everyone except קורין (she doesn't connect with the kids).
 *   • Hi-Tech  — everyone.
 *   • A–D      — everyone.
 *   • E        — Rank ≤ 2 AND male, priority to Rank 1; if a shift has two
 *                E classes they may be split between two eligible coaches.
 *   • League   — only בבה and יובל כץ (no split — same coach takes all).
 *
 * Staff can override the defaults via the `ClassTypeRules` sheet (one row per
 * type, EligibleRule column uses the same DSL). Missing/empty rows fall back
 * to the in-code default for that type.
 *
 * Class-type enforcement is gated by the `class_type_eligibility_enabled`
 * rule in the Rules sheet (default TRUE). Setting it to FALSE turns the
 * filter off entirely — useful as an emergency switch on go-live day.
 */

/** Ordered class types, level 1 (easiest) → 8 (hardest). */
var MENTOR_CLASS_TYPES_ = [
  { id: 'Childs',  he: 'ילדים', level: 1 },
  { id: 'Hi-Tech', he: 'הייטק', level: 2 },
  { id: 'A',       he: 'A',      level: 3 },
  { id: 'B',       he: 'B',      level: 4 },
  { id: 'C',       he: 'C',      level: 5 },
  { id: 'D',       he: 'D',      level: 6 },
  { id: 'E',       he: 'E',      level: 7 },
  { id: 'League',  he: 'ליגה',   level: 8 }
];

/**
 * Default eligibility per class type. `eligible` is a DSL string (see
 * parseClassTypeEligibility_); `priorityRank` is the rank preferred within
 * the eligible set (or null); `allowSplit` is informational today (the
 * optimizer already splits per-time-slot when needed).
 */
var MENTOR_CLASS_TYPE_RULES_ = {
  'Childs':  { eligible: '*,-קורין',         priorityRank: null, allowSplit: false },
  'Hi-Tech': { eligible: '*',                priorityRank: null, allowSplit: false },
  'A':       { eligible: '*',                priorityRank: null, allowSplit: false },
  'B':       { eligible: '*',                priorityRank: null, allowSplit: false },
  'C':       { eligible: '*',                priorityRank: null, allowSplit: false },
  'D':       { eligible: '*',                priorityRank: null, allowSplit: false },
  'E':       { eligible: 'Rank<=2,Gender=M', priorityRank: 1,    allowSplit: true  },
  'League':  { eligible: 'Rank<=1,בבה,יובל כץ', priorityRank: 1, allowSplit: false }
};

/** Readable Hebrew descriptions for the `תיאור` column in ClassTypeRules. */
var MENTOR_CLASS_TYPE_DESCRIPTIONS_ = {
  'Childs':
    'ילדים — כל המאמנים מוסמכים לאמן, חוץ מקורין שלא התחברה לקבוצה.',
  'Hi-Tech':
    'הייטק — כל המאמנים מוסמכים. אין הגבלות.',
  'A':
    'A — כל המאמנים מוסמכים. אין הגבלות.',
  'B':
    'B — כל המאמנים מוסמכים. אין הגבלות.',
  'C':
    'C — כל המאמנים מוסמכים. אין הגבלות.',
  'D':
    'D — כל המאמנים מוסמכים. אין הגבלות.',
  'E':
    'E — רק מאמנים זכרים בדרג 1 או 2, עם עדיפות לדרג 1. ' +
    'אם יש שני אימוני E באותה משמרת — מותר לחלק אותם בין שני מאמנים מתאימים.',
  'League':
    'ליגה — כל מאמני דרג 1 + בבה + יובל כץ מורשים לאמן ליגה (בעדיפות לדרג 1). ' +
    'אין חלוקה — מי שמשובץ לוקח את כל אימוני הליגה במשמרת.'
};

/** Ordered list of class-type ids. */
function getClassTypeIds_() {
  var ids = [];
  for (var i = 0; i < MENTOR_CLASS_TYPES_.length; i++) {
    ids.push(MENTOR_CLASS_TYPES_[i].id);
  }
  return ids;
}

/** Hebrew display label for a class type. Returns id when unknown. */
function classTypeHebrew_(classTypeId) {
  for (var i = 0; i < MENTOR_CLASS_TYPES_.length; i++) {
    if (MENTOR_CLASS_TYPES_[i].id === classTypeId) return MENTOR_CLASS_TYPES_[i].he;
  }
  return classTypeId || '';
}

/** Numeric level (1..8) for a class type id. 0 = unknown. */
function classTypeLevel_(classTypeId) {
  for (var i = 0; i < MENTOR_CLASS_TYPES_.length; i++) {
    if (MENTOR_CLASS_TYPES_[i].id === classTypeId) return MENTOR_CLASS_TYPES_[i].level;
  }
  return 0;
}

/**
 * Normalize a free-text class-type cell to a canonical id from the ladder.
 * Accepts the English id (`Childs`, `League`, …), the Hebrew label (`ילדים`,
 * `ליגה`), or whitespace/case variants. Returns '' when the cell is empty
 * or unrecognised (which means "no class-type filter — anyone may teach").
 */
function normalizeClassTypeId_(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return '';
  var u = s.toUpperCase();
  for (var i = 0; i < MENTOR_CLASS_TYPES_.length; i++) {
    var t = MENTOR_CLASS_TYPES_[i];
    if (t.id === s) return t.id;
    if (t.id.toUpperCase() === u) return t.id;
    if (t.he === s) return t.id;
  }
  // Common typo / variant: "Hi Tech" with a space.
  if (u === 'HI TECH' || u === 'HITECH') return 'Hi-Tech';
  return '';
}

/**
 * Parse the eligibility DSL into a predicate function.
 *
 *   '*'                     → everyone in MasterData
 *   '*,-name1,-name2'       → everyone except listed names
 *   'Rank<=N'               → coaches whose Rank is ≤ N
 *   'Gender=M' / 'Gender=F' → coaches matching that gender
 *   '<name1>,<name2>,...'   → explicit allow-list — these coaches are
 *                             allowed regardless of predicates.
 *
 * Semantics (May 23 2026 — fixed from the original AND-only version):
 *   - Predicates (Rank, Gender) are AND'd together — a coach must pass
 *     every predicate to be allowed by the predicate path.
 *   - Explicit names are OR'd with the predicate path — a coach is allowed
 *     if EITHER (a) they pass every predicate, OR (b) their name is in the
 *     allow-list. This lets rules like 'Rank<=1,בבה,יובל כץ' mean
 *     "every Rank 1 coach + בבה + יובל כץ".
 *   - '-<name>' tokens subtract from the result (deny wins).
 *   - '*' alone (or empty rule) = everyone.
 *
 * @returns {function(string, Object): boolean} `(coachName, masterMap) => bool`
 */
function parseClassTypeEligibility_(ruleText) {
  var allowAll = false;
  var rankMax = null;
  var requiredGender = null;
  var allowedNames = {};
  var deniedNames = {};
  var hasExplicitAllow = false;

  var tokens = String(ruleText || '').split(/[,;\n]+/);
  for (var i = 0; i < tokens.length; i++) {
    var raw = String(tokens[i] || '').trim();
    if (!raw) continue;

    if (raw === '*') { allowAll = true; continue; }

    if (raw.charAt(0) === '-') {
      var deniedName = raw.substring(1).trim();
      if (deniedName) deniedNames[deniedName] = true;
      continue;
    }

    var rankMatch = raw.match(/^Rank\s*<=\s*(\d+)$/i);
    if (rankMatch) {
      var r = parseInt(rankMatch[1], 10);
      if (!isNaN(r) && r >= 1) rankMax = rankMax === null ? r : Math.min(rankMax, r);
      continue;
    }

    var genderMatch = raw.match(/^Gender\s*=\s*([MmFfזכרנקבה])/i);
    if (genderMatch) {
      requiredGender = normalizeMentorGender_(genderMatch[1]);
      continue;
    }

    // Plain name token → explicit allow-list.
    allowedNames[raw] = true;
    hasExplicitAllow = true;
  }

  // Empty/garbage rule defaults to "anyone" so a typo in the sheet never
  // accidentally locks every coach out of a class.
  if (!allowAll && !hasExplicitAllow && rankMax === null && requiredGender === null) {
    allowAll = true;
  }

  var hasPredicate = (rankMax !== null) || (requiredGender !== null);

  return function(coachName, masterMap) {
    // Deny list always wins.
    if (deniedNames[coachName]) return false;

    // Wildcard rule — allow anyone not denied.
    if (allowAll) return true;

    // Explicit allow-list — coach in list is allowed unconditionally
    // (OR'd with predicates).
    if (hasExplicitAllow && allowedNames[coachName]) return true;

    // Predicate path — coach must pass every predicate.
    if (hasPredicate) {
      var emp = masterMap && masterMap[coachName];
      if (rankMax !== null) {
        if (!emp) return false;
        if (normalizeMentorRank_(emp.rank) > rankMax) return false;
      }
      if (requiredGender !== null) {
        var g = emp && emp.gender ? normalizeMentorGender_(emp.gender) : 'M';
        if (g !== requiredGender) return false;
      }
      return true;
    }

    // Explicit names with no predicate: coach not in list → reject.
    if (hasExplicitAllow) return false;

    return false;
  };
}

/**
 * Default eligibility-rule object: maps ClassType id → { isEligible, ... }
 * with the DSL parsed once. Cloned per call (the parsed predicates are stable
 * references inside the returned objects).
 */
function buildDefaultClassTypeRules_() {
  var out = {};
  var ids = Object.keys(MENTOR_CLASS_TYPE_RULES_);
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var spec = MENTOR_CLASS_TYPE_RULES_[id];
    out[id] = {
      eligible: spec.eligible,
      isEligible: parseClassTypeEligibility_(spec.eligible),
      priorityRank: spec.priorityRank == null ? null : parseInt(spec.priorityRank, 10),
      allowSplit: !!spec.allowSplit,
      description: MENTOR_CLASS_TYPE_DESCRIPTIONS_[id] || ''
    };
  }
  return out;
}

/**
 * Read per-class eligibility from the ClassTypeRules sheet, falling back to
 * MENTOR_CLASS_TYPE_RULES_ for missing rows. Missing sheet = all defaults.
 *
 * @returns {Object<string, {isEligible:function, priorityRank:?number, allowSplit:boolean, eligible:string, description:string}>}
 */
function loadClassTypeRules_() {
  var rules = buildDefaultClassTypeRules_();
  var sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CONFIG.sheets.classTypeRules);
  if (!sheet) return rules;

  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return rules;

  var headers = data[0];
  var colClassType    = -1;
  var colEligible     = -1;
  var colPriority     = -1;
  var colAllowSplit   = -1;
  var colDescription  = -1;
  for (var h = 0; h < headers.length; h++) {
    var name = String(headers[h] || '').trim();
    if (name === 'ClassType')      colClassType   = h;
    else if (name === 'EligibleRule')   colEligible    = h;
    else if (name === 'PriorityRank')   colPriority    = h;
    else if (name === 'AllowSplit')     colAllowSplit  = h;
    else if (name === 'תיאור' || name === 'Description') colDescription = h;
  }
  if (colClassType < 0 || colEligible < 0) return rules;

  for (var r = 1; r < data.length; r++) {
    var id = normalizeClassTypeId_(data[r][colClassType]);
    if (!id) continue;

    var rawRule = String(data[r][colEligible] == null ? '' : data[r][colEligible]).trim();
    if (!rawRule) continue;

    var priority = null;
    if (colPriority >= 0) {
      var p = data[r][colPriority];
      var pn = parseInt(p, 10);
      if (!isNaN(pn) && pn >= 1) priority = pn;
    }

    var allowSplit = false;
    if (colAllowSplit >= 0) {
      var av = data[r][colAllowSplit];
      if (typeof av === 'boolean') allowSplit = av;
      else allowSplit = String(av).trim().toUpperCase() === 'TRUE';
    }

    var description = colDescription >= 0
      ? String(data[r][colDescription] || '').trim()
      : (rules[id] && rules[id].description) || '';

    rules[id] = {
      eligible: rawRule,
      isEligible: parseClassTypeEligibility_(rawRule),
      priorityRank: priority,
      allowSplit: allowSplit,
      description: description
    };
  }

  return rules;
}

/**
 * True iff `coachName` may teach a slot tagged with `classTypeId`.
 *
 * - Empty/unknown class type → true (no filter applies to untagged slots).
 * - `class_type_eligibility_enabled` rule FALSE → true (master kill switch).
 */
function coachEligibleForClassType_(coachName, classTypeId, masterMap, classTypeRules, rules) {
  // Current Mentor mode is shifts-first: every coach may teach every class type.
  // Keep the function as the single switch point so class-type rules can be
  // restored later without touching the optimizer.
  return true;
}

/**
 * Per-class default weekly count. Intentionally zero for every type — the
 * staff enters the real counts via the "🚀 הרץ שיבוץ שבועי" dialog each week,
 * and those values then live in the WeeklyClasses sheet until the next run.
 * Seeded as zeros so the sheet starts blank and never carries stale guesses.
 */
function getDefaultWeeklyClassCountsByType_() {
  var out = {};
  for (var i = 0; i < MENTOR_CLASS_TYPES_.length; i++) {
    out[MENTOR_CLASS_TYPES_[i].id] = 0;
  }
  return out;
}

// =====================================================================
//  Auto-distribute weekly class counts across the ShiftTemplate capacity
// =====================================================================

/**
 * Number of trainings per "anchor block" — i.e. the canonical full shift.
 * A net is opened in 4-training blocks; we never open partial slots in the
 * middle of a net (only at the tail, when the user's total is non-divisible).
 */
var MENTOR_ANCHOR_BLOCK_TRAININGS_ = 4;

/**
 * Anchor start times per (block, net-order-index). Each net is opened as
 * a contiguous 4-training block starting from this hour. Matches the
 * Mentor staff rule "morning must have ≥1 net starting at 07:00".
 *
 * Friday morning only has 4 hours total (no 11–12), so all 3 nets must
 * anchor at 07:00 — there's no other anchor to choose.
 */
var MENTOR_NET_ANCHORS_ = {
  'בוקר':       [7, 8, 7],            // Sun–Thu: Net1 = 7→11, Net2 = 8→12, Net3 = 7→11
  // Friday morning: only Net 1 opens (7→11). Net 2 / Net 3 are deliberately
  // closed on Friday — historically there aren't enough Friday-morning
  // coaches, so the staff want at most one Friday net. The freed weekly
  // class count is redistributed to Sun–Thu by the priority builder.
  'בוקר_שישי':  [7, null, null],
  'ערב':        [17, 16, 17]          // Sun–Thu: Net1 = 17→21:15, Net2 = 16→20:15, Net3 = 17→21:15
};

/**
 * Ordered list of (day, block) units in the order we fill them. The
 * distribution fills Net1 across ALL units first (round 1), then Net2
 * (round 2), then Net3 (round 3) — this is "shift filling vision":
 * rather than light up all 3 nets at half-capacity, light up 1 net at
 * full capacity across every day, then add a 2nd net everywhere, etc.
 *
 * Within a round we interleave morning and evening so a small weekly
 * total (e.g. 30 classes) still hits every day — instead of filling all
 * mornings before any evening opens.
 */
function buildUnitOrder_() {
  return [
    { day: 'ראשון',  block: 'בוקר' }, { day: 'ראשון',  block: 'ערב' },
    { day: 'שני',    block: 'בוקר' }, { day: 'שני',    block: 'ערב' },
    { day: 'שלישי',  block: 'בוקר' }, { day: 'שלישי',  block: 'ערב' },
    { day: 'רביעי',  block: 'בוקר' }, { day: 'רביעי',  block: 'ערב' },
    { day: 'חמישי',  block: 'בוקר' }, { day: 'חמישי',  block: 'ערב' },
    { day: 'שישי',   block: 'בוקר' }
    // No Friday evening at Mentor.
  ];
}

/**
 * For a single (day, block, net-index), return up to MENTOR_ANCHOR_BLOCK_TRAININGS_
 * slots starting at the anchor hour. Slot ordering is by startTime ascending
 * so the 19:15 break is handled naturally (the next slot after 18-19 is
 * 19:15-20:15, not "19").
 *
 * @param {Object} index  day|block|loc → sorted slot array
 * @param {string} day
 * @param {string} block
 * @param {string} loc
 * @param {number} anchorHour
 * @returns {Array<Object>}  0..4 slots, in time order.
 */
function pickAnchorBlockSlots_(index, day, block, loc, anchorHour) {
  var key = day + '|' + block + '|' + loc;
  var arr = index[key];
  if (!arr || !arr.length) return [];
  // Find the slot whose startTime matches the anchor (epsilon-tolerant).
  var startIdx = -1;
  for (var i = 0; i < arr.length; i++) {
    if (Math.abs(arr[i].startTime - anchorHour) < 0.01) { startIdx = i; break; }
  }
  if (startIdx === -1) return [];
  return arr.slice(startIdx, startIdx + MENTOR_ANCHOR_BLOCK_TRAININGS_);
}

/**
 * Candidate anchor start hours for supply comparison on a (day, block).
 * @param {string} anchorKey  'בוקר' | 'בוקר_שישי' | 'ערב'
 * @returns {number[]}
 */
function getAnchorCandidateHours_(anchorKey) {
  if (anchorKey === 'ערב') return [16, 17];
  return [7, 8];
}

/**
 * Pick the anchor hour for one net on one (day, block) unit by coach supply.
 * Tie → `MENTOR_NET_ANCHORS_` default for that net. 3-cell blocks count on
 * Friday morning (no 11–12) when evaluating the 08:00 window.
 */
function pickSupplyAwareAnchorHour_(unit, netIdx, loc, byKey, availability) {
  var anchorKey = unit.block;
  if (unit.day === 'שישי' && unit.block === 'בוקר') anchorKey = 'בוקר_שישי';
  var anchors = MENTOR_NET_ANCHORS_[anchorKey];
  if (!anchors) return null;
  var defaultHour = anchors[netIdx];
  if (defaultHour == null) return null;
  if (!availability) return defaultHour;

  var candidates = getAnchorCandidateHours_(anchorKey);
  var bestHour = defaultHour;
  var bestSupply = -1;

  for (var c = 0; c < candidates.length; c++) {
    var hour = candidates[c];
    var block = pickAnchorBlockSlots_(byKey, unit.day, unit.block, loc, hour);
    // 3-cell partial blocks count (Friday 8→11; shorter windows skipped).
    if (block.length < 3) continue;
    var supply = countCoachesCoveringSlots_(unit.day, block, availability);
    if (supply > bestSupply || (supply === bestSupply && hour === defaultHour)) {
      bestSupply = supply;
      bestHour = hour;
    }
  }
  return bestHour;
}

/**
 * Staff rule: every morning (day, block) must have ≥1 net anchored at 07:00.
 * If supply-aware picks left all nets at 08:00, force the net with the
 * largest supply(7)−supply(8) (smallest loss) back to 07:00.
 *
 * **Relaxation (May 27 2026).** If forcing 07:00 would open a structurally
 * empty net — that is, the best-candidate net has 0 coaches who cover the
 * 07:00 window — we skip the force. Opening an empty 4-cell red block in
 * the name of "one 7am net per morning" costs the schedule more (fairness
 * + red count) than dropping the 7am availability for that single day.
 * Similarly, when 07:00 supply is much smaller than 08:00 supply (loss of
 * `morning_seven_am_anchor_supply_gap` or more coaches; default 2), we
 * prefer to keep all nets at 08:00. Both behaviours are guarded by
 * `Rules` so they can be tuned without code changes.
 */
function enforceAtLeastOneMorningSevenAm_(unit, anchorHoursByNet, locOrder, byKey, availability, rules) {
  if (unit.block !== 'בוקר') return;
  var netCount = locOrder.length;
  var hasSeven = false;
  for (var i = 0; i < netCount; i++) {
    if (anchorHoursByNet[i] === 7) {
      hasSeven = true;
      break;
    }
  }
  if (hasSeven) return;

  var allowZeroSupplyForce = !!(rules && rules.force_morning_seven_am_even_if_empty === true);
  var supplyGapCap = (rules && typeof rules.morning_seven_am_anchor_supply_gap === 'number')
    ? rules.morning_seven_am_anchor_supply_gap
    : 2;

  var bestNet = -1;
  var bestGap = -Infinity;
  var bestS7 = 0;
  var bestS8 = 0;
  for (var n = 0; n < netCount; n++) {
    // Skip nets that are intentionally closed for this (day, block) — e.g.
    // Friday morning Net 2 / Net 3 (MENTOR_NET_ANCHORS_['בוקר_שישי']).
    if (anchorHoursByNet[n] == null) continue;
    var loc = locOrder[n];
    var block7 = pickAnchorBlockSlots_(byKey, unit.day, unit.block, loc, 7);
    if (block7.length < 3) continue;
    var block8 = pickAnchorBlockSlots_(byKey, unit.day, unit.block, loc, 8);
    var s7 = countCoachesCoveringSlots_(unit.day, block7, availability);
    var s8 = (block8.length >= 3)
      ? countCoachesCoveringSlots_(unit.day, block8, availability)
      : 0;
    var gap = s7 - s8;
    if (gap > bestGap) {
      bestGap = gap;
      bestNet = n;
      bestS7 = s7;
      bestS8 = s8;
    }
  }
  if (bestNet < 0) return;
  if (!allowZeroSupplyForce && bestS7 === 0 && bestS8 > 0) return;
  if (!allowZeroSupplyForce && bestS8 - bestS7 >= supplyGapCap && bestS8 > 0) return;
  anchorHoursByNet[bestNet] = 7;
}

/**
 * Symmetrical staff rule for evenings (Sun–Thu): every evening unit must
 * have ≥1 net anchored at 17:00 so the 20:15-21:15 training exists. If
 * supply-aware picks left all nets at 16:00, force the net with the
 * largest supply(17)−supply(16) (smallest loss) back to 17:00.
 */
function enforceAtLeastOneEvening1700_(unit, anchorHoursByNet, locOrder, byKey, availability) {
  if (unit.block !== 'ערב') return;
  var netCount = locOrder.length;
  var has17 = false;
  for (var i = 0; i < netCount; i++) {
    if (anchorHoursByNet[i] === 17) {
      has17 = true;
      break;
    }
  }
  if (has17) return;

  var bestNet = -1;
  var bestGap = -Infinity;
  for (var n = 0; n < netCount; n++) {
    if (anchorHoursByNet[n] == null) continue; // Skip closed nets.
    var loc = locOrder[n];
    var block17 = pickAnchorBlockSlots_(byKey, unit.day, unit.block, loc, 17);
    if (block17.length < 3) continue;
    var block16 = pickAnchorBlockSlots_(byKey, unit.day, unit.block, loc, 16);
    var s17 = countCoachesCoveringSlots_(unit.day, block17, availability);
    var s16 = (block16.length >= 3)
      ? countCoachesCoveringSlots_(unit.day, block16, availability)
      : 0;
    var gap = s17 - s16;
    if (gap > bestGap) {
      bestGap = gap;
      bestNet = n;
    }
  }
  if (bestNet >= 0) anchorHoursByNet[bestNet] = 17;
}

/**
 * For each (day, block) unit, compute supply-aware anchor hour per net and
 * apply the morning ≥1-at-07:00 / evening ≥1-at-17:00 constraints.
 * @returns {Object<string, number[]>}  key day|block → [hour per net index]
 */
function precomputeUnitAnchorHours_(units, locOrder, byKey, availability, rules) {
  var out = {};
  for (var u = 0; u < units.length; u++) {
    var unit = units[u];
    var uKey = unit.day + '|' + unit.block;
    var hours = [];
    for (var netIdx = 0; netIdx < locOrder.length; netIdx++) {
      hours[netIdx] = pickSupplyAwareAnchorHour_(
        unit, netIdx, locOrder[netIdx], byKey, availability
      );
    }
    if (unit.block === 'בוקר') {
      enforceAtLeastOneMorningSevenAm_(unit, hours, locOrder, byKey, availability, rules);
    } else if (unit.block === 'ערב') {
      enforceAtLeastOneEvening1700_(unit, hours, locOrder, byKey, availability);
    }
    // Hard rule: Friday morning Net 1 must always anchor at 07:00, regardless
    // of supply. Staff requirement — Friday morning training starts at 7am or
    // not at all. The cluster may end up red if no coach is available, that's
    // OK; the daily structure must show a 7am slot.
    if (unit.day === 'שישי' && unit.block === 'בוקר') {
      hours[0] = 7;
    }
    out[uKey] = hours;
  }
  return out;
}

/**
 * Build the ordered list of capacity slots in fill priority. Order is:
 *
 *   Round 1 (open one net per unit): Sun-morn Net1 → Sun-even Net1 → … → Fri-morn Net1
 *   Round 2 (open second net per unit): same units, Net2
 *   Round 3 (open third net per unit): same units, Net3
 *
 * Within each (unit, net) we list the 4 anchor-aligned slots in time
 * order. Slots NOT in any anchor block (e.g. Net1 at 11–12 on a morning
 * anchored at 7) are appended at the very end, so a tail user-request
 * that doesn't fit in anchor blocks still has somewhere to land instead
 * of being silently dropped.
 *
 * **Supply-aware anchors (May 23 2026).** Every net picks its anchor per
 * (day, block) from the candidate hours for that block (morning 7|8,
 * evening 16|17) by counting coaches who can fully cover the window.
 * Tie → keep `MENTOR_NET_ANCHORS_` default for that net. Morning only:
 * after all nets choose, if none anchored at 07:00, force the net with
 * the smallest supply loss (largest supply(7)−supply(8)) back to 07:00.
 * Evening has no required anchor — multiple nets may start at 16:00.
 *
 * @param {Array} slots          Output of loadShiftTemplates() — already expanded per net.
 * @param {Object} [availability] Optional `loadAvailability().availability` map.
 *                                When provided, all nets pick anchor by supply;
 *                                when omitted (legacy / capacity calc), fixed
 *                                anchors from `MENTOR_NET_ANCHORS_` only.
 * @returns {Array}              The same slot objects re-ordered.
 */
function buildSlotFillPriority_(slots, availability, masterMap, rules) {
  var locOrder = (CONFIG.locations || []).slice();
  if (!locOrder.length) locOrder = ['Net1', 'Net2', 'Net3'];

  // Group slots by (day|block|loc), sorted by startTime ascending.
  var byKey = {};
  for (var s = 0; s < slots.length; s++) {
    var sl = slots[s];
    if (sl.block === 'מנהל') continue;
    var key = sl.day + '|' + sl.block + '|' + sl.location;
    (byKey[key] = byKey[key] || []).push(sl);
  }
  for (var k in byKey) {
    if (!byKey.hasOwnProperty(k)) continue;
    byKey[k].sort(function(a, b) { return a.startTime - b.startTime; });
  }

  var units = buildUnitOrder_();
  var ordered = [];
  var seen = {};

  var unitAnchorHours = availability
    ? precomputeUnitAnchorHours_(units, locOrder, byKey, availability, rules)
    : null;

  for (var netIdx = 0; netIdx < locOrder.length; netIdx++) {
    // Open units with the best real coach pressure first. This keeps the class
    // budget pointed at places where under-target coaches can actually work,
    // instead of blindly lighting Net 1/2 everywhere before looking at Net 3.
    var unitsThisNet = units.slice();
    if (availability) {
      unitsThisNet.sort(function(a, b) {
        var scoreDiff = unitOpeningPressure_(b, netIdx, locOrder, byKey, availability, masterMap, rules) -
          unitOpeningPressure_(a, netIdx, locOrder, byKey, availability, masterMap, rules);
        if (scoreDiff !== 0) return scoreDiff;
        return unitCoachSupply_(b, netIdx, locOrder, byKey, availability) -
          unitCoachSupply_(a, netIdx, locOrder, byKey, availability);
      });
    }

    for (var u = 0; u < unitsThisNet.length; u++) {
      var unit = unitsThisNet[u];
      var anchorKey = unit.block;
      if (unit.day === 'שישי' && unit.block === 'בוקר') anchorKey = 'בוקר_שישי';
      var anchors = MENTOR_NET_ANCHORS_[anchorKey];
      if (!anchors) continue;
      var anchorHour = anchors[netIdx];
      if (anchorHour == null) continue;
      var loc = locOrder[netIdx];

      if (unitAnchorHours) {
        var uKey = unit.day + '|' + unit.block;
        if (unitAnchorHours[uKey] && unitAnchorHours[uKey][netIdx] != null) {
          anchorHour = unitAnchorHours[uKey][netIdx];
        }
      }

      var block = pickAnchorBlockSlots_(byKey, unit.day, unit.block, loc, anchorHour);
      for (var b = 0; b < block.length; b++) {
        var slt = block[b];
        if (seen[slt.slotId]) continue;
        seen[slt.slotId] = true;
        ordered.push(slt);
      }
    }
  }

  // Tail: any slot NOT picked above (e.g. Net1@11-12, Net2@7-8) — appended
  // in original order so over-request still has somewhere to land. Coaches
  // assigned to these will not form anchor-aligned shifts on their own,
  // but that's the user's call (asked for more than 132).
  //
  // Exception: Friday morning Net 2 / Net 3 are intentionally closed (see
  // MENTOR_NET_ANCHORS_['בוקר_שישי']). Skip them here too so they never
  // receive a class type — those weekly classes are pushed to Sun–Thu
  // instead.
  for (var i = 0; i < slots.length; i++) {
    var slI = slots[i];
    if (slI.block === 'מנהל') continue;
    if (slI.day === 'שישי' && slI.block === 'בוקר' && slI.location !== locOrder[0]) continue;
    if (!seen[slI.slotId]) {
      seen[slI.slotId] = true;
      ordered.push(slI);
    }
  }

  return ordered;
}

function coachSupplyForOpening_(opening, availability) {
  if (!availability || !opening || !opening.length) return opening ? opening.length : 0;
  return countCoachesCoveringSlots_(opening[0].day, opening, availability);
}

/**
 * Keep class placement aligned to real shift openings instead of letting the
 * weekly count light up isolated cells. Full 4-training openings are preferred;
 * if only two trainings remain, allow a 2-training half-shift only when at
 * least one coach can cover those two cells.
 */
function capPriorityToCompleteOpenings_(orderedSlots, remainingCount, availability, rules) {
  if (!orderedSlots || !orderedSlots.length || remainingCount <= 0) return [];
  if (!availability) return orderedSlots.slice(0, remainingCount);

  var locOrder = (CONFIG.locations || []).slice();
  if (!locOrder.length) locOrder = ['Net1', 'Net2', 'Net3'];

  var dropUnfillableResidual = !rules || rules.drop_unfillable_residual_class !== false;

  var out = [];
  var skipped = [];
  var idx = 0;
  while (idx < orderedSlots.length && remainingCount > 0) {
    var first = orderedSlots[idx];
    var opening = [first];
    idx++;
    while (idx < orderedSlots.length && opening.length < MENTOR_ANCHOR_BLOCK_TRAININGS_) {
      var next = orderedSlots[idx];
      if (next.day !== first.day || next.block !== first.block || next.location !== first.location) break;
      opening.push(next);
      idx++;
    }

    var netIdx = locOrder.indexOf(first.location);
    var fullOpening = opening.slice(0, Math.min(opening.length, MENTOR_ANCHOR_BLOCK_TRAININGS_));
    var isFridayMorningNet1 = first.day === 'שישי' && first.block === 'בוקר' && netIdx === 0;
    if (remainingCount === 1 && opening.length >= 1) {
      var singleOpening = opening.slice(0, 1);
      var singleCell = singleOpening[0];
      var extendsExisting = dropUnfillableResidual
        ? slotIsAdjacentToOpenedBlock_(singleCell, out)
        : true;
      if (extendsExisting && coachSupplyForOpening_(singleOpening, availability) > 0) {
        out = out.concat(singleOpening);
        remainingCount -= singleOpening.length;
      } else {
        skipped.push(singleOpening);
      }
      continue;
    }

    // Always keep Net 1 and Net 2 openings (Round 1/2) so the schedule surface
    // remains stable even when no one submitted availability for that unit
    // (e.g. Friday morning Net 1). Net 3 remains supply-aware.
    if (netIdx === 0 || netIdx === 1) {
      var placed12 = false;
      if (remainingCount >= MENTOR_ANCHOR_BLOCK_TRAININGS_ &&
          fullOpening.length >= MENTOR_ANCHOR_BLOCK_TRAININGS_) {
        // Friday morning Net 1 opens unconditionally — staff rule. If supply
        // is 0 the cluster will be red, that's accepted.
        if (isFridayMorningNet1 || coachSupplyForOpening_(fullOpening, availability) > 0) {
          out = out.concat(fullOpening);
          remainingCount -= fullOpening.length;
          placed12 = true;
        }
      }
      if (!placed12 && remainingCount >= 3 && opening.length >= 3) {
        var threeCellOpening12 = pickThreeCellOpening_(opening, availability);
        if (threeCellOpening12) {
          out = out.concat(threeCellOpening12);
          remainingCount -= 3;
          placed12 = true;
        }
      }
      if (!placed12 && fullOpening.length >= MENTOR_ANCHOR_BLOCK_TRAININGS_) {
        skipped.push(fullOpening);
      }
      continue;
    }

    var placedNet3 = false;
    if (remainingCount >= MENTOR_ANCHOR_BLOCK_TRAININGS_ &&
        fullOpening.length >= MENTOR_ANCHOR_BLOCK_TRAININGS_ &&
        coachSupplyForOpening_(fullOpening, availability) > 0) {
      out = out.concat(fullOpening);
      remainingCount -= fullOpening.length;
      placedNet3 = true;
    }
    // 3-cell fallback for Net 3 too — better a clean 3-training shift than
    // a 2-cell half-shift sitting on top of "אין אימון" cells.
    if (!placedNet3 && remainingCount >= 3 && opening.length >= 3) {
      var threeCellOpening3 = pickThreeCellOpening_(opening, availability);
      if (threeCellOpening3) {
        out = out.concat(threeCellOpening3);
        remainingCount -= 3;
        placedNet3 = true;
      }
    }
    if (placedNet3) continue;
    if (fullOpening.length >= MENTOR_ANCHOR_BLOCK_TRAININGS_) {
      skipped.push(fullOpening);
    }

    if (remainingCount >= 2 && opening.length >= 2) {
      var halfOpening = opening.slice(0, 2);
      if (coachSupplyForOpening_(halfOpening, availability) > 0) {
        out = out.concat(halfOpening);
        remainingCount -= halfOpening.length;
      } else {
        skipped.push(halfOpening);
      }
    }
  }

  for (var sk = 0; sk < skipped.length && remainingCount > 0; sk++) {
    var fallback = skipped[sk];
    if (!fallback || !fallback.length) continue;
    var take = Math.min(fallback.length, remainingCount);
    if (take === 1 && remainingCount > 1) continue;
    // Residual single-cell rule applies to the fallback path too — if the
    // last 1 cell can't extend an existing opening, we drop it instead of
    // creating an unfillable orphan.
    if (take === 1 && dropUnfillableResidual &&
        !slotIsAdjacentToOpenedBlock_(fallback[0], out)) {
      continue;
    }
    out = out.concat(fallback.slice(0, take));
    remainingCount -= take;
  }
  return out;
}

/**
 * Helper for the residual single-cell rule: is `slot` adjacent (within
 * 0.5 hour gap) to any cell already in `out` on the same (day, block,
 * location), AND would that block stay ≤ 4 cells after adding `slot`?
 * Coaches can only teach up to 4 contiguous cells, so extending a block
 * that's already 4 cells just creates an unfillable 5th cell. With the
 * 3-cell opening fallback in place, the residual now naturally lands on
 * a 3-cell shift and promotes it to 4 cells.
 */
function slotIsAdjacentToOpenedBlock_(slot, out) {
  if (!slot || !out || !out.length) return false;
  var sameBlockCount = 0;
  var anyAdjacent = false;
  for (var i = 0; i < out.length; i++) {
    var o = out[i];
    if (o.day !== slot.day || o.block !== slot.block || o.location !== slot.location) continue;
    sameBlockCount++;
    if (Math.abs(o.endTime - slot.startTime) <= 0.5) anyAdjacent = true;
    else if (Math.abs(slot.endTime - o.startTime) <= 0.5) anyAdjacent = true;
  }
  // Already a full 4-cell block — adding the residual would create a 5th
  // cell that no single coach can absorb. Drop it.
  if (sameBlockCount >= MENTOR_ANCHOR_BLOCK_TRAININGS_) return false;
  return anyAdjacent;
}

/**
 * Pick a 3-cell sub-window inside a 4-cell `opening` that has ≥1 coach
 * covering all 3 cells. Tries the first-3 and last-3 windows in priority
 * order (first-3 is the anchor-aligned start; last-3 picks up coaches
 * available only later in the block). Returns the chosen array of 3
 * slots, or null if neither window has a coach.
 */
function pickThreeCellOpening_(opening, availability) {
  if (!opening || opening.length < 3) return null;
  var windows = [];
  windows.push(opening.slice(0, 3));
  if (opening.length >= 4) windows.push(opening.slice(1, 4));
  for (var i = 0; i < windows.length; i++) {
    var w = windows[i];
    if (w.length === 3 && coachSupplyForOpening_(w, availability) > 0) return w;
  }
  return null;
}

/**
 * Count how many coaches in `availability` can cover EVERY slot in `slots`
 * on the given `day` — i.e. coaches whose submitted ranges contain each
 * slot's [startTime, endTime] fully. Used by buildSlotFillPriority_'s
 * supply-aware anchor selection. Legacy block-mode availability
 * (string values like 'בוקר') is skipped because we need precise times.
 *
 * @param {string} day        Hebrew day name ('ראשון' / 'שני' / …).
 * @param {Array} slots       4 anchor-aligned ShiftTemplate slot objects.
 * @param {Object} availability `loadAvailability().availability` map.
 * @returns {number}          Count of coaches who can fully cover the window.
 */
function countCoachesCoveringSlots_(day, slots, availability) {
  if (!slots || !slots.length || !availability) return 0;
  var names = Object.keys(availability);
  var count = 0;
  for (var i = 0; i < names.length; i++) {
    var avail = availability[names[i]];
    if (!avail || !avail[day] || !avail[day].length) continue;
    var ranges = avail[day];
    // Legacy block-mode availability — can't be matched to specific hours.
    if (typeof ranges[0] === 'string') continue;
    var coversAll = true;
    for (var s = 0; s < slots.length; s++) {
      if (!slotCoveredByMentorRanges_(slots[s], ranges)) {
        coversAll = false;
        break;
      }
    }
    if (coversAll) count++;
  }
  return count;
}

/**
 * Coach supply score for a (day, block) unit on one net — used to sort Net 3
 * units so high-supply mornings (e.g. Mon) get class slots before Sun.
 */
function unitCoachSupply_(unit, netIdx, locOrder, byKey, availability) {
  if (!unit || !availability) return 0;
  var loc = locOrder[netIdx];
  var anchorHour = pickSupplyAwareAnchorHour_(unit, netIdx, loc, byKey, availability);
  if (anchorHour == null) return 0;
  var block = pickAnchorBlockSlots_(byKey, unit.day, unit.block, loc, anchorHour);
  return countCoachesCoveringSlots_(unit.day, block, availability);
}

function unitOpeningPressure_(unit, netIdx, locOrder, byKey, availability, masterMap, rules) {
  if (!unit || !availability || !masterMap) return unitCoachSupply_(unit, netIdx, locOrder, byKey, availability);
  var loc = locOrder[netIdx];
  var anchorHour = pickSupplyAwareAnchorHour_(unit, netIdx, loc, byKey, availability);
  if (anchorHour == null) return 0;
  var block = pickAnchorBlockSlots_(byKey, unit.day, unit.block, loc, anchorHour);
  if (!block || !block.length) return 0;

  var score = 0;
  var names = Object.keys(masterMap);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var emp = masterMap[name];
    if (!emp || !availability[name] || !availability[name][unit.day]) continue;
    var ranges = availability[name][unit.day];
    if (!ranges || !ranges.length || typeof ranges[0] === 'string') continue;
    if (emp.locationRestriction && emp.locationRestriction !== loc) continue;

    var covered = 0;
    for (var s = 0; s < block.length; s++) {
      if (slotCoveredByMentorRanges_(block[s], ranges)) covered++;
    }
    if (covered < MENTOR_MIN_SHIFT_TRAININGS_) continue;

    var rank = normalizeMentorRank_(emp.rank);
    var target = getShiftTarget(name, masterMap, availability, rules);
    if (rank === CONFIG.ranks.best && target > 0) {
      score += 1000 + covered * 10;
    } else if (rank >= 3 && target > 0) {
      score += 200 + covered * 5;
    } else if (target > 0) {
      score += 100 + covered * 5;
    } else {
      score += covered;
    }
  }
  return score;
}

/** Class types that need explicit eligible coaches on the slot before placement. */
var MENTOR_RESTRICTED_CLASS_TYPES_ = ['League', 'E'];

/**
 * Place weekly class types onto unpinned slots. Restricted types (League, E)
 * only land on slots where at least one coach who submitted availability for
 * that day can teach that type at that hour — prevents League on Mon Net1
 * when only רון (not League-certified) is available.
 */
function placeWeeklyClassTypesWithSupply_(unpinned, remaining, availability, masterMap, classTypeRules, rules) {
  var placedByType = {};
  var ids = getClassTypeIds_();
  for (var i = 0; i < ids.length; i++) placedByType[ids[i]] = 0;

  var assigned = {};
  for (var r = 0; r < MENTOR_RESTRICTED_CLASS_TYPES_.length; r++) {
    var typeId = MENTOR_RESTRICTED_CLASS_TYPES_[r];
    var need = remaining[typeId] || 0;
    if (need <= 0) continue;
    var placed = 0;
    for (var s = 0; s < unpinned.length && placed < need; s++) {
      if (assigned[s]) continue;
      var slot = unpinned[s];
      if (!slotHasEligibleCoachForClass_(slot, typeId, availability, masterMap, classTypeRules, rules)) continue;
      slot.classType = typeId;
      assigned[s] = true;
      placed++;
      placedByType[typeId]++;
    }
  }

  var flexOrder = ids.slice().sort(function(a, b) {
    return classTypeLevel_(b) - classTypeLevel_(a);
  });
  for (var t = 0; t < flexOrder.length; t++) {
    var flexId = flexOrder[t];
    if (MENTOR_RESTRICTED_CLASS_TYPES_.indexOf(flexId) >= 0) continue;
    var flexNeed = remaining[flexId] || 0;
    if (flexNeed <= 0) continue;
    var flexPlaced = 0;
    for (var fs = 0; fs < unpinned.length && flexPlaced < flexNeed; fs++) {
      if (assigned[fs]) continue;
      unpinned[fs].classType = flexId;
      assigned[fs] = true;
      flexPlaced++;
      placedByType[flexId]++;
    }
  }

  return placedByType;
}

/** True if any coach who submitted this day can teach `classTypeId` on `slot`. */
function slotHasEligibleCoachForClass_(slot, classTypeId, availability, masterMap, classTypeRules, rules) {
  if (!availability || !slot) return false;
  var names = Object.keys(availability);
  for (var i = 0; i < names.length; i++) {
    var dayAvail = availability[names[i]] && availability[names[i]][slot.day];
    if (!dayAvail || !dayAvail.length) continue;
    if (typeof dayAvail[0] === 'string') continue;
    if (!slotCoveredByMentorRanges_(slot, dayAvail)) continue;
    if (!coachEligibleForClassType_(names[i], classTypeId, masterMap, classTypeRules, rules)) continue;
    return true;
  }
  return false;
}

function roundTimeKey_(t) {
  if (t == null) return 'NA';
  return Math.round(Number(t) * 100) / 100;
}

/**
 * Auto-distribute the weekly class counts across the template's capacity
 * slots. Slots that already have a manual `classType` tag (from the
 * ShiftTemplate.ClassType column) are treated as pins and counted against
 * the user's totals. All remaining counts are placed into the next-priority
 * unpinned slots.
 *
 * @param {Array} slots          Full loadShiftTemplates() output.
 * @param {Object} weeklyCounts  classTypeId → desired count this week.
 * @param {Object} [availability] Optional `loadAvailability().availability`
 *                                map. When provided, buildSlotFillPriority_
 *                                uses it to pick a supply-aware Net 3 anchor
 *                                per day. Omit for capacity-only callers.
 * @returns {{
 *   activeSlots: Array,    // slots that will run a class — each has slot.classType set
 *   inactiveSlots: Array,  // slots that will be left empty this week (no class)
 *   placedByType: Object,  // classTypeId → number actually placed
 *   requestedTotal: number,
 *   activeTotal: number,
 *   capacity: number,
 *   warnings: string[]
 * }}
 */
function distributeClassesIntoSlots_(slots, weeklyCounts, availability) {
  var ids = getClassTypeIds_();
  var warnings = [];

  // Snapshot how many of each type the user asked for.
  var requested = {};
  var requestedTotal = 0;
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var n = parseInt((weeklyCounts || {})[id], 10);
    if (isNaN(n) || n < 0) n = 0;
    requested[id] = n;
    requestedTotal += n;
  }

  // Pinned tags from the sheet — these always run their class. We subtract
  // them from the user's requested counts so the auto-fill only places the
  // remainder.
  var remaining = {};
  for (var k = 0; k < ids.length; k++) remaining[ids[k]] = requested[ids[k]];

  var pinnedTotalsByType = {};
  for (var p = 0; p < slots.length; p++) {
    var pinned = slots[p].classType;
    if (!pinned) continue;
    pinnedTotalsByType[pinned] = (pinnedTotalsByType[pinned] || 0) + 1;
  }
  for (var pt in pinnedTotalsByType) {
    if (!pinnedTotalsByType.hasOwnProperty(pt)) continue;
    if (remaining[pt] == null) {
      // Pinned tag for a class type with zero requested — keep the pin but
      // warn so the user knows the sheet is overriding the dialog.
      warnings.push(
        'ב-' + CONFIG.sheets.shiftTemplate + ' יש ' + pinnedTotalsByType[pt] +
        ' שיבוצים ידניים מסוג "' + classTypeHebrew_(pt) + '" שלא ביקשת השבוע. ' +
        'הם נשמרים כפינים — אם זו טעות, נקה את עמודת ClassType לפני הרצה.'
      );
      continue;
    }
    var diff = remaining[pt] - pinnedTotalsByType[pt];
    if (diff < 0) {
      warnings.push(
        'מספר ה-pinים מסוג "' + classTypeHebrew_(pt) + '" ב-' + CONFIG.sheets.shiftTemplate +
        ' (' + pinnedTotalsByType[pt] + ') גדול מהכמות השבועית שביקשת (' + remaining[pt] + ').' +
        ' המערכת תשמור את הפינים ולא תוסיף עוד מהסוג הזה השבוע.'
      );
      diff = 0;
    }
    remaining[pt] = diff;
  }

  var sumRemaining = 0;
  for (var rk in remaining) {
    if (remaining.hasOwnProperty(rk)) sumRemaining += remaining[rk];
  }

  var classTypeRules = loadClassTypeRules_();
  var masterMap = loadMasterData();
  var rules = loadRules();

  // Walk the auto-fill slots in priority order.
  var priorityOrdered = buildSlotFillPriority_(slots, availability, masterMap, rules);
  var unpinned = [];
  for (var u = 0; u < priorityOrdered.length; u++) {
    if (!priorityOrdered[u].classType) unpinned.push(priorityOrdered[u]);
  }
  unpinned = capPriorityToCompleteOpenings_(unpinned, sumRemaining, availability, rules);
  var residualSingleOpened = availability && sumRemaining > 0 && (sumRemaining % 2) === 1 &&
    unpinned.length === sumRemaining;
  if (residualSingleOpened) {
    warnings.push(
      'הכמות השבועית אי-זוגית (' + requestedTotal +
      '), לכן נפתח אימון יחיד נוסף כדי להגיע בדיוק למספר שביקשת. ' +
      'מעבר השיפור הגלובלי ינסה לצרף אותו למשמרת קיימת.'
    );
  }

  // If the residual rule dropped the leftover single, the count placed
  // will be lower than requested. Warn the user explicitly instead of
  // failing silently.
  var residualDropped = availability && sumRemaining > unpinned.length &&
    (sumRemaining - unpinned.length) === 1 &&
    (!rules || rules.drop_unfillable_residual_class !== false);
  if (residualDropped) {
    warnings.push(
      'נשאר שיעור בודד בלתי-משובץ (תא יחיד שאף מאמן לא יכול ללמד) — לא נפתח כדי למנוע ' +
      'תא אדום יתום. סה"כ אימונים השבוע: ' + (requestedTotal - 1) + ' במקום ' + requestedTotal +
      '. ניתן לכבות את הכלל ב-Rules → drop_unfillable_residual_class = FALSE.'
    );
  }

  if (sumRemaining > unpinned.length && !residualDropped) {
    warnings.push(
      'הכמות השבועית (' + requestedTotal + ') חורגת מהקיבולת הפנויה (' +
      (unpinned.length + (slots.length - unpinned.length)) +
      '). הוצבו ' + unpinned.length + ' אימונים נוספים בלבד; השאר נשארו ללא משבצת.'
    );
  }

  // Class-type placement: restricted types (League, E) only on slots where
  // a submitted coach can actually teach them; flexible types fill the rest.
  var placedCounts = placeWeeklyClassTypesWithSupply_(
    unpinned, remaining, availability, masterMap, classTypeRules, rules
  );
  var placedByType = {};
  for (var pi = 0; pi < ids.length; pi++) {
    var pid = ids[pi];
    placedByType[pid] = (pinnedTotalsByType[pid] || 0) + (placedCounts[pid] || 0);
  }

  // Surface any type that ended up short (we ran out of capacity mid-way).
  for (var tt = 0; tt < ids.length; tt++) {
    var idd = ids[tt];
    var asked = requested[idd];
    var got = placedByType[idd] || (pinnedTotalsByType[idd] || 0);
    if (asked > 0 && got < asked) {
      warnings.push(
        'סוג כיתה "' + classTypeHebrew_(idd) + '": ביקשת ' + asked +
        ', שובצו רק ' + got + ' אימונים השבוע.'
      );
    }
  }

  // Split into active (has classType) vs inactive (no classType after the
  // distribution pass — these slots are simply not happening this week).
  var activeSlots = [];
  var inactiveSlots = [];
  for (var sIdx = 0; sIdx < slots.length; sIdx++) {
    var sl = slots[sIdx];
    if (sl.classType) {
      activeSlots.push(sl);
    } else {
      sl.inactive = true;
      inactiveSlots.push(sl);
    }
  }

  return {
    activeSlots: activeSlots,
    inactiveSlots: inactiveSlots,
    placedByType: placedByType,
    requestedTotal: requestedTotal,
    activeTotal: activeSlots.length,
    residualSingleOpened: residualSingleOpened,
    capacity: slots.length,
    warnings: warnings
  };
}

/**
 * Read current Count values from the WeeklyClasses sheet, keyed by class-type
 * id. Missing sheet / missing row → 0. Skips the `סה״כ` summary row because
 * its ClassType cell is not a real id (normalizeClassTypeId_ returns '').
 */
function loadWeeklyClassCountsFromSheet_() {
  var counts = getDefaultWeeklyClassCountsByType_();
  var sheet = SpreadsheetApp.getActiveSpreadsheet()
    .getSheetByName(CONFIG.sheets.weeklyClasses);
  if (!sheet) return counts;

  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return counts;

  for (var r = 1; r < data.length; r++) {
    var id = normalizeClassTypeId_(data[r][0]);
    if (!id) continue;
    var raw = data[r][1];
    var n = parseInt(raw, 10);
    counts[id] = (isNaN(n) || n < 0) ? 0 : n;
  }
  return counts;
}

/**
 * Anchor-aligned weekly capacity — i.e. how many class-trainings fit when
 * every net is opened as a 4-training anchor block. With 11 units (5
 * Sun–Thu mornings + 5 Sun–Thu evenings + 1 Friday morning) × 3 nets ×
 * 4 trainings the answer is 132. We compute it from the actual
 * `buildSlotFillPriority_` output (counting anchor-block slots only) so
 * Friday's 4-hour cap and any future template tweaks stay accurate.
 *
 * Note: the dialog uses this as the user-facing maximum. The raw
 * ShiftTemplate has 162 capacity cells, but the extra 30 (= Net1@11–12,
 * Net2@7–8, Net1@20:15, Net2@16, …) intentionally stay closed by
 * default — opening them creates non-anchor stub shifts (e.g. one
 * 11-12 training with no 8-12 anchor), which violates the staff rule.
 */
function computeWeeklyClassCapacity_() {
  try {
    var slots = loadShiftTemplates();
    var ordered = buildSlotFillPriority_(slots);
    var locOrder = (CONFIG.locations || ['Net1', 'Net2', 'Net3']);
    var units = buildUnitOrder_();
    // First N entries of ordered are the anchor-aligned ones (we appended
    // non-anchor tail at the end). Count how many anchor blocks are valid.
    var anchorTotal = 0;
    for (var u = 0; u < units.length; u++) {
      for (var n = 0; n < locOrder.length; n++) {
        anchorTotal += MENTOR_ANCHOR_BLOCK_TRAININGS_;
      }
    }
    // Cap by actual slot count so seeds with smaller templates report correctly.
    return Math.min(anchorTotal, ordered.length);
  } catch (e) {
    return 132;
  }
}

/**
 * Write per-class counts back into the WeeklyClasses sheet. Re-seeds the
 * sheet first if it's missing or has the wrong header, so this is safe to
 * call from the optimizer dialog even on a fresh spreadsheet.
 *
 * @param {Object<string, number|string>} counts  classTypeId → count
 * @returns {{written:number, total:number}}
 */
function saveWeeklyClassCounts_(counts) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.sheets.weeklyClasses);
  if (!sheet || sheet.getLastRow() < 2) {
    seedWeeklyClasses_(ss);
    sheet = ss.getSheetByName(CONFIG.sheets.weeklyClasses);
  }

  var ids = getClassTypeIds_();
  var written = 0;
  var total = 0;
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var raw = counts && counts[id] != null ? counts[id] : 0;
    var n = parseInt(raw, 10);
    if (isNaN(n) || n < 0) n = 0;
    sheet.getRange(i + 2, 2).setValue(n);
    total += n;
    written++;
  }
  return { written: written, total: total };
}
