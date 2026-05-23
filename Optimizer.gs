/**
 * Core optimization engine for weekly shift scheduling (Mentor).
 *
 * Shift-level greedy algorithm:
 *   - Coaches submit availability as shift windows (e.g. 7:00-10:00).
 *   - ShiftTemplate contains the training layer (hourly trainings per net/capacity slot).
 *   - The optimizer assigns a coach to every class fully inside the requested window.
 *   - Nets are anonymous parallel capacity in one physical place; same-net placement is preferred
 *     for readability, but coaches may be spread across nets if needed.
 *
 * Cross-slot constraints enforced:
 *   - Rank priority: 1 before 2 before 3.
 *   - Rank 2/3 soft preference: avoid morning+evening same day and evening→morning next day.
 *   - No double booking (same person, overlapping time, any net).
 *   - Location restrictions per employee
 *   - Max shifts per week
 */

/**
 * Compute dynamic shift target for an employee.
 * Soft fairness target: days marked available in the form.
 */
var SHIFT_TARGET_RULES_CACHE_ = null;
/**
 * Per-coach form-submitted target. Populated by optimizeWeek (and the
 * schedule-refresh / fairness paths) from loadAvailability().weeklyTargets.
 * Lookup is by coach name → integer in [1..6]. Missing entries mean the
 * coach didn't submit a target this week.
 */
var SHIFT_TARGET_FORM_CACHE_ = null;

/**
 * Cache the form-submitted weekly targets for the current run. Called from
 * the optimizer and the refresh-from-sheet paths so getShiftTarget() can
 * prefer the coach's own number over MasterData.WeeklyMax. Pass null to
 * clear, e.g. between tests.
 */
function setShiftTargetFormCache_(weeklyTargets) {
  SHIFT_TARGET_FORM_CACHE_ = weeklyTargets || null;
}

/**
 * Returns the upper bound of the coach's weekly shift target — the number the
 * fairness column ("יעד") and "✅ / ⚠ מעל היעד" badges compare against.
 *
 * Priority of the raw target:
 *   1. Form value from this week's response (1–6), if the coach submitted one.
 *   2. Explicit `WeeklyMax` from MasterData.
 *   3. Dynamic from submitted availability (legacy fallback).
 *
 * After picking the raw target we enforce the **+1 cap**: a coach can never be
 * scheduled for more than `submittedDays + 1` distinct days (= at most one 🔵
 * suggestion day beyond their submitted availability). The cap is applied
 * universally, even when MasterData says otherwise — the staff agreed in May
 * 2026 that no coach should ever land 2+ days outside what they submitted.
 */
function getShiftTarget(name, masterMap, availability, rules) {
  var emp = masterMap[name];
  if (!emp) return 0;

  if (!rules) {
    if (!SHIFT_TARGET_RULES_CACHE_) SHIFT_TARGET_RULES_CACHE_ = loadRules();
    rules = SHIFT_TARGET_RULES_CACHE_;
  }

  var submittedDays = countCoachSubmittedDays_(name, availability);
  // Coach who didn't submit anything is never auto-scheduled.
  if (submittedDays === 0) return 0;

  // Pick the raw target in priority order: form value, MasterData, dynamic.
  var formTarget = (SHIFT_TARGET_FORM_CACHE_ && SHIFT_TARGET_FORM_CACHE_[name] !== undefined)
    ? SHIFT_TARGET_FORM_CACHE_[name]
    : null;

  var rawTarget;
  if (formTarget !== null) {
    rawTarget = formTarget;
  } else if (emp.weeklyMax !== null && emp.weeklyMax !== undefined) {
    rawTarget = emp.weeklyMax;
  } else if (isBasicMode_()) {
    rawTarget = Math.max(1, submittedDays);
  } else {
    rawTarget = Math.min(Math.max(1, submittedDays - 1), 5);
  }

  // +1 cap: never more than one day beyond submitted availability.
  var cap = submittedDays + 1;
  return Math.min(rawTarget, cap);
}

/** Count distinct days the coach marked any availability range for. */
function countCoachSubmittedDays_(name, availability) {
  if (!availability || !availability[name]) return 0;
  var avail = availability[name];
  var count = 0;
  var days = Object.keys(avail);
  for (var d = 0; d < days.length; d++) {
    var key = days[d];
    if (key.charAt(0) === '_') continue; // skip reserved keys like __weeklyTarget
    var dayRanges = avail[key];
    if (dayRanges && dayRanges.length > 0) count++;
  }
  return count;
}

/**
 * Lower bound of the coach's weekly target (MasterData WeeklyMin, default 0).
 * The fairness panel uses this to flag "מתחת ליעד".
 */
function getShiftTargetMin_(name, masterMap) {
  var emp = masterMap && masterMap[name];
  if (!emp) return 0;
  return emp.weeklyMin || 0;
}

/**
 * Main entry point. Optimizes the entire week across all locations.
 *
 * @param {Object[]} slots - From loadShiftTemplates()
 * @param {Object} availability - From loadAvailability().availability
 * @param {Object} masterMap - From loadMasterData()
 * @param {Object} rules - From loadRules()
 * @returns {{ assignments: Object, warnings: string[], employeeStats: Object }}
 */
function optimizeWeek(slots, availability, masterMap, rules) {
  var optimizationMode = 'fair';
  // Ensure shift target uses the same rules object throughout this run.
  SHIFT_TARGET_RULES_CACHE_ = rules || null;
  var classTypeRules = loadClassTypeRules_();
  var state = {
    assigned: {},
    employeeShifts: {},
    warnings: [],
    _slotMap: buildSlotMap_(slots),
    _classTypeRules: classTypeRules,
    optimizationMode: optimizationMode
  };

  var empNames = Object.keys(masterMap);
  for (var i = 0; i < empNames.length; i++) {
    state.employeeShifts[empNames[i]] = [];
  }

  for (var s = 0; s < slots.length; s++) {
    slots[s]._index = s;
  }

  // Mark manager slots as pre-filled (not optimizable).
  for (var s = 0; s < slots.length; s++) {
    if (slots[s].block === 'מנהל') {
      state.assigned[slots[s].slotId] = {
        name: 'מנהל', rank: CONFIG.ranks.best, unfilled: false, managerSlot: true
      };
    }
  }

  assignContinuousShiftBlocks_(slots, availability, masterMap, rules, state);

  // Fairness floor: every Rank 3+ coach who submitted availability gets at
  // least one shift, even if it means swapping with a more-shifts coach.
  // Per staff May 23 2026 — see enforceMinimumOneShiftForLowerRanks_.
  if (rules && rules.enforce_min_shift_rank3plus !== false) {
    enforceMinimumOneShiftForLowerRanks_(slots, availability, masterMap, rules, state);
  }

  // Any remaining training slot is genuinely unfilled; suggestion phase may add blue fallback suggestions.
  for (var s = 0; s < slots.length; s++) {
    if (!state.assigned[slots[s].slotId]) {
      state.assigned[slots[s].slotId] = {
        name: '', unfilled: true,
        note: 'לא נמצא עובד זמין.\nכל העובדים תפוסים, הגיעו למכסה, או לא סימנו זמינות.'
      };
    }
  }

  // Phase 3: suggest employees for unfilled slots (blue cells).
  if (rules && rules.suggest_outside_availability !== false) {
    suggestForUnfilled(slots, availability, masterMap, rules, state, optimizationMode);
  }

  return buildResultFromState_(state, masterMap, availability, rules);
}

