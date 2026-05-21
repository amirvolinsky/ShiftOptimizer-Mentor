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
  'League':  { eligible: 'בבה,יובל כץ',      priorityRank: 1,    allowSplit: false }
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
    'ליגה — רק בבה ויובל כץ מאמנים אימוני ליגה (בעדיפות לדרג 1). ' +
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
 *   '<name1>,<name2>,...'   → explicit allow-list (any token not matching
 *                             the operators above is treated as a name)
 *
 * Predicates combine with `,` as AND, and any `-<name>` token subtracts
 * that name from the result.
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

  return function(coachName, masterMap) {
    if (deniedNames[coachName]) return false;

    var emp = masterMap && masterMap[coachName];
    if (rankMax !== null) {
      if (!emp) return false;
      if (normalizeMentorRank_(emp.rank) > rankMax) return false;
    }
    if (requiredGender !== null) {
      var g = emp && emp.gender ? normalizeMentorGender_(emp.gender) : 'M';
      if (g !== requiredGender) return false;
    }

    if (hasExplicitAllow) return !!allowedNames[coachName];
    return allowAll;
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
  if (rules && rules.class_type_eligibility_enabled === false) return true;
  var id = normalizeClassTypeId_(classTypeId);
  if (!id) return true;
  var spec = classTypeRules && classTypeRules[id];
  if (!spec || typeof spec.isEligible !== 'function') return true;
  return spec.isEligible(coachName, masterMap);
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
 * Time-of-day priority inside a (day, block) session. Earlier in the list =
 * filled first when there are fewer classes than capacity. Tuned to match
 * real-life Mentor demand:
 *   - Morning peak: 9–10, then 10–11, 8–9. Edges (11–12, 7–8) drop first.
 *   - Evening peak: 18–19, then 17–18, 19:15–20:15. Edges (16–17,
 *     20:15–21:15) drop first.
 *
 * Times use the slot's `startTime` (decimal hour, e.g. 19.25 for 19:15).
 */
var MENTOR_MORNING_TIME_PRIORITY_ = [9, 10, 8, 11, 7];
var MENTOR_EVENING_TIME_PRIORITY_ = [18, 17, 19.25, 16, 20.25];

/**
 * Build the ordered list of (day, block, time, net) capacity slots in the
 * order they should be filled if there are fewer classes than capacity.
 *
 * Ordering, outermost → innermost:
 *   1. Priority round (1 = peak, 5 = off-peak). Each round pairs the n-th
 *      morning priority with the n-th evening priority, so both blocks get
 *      filled in tandem instead of "every morning before any evening".
 *   2. Block ordering inside a round: morning first, then evening.
 *   3. Day cycle (Sun → Thu → Fri). Morning includes Friday; evening skips
 *      Friday (no evening session there).
 *   4. Net order: Net1 → Net2 → Net3.
 *
 * @param {Array} slots  Output of loadShiftTemplates() — already expanded per net.
 * @returns {Array}      The same slot objects re-ordered.
 */
function buildSlotFillPriority_(slots) {
  var dayOrder = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];
  var locOrder = (CONFIG.locations || []).slice();
  if (!locOrder.length) locOrder = ['Net1', 'Net2', 'Net3'];

  // Index slots by (day | block | rounded-startHour | location) for O(1) lookup.
  var index = {};
  for (var s = 0; s < slots.length; s++) {
    var sl = slots[s];
    if (sl.block === 'מנהל') continue;
    var key = sl.day + '|' + sl.block + '|' + roundTimeKey_(sl.startTime) + '|' + sl.location;
    index[key] = sl;
  }

  var rounds = Math.max(MENTOR_MORNING_TIME_PRIORITY_.length, MENTOR_EVENING_TIME_PRIORITY_.length);
  var ordered = [];
  var seen = {};

  for (var r = 0; r < rounds; r++) {
    var mHour = MENTOR_MORNING_TIME_PRIORITY_[r];
    var eHour = MENTOR_EVENING_TIME_PRIORITY_[r];

    if (mHour != null) appendRoundSlots_(ordered, seen, index, dayOrder, locOrder, 'בוקר', mHour, true);
    if (eHour != null) appendRoundSlots_(ordered, seen, index, dayOrder, locOrder, 'ערב', eHour, false);
  }

  // Append any leftover slots in the original order so we never silently drop
  // capacity (e.g. an 'אמצע' block somebody added later).
  for (var i = 0; i < slots.length; i++) {
    var slI = slots[i];
    if (slI.block === 'מנהל') continue;
    var k = slI.day + '|' + slI.block + '|' + roundTimeKey_(slI.startTime) + '|' + slI.location;
    if (!seen[k]) {
      seen[k] = true;
      ordered.push(slI);
    }
  }

  return ordered;
}

function appendRoundSlots_(out, seen, index, dayOrder, locOrder, block, hour, includeFriday) {
  for (var d = 0; d < dayOrder.length; d++) {
    var day = dayOrder[d];
    if (day === 'שישי' && !includeFriday) continue;
    for (var l = 0; l < locOrder.length; l++) {
      var loc = locOrder[l];
      var key = day + '|' + block + '|' + roundTimeKey_(hour) + '|' + loc;
      var slot = index[key];
      if (slot && !seen[key]) {
        seen[key] = true;
        out.push(slot);
      }
    }
  }
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
 * @param {Array} slots         Full loadShiftTemplates() output.
 * @param {Object} weeklyCounts classTypeId → desired count this week.
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
function distributeClassesIntoSlots_(slots, weeklyCounts) {
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

  // Walk the auto-fill slots in priority order.
  var priorityOrdered = buildSlotFillPriority_(slots);
  var unpinned = [];
  for (var u = 0; u < priorityOrdered.length; u++) {
    if (!priorityOrdered[u].classType) unpinned.push(priorityOrdered[u]);
  }

  if (sumRemaining > unpinned.length) {
    warnings.push(
      'הכמות השבועית (' + requestedTotal + ') חורגת מהקיבולת הפנויה (' +
      (unpinned.length + (slots.length - unpinned.length)) +
      '). הוצבו ' + unpinned.length + ' אימונים נוספים בלבד; השאר נשארו ללא משבצת.'
    );
  }

  // Class-type assignment order: level descending (League / E / D / C / B / A
  // / Hi-Tech / Childs). Higher tiers land in the top-priority slots first.
  var typeOrder = ids.slice().sort(function(a, b) {
    return classTypeLevel_(b) - classTypeLevel_(a);
  });

  var slotIdx = 0;
  var placedByType = {};
  for (var t = 0; t < typeOrder.length; t++) {
    var typeId = typeOrder[t];
    var need = remaining[typeId] || 0;
    if (need <= 0) continue;
    var placed = 0;
    while (placed < need && slotIdx < unpinned.length) {
      var target = unpinned[slotIdx++];
      target.classType = typeId;
      placed++;
    }
    placedByType[typeId] = (pinnedTotalsByType[typeId] || 0) + placed;
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
 * How many parallel-net slots can possibly run a class across the whole week.
 * Today it's 165 (5 morning hours × 6 days × 3 nets + 5 evening hours × 5
 * weekdays × 3 nets); derived from the ShiftTemplate at runtime so it stays
 * truthful if the template ever changes.
 */
function computeWeeklyClassCapacity_() {
  try {
    var slots = loadShiftTemplates();
    return slots.length;
  } catch (e) {
    // Sheet missing during a fresh seed — fall back to the documented total.
    return 165;
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