/**
 * Assigns whole availability ranges, not isolated class cells.
 * A coach who gave 8:00-11:00 should receive the 8-9, 9-10, 10-11 classes together.
 * Nets are anonymous capacity in one physical place: prefer one net column, but spread across nets
 * when needed as long as the coach keeps a continuous time block.
 */
function assignContinuousShiftBlocks_(slots, availability, masterMap, rules, state) {
  var groups = buildShiftGroups_(slots);
  for (var g = 0; g < groups.length; g++) {
    assignShiftBlock_(groups[g], availability, masterMap, rules, state);
  }
}

function buildShiftGroups_(slots) {
  var byKey = {};
  for (var s = 0; s < slots.length; s++) {
    var slot = slots[s];
    if (slot.block === 'מנהל') continue;
    var key = slot.day + '|' + slot.block;
    if (!byKey[key]) byKey[key] = { day: slot.day, block: slot.block, slots: [] };
    byKey[key].slots.push(slot);
  }

  var groups = [];
  var keys = Object.keys(byKey);
  for (var k = 0; k < keys.length; k++) {
    var group = byKey[keys[k]];
    group.slots.sort(sortSlotsByTimeAndLocation_);
    group.timeKeys = getGroupTimeKeys_(group.slots);
    group.slotsByTime = buildSlotsByTime_(group.slots);
    groups.push(group);
  }

  groups.sort(function(a, b) {
    var dayDiff = dayOrder_(a.day) - dayOrder_(b.day);
    if (dayDiff !== 0) return dayDiff;
    return blockOrder_(a.block) - blockOrder_(b.block);
  });
  return groups;
}

function sortSlotsByTimeAndLocation_(a, b) {
  var st = (a.startTime || 0) - (b.startTime || 0);
  if (st !== 0) return st;
  var en = (a.endTime || 0) - (b.endTime || 0);
  if (en !== 0) return en;
  return String(a.location).localeCompare(String(b.location), 'he');
}

function dayOrder_(day) {
  for (var i = 0; i < CONFIG.days.length; i++) {
    if (CONFIG.days[i] === day) return i;
  }
  return 99;
}

function blockOrder_(block) {
  if (block === 'בוקר') return 1;
  if (block === 'אמצע') return 2;
  if (block === 'ערב') return 3;
  return 9;
}

function getGroupTimeKeys_(slots) {
  var seen = {};
  var keys = [];
  for (var i = 0; i < slots.length; i++) {
    var key = slotTimeKey_(slots[i]);
    if (!seen[key]) {
      seen[key] = true;
      keys.push(key);
    }
  }
  return keys;
}

function buildSlotsByTime_(slots) {
  var out = {};
  for (var i = 0; i < slots.length; i++) {
    var key = slotTimeKey_(slots[i]);
    if (!out[key]) out[key] = [];
    out[key].push(slots[i]);
  }
  var keys = Object.keys(out);
  for (var k = 0; k < keys.length; k++) {
    out[keys[k]].sort(sortSlotsByTimeAndLocation_);
  }
  return out;
}

function slotTimeKey_(slot) {
  return String(slot.startTime) + '|' + String(slot.endTime);
}

function assignShiftBlock_(group, availability, masterMap, rules, state) {
  // Read configurable rule toggles once (same for every pass).
  var rank1Unconditional   = rules.rank_1_unconditional   !== false;
  var rankPriorityEnabled  = rules.rank_priority_enabled  !== false;
  var softCapWeeklyMax     = rules.soft_cap_weekly_max    !== false;
  var avoidBackToBack      = rules.avoid_back_to_back     !== false;

  // Shift-vision multi-pass: place full 4-training shifts before
  // 3-training, before 2-training. This trades training-cell coverage for
  // shift completeness — better to have a net sit empty than to give two
  // coaches fragmented 2-training shifts on it. Matches the staff rule
  // "prefer fuller shifts; leave a net empty if needed".
  var passLengths = [
    MENTOR_FULL_SHIFT_TRAININGS_,                // 4
    MENTOR_FULL_SHIFT_TRAININGS_ - 1,            // 3
    MENTOR_MIN_SHIFT_TRAININGS_                  // 2
  ];

  for (var p = 0; p < passLengths.length; p++) {
    var passMin = passLengths[p];
    var candidates = buildShiftBlockCandidates_(
      group, availability, masterMap, rules, state, passMin
    );

    candidates.sort(function(a, b) {
      var aIsTop = a.rank === CONFIG.ranks.best;
      var bIsTop = b.rank === CONFIG.ranks.best;

      if (rank1Unconditional && aIsTop !== bIsTop) return aIsTop ? -1 : 1;

      if (softCapWeeklyMax) {
        var skipCap = rank1Unconditional && (aIsTop || bIsTop);
        if (!skipCap) {
          var aAtMax = a.gap <= 0;
          var bAtMax = b.gap <= 0;
          if (aAtMax !== bAtMax) return aAtMax ? 1 : -1;
        }
      }

      if (rankPriorityEnabled && a.rank !== b.rank) return a.rank - b.rank;
      if (avoidBackToBack && a.backToBack !== b.backToBack) return a.backToBack ? 1 : -1;
      if (a.gap !== b.gap) return b.gap - a.gap;
      if (a.length !== b.length) return b.length - a.length;
      return a.name.localeCompare(b.name, 'he');
    });

    for (var i = 0; i < candidates.length; i++) {
      var cand = candidates[i];
      if (!canAssignMoreClasses_(cand.name, cand.length, rules, state)) continue;
      if (candidateAlreadyHasAnyTime_(cand, state)) continue;

      var assignedSlots = findBestContiguousAssignment_(
        cand, state, masterMap, rules, {
          minLength: passMin,
          // Never split one coach across nets in a single block — staff want
          // one tall cell per net, not 3h here + 1h there.
          allowSpread: false
        }
      );
      if (!assignedSlots) continue;

      assignEmployeeToSlots_(cand.name, assignedSlots, masterMap, state);
      if (cand.backToBack) {
        state.warnings.push(
          cand.name + ' — שובץ/ה במשמרת צמודה למרות דרגה ' + cand.rank + ' (' +
          cand.day + ' ' + cand.block + ').'
        );
      }
    }
  }
}

/**
 * Fairness floor (May 23 2026 per staff): every Rank 3+ coach who submitted
 * any availability this week must end up with at least one shift assigned —
 * even if it means displacing another coach who already has ≥2 shifts.
 *
 * Algorithm: for each Rank 3+ coach with 0 shifts and any submitted day,
 * walk every (day, block) they signed up for, look for an existing shift
 * (contiguous run of same coach on same net) that this coach can fully
 * cover by time + class-type eligibility, then swap.
 *
 * Victim rules — coach being displaced must:
 *   - have ≥ 2 distinct (day, block) shifts (so they don't go to 0),
 *   - NOT be on CONFIG.noSuggestCoaches (רון / מנש are protected),
 *   - NOT be Rank 1 when rank_1_unconditional is on (default).
 *
 * Victim sort: (currentShifts − target) descending → over-target coaches
 * first; then currentShifts descending; then rank descending (lower priority
 * coach displaced first); then name.
 *
 * Kill switch: set `enforce_min_shift_rank3plus` to FALSE in the Rules sheet.
 */
function enforceMinimumOneShiftForLowerRanks_(slots, availability, masterMap, rules, state) {
  var names = Object.keys(masterMap);
  names.sort(function(a, b) {
    var rA = normalizeMentorRank_(masterMap[a].rank);
    var rB = normalizeMentorRank_(masterMap[b].rank);
    if (rA !== rB) return rA - rB;
    return a.localeCompare(b, 'he');
  });

  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var emp = masterMap[name];
    var rank = normalizeMentorRank_(emp.rank);
    if (rank < 3) continue;
    if (!hasSubmittedAnyAvailability_(name, availability)) continue;
    if (countAssignedShifts_(name, state) > 0) continue;

    var ok = tryGiveOneShiftBySwap_(name, emp, slots, availability, masterMap, rules, state);
    if (!ok) {
      state.warnings.push(
        '⚠️ ' + name + ' (דרג ' + rank + ') הגיש זמינות אך לא נמצא שיבוץ מינימלי. ' +
        'לא נמצא מאמן זמין להחלפה (כולם מתחת ל-2 משמרות או מוגנים).'
      );
    }
  }
}

/**
 * Try to give `name` a single shift by displacing a higher-count coach in
 * one of the coach's submitted (day, block) units. Returns true on success.
 */
function tryGiveOneShiftBySwap_(name, emp, slots, availability, masterMap, rules, state) {
  var groups = buildShiftGroups_(slots);
  var rank1Unconditional = !rules || rules.rank_1_unconditional !== false;

  for (var g = 0; g < groups.length; g++) {
    var group = groups[g];
    if (!availability[name] || !availability[name][group.day]) continue;
    var ranges = availability[name][group.day];
    if (!ranges || !ranges.length) continue;
    if (typeof ranges[0] === 'string') continue;

    var seenKey = {};
    for (var r = 0; r < ranges.length; r++) {
      var keys = timeKeysCoveredByRange_(group, ranges[r]);
      keys = filterTimeKeysByClassEligibility_(group, keys, name, masterMap, state, rules);
      for (var ki = 0; ki < keys.length; ki++) seenKey[keys[ki]] = true;
    }

    var keyCount = 0;
    for (var kc in seenKey) if (seenKey.hasOwnProperty(kc)) keyCount++;
    if (keyCount < MENTOR_MIN_SHIFT_TRAININGS_) continue;

    // Group existing assignments in this (day, block) by (location, coach).
    var existing = {};
    for (var s = 0; s < group.slots.length; s++) {
      var slot = group.slots[s];
      var asgn = state.assigned[slot.slotId];
      if (!asgn || !asgn.name || asgn.unfilled || asgn.managerSlot) continue;
      var k = slot.location + '|' + asgn.name;
      if (!existing[k]) existing[k] = { coach: asgn.name, loc: slot.location, slots: [] };
      existing[k].slots.push(slot);
    }

    var victims = [];
    var ekeys = Object.keys(existing);
    for (var ek = 0; ek < ekeys.length; ek++) {
      var v = existing[ekeys[ek]];
      if (v.coach === name) continue;
      if (isNoSuggestCoach_(v.coach)) continue;

      var vRank = normalizeMentorRank_(masterMap[v.coach].rank);
      if (rank1Unconditional && vRank === CONFIG.ranks.best) continue;

      var vShifts = countAssignedShifts_(v.coach, state);
      if (vShifts < 2) continue;

      v.slots.sort(function(a, b) { return a.startTime - b.startTime; });
      var canCover = true;
      for (var vs = 0; vs < v.slots.length; vs++) {
        if (!seenKey[slotTimeKey_(v.slots[vs])]) { canCover = false; break; }
      }
      if (!canCover) continue;

      var vTarget = getShiftTarget(v.coach, masterMap, availability, rules);
      victims.push({
        coach: v.coach,
        loc: v.loc,
        slots: v.slots,
        rank: vRank,
        shifts: vShifts,
        over: vShifts - vTarget
      });
    }

    if (victims.length === 0) continue;

    victims.sort(function(a, b) {
      if (a.over !== b.over) return b.over - a.over;
      if (a.shifts !== b.shifts) return b.shifts - a.shifts;
      if (a.rank !== b.rank) return b.rank - a.rank;
      return a.coach.localeCompare(b.coach, 'he');
    });

    var victim = victims[0];
    for (var us = 0; us < victim.slots.length; us++) {
      unassignSlot_(victim.slots[us].slotId, victim.slots[us], state);
    }
    for (var as = 0; as < victim.slots.length; as++) {
      assignEmployee(name, victim.slots[as], masterMap, state);
    }

    state.warnings.push(
      '🔁 ' + name + ' (דרג ' + emp.rank + ') הוחלף עם ' + victim.coach +
      ' (דרג ' + victim.rank + ') ב-' + group.day + ' ' + group.block + ' ' +
      (CONFIG.locationNames[victim.loc] || victim.loc) +
      ' — הבטחת לפחות משמרת אחת לכל מאמן מדרג 3+ שהגיש זמינות.'
    );
    return true;
  }
  return false;
}

/** Canonical full-shift length in trainings (4 = 4 hours of footvolley). */
var MENTOR_FULL_SHIFT_TRAININGS_ = 4;
/** Hard floor on shift length — coaches whose longest contiguous teachable
 *  run is below this are skipped this week (matches the staff rule
 *  "no 1-training assignments"). */
var MENTOR_MIN_SHIFT_TRAININGS_ = 2;

function buildShiftBlockCandidates_(group, availability, masterMap, rules, state, minLength) {
  // minLength is the floor on the coach's longest contiguous teachable run
  // for this pass — pass 1 demands 4 (full shifts), pass 2 demands 3, pass 3
  // demands 2. Callers that don't care fall back to the global minimum.
  if (!minLength) minLength = MENTOR_MIN_SHIFT_TRAININGS_;

  var candidates = [];
  var names = Object.keys(masterMap);
  for (var n = 0; n < names.length; n++) {
    var name = names[n];
    var emp = masterMap[name];
    if (!availability[name] || !availability[name][group.day]) continue;
    var ranges = availability[name][group.day];
    if (!ranges || !ranges.length || typeof ranges[0] === 'string') continue;

    for (var r = 0; r < ranges.length; r++) {
      var timeKeys = timeKeysCoveredByRange_(group, ranges[r]);
      // Drop timeKeys where the coach can't teach ANY of the parallel-net
      // classes at that time. This naturally truncates the shift to the
      // teachable subset — and the rest will be picked up by another eligible
      // coach later in the same pass (gives us "split within a shift" for free
      // for class types like E with allowSplit: true).
      timeKeys = filterTimeKeysByClassEligibility_(group, timeKeys, name, masterMap, state, rules);
      if (!timeKeys.length) continue;

      // Pass floor: longest contiguous teachable run must reach this pass's
      // minimum, otherwise the coach won't be considered yet.
      var longestRun = computeLongestContiguousRun_(timeKeys);
      var clampedRun = Math.min(longestRun, MENTOR_FULL_SHIFT_TRAININGS_);
      if (clampedRun < minLength) continue;

      // Strict 4h-rule (staff, May 23 2026): a coach who can deliver a full
      // 4-training shift is ONLY allowed to land in pass 1. Passes 2 and 3
      // exclude them, so a 4h+ coach gets exactly 4 trainings or nothing —
      // they never fall back to a 3- or 2-training shorter shift.
      if (minLength < MENTOR_FULL_SHIFT_TRAININGS_ &&
          clampedRun >= MENTOR_FULL_SHIFT_TRAININGS_) continue;

      var effectiveLength = clampedRun;

      candidates.push({
        name: name,
        rank: normalizeMentorRank_(emp.rank),
        day: group.day,
        block: group.block,
        rangeIndex: r,
        timeKeys: timeKeys,
        // length used for sort priority — caps at the canonical 4 so a
        // 5-hour submission doesn't outrank a 4-hour submission unfairly.
        length: effectiveLength,
        // gap = WeeklyMax − number of distinct (day, block) shifts already assigned.
        // One full 4-training morning still counts as ONE shift here.
        gap: getShiftTarget(name, masterMap, availability, rules) - countAssignedShifts_(name, state),
        backToBack: wouldCreateBackToBackShift_(name, group.day, group.block, emp, state),
        group: group
      });
    }
  }
  return candidates;
}

/** True when keyB starts within 30 min of keyA's end (handles the 19:00→19:15 break). */
function timeKeysAdjacent_(keyA, keyB) {
  var a = String(keyA).split('|');
  var b = String(keyB).split('|');
  if (a.length < 2 || b.length < 2) return false;
  var aEnd = parseFloat(a[1]);
  var bStart = parseFloat(b[0]);
  if (isNaN(aEnd) || isNaN(bStart)) return false;
  return (bStart - aEnd) <= 0.5 && (bStart - aEnd) >= -0.01;
}

/** Length of the longest sub-array of timeKeys where each consecutive pair is adjacent. */
function computeLongestContiguousRun_(timeKeys) {
  if (!timeKeys || !timeKeys.length) return 0;
  var best = 1;
  var current = 1;
  for (var i = 1; i < timeKeys.length; i++) {
    if (timeKeysAdjacent_(timeKeys[i - 1], timeKeys[i])) {
      current++;
      if (current > best) best = current;
    } else {
      current = 1;
    }
  }
  return best;
}

/**
 * All contiguous runs of timeKeys as { start, end } indices into the array,
 * sorted by descending length. Used by findBestContiguousAssignment_ to try
 * the longest contiguous teachable window first before falling back to
 * shorter ones.
 */
function buildContiguousRuns_(timeKeys) {
  var runs = [];
  if (!timeKeys || !timeKeys.length) return runs;
  var runStart = 0;
  for (var i = 1; i < timeKeys.length; i++) {
    if (!timeKeysAdjacent_(timeKeys[i - 1], timeKeys[i])) {
      runs.push({ start: runStart, end: i - 1 });
      runStart = i;
    }
  }
  runs.push({ start: runStart, end: timeKeys.length - 1 });
  runs.sort(function(a, b) { return (b.end - b.start) - (a.end - a.start); });
  return runs;
}

/**
 * For each timeKey in `keys`, keep it only if the coach can teach at least
 * one parallel-net slot at that time. Untagged slots (no ClassType) are
 * always teachable. When the master kill switch
 * `class_type_eligibility_enabled` is FALSE every timeKey is kept.
 */
function filterTimeKeysByClassEligibility_(group, keys, coachName, masterMap, state, rules) {
  if (rules && rules.class_type_eligibility_enabled === false) return keys.slice();
  var classTypeRules = state && state._classTypeRules;
  if (!classTypeRules) return keys.slice();

  var kept = [];
  for (var i = 0; i < keys.length; i++) {
    var slotsAtTime = group.slotsByTime[keys[i]] || [];
    var canTeachAny = false;
    for (var s = 0; s < slotsAtTime.length; s++) {
      var sl = slotsAtTime[s];
      if (state.assigned[sl.slotId]) continue;
      if (coachEligibleForClassType_(coachName, sl.classType, masterMap, classTypeRules, rules)) {
        canTeachAny = true;
        break;
      }
    }
    if (canTeachAny) kept.push(keys[i]);
  }
  return kept;
}

/** Count unique (day, block) pairs the coach is already assigned to. */
function countAssignedShifts_(name, state) {
  var arr = state.employeeShifts[name] || [];
  var seen = {};
  var count = 0;
  for (var i = 0; i < arr.length; i++) {
    var key = arr[i].day + '|' + arr[i].block;
    if (seen[key]) continue;
    seen[key] = true;
    count++;
  }
  return count;
}

function timeKeysCoveredByRange_(group, range) {
  var keys = [];
  for (var i = 0; i < group.timeKeys.length; i++) {
    var key = group.timeKeys[i];
    var slotsAtTime = group.slotsByTime[key] || [];
    if (!slotsAtTime.length) continue;
    if (slotCoveredByMentorRanges_(slotsAtTime[0], [range])) {
      keys.push(key);
    }
  }
  return keys;
}

function canAssignMoreClasses_(name, additionalCount, rules, state) {
  var maxShifts = getEmployeeMaxShifts_(rules);
  // Count distinct (day, block) shifts, not individual training cells.
  var currentCount = countAssignedShifts_(name, state);
  return currentCount + 1 <= maxShifts;
}

/**
 * True iff `candidate` already has any assignment in the same (day, block).
 *
 * A "shift" at Mentor is one anchor-aligned block of up to 4 trainings — the
 * coach is either there for the whole block or not at all. Once they have
 * any training in (day, block), they can't be considered for another
 * candidate in the same block, EVEN on a different net: that would just be
 * the same coach doing more hours in the same morning, which violates the
 * 4-training full-shift cap (one shift = one block).
 */
function candidateAlreadyHasAnyTime_(candidate, state) {
  var shifts = state.employeeShifts[candidate.name] || [];
  for (var i = 0; i < shifts.length; i++) {
    if (shifts[i].day !== candidate.day) continue;
    if (shifts[i].block === candidate.block) return true;
  }
  return false;
}

function findSlotForLocationAtTime_(slotsAtTime, location) {
  for (var i = 0; i < slotsAtTime.length; i++) {
    if (slotsAtTime[i].location === location) return slotsAtTime[i];
  }
  return null;
}

/**
 * Pick the best contiguous shift for `candidate`. "Best" means longest
 * contiguous (time-adjacent) window of teachable, free slots inside the
 * coach's submitted availability, capped at MENTOR_FULL_SHIFT_TRAININGS_
 * (4) and floored at MENTOR_MIN_SHIFT_TRAININGS_ (2).
 *
 * `opts.minLength` raises the floor for this call — used by the multi-pass
 * outer loop in assignShiftBlock_ to enforce "pass 1 = full shifts only,
 * pass 2 = 3+, pass 3 = 2+". The cap stays at 4 regardless of pass.
 *
 * Within a chosen window we first try same-net (sticky) placement on each
 * net in order, then fall back to a spread placement (different nets per
 * training) if no single net works for the whole window.
 *
 * Returns the assigned slot array or null when no window meeting the
 * pass's minimum can be filled.
 */
function findBestContiguousAssignment_(candidate, state, masterMap, rules, opts) {
  opts = opts || {};
  var capLen = MENTOR_FULL_SHIFT_TRAININGS_;
  var minLen = opts.minLength || MENTOR_MIN_SHIFT_TRAININGS_;
  if (minLen > capLen) minLen = capLen;
  var allowSpread = opts.allowSpread === true;

  var keys = candidate.timeKeys;
  if (!keys || keys.length < minLen) return null;

  var runs = buildContiguousRuns_(keys);
  var netOrder = rankStickyNetsForWindow_(candidate, state, masterMap, rules, capLen);

  for (var ri = 0; ri < runs.length; ri++) {
    var run = runs[ri];
    var runLen = run.end - run.start + 1;
    if (runLen < minLen) continue;
    var startMaxLen = Math.min(capLen, runLen);

    for (var L = startMaxLen; L >= minLen; L--) {
      for (var start = run.start; start + L - 1 <= run.end; start++) {
        // Sticky pass — same net throughout the window. Try nets where the
        // coach can actually fill the most hours first (Net1 before Net2
        // only when Net1 has more free eligible slots in this window).
        for (var ni = 0; ni < netOrder.length; ni++) {
          var stickyOut = tryAssignmentOnNet_(
            candidate, state, masterMap, rules, start, L, netOrder[ni]
          );
          if (stickyOut) return stickyOut;
        }
        if (allowSpread) {
          var spreadOut = trySpreadAssignment_(
            candidate, state, masterMap, rules, start, L
          );
          if (spreadOut) return spreadOut;
        }
      }
    }
  }
  return null;
}

/**
 * Order nets for sticky placement: highest count of free+eligible slots in
 * the coach's longest teachable window first. Prevents always defaulting to
 * Net1 when Net2/Net3 is a better fit (e.g. תומר 8-11 on Net3).
 */
function rankStickyNetsForWindow_(candidate, state, masterMap, rules, capLen) {
  var locs = (CONFIG.locations || []).slice();
  if (!locs.length) return ['Net1', 'Net2', 'Net3'];

  var keys = candidate.timeKeys || [];
  if (!keys.length) return locs;

  var runs = buildContiguousRuns_(keys);
  var bestRun = runs[0];
  var tryLen = Math.min(capLen, bestRun.end - bestRun.start + 1);
  var tryStart = bestRun.start;

  var scores = [];
  for (var li = 0; li < locs.length; li++) {
    var loc = locs[li];
    var score = 0;
    for (var t = tryStart; t < tryStart + tryLen; t++) {
      var slot = findSlotForLocationAtTime_(
        candidate.group.slotsByTime[keys[t]] || [], loc
      );
      if (!slot || state.assigned[slot.slotId]) continue;
      if (hasTimeConflict(candidate.name, slot, null, state)) continue;
      if (!coachEligibleForClassType_(candidate.name, slot.classType, masterMap, state._classTypeRules, rules)) continue;
      score++;
    }
    scores.push({ loc: loc, score: score });
  }

  scores.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.loc.localeCompare(b.loc, 'he');
  });

  var out = [];
  for (var s = 0; s < scores.length; s++) out.push(scores[s].loc);
  return out;
}

/** Try to fill candidate.timeKeys[start..start+L-1] on a single net. */
function tryAssignmentOnNet_(candidate, state, masterMap, rules, start, L, location) {
  var out = [];
  for (var t = start; t < start + L; t++) {
    var slot = findSlotForLocationAtTime_(
      candidate.group.slotsByTime[candidate.timeKeys[t]] || [], location
    );
    if (!slot || state.assigned[slot.slotId]) return null;
    if (hasTimeConflict(candidate.name, slot, null, state)) return null;
    if (!coachEligibleForClassType_(candidate.name, slot.classType, masterMap, state._classTypeRules, rules)) return null;
    out.push(slot);
  }
  return out;
}

/** Try to fill candidate.timeKeys[start..start+L-1] allowing net switches. */
function trySpreadAssignment_(candidate, state, masterMap, rules, start, L) {
  var out = [];
  for (var t = start; t < start + L; t++) {
    var slotsAtTime = candidate.group.slotsByTime[candidate.timeKeys[t]] || [];
    var picked = null;
    for (var s = 0; s < slotsAtTime.length; s++) {
      var slot = slotsAtTime[s];
      if (state.assigned[slot.slotId]) continue;
      if (hasTimeConflict(candidate.name, slot, null, state)) continue;
      if (!coachEligibleForClassType_(candidate.name, slot.classType, masterMap, state._classTypeRules, rules)) continue;
      picked = slot;
      break;
    }
    if (!picked) return null;
    out.push(picked);
  }
  return out;
}

function assignEmployeeToSlots_(name, assignedSlots, masterMap, state) {
  for (var i = 0; i < assignedSlots.length; i++) {
    assignEmployee(name, assignedSlots[i], masterMap, state);
  }
}

function wouldCreateBackToBackShift_(name, day, block, emp, state) {
  if (normalizeMentorRank_(emp.rank) <= 1) return false;
  var shifts = state.employeeShifts[name] || [];
  var dayIdx = dayOrder_(day);
  for (var i = 0; i < shifts.length; i++) {
    var existing = shifts[i];
    var existingDayIdx = dayOrder_(existing.day);
    if (existing.day === day) {
      if ((existing.block === 'בוקר' && block === 'ערב') || (existing.block === 'ערב' && block === 'בוקר')) {
        return true;
      }
    }
    if (existingDayIdx + 1 === dayIdx && existing.block === 'ערב' && block === 'בוקר') {
      return true;
    }
  }
  return false;
}

/**
 * Build optimizer result object from assignment state.
 */
function buildResultFromState_(state, masterMap, availability, rules) {
  var empNames = Object.keys(masterMap);
  var employeeStats = {};
  for (var e = 0; e < empNames.length; e++) {
    var emp = masterMap[empNames[e]];
    var trainings = state.employeeShifts[empNames[e]] || [];

    // Unique (day, block) keys = real shifts. Hours sum across all trainings.
    var seenShifts = {};
    var morningCount = 0;
    var eveningCount = 0;
    var totalHours = 0;
    for (var sh = 0; sh < trainings.length; sh++) {
      var t = trainings[sh];
      totalHours += t.durationHours || 0;
      var shiftKey = t.day + '|' + t.block;
      if (seenShifts[shiftKey]) continue;
      seenShifts[shiftKey] = true;
      if (t.block === 'בוקר') morningCount++;
      else if (t.block === 'ערב') eveningCount++;
    }
    var shiftsCount = morningCount + eveningCount;

    employeeStats[empNames[e]] = {
      name: empNames[e],
      rank: emp.rank,
      shiftsCount: shiftsCount,
      shiftTarget: getShiftTarget(empNames[e], masterMap, availability, rules),
      morningCount: morningCount,
      eveningCount: eveningCount,
      trainingsCount: trainings.length,
      totalHours: totalHours
    };
  }
  return {
    assignments: state.assigned,
    warnings: state.warnings || [],
    employeeStats: employeeStats
  };
}

function computeWeeklyCostFromState_(state) {
  var total = 0;
  var ids = Object.keys(state.assigned);
  for (var i = 0; i < ids.length; i++) {
    var a = state.assigned[ids[i]];
    if (a && a.cost) total += a.cost;
  }
  return total;
}

/** Sum of (target - shifts) for employees below target. Lower is fairer. */
function computeFairnessDeficit_(state, masterMap, availability, rules) {
  var total = 0;
  var names = Object.keys(masterMap);
  for (var i = 0; i < names.length; i++) {
    var target = getShiftTarget(names[i], masterMap, availability, rules);
    if (target <= 0) continue;
    var count = (state.employeeShifts[names[i]] || []).length;
    if (count < target) total += (target - count);
  }
  return total;
}

function rebuildStateFromAssignments_(assignments, slots, masterMap) {
  var state = {
    assigned: {},
    employeeShifts: {},
    warnings: [],
    _slotMap: buildSlotMap_(slots),
    _classTypeRules: loadClassTypeRules_()
  };
  var empNames = Object.keys(masterMap);
  for (var i = 0; i < empNames.length; i++) {
    state.employeeShifts[empNames[i]] = [];
  }
  for (var s = 0; s < slots.length; s++) {
    var slot = slots[s];
    var asgn = assignments[slot.slotId];
    if (!asgn) continue;
    if (asgn.unfilled || !asgn.name) {
      state.assigned[slot.slotId] = asgn;
      continue;
    }
    assignEmployee(asgn.name, slot, masterMap, state);
    state.assigned[slot.slotId] = {
      name: asgn.name,
      rank: state.assigned[slot.slotId].rank,
      unfilled: false,
      suggested: !!asgn.suggested
    };
  }
  return state;
}

function unassignSlot_(slotId, slot, state) {
  var asgn = state.assigned[slotId];
  if (!asgn || !asgn.name) {
    state.assigned[slotId] = { name: '', unfilled: true };
    return;
  }
  var name = asgn.name;
  var shifts = state.employeeShifts[name] || [];
  for (var i = shifts.length - 1; i >= 0; i--) {
    if (shifts[i].slotId === slotId) {
      shifts.splice(i, 1);
      break;
    }
  }
  state.assigned[slotId] = { name: '', unfilled: true };
}

/**
 * Improve fairness starting from a base schedule without going below minWeeklyCost.
 * Used so balanced/fair never end up cheaper than economical.
 */
function improveFairnessFromBase_(baseResult, slots, availability, masterMap, rules, mode, minWeeklyCost) {
  var state = rebuildStateFromAssignments_(baseResult.assignments, slots, masterMap);
  state.optimizationMode = mode;
  var minCost = minWeeklyCost != null ? minWeeklyCost : computeWeeklyCostFromState_(state);

  var maxPasses = mode === 'fair' ? 5 : 3;
  for (var pass = 0; pass < maxPasses; pass++) {
    var improved = false;
    var deficitBefore = computeFairnessDeficit_(state, masterMap, availability, rules);

    for (var s = 0; s < slots.length; s++) {
      var slot = slots[s];
      if (slot.block === 'מנהל') continue;
      var cur = state.assigned[slot.slotId];
      if (!cur || cur.unfilled || !cur.name || cur.suggested) continue;

      var currentName = cur.name;
      unassignSlot_(slot.slotId, slot, state);

      var candidates = getEligibleCandidates(slot, availability, masterMap, rules, state);
      var bestName = null;
      var bestDeficit = deficitBefore;
      var bestCost = computeWeeklyCostFromState_(state);

      for (var c = 0; c < candidates.length; c++) {
        var cand = candidates[c];
        assignEmployee(cand, slot, masterMap, state);
        var tryCost = computeWeeklyCostFromState_(state);
        var tryDeficit = computeFairnessDeficit_(state, masterMap, availability, rules);
        var ok = tryCost >= minCost - 0.01 && tryDeficit <= bestDeficit;
        if (mode === 'balanced' && tryDeficit === bestDeficit && tryCost > bestCost) {
          ok = false;
        }
        if (mode === 'fair' && tryDeficit === bestDeficit && tryCost <= bestCost) {
          ok = false;
        }
        if (ok && (tryDeficit < bestDeficit || (mode === 'fair' && tryCost >= bestCost))) {
          bestName = cand;
          bestDeficit = tryDeficit;
          bestCost = tryCost;
        }
        unassignSlot_(slot.slotId, slot, state);
      }

      if (bestName && bestName !== currentName) {
        assignEmployee(bestName, slot, masterMap, state);
        improved = true;
      } else {
        assignEmployee(currentName, slot, masterMap, state);
      }
    }
    if (!improved) break;
  }

  return buildResultFromState_(state, masterMap, availability, rules);
}

/**
 * Phase 1: Assign global employees to their required number of shifts.
 * Globals cost 0, so we assign them to slots where they provide the most value
 * (prefer slots that would otherwise be expensive to fill).
 */
function assignGlobals(globals, slots, availability, masterMap, rules, state) {
  for (var g = 0; g < globals.length; g++) {
    var emp = globals[g];
    var targetShifts = emp.minShifts || 5;

    var eligibleSlots = [];
    for (var s = 0; s < slots.length; s++) {
      var slot = slots[s];
      if (state.assigned[slot.slotId]) continue;
      if (!isAvailableForSlot(emp.name, slot, availability)) continue;
      if (!meetsLocationRestriction(emp, slot)) continue;
      if (hasTimeConflict(emp.name, slot, slots, state)) continue;

      eligibleSlots.push(slot);
    }

    eligibleSlots.sort(function(a, b) {
      var aElig = countEligible(a, availability, masterMap, rules, state);
      var bElig = countEligible(b, availability, masterMap, rules, state);
      return aElig - bElig;
    });

    var assigned = 0;
    var usedDays = {};
    for (var s = 0; s < eligibleSlots.length && assigned < targetShifts; s++) {
      var slot = eligibleSlots[s];
      if (state.assigned[slot.slotId]) continue;

      if (usedDays[slot.day]) continue;
      if (hasTimeConflict(emp.name, slot, slots, state)) continue;

      assignEmployee(emp.name, slot, masterMap, state);
      usedDays[slot.day] = true;
      assigned++;
    }

    if (assigned < targetShifts) {
      state.warnings.push(
        emp.name + ' (עדיפות) — קיבל ' + assigned + ' מתוך ' + targetShifts + ' משמרות.\n' +
        '   💡 ' + emp.name + ' סימן/ה זמינות רק ל-' + assigned + ' משמרות בטופס.'
      );
    }
  }
}

/**
 * Compare two candidates for a slot (negative = a preferred).
 * @param {string} mode - 'economical' | 'balanced' | 'fair'
 */
function compareCandidates_(a, b, slot, masterMap, rules, state, availability, mode, opts) {
  var empA = masterMap[a];
  var empB = masterMap[b];
  var aShifts = (state.employeeShifts[a] || []).length;
  var bShifts = (state.employeeShifts[b] || []).length;
  var targetA = getShiftTarget(a, masterMap, availability, rules);
  var targetB = getShiftTarget(b, masterMap, availability, rules);
  var gapA = targetA - aShifts;
  var gapB = targetB - bShifts;
  var slotIsMorning = opts.slotIsMorning;
  var slotIsEvening = opts.slotIsEvening;

  if (gapA !== gapB) return gapB - gapA;

  if (aShifts === bShifts && (slotIsMorning || slotIsEvening)) {
    var aBal = getShiftBalance_(a, state);
    var bBal = getShiftBalance_(b, state);
    if (slotIsMorning) return aBal.morning - bBal.morning;
    if (slotIsEvening) return aBal.evening - bBal.evening;
  }

  return aShifts - bShifts;
}

/**
 * Find the best candidate for a slot (fairness-first).
 */
function pickBestCandidate_(slot, availability, masterMap, rules, state) {
  var optimizationMode = 'fair';
  var candidates = getEligibleCandidates(slot, availability, masterMap, rules, state);
  if (candidates.length === 0) return null;

  var opts = {
    slotIsMorning: (slot.block === 'בוקר'),
    slotIsEvening: (slot.block === 'ערב')
  };

  candidates.sort(function(a, b) {
    return compareCandidates_(a, b, slot, masterMap, rules, state, availability, optimizationMode, opts);
  });

  return candidates[0];
}

/**
 * Get list of eligible employee names for a slot.
 */
function getEligibleCandidates(slot, availability, masterMap, rules, state) {
  var candidates = [];
  var empNames = Object.keys(masterMap);
  var classTypeRules = state && state._classTypeRules;

  for (var i = 0; i < empNames.length; i++) {
    var name = empNames[i];
    var emp = masterMap[name];

    if (!isAvailableForSlot(name, slot, availability)) continue;
    if (!meetsLocationRestriction(emp, slot)) continue;
    if (hasTimeConflict(name, slot, null, state)) continue;
    if (!coachEligibleForClassType_(name, slot.classType, masterMap, classTypeRules, rules)) continue;

    var currentCount = (state.employeeShifts[name] || []).length;
    var maxShifts = getEmployeeMaxShifts_(rules);
    if (currentCount >= maxShifts) continue;

    candidates.push(name);
  }

  return candidates;
}

/**
 * Count eligible candidates for a slot (used for difficulty sorting).
 */
function countEligible(slot, availability, masterMap, rules, state) {
  return getEligibleCandidates(slot, availability, masterMap, rules, state).length;
}

/**
 * Check if an employee is available for a specific slot based on form responses.
 */
function isAvailableForSlot(name, slot, availability) {
  if (!availability[name]) return false;
  var dayAvail = availability[name][slot.day];
  if (!dayAvail || dayAvail.length === 0) return false;

  if (typeof dayAvail[0] === 'string') {
    for (var i = 0; i < dayAvail.length; i++) {
      if (dayAvail[i] === slot.block) return true;
    }
    return false;
  }

  return slotCoveredByMentorRanges_(slot, dayAvail);
}

/**
 * Check if employee's location restriction allows this slot.
 */
function meetsLocationRestriction(emp, slot) {
  if (!emp.locationRestriction) return true;
  return emp.locationRestriction === slot.location;
}

/**
 * Conflict check: basicMode = overlapping times same day; full rules = one shift per day.
 */
function hasTimeConflict(name, newSlot, allSlots, state) {
  var shifts = state.employeeShifts[name] || [];

  for (var i = 0; i < shifts.length; i++) {
    var existing = shifts[i];
    if (existing.day !== newSlot.day) continue;

    if (isBasicMode_()) {
      if (shiftTimesOverlap_(existing.startTime, existing.endTime, newSlot.startTime, newSlot.endTime)) {
        return true;
      }
    } else {
      return true;
    }
  }

  return false;
}

/**
 * Count morning vs evening shifts for an employee.
 * Returns { morning: N, evening: M }.
 */
function getShiftBalance_(name, state) {
  var shifts = state.employeeShifts[name] || [];
  var morning = 0, evening = 0;
  for (var i = 0; i < shifts.length; i++) {
    if (shifts[i].block === 'בוקר') morning++;
    else if (shifts[i].block === 'ערב') evening++;
  }
  return { morning: morning, evening: evening };
}

function assignEmployee(nameOrEmp, slot, masterMap, state) {
  var name = typeof nameOrEmp === 'string' ? nameOrEmp : nameOrEmp.name;
  var emp = masterMap[name];

  state.assigned[slot.slotId] = {
    name: name,
    rank: emp ? emp.rank : 0,
    unfilled: false
  };

  if (!state.employeeShifts[name]) {
    state.employeeShifts[name] = [];
  }
  state.employeeShifts[name].push({
    slotId: slot.slotId,
    location: slot.location,
    day: slot.day,
    block: slot.block,
    startTime: slot.startTime,
    endTime: slot.endTime,
    durationHours: slot.durationHours
  });
}

/**
 * Phase 3 (cluster-based suggester, May 23 2026): for each contiguous run
 * of unfilled cells on the same (day, block, net), find a single coach
 * who can take the entire run as a fresh 2–4 training shift, and assign
 * them as a "💙 suggested" shift in one go.
 *
 * Why cluster-based? Per-slot suggestions can place a coach on a single
 * isolated cell (e.g. שירי alone at Wed 10–11), which violates the staff
 * rule "no 1-training shifts". A cluster has length ≥ 2 by construction,
 * so the suggestion always lands as a real shift. Singleton clusters
 * (size 1) are skipped — the cell stays red, and the staff can see it
 * needs a manual phone call.
 *
 * The suggested coach must:
 *   - have NO existing shift in (day, block) — one shift per block per coach;
 *   - be eligible for every class type in the cluster;
 *   - be under the weekly cap; Rank 4 reserves additionally need to have
 *     submitted some availability this week (otherwise they're off-roster).
 * Among qualifying coaches we prefer (in order): under target → larger
 * gap to target → lower rank → larger remaining cap → name.
 */
function suggestForUnfilled(slots, availability, masterMap, rules, state, optimizationMode) {
  optimizationMode = optimizationMode || state.optimizationMode || 'economical';
  var empNames = Object.keys(masterMap);

  var clusters = buildUnfilledClusters_(slots, state);
  // Largest cluster first — it's the hardest to fill and we want it placed
  // before nibbling at small ones; ties broken so weekdays-first is stable.
  clusters.sort(function(a, b) {
    if (b.slots.length !== a.slots.length) return b.slots.length - a.slots.length;
    var dd = dayOrder_(a.day) - dayOrder_(b.day);
    if (dd !== 0) return dd;
    return (a.slots[0].startTime || 0) - (b.slots[0].startTime || 0);
  });

  for (var c = 0; c < clusters.length; c++) {
    var cluster = clusters[c];
    // Singletons are intentionally not suggested (would create an isolated
    // 1-training shift). Staff sees the red cell and acts on it manually.
    if (cluster.slots.length < MENTOR_MIN_SHIFT_TRAININGS_) continue;

    // Cap cluster size at 4 — never propose a 5+ training mega-shift even
    // if there's a longer empty run. Take the first 4 cells (anchor-aligned).
    var clusterSlots = cluster.slots.slice(0, MENTOR_FULL_SHIFT_TRAININGS_);
    var trimmedCluster = {
      day: cluster.day,
      block: cluster.block,
      location: cluster.location,
      slots: clusterSlots
    };

    var ranked = rankClusterSuggestionCandidates_(
      trimmedCluster, empNames, masterMap, rules, state, availability
    );
    if (ranked.length === 0) continue;

    var bestCandidate = ranked[0].name;
    var emp = masterMap[bestCandidate];
    if (!state.employeeShifts[bestCandidate]) {
      state.employeeShifts[bestCandidate] = [];
    }

    // Build the suggestion note once, since the entire cluster shares it.
    var availCount = countAvailableBlocks_(bestCandidate, availability, slots, emp);
    var dynTarget = getShiftTarget(bestCandidate, masterMap, availability, rules);
    var rangeHe = formatClusterTimeRangeHe_(clusterSlots);
    var note = '💙 הצעת המערכת (לא שיבוץ מאושר)\n\n' +
      bestCandidate + ' לא סימן/ה זמינות למשמרת הזו (' +
      clusterSlots.length + ' אימונים רצופים, ' + rangeHe + ').\n' +
      'יעד שבועי: ' + dynTarget + ' משמרות.\n' +
      'הגיש/ה זמינות ל-' + availCount + ' משמרות.\n\n' +
      'צריך לאשר מול ' + bestCandidate + '.';

    if (ranked.length > 1) {
      var alt = ranked[1];
      var altAvail = countAvailableBlocks_(alt.name, availability, slots, masterMap[alt.name]);
      var altCurrent = countAssignedShifts_(alt.name, state);
      var altTarget = getShiftTarget(alt.name, masterMap, availability, rules);
      note += '\n\n🔄 חלופה: ' + alt.name +
        '\nיעד: ' + altTarget + ' משמרות' +
        ', הגיש/ה ' + altAvail +
        ', כרגע ' + altCurrent;
    }

    for (var k = 0; k < clusterSlots.length; k++) {
      var slt = clusterSlots[k];
      state.employeeShifts[bestCandidate].push({
        slotId: slt.slotId,
        location: slt.location,
        day: slt.day,
        block: slt.block,
        startTime: slt.startTime,
        endTime: slt.endTime,
        durationHours: slt.durationHours
      });
      state.assigned[slt.slotId] = {
        name: bestCandidate,
        rank: emp.rank,
        unfilled: false,
        suggested: true,
        note: note
      };
    }

    state.warnings.push(
      cluster.day + ' ' + cluster.block + ' ' + cluster.location + ' — 💙 הצעת המערכת: ' +
      bestCandidate + ' (' + clusterSlots.length + ' אימונים, ' + rangeHe + '). צריך אישור.'
    );
  }

  // Anything still unfilled after the cluster pass: emit a per-slot warning
  // so the staff sees exactly which cells need a manual call.
  for (var s = 0; s < slots.length; s++) {
    var slot = slots[s];
    var asgn = state.assigned[slot.slotId];
    if (!asgn || !asgn.unfilled) continue;
    state.warnings.push(
      formatSlotHebrew(slot.slotId) + ' — לא נמצא עובד זמין למשמרת הזו.\n' +
      '   💡 כל העובדים כבר תפוסים, הגיעו למכסה, או לא סימנו זמינות.'
    );
  }
}

/**
 * Group all unfilled slots into contiguous runs per (day, block, location).
 * Two slots are "contiguous" if their startTime/endTime are time-adjacent
 * within ~30 minutes (so the 19:00 → 19:15 evening break still counts).
 */
function buildUnfilledClusters_(slots, state) {
  var groups = {};
  for (var i = 0; i < slots.length; i++) {
    var slot = slots[i];
    var asgn = state.assigned[slot.slotId];
    if (!asgn || !asgn.unfilled) continue;
    var key = slot.day + '|' + slot.block + '|' + slot.location;
    (groups[key] = groups[key] || []).push(slot);
  }

  var clusters = [];
  for (var k in groups) {
    if (!groups.hasOwnProperty(k)) continue;
    var arr = groups[k];
    arr.sort(function(a, b) { return a.startTime - b.startTime; });

    var current = [arr[0]];
    for (var j = 1; j < arr.length; j++) {
      var gap = arr[j].startTime - arr[j - 1].endTime;
      if (gap >= -0.01 && gap <= 0.5) {
        current.push(arr[j]);
      } else {
        clusters.push({
          day: current[0].day,
          block: current[0].block,
          location: current[0].location,
          slots: current
        });
        current = [arr[j]];
      }
    }
    clusters.push({
      day: current[0].day,
      block: current[0].block,
      location: current[0].location,
      slots: current
    });
  }
  return clusters;
}

/** "07:00–10:00" / "17:00–20:15" — for the suggestion hover note. */
function formatClusterTimeRangeHe_(slots) {
  if (!slots || !slots.length) return '';
  var first = slots[0];
  var last = slots[slots.length - 1];
  return formatHourLabelHe_(first.startTime) + '–' + formatHourLabelHe_(last.endTime);
}

function formatHourLabelHe_(t) {
  if (t == null) return '';
  var h = Math.floor(t);
  var m = Math.round((t - h) * 60);
  if (m === 0) return (h < 10 ? '0' : '') + h + ':00';
  return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
}

/**
 * Like rankSuggestionCandidates_ but for a whole contiguous cluster of
 * unfilled slots. The candidate must be eligible for EVERY class type in
 * the cluster and free of time conflicts for every slot. Coaches who
 * already have any shift on this (day, block) are excluded — one shift
 * per block per coach is the canonical Mentor rule.
 */
function rankClusterSuggestionCandidates_(cluster, empNames, masterMap, rules, state, availability) {
  var out = [];
  for (var e = 0; e < empNames.length; e++) {
    var name = empNames[e];
    var emp = masterMap[name];

    if (emp.locationRestriction && emp.locationRestriction !== cluster.location) continue;

    // Per staff: senior coaches on this list only do the shifts they
    // submitted in the form — never propose them for extra "outside
    // availability" shifts (no 💙 suggestions). Edit the array in
    // Config.gs (CONFIG.noSuggestCoaches) to add or remove names.
    if (isNoSuggestCoach_(name)) continue;

    if (normalizeMentorRank_(emp.rank) >= CONFIG.ranks.max &&
        !hasSubmittedAnyAvailability_(name, availability)) continue;

    var existing = state.employeeShifts[name] || [];
    var alreadyInBlock = false;
    for (var s = 0; s < existing.length; s++) {
      if (existing[s].day === cluster.day && existing[s].block === cluster.block) {
        alreadyInBlock = true;
        break;
      }
    }
    if (alreadyInBlock) continue;

    var currentCount = existing.length;
    var maxShifts = getEmployeeMaxShifts_(rules);
    if (currentCount + cluster.slots.length > maxShifts) continue;

    var target = getShiftTarget(name, masterMap, availability, rules);
    if (target <= 0) continue;

    var eligibleAll = true;
    var conflict = false;
    for (var c = 0; c < cluster.slots.length; c++) {
      var slot = cluster.slots[c];
      if (!coachEligibleForClassType_(name, slot.classType, masterMap, state._classTypeRules, rules)) {
        eligibleAll = false;
        break;
      }
      if (hasTimeConflict(name, slot, null, state)) {
        conflict = true;
        break;
      }
    }
    if (!eligibleAll || conflict) continue;

    out.push({
      name: name,
      rank: normalizeMentorRank_(emp.rank),
      gapSoft: target - currentCount,
      remainingCap: maxShifts - currentCount
    });
  }

  out.sort(function(a, b) {
    var aUnder = a.gapSoft > 0 ? 1 : 0;
    var bUnder = b.gapSoft > 0 ? 1 : 0;
    if (aUnder !== bUnder) return bUnder - aUnder;
    if (aUnder && a.gapSoft !== b.gapSoft) return b.gapSoft - a.gapSoft;
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.remainingCap !== b.remainingCap) return b.remainingCap - a.remainingCap;
    return a.name.localeCompare(b.name, 'he');
  });

  return out;
}

/**
 * True iff the coach submitted ANY availability this week (at least one day
 * has at least one range or block). Used to gate Rank 4 reserves out of the
 * suggestion pool when they didn't fill the form at all.
 */
function hasSubmittedAnyAvailability_(name, availability) {
  if (!availability || !availability[name]) return false;
  var avail = availability[name];
  var days = Object.keys(avail);
  for (var i = 0; i < days.length; i++) {
    if (avail[days[i]] && avail[days[i]].length > 0) return true;
  }
  return false;
}

/**
 * Count how many distinct day+block combos this employee marked as available.
 */
function countAvailableBlocks_(name, availability, slots, emp) {
  if (!availability || !availability[name]) return 0;
  var avail = availability[name];
  var seen = {};
  var count = 0;

  for (var s = 0; s < slots.length; s++) {
    var slot = slots[s];
    if (emp && emp.locationRestriction && emp.locationRestriction !== slot.location) continue;
    var dayAvail = avail[slot.day];
    if (!dayAvail || !dayAvail.length) continue;

    var covered = false;
    if (typeof dayAvail[0] === 'string') {
      for (var b = 0; b < dayAvail.length; b++) {
        if (dayAvail[b] === slot.block) { covered = true; break; }
      }
    } else {
      covered = slotCoveredByMentorRanges_(slot, dayAvail);
    }
    if (!covered) continue;

    // Count unique (day, block) — one shift = morning OR evening half-day.
    var key = slot.day + '|' + slot.block;
    if (!seen[key]) { seen[key] = true; count++; }
  }
  return count;
}

/**
 * Convert a slotId like "Gordon_שני_ערב_0" to readable Hebrew like "גורדון | שני | ערב".
 * For group keys like "Gordon_שני_ערב" also works.
 */
function formatSlotHebrew(slotIdOrGroupKey) {
  var parts = slotIdOrGroupKey.split('_');
  var location = CONFIG.locationNames[parts[0]] || parts[0];
  var day = parts[1] || '';
  var block = parts[2] || '';
  return location + ' | ' + day + ' | ' + block;
}

