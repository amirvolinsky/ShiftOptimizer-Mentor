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
 * Per-coach effective shift target (integer) after capping by the structural
 * ceiling that the coach's submitted availability physically supports. Lets
 * the algorithm avoid chasing targets it can never reach (e.g. coach asked
 * for 4 but only submitted enough windows for 3). Populated by
 * setEffectiveShiftTargetCache_ at the start of every entry-point flow.
 */
var SHIFT_TARGET_EFFECTIVE_CACHE_ = null;

/**
 * Cache the form-submitted weekly targets for the current run. Called from
 * the optimizer and the refresh-from-sheet paths so getShiftTarget() can
 * prefer the coach's own number over MasterData.WeeklyMax. Pass null to
 * clear, e.g. between tests.
 */
function setShiftTargetFormCache_(weeklyTargets) {
  SHIFT_TARGET_FORM_CACHE_ = weeklyTargets || null;
  // Form targets feed into the effective-target calculation; invalidate the
  // downstream cache so the next call rebuilds with the new form values.
  SHIFT_TARGET_EFFECTIVE_CACHE_ = null;
}

/**
 * Pre-compute the per-coach EFFECTIVE shift target: the form/MasterData
 * target capped by the structural availability ceiling. After this runs,
 * every getShiftTarget(name) call returns min(requested, floor(structuralMax))
 * for coaches whose submitted availability cannot support their requested
 * number. Safety floor: never below 1 if the coach submitted any availability
 * and asked for at least 1 shift.
 *
 * Call from every flow that uses getShiftTarget BEFORE any scheduling work:
 *   - optimizeWeek (full run)
 *   - refreshScheduleFromSheet_ (after manual edits)
 *   - logHistoryFromSheet_ (history snapshot)
 *
 * @param {Object[]} slots  Full ShiftTemplate list
 * @param {Object}   availability  loadAvailability().availability
 * @param {Object}   masterMap     loadMasterData()
 * @param {Object}   rules         loadRules() — set cap_target_by_structural_max=false to skip
 */
function setEffectiveShiftTargetCache_(slots, availability, masterMap, rules) {
  SHIFT_TARGET_EFFECTIVE_CACHE_ = {};
  if (!masterMap) return;
  if (rules && rules.cap_target_by_structural_max === false) return;
  if (!slots || !slots.length || !availability) return;
  var names = Object.keys(masterMap);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (!availability[name]) continue;
    var submittedDays = countCoachSubmittedDays_(name, availability);
    if (submittedDays === 0) continue;
    var structuralMax = computeStructuralMaxWeightedShifts_(name, availability, slots, masterMap);
    if (structuralMax <= 0) continue;
    // Floor to whole shifts (a 0.5 partial isn't a "real" shift target);
    // safety floor at 1 so we still try to give submitters at least one.
    SHIFT_TARGET_EFFECTIVE_CACHE_[name] = Math.max(1, Math.floor(structuralMax));
  }
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
  var target = Math.min(rawTarget, cap);

  // Structural cap: if the coach's submitted availability physically can't
  // support `target` shifts (e.g. requested 4 but only enough windows for 3),
  // use the structural ceiling instead. This makes the algorithm stop chasing
  // impossible targets via swaps that create new red cells.
  if (!rules || rules.cap_target_by_structural_max !== false) {
    if (SHIFT_TARGET_EFFECTIVE_CACHE_ &&
        Object.prototype.hasOwnProperty.call(SHIFT_TARGET_EFFECTIVE_CACHE_, name)) {
      var effective = SHIFT_TARGET_EFFECTIVE_CACHE_[name];
      if (effective > 0 && effective < target) target = effective;
    }
  }

  return target;
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
 * Coach-level structural ceiling: maximum weighted shifts that COULD be
 * delivered given the coach's submitted availability windows alone — before
 * considering competing coaches, openings, or class types. Returned in the
 * same weighted scale as `countAssignedShifts_` (3+ trainings = 1.0,
 * exactly 2 trainings = 0.5).
 *
 * Used by the fairness panel to expose targets that are physically out of
 * reach (e.g. "target 4, but availability only supports 3").
 */
function computeStructuralMaxWeightedShifts_(name, availability, slots, masterMap) {
  if (!availability || !availability[name] || !slots || !slots.length) return 0;
  var emp = masterMap && masterMap[name];
  if (!emp) return 0;
  var groups = buildShiftGroups_(slots);
  var total = 0;
  for (var g = 0; g < groups.length; g++) {
    var group = groups[g];
    if (group.block === 'מנהל') continue;
    if (emp.locationRestriction) {
      var anySlotInLoc = false;
      for (var si = 0; si < group.slots.length; si++) {
        if (group.slots[si].location === emp.locationRestriction) {
          anySlotInLoc = true;
          break;
        }
      }
      if (!anySlotInLoc) continue;
    }
    var dayRanges = availability[name][group.day];
    if (!dayRanges || !dayRanges.length) continue;
    if (typeof dayRanges[0] === 'string') {
      var anyBlockMatch = false;
      for (var b = 0; b < dayRanges.length; b++) {
        if (dayRanges[b] === group.block) { anyBlockMatch = true; break; }
      }
      if (anyBlockMatch) total += 1;
      continue;
    }
    var bestRun = 0;
    for (var r = 0; r < dayRanges.length; r++) {
      if (!rangeBelongsToBlock_(dayRanges[r], group.block)) continue;
      var keys = timeKeysCoveredByRange_(group, dayRanges[r]);
      var run = computeLongestContiguousRun_(keys);
      if (run > bestRun) bestRun = Math.min(run, MENTOR_FULL_SHIFT_TRAININGS_);
    }
    total += shiftWeightForTrainingCount_(bestRun);
  }
  return total;
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
 * Display target for the fairness table "יעד" column: the coach's form
 * submission (כמות משמרות מבוקשת) when present, else capped getShiftTarget.
 */
function getFormShiftTarget_(name, masterMap, availability, rules) {
  if (SHIFT_TARGET_FORM_CACHE_ && SHIFT_TARGET_FORM_CACHE_[name] !== undefined) {
    var ft = SHIFT_TARGET_FORM_CACHE_[name];
    if (ft !== null && ft !== undefined && !isNaN(ft)) return ft;
  }
  return getShiftTarget(name, masterMap, availability, rules);
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
function optimizeWeek(slots, availability, masterMap, rules, allSlots) {
  var optimizationMode = 'fair';
  // Ensure shift target uses the same rules object throughout this run.
  SHIFT_TARGET_RULES_CACHE_ = rules || null;
  // Pre-compute effective shift targets (capped by what each coach's
  // submitted availability physically supports). Done ONCE before any
  // scheduling so every pass / swap / displacement / fairness check uses the
  // same realistic target, instead of chasing a value the coach can't reach.
  setEffectiveShiftTargetCache_(slots, availability, masterMap, rules);
  var classTypeRules = loadClassTypeRules_();
  var state = {
    assigned: {},
    employeeShifts: {},
    warnings: [],
    passLog: [],
    globalReviewLog: [],
    _slotMap: buildSlotMap_(slots),
    _allSlots: allSlots || slots,
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

  var optimizerAvailability = cloneAvailabilityForOptimization_(availability);

  assignContinuousShiftBlocks_(slots, optimizerAvailability, masterMap, rules, state);

  // Fairness floor: every Rank 3+ coach who submitted availability gets at
  // least one shift, even if it means swapping with a more-shifts coach.
  // Per staff May 23 2026 — see enforceMinimumOneShiftForLowerRanks_.
  if (rules && rules.enforce_min_shift_rank3plus !== false) {
    enforceMinimumOneShiftForLowerRanks_(slots, optimizerAvailability, masterMap, rules, state);
  }

  if (!rules || rules.rank_1_unconditional !== false) {
    enforceRank1TargetByDisplacement_(slots, optimizerAvailability, masterMap, rules, state);
  }

  // Any remaining training slot is genuinely unfilled; suggestion phase may add blue fallback suggestions.
  for (var s = 0; s < slots.length; s++) {
    if (slots[s].inactive) continue;
    if (!state.assigned[slots[s].slotId]) {
      state.assigned[slots[s].slotId] = {
        name: '', unfilled: true,
        note: 'לא נמצא עובד זמין.\nכל העובדים תפוסים, הגיעו למכסה, או לא סימנו זמינות.'
      };
    }
  }

  if (!rules || rules.global_review_enabled !== false) {
    globalScheduleReview_(slots, optimizerAvailability, masterMap, rules, state);
  }

  // Phase 3: suggest employees for unfilled slots (blue cells).
  if (rules && rules.suggest_outside_availability !== false) {
    suggestForUnfilled(slots, optimizerAvailability, masterMap, rules, state, optimizationMode);
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

function logOptimizerPass_(state, group, passName, entries) {
  if (!state) return;
  if (!state.passLog) state.passLog = [];
  state.passLog.push({
    day: group.day,
    block: group.block,
    pass: passName,
    entries: entries || []
  });
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

function cloneAvailabilityForOptimization_(availability) {
  var out = {};
  if (!availability) return out;
  var names = Object.keys(availability);
  for (var n = 0; n < names.length; n++) {
    var name = names[n];
    out[name] = {};
    var days = Object.keys(availability[name] || {});
    for (var d = 0; d < days.length; d++) {
      var day = days[d];
      var ranges = availability[name][day];
      out[name][day] = ranges && ranges.slice ? ranges.slice() : ranges;
    }
  }
  return out;
}

function routeFlexibleCoachesByScarcity_(slots, availability, masterMap, rules, state) {
  var routed = cloneAvailabilityForOptimization_(availability);
  if (!rules || rules.route_flexible_coaches_by_scarcity !== true) {
    return routed;
  }
  var groups = buildShiftGroups_(slots);
  var groupByDayBlock = {};
  for (var g = 0; g < groups.length; g++) {
    groupByDayBlock[groups[g].day + '|' + groups[g].block] = groups[g];
  }

  var names = Object.keys(masterMap);
  for (var d = 0; d < CONFIG.days.length; d++) {
    var day = CONFIG.days[d];
    var morningGroup = groupByDayBlock[day + '|בוקר'];
    var eveningGroup = groupByDayBlock[day + '|ערב'];
    if (!morningGroup || !eveningGroup) continue;

    var flexCoaches = [];
    for (var n = 0; n < names.length; n++) {
      var name = names[n];
      if (!availability || !availability[name]) continue;
      var ranges = availability[name][day];
      if (!ranges || !ranges.length || typeof ranges[0] === 'string') continue;
      if (!coachHasBlockAvailability_(ranges, 'בוקר') ||
          !coachHasBlockAvailability_(ranges, 'ערב')) continue;

      flexCoaches.push({
        name: name,
        rank: normalizeMentorRank_(masterMap[name].rank),
        ranges: ranges
      });
    }
    if (!flexCoaches.length) continue;

    var morningCount = countSingleBlockFullShiftCoaches_(
      day, 'בוקר', morningGroup, availability, masterMap, rules, state
    );
    var eveningCount = countSingleBlockFullShiftCoaches_(
      day, 'ערב', eveningGroup, availability, masterMap, rules, state
    );

    flexCoaches.sort(function(a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.name.localeCompare(b.name, 'he');
    });

    for (var f = 0; f < flexCoaches.length; f++) {
      var flex = flexCoaches[f];
      var keepBlock = morningCount < eveningCount ? 'בוקר' : 'ערב';
      routed[flex.name][day] = filterRangesForBlock_(flex.ranges, keepBlock);
      if (keepBlock === 'בוקר') {
        morningCount++;
      } else {
        eveningCount++;
      }
      state.warnings.push(
        flex.name + ' — זמינות ' + day + ' נותבה ל' + keepBlock +
        ' כדי לאזן עומס בין בוקר לערב בלי לשבץ את שניהם.'
      );
    }
  }
  return routed;
}

function countSingleBlockFullShiftCoaches_(day, block, group, availability, masterMap, rules, state) {
  var count = 0;
  var otherBlock = block === 'בוקר' ? 'ערב' : 'בוקר';
  var names = Object.keys(masterMap);
  for (var n = 0; n < names.length; n++) {
    var name = names[n];
    if (!availability[name] || !availability[name][day]) continue;
    var ranges = availability[name][day];
    if (!ranges || !ranges.length || typeof ranges[0] === 'string') continue;
    if (!coachHasBlockAvailability_(ranges, block)) continue;
    if (coachHasBlockAvailability_(ranges, otherBlock)) continue;
    if (longestBlockRunForCoach_(name, group, ranges, masterMap, rules, state) >= MENTOR_FULL_SHIFT_TRAININGS_) {
      count++;
    }
  }
  return count;
}

function longestBlockRunForCoach_(name, group, ranges, masterMap, rules, state) {
  var bestRun = 0;
  for (var r = 0; r < ranges.length; r++) {
    if (!rangeBelongsToBlock_(ranges[r], group.block)) continue;
    var timeKeys = timeKeysCoveredByRange_(group, ranges[r]);
    timeKeys = filterTimeKeysByClassEligibility_(group, timeKeys, name, masterMap, state, rules);
    if (!timeKeys.length) continue;
    bestRun = Math.max(bestRun, Math.min(
      computeLongestContiguousRun_(timeKeys),
      MENTOR_FULL_SHIFT_TRAININGS_
    ));
  }
  return bestRun;
}

function coachHasBlockAvailability_(ranges, block) {
  if (!ranges || !ranges.length || typeof ranges[0] === 'string') return false;
  for (var i = 0; i < ranges.length; i++) {
    if (rangeBelongsToBlock_(ranges[i], block)) return true;
  }
  return false;
}

function filterRangesForBlock_(ranges, block) {
  var out = [];
  for (var i = 0; i < ranges.length; i++) {
    if (rangeBelongsToBlock_(ranges[i], block)) out.push(ranges[i]);
  }
  return out;
}

function rangeBelongsToBlock_(range, block) {
  if (!range) return false;
  if (block === 'בוקר') return range.startHour < 12;
  if (block === 'ערב') return range.endHour > 12;
  return false;
}

function scoreOtherCoachSupplyForBlock_(flexCoachName, group, availability, masterMap, rules, state) {
  var score = { full: 0, any: 0 };
  var names = Object.keys(masterMap);
  for (var n = 0; n < names.length; n++) {
    var name = names[n];
    if (name === flexCoachName) continue;
    if (!availability[name] || !availability[name][group.day]) continue;
    var ranges = availability[name][group.day];
    if (!ranges || !ranges.length || typeof ranges[0] === 'string') continue;

    var bestRun = 0;
    for (var r = 0; r < ranges.length; r++) {
      if (!rangeBelongsToBlock_(ranges[r], group.block)) continue;
      var timeKeys = timeKeysCoveredByRange_(group, ranges[r]);
      timeKeys = filterTimeKeysByClassEligibility_(group, timeKeys, name, masterMap, state, rules);
      if (!timeKeys.length) continue;
      bestRun = Math.max(bestRun, Math.min(
        computeLongestContiguousRun_(timeKeys),
        MENTOR_FULL_SHIFT_TRAININGS_
      ));
    }
    if (bestRun >= MENTOR_MIN_SHIFT_TRAININGS_) score.any++;
    if (bestRun >= MENTOR_FULL_SHIFT_TRAININGS_) score.full++;
  }
  return score;
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
    var passLogEntries = [];

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
      var logEntry = {
        name: cand.name,
        rank: cand.rank,
        length: cand.length,
        gap: cand.gap,
        placed: false,
        reason: ''
      };
      passLogEntries.push(logEntry);

      if (cand.gap <= 0) {
        logEntry.reason = 'at-target';
        continue; // Form target is a hard cap, including Rank 1.
      }
      // Hard "no morning+evening same day" rule — never bypassed (applies
      // to every rank, including Rank 1).
      if (hasSameDayOppositeBlockShift_(cand.name, cand.day, cand.block, state)) {
        logEntry.reason = 'opposite-block-same-day';
        continue;
      }
      if (!canAssignMoreClasses_(cand.name, cand.length, rules, state)) {
        logEntry.reason = 'class-cap';
        continue;
      }
      if (candidateAlreadyHasAnyTime_(cand, state)) {
        logEntry.reason = 'already-in-block';
        continue;
      }

      var assignedSlots = findBestContiguousAssignment_(
        cand, state, masterMap, rules, {
          minLength: passMin,
          // Never split one coach across nets in a single block — staff want
          // one tall cell per net, not 3h here + 1h there.
          allowSpread: false
        }
      );
      if (!assignedSlots) {
        logEntry.reason = 'no-contiguous-net';
        continue;
      }

      assignEmployeeToSlots_(cand.name, assignedSlots, masterMap, state);
      logEntry.placed = true;
      logEntry.reason = 'placed';
      if (cand.backToBack) {
        state.warnings.push(
          cand.name + ' — שובץ/ה במשמרת צמודה למרות דרגה ' + cand.rank + ' (' +
          cand.day + ' ' + cand.block + ').'
        );
      }
    }

    // Rank 1 sub-4h windows are reserved after full 4-training shifts land,
    // so a 7-11 coach is not displaced by an 8-11 prepass assignment.
    if (p === 0 && rank1Unconditional) {
      runRank1SubFullShiftPrepass_(group, availability, masterMap, rules, state);
    }
    logOptimizerPass_(state, group, 'pass-' + passMin, passLogEntries);
  }
}

/**
 * Pre-pass for Rank 1 coaches whose longest contiguous teachable run on
 * this (day, block) is SHORTER than a full 4-training shift. Those coaches
 * are filtered out of the regular 4h pass and would otherwise lose every
 * active net on the block to Rank 2 4h-capable coaches. To guarantee
 * "Rank 1 always gets the shifts they submitted", we place each such
 * under-target Rank 1 coach after the full-shift pass and before 3h/2h
 * passes get to consider anyone else.
 *
 * Rules:
 *   - Coach must be Rank 1 and submit a range on this (day, block).
 *   - Coach must NOT already have a shift in this (day, block).
 *   - Coach must be strictly under their form target.
 *   - Only sub-4h windows are handled here; 4h+ Rank 1 windows continue
 *     to land via the normal 4h pass (where they also win first by rank).
 *   - The assigned run uses the coach's actual longest teachable length
 *     (≥2), so a 3h window becomes a 3-training shift on a single net.
 */
function runRank1SubFullShiftPrepass_(group, availability, masterMap, rules, state) {
  var names = Object.keys(masterMap);
  var candidates = [];

  for (var n = 0; n < names.length; n++) {
    var name = names[n];
    var emp = masterMap[name];
    if (normalizeMentorRank_(emp.rank) !== CONFIG.ranks.best) continue;
    if (!availability[name] || !availability[name][group.day]) continue;
    var ranges = availability[name][group.day];
    if (!ranges || !ranges.length || typeof ranges[0] === 'string') continue;

    var target = getShiftTarget(name, masterMap, availability, rules);
    if (target <= 0) continue;
    if (countAssignedShifts_(name, state) >= target) continue;

    // Skip if this coach already has any shift in this (day, block).
    var shifts = state.employeeShifts[name] || [];
    var alreadyInBlock = false;
    for (var s = 0; s < shifts.length; s++) {
      if (shifts[s].day === group.day && shifts[s].block === group.block) {
        alreadyInBlock = true;
        break;
      }
    }
    if (alreadyInBlock) continue;

    // Hard-skip if the coach already has the OPPOSITE block (morning vs
    // evening) on the same day — we never want a coach working both
    // halves of the same calendar day, regardless of how big the gap is.
    if (hasSameDayOppositeBlockShift_(name, group.day, group.block, state)) continue;

    // Inspect ALL submitted ranges on this (day, block) before deciding.
    // If ANY range gives a 4-training run, this coach should not land in
    // the prepass — the regular pass 1 picks them up with the longer
    // window. Otherwise pick the longest sub-4h run as the prepass
    // candidate (so רון 7–11 + 8–12 → 4-cell range, not 3-cell range).
    var hasFullShiftRange = false;
    var bestRange = null;
    for (var r = 0; r < ranges.length; r++) {
      var timeKeys = timeKeysCoveredByRange_(group, ranges[r]);
      timeKeys = filterTimeKeysByClassEligibility_(group, timeKeys, name, masterMap, state, rules);
      if (!timeKeys.length) continue;

      var longestRun = computeLongestContiguousRun_(timeKeys);
      var clampedRun = Math.min(longestRun, MENTOR_FULL_SHIFT_TRAININGS_);
      if (clampedRun >= MENTOR_FULL_SHIFT_TRAININGS_) {
        hasFullShiftRange = true;
        break;
      }
      if (clampedRun < MENTOR_MIN_SHIFT_TRAININGS_) continue;
      if (!bestRange || clampedRun > bestRange.length) {
        bestRange = {
          rangeIndex: r,
          timeKeys: timeKeys,
          length: clampedRun,
          preferredAnchorHour: ranges[r].startHour
        };
      }
    }
    if (hasFullShiftRange) continue;
    if (!bestRange) continue;

    candidates.push({
      name: name,
      rank: normalizeMentorRank_(emp.rank),
      day: group.day,
      block: group.block,
      rangeIndex: bestRange.rangeIndex,
      timeKeys: bestRange.timeKeys,
      length: bestRange.length,
      preferredAnchorHour: bestRange.preferredAnchorHour,
      gap: target - countAssignedShifts_(name, state),
      backToBack: wouldCreateBackToBackShift_(name, group.day, group.block, emp, state),
        group: group,
        availability: availability
    });
  }

  if (!candidates.length) return;

  // Largest gap first (most under-target), then longest window, then name.
  candidates.sort(function(a, b) {
    if (a.gap !== b.gap) return b.gap - a.gap;
    if (a.length !== b.length) return b.length - a.length;
    return a.name.localeCompare(b.name, 'he');
  });

  for (var i = 0; i < candidates.length; i++) {
    var cand = candidates[i];
    // Re-check the cap; previous iterations in this pass may have placed
    // the same coach on a different range earlier (defensive).
    if (countAssignedShifts_(cand.name, state) >= getShiftTarget(cand.name, masterMap, availability, rules)) continue;

    var assignedSlots = findBestContiguousAssignment_(
      cand, state, masterMap, rules, {
        // Use the coach's actual run length, NOT the multi-pass minimum;
        // this is exactly what unblocks a sub-4h Rank 1 window.
        minLength: cand.length,
        allowSpread: false,
        preferredAnchorHour: cand.preferredAnchorHour
      }
    );
    if (!assignedSlots) continue;

    assignEmployeeToSlots_(cand.name, assignedSlots, masterMap, state);
    if (cand.backToBack) {
      state.warnings.push(
        cand.name + ' — שובץ/ה במשמרת צמודה (' + cand.day + ' ' + cand.block +
        ') בקדם־מעבר של דרג 1 כדי לעמוד ביעד שהגיש/ה.'
      );
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
 * `protect_under_target_rank12` (default TRUE) prevents this pass from taking
 * a run that an under-target Rank 1-2 coach could fill; see placeUnderTargetRank12IntoUnassignedRuns_.
 */
function enforceMinimumOneShiftForLowerRanks_(slots, availability, masterMap, rules, state) {
  var protectR12 = !rules || rules.protect_under_target_rank12 !== false;

  // Stage A — Rank 3+ with guard (don't steal from under-target R1-2).
  placeRank3PlusFairnessFloor_(slots, availability, masterMap, rules, state, protectR12, false);

  // Under-target Rank 1-2 pick up runs the guard left open.
  if (protectR12) {
    placeUnderTargetRank12IntoUnassignedRuns_(slots, availability, masterMap, rules, state);
  }

  // Stage B — Rank 3+ still at 0 shifts: unguarded fallback (min-1 guarantee).
  placeRank3PlusFairnessFloor_(slots, availability, masterMap, rules, state, false, true);
}

function enforceRank1TargetByDisplacement_(slots, availability, masterMap, rules, state) {
  var names = Object.keys(masterMap);
  names.sort(function(a, b) {
    var gapA = getShiftTarget(a, masterMap, availability, rules) - countAssignedShifts_(a, state);
    var gapB = getShiftTarget(b, masterMap, availability, rules) - countAssignedShifts_(b, state);
    if (gapA !== gapB) return gapB - gapA;
    return a.localeCompare(b, 'he');
  });

  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var emp = masterMap[name];
    if (!emp || normalizeMentorRank_(emp.rank) !== CONFIG.ranks.best) continue;
    if (!hasSubmittedAnyAvailability_(name, availability)) continue;

    var target = getShiftTarget(name, masterMap, availability, rules);
    var guard = 0;
    while (countAssignedShifts_(name, state) < target && guard < target + 2) {
      guard++;
      var placed = tryPlaceInUnassignedRun_(name, emp, slots, availability, masterMap, rules, state, false);
      if (!placed) {
        placed = tryGiveOneShiftBySwap_(
          name, emp, slots, availability, masterMap, rules, state, false, {
            warningSuffix: ' — השלמת יעד חובה למאמן/ת דרג 1.',
            allowRank1Requester: true,
            allowPartialRehome: true
          }
        );
      }
      if (!placed) break;
    }

    if (countAssignedShifts_(name, state) < target) {
      state.warnings.push(
        '⚠️ ' + name + ' (דרג 1) עדיין מתחת ליעד: ' +
        countAssignedShifts_(name, state) + '/' + target +
        '. לא נמצאה החלפה חוקית לפי זמינות/כשירות/חפיפה.'
      );
    }
  }
}

/**
 * Rank 3+ fairness floor loop. When `guardUnderTargetR12` is true, skips runs
 * where an under-target Rank 1-2 coach is eligible. Warnings only when
 * `warnIfStillZero` is true (Stage B).
 */
function placeRank3PlusFairnessFloor_(slots, availability, masterMap, rules, state, guardUnderTargetR12, warnIfStillZero) {
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

    var placed = tryPlaceInUnassignedRun_(
      name, emp, slots, availability, masterMap, rules, state, guardUnderTargetR12
    );
    if (!placed) {
      placed = tryGiveOneShiftBySwap_(
        name, emp, slots, availability, masterMap, rules, state, guardUnderTargetR12, {
          allowPartialRehome: true
        }
      );
    }
    if (!placed && warnIfStillZero) {
      state.warnings.push(
        '⚠️ ' + name + ' (דרג ' + rank + ') הגיש זמינות אך לא נמצא שיבוץ מינימלי. ' +
        'אין משבצות פנויות בזמינות שלו/ה ולא נמצא מאמן להחלפה.'
      );
    }
  }
}

/**
 * After the guarded Rank 3+ pass, place under-target Rank 1-2 coaches into
 * still-unassigned contiguous runs they can teach.
 */
function placeUnderTargetRank12IntoUnassignedRuns_(slots, availability, masterMap, rules, state) {
  var names = Object.keys(masterMap);
  names.sort(function(a, b) {
    var rA = normalizeMentorRank_(masterMap[a].rank);
    var rB = normalizeMentorRank_(masterMap[b].rank);
    if (rA !== rB) return rA - rB;
    var gapA = getShiftTarget(a, masterMap, availability, rules) - countAssignedShifts_(a, state);
    var gapB = getShiftTarget(b, masterMap, availability, rules) - countAssignedShifts_(b, state);
    if (gapA !== gapB) return gapB - gapA;
    return a.localeCompare(b, 'he');
  });

  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var emp = masterMap[name];
    var rank = normalizeMentorRank_(emp.rank);
    if (rank > 2) continue;
    if (!hasSubmittedAnyAvailability_(name, availability)) continue;
    var target = getShiftTarget(name, masterMap, availability, rules);
    if (countAssignedShifts_(name, state) >= target) continue;

    tryPlaceInUnassignedRun_(
      name, emp, slots, availability, masterMap, rules, state, false
    );
  }
}

/**
 * True when some Rank 1-2 coach is still under weekly target and could take
 * `runSlots` on this (day, block) by time + class-type + no existing shift there.
 */
function isUnderTargetRank12EligibleForRun_(runSlots, group, availability, masterMap, rules, state) {
  if (!runSlots || !runSlots.length || !group) return false;
  if (rules && rules.protect_under_target_rank12 === false) return false;

  var classTypeRules = state && state._classTypeRules;
  var day = group.day;
  var block = group.block;
  var coachNames = Object.keys(masterMap);

  for (var i = 0; i < coachNames.length; i++) {
    var coachName = coachNames[i];
    var emp = masterMap[coachName];
    var rank = normalizeMentorRank_(emp.rank);
    if (rank > 2) continue;

    var target = getShiftTarget(coachName, masterMap, availability, rules);
    if (countAssignedShifts_(coachName, state) >= target) continue;

    if (!availability[coachName] || !availability[coachName][day]) continue;
    var ranges = availability[coachName][day];
    if (!ranges || !ranges.length || typeof ranges[0] === 'string') continue;

    var cand = { name: coachName, day: day, block: block };
    if (candidateAlreadyHasAnyTime_(cand, state)) continue;

    var coversAll = true;
    for (var s = 0; s < runSlots.length; s++) {
      var slot = runSlots[s];
      if (!slotCoveredByMentorRanges_(slot, ranges)) {
        coversAll = false;
        break;
      }
      if (!coachEligibleForClassType_(coachName, slot.classType, masterMap, classTypeRules, rules)) {
        coversAll = false;
        break;
      }
    }
    if (coversAll) return true;
  }
  return false;
}

/**
 * Step 1 of the fairness floor: try to place `name` into a contiguous run
 * of UNASSIGNED slots they can teach (≥2 cells, ≤4 cells, single net).
 * This handles e.g. לילוש who is "4-capable" on Sun eve (covers 4 hours of
 * the 5-hour evening window) but the 4-or-nothing rule excluded her from
 * passes 2/3 even though Net 1 has 3 unassigned cells matching her window.
 */
function tryPlaceInUnassignedRun_(name, emp, slots, availability, masterMap, rules, state, guardUnderTargetR12) {
  var groups = buildShiftGroups_(slots);
  var classTypeRules = state && state._classTypeRules;

  for (var g = 0; g < groups.length; g++) {
    var group = groups[g];
    if (!availability[name] || !availability[name][group.day]) continue;
    var ranges = availability[name][group.day];
    if (!ranges || !ranges.length || typeof ranges[0] === 'string') continue;

    // Hard: never give a coach both morning and evening on the same day.
    if (hasSameDayOppositeBlockShift_(name, group.day, group.block, state)) continue;
    if (employeeAlreadyInBlock_(name, group.day, group.block, state)) continue;

    for (var r = 0; r < ranges.length; r++) {
      var timeKeys = timeKeysCoveredByRange_(group, ranges[r]);
      // Keep only time keys with at least one UNASSIGNED slot the coach
      // is eligible for. Different from filterTimeKeysByClassEligibility_
      // because we also require unassigned (the main filter already skips
      // assigned, but spelling it out keeps this code self-contained).
      var kept = [];
      for (var ki = 0; ki < timeKeys.length; ki++) {
        var k = timeKeys[ki];
        var slotsAtTime = group.slotsByTime[k] || [];
        for (var ss = 0; ss < slotsAtTime.length; ss++) {
          var sl = slotsAtTime[ss];
          if (state.assigned[sl.slotId]) continue;
          if (coachEligibleForClassType_(name, sl.classType, masterMap, classTypeRules, rules)) {
            kept.push(k);
            break;
          }
        }
      }
      if (kept.length < MENTOR_MIN_SHIFT_TRAININGS_) continue;

      var cand = {
        name: name,
        rank: normalizeMentorRank_(emp.rank),
        day: group.day,
        block: group.block,
        timeKeys: kept,
        group: group
      };
      var assignedSlots = findBestContiguousAssignment_(cand, state, masterMap, rules, {
        minLength: MENTOR_MIN_SHIFT_TRAININGS_,
        allowSpread: false
      });
      if (!assignedSlots) continue;

      if (guardUnderTargetR12 &&
          isUnderTargetRank12EligibleForRun_(assignedSlots, group, availability, masterMap, rules, state)) {
        continue;
      }

      assignEmployeeToSlots_(name, assignedSlots, masterMap, state);
      var rankN = normalizeMentorRank_(emp.rank);
      var msgPrefix = rankN >= 3 ? '🆘 ' : '📌 ';
      var msgSuffix = rankN >= 3
        ? ' — הבטחת לפחות משמרת אחת למאמן מדרג 3+ שהגיש זמינות.'
        : ' — השלמת יעד דרג 1-2 במשבצות פנויות.';
      state.warnings.push(
        msgPrefix + name + ' (דרג ' + emp.rank + ') שובץ במשבצות פנויות ב-' +
        group.day + ' ' + group.block +
        ' (' + assignedSlots.length + ' אימונים)' + msgSuffix
      );
      return true;
    }
  }
  return false;
}

/**
 * Try to give `name` a single shift by displacing a higher-count coach in
 * one of the coach's submitted (day, block) units. Returns true on success.
 */
function tryGiveOneShiftBySwap_(name, emp, slots, availability, masterMap, rules, state, guardUnderTargetR12, opts) {
  opts = opts || {};
  var groups = buildShiftGroups_(slots);
  var rank1Unconditional = !rules || rules.rank_1_unconditional !== false;

  for (var g = 0; g < groups.length; g++) {
    var group = groups[g];
    if (!availability[name] || !availability[name][group.day]) continue;
    var ranges = availability[name][group.day];
    if (!ranges || !ranges.length) continue;
    if (typeof ranges[0] === 'string') continue;

    // Hard: never give a coach both morning and evening on the same day.
    if (hasSameDayOppositeBlockShift_(name, group.day, group.block, state)) continue;
    if (employeeAlreadyInBlock_(name, group.day, group.block, state)) continue;

    // Build seenKey = time keys this coach can teach in this group. Unlike
    // the main-pass filter, we DO NOT skip already-assigned slots — the
    // whole point of this pass is to displace an existing assignment.
    var seenKey = {};
    var classTypeRules = state && state._classTypeRules;
    for (var r = 0; r < ranges.length; r++) {
      var keysInRange = timeKeysCoveredByRange_(group, ranges[r]);
      for (var ki = 0; ki < keysInRange.length; ki++) {
        var tk = keysInRange[ki];
        if (seenKey[tk]) continue;
        var slotsAtTime = group.slotsByTime[tk] || [];
        var canTeach = false;
        for (var ss = 0; ss < slotsAtTime.length; ss++) {
          if (coachEligibleForClassType_(name, slotsAtTime[ss].classType, masterMap, classTypeRules, rules)) {
            canTeach = true;
            break;
          }
        }
        if (canTeach) seenKey[tk] = true;
      }
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

      var vShifts = countAssignedShifts_(v.coach, state);
      var vRank = normalizeMentorRank_(masterMap[v.coach].rank);
      var vTarget = getShiftTarget(v.coach, masterMap, availability, rules);
      if (rank1Unconditional && vRank === CONFIG.ranks.best) {
        var requesterIsRank1 = opts.allowRank1Requester &&
          normalizeMentorRank_(emp.rank) === CONFIG.ranks.best;
        if (!requesterIsRank1 || vShifts <= vTarget + 0.01) continue;
      }
      if (vShifts < 2) continue;

      v.slots.sort(function(a, b) { return a.startTime - b.startTime; });
      var coverSlots = [];
      var uncoveredSlots = [];
      for (var vs = 0; vs < v.slots.length; vs++) {
        var vslot = v.slots[vs];
        // Time-window: coach must have submitted availability covering this slot.
        var canCoverSlot = !!seenKey[slotTimeKey_(vslot)];
        // Class-type: coach must be eligible for THIS specific slot, not
        // just some other slot at the same time.
        if (canCoverSlot &&
            !coachEligibleForClassType_(name, vslot.classType, masterMap, classTypeRules, rules)) {
          canCoverSlot = false;
        }
        if (canCoverSlot) coverSlots.push(vslot);
        else uncoveredSlots.push(vslot);
      }

      var partialRehome = null;
      if (uncoveredSlots.length > 0) {
        if (!opts.allowPartialRehome) continue;
        if (coverSlots.length < MENTOR_MIN_SHIFT_TRAININGS_) continue;
        if (!isBoundaryPartialSwap_(v.slots, coverSlots, uncoveredSlots)) continue;
        partialRehome = buildRehomePlanForUncoveredSlots_(
          uncoveredSlots, state, availability, masterMap, rules
        );
        if (!partialRehome) continue;
      }

      victims.push({
        coach: v.coach,
        loc: v.loc,
        slots: v.slots,
        coverSlots: coverSlots,
        uncoveredSlots: uncoveredSlots,
        rehomePlan: partialRehome,
        rank: vRank,
        shifts: vShifts,
        over: vShifts - vTarget
      });
    }

    if (victims.length === 0) continue;

    victims.sort(function(a, b) {
      var aPartial = a.uncoveredSlots && a.uncoveredSlots.length ? 1 : 0;
      var bPartial = b.uncoveredSlots && b.uncoveredSlots.length ? 1 : 0;
      if (aPartial !== bPartial) return aPartial - bPartial;
      if (a.over !== b.over) return b.over - a.over;
      if (a.shifts !== b.shifts) return b.shifts - a.shifts;
      if (a.rank !== b.rank) return b.rank - a.rank;
      return a.coach.localeCompare(b.coach, 'he');
    });

    var victim = victims[0];
    if (guardUnderTargetR12 &&
        isUnderTargetRank12EligibleForRun_(victim.slots, group, availability, masterMap, rules, state)) {
      continue;
    }

    for (var us = 0; us < victim.slots.length; us++) {
      unassignSlot_(victim.slots[us].slotId, victim.slots[us], state);
    }
    var requesterSlots = victim.coverSlots && victim.coverSlots.length
      ? victim.coverSlots
      : victim.slots;
    for (var as = 0; as < requesterSlots.length; as++) {
      assignEmployee(name, requesterSlots[as], masterMap, state);
    }
    if (victim.rehomePlan) {
      applyRehomePlan_(victim.rehomePlan, masterMap, state);
    }

    state.warnings.push(
      '🔁 ' + name + ' (דרג ' + emp.rank + ') הוחלף עם ' + victim.coach +
      ' (דרג ' + victim.rank + ') ב-' + group.day + ' ' + group.block + ' ' +
      (CONFIG.locationNames[victim.loc] || victim.loc) +
      (victim.rehomePlan ? ' — תא שלא כוסה נסגר והאימון הועבר לתא זמין אחר.' : '') +
      (opts.warningSuffix || ' — הבטחת לפחות משמרת אחת לכל מאמן מדרג 3+ שהגיש זמינות.')
    );
    return true;
  }
  return false;
}

function isBoundaryPartialSwap_(victimSlots, coverSlots, uncoveredSlots) {
  if (!victimSlots || !coverSlots || !uncoveredSlots) return false;
  if (uncoveredSlots.length !== 1) return false;
  if (coverSlots.length < MENTOR_MIN_SHIFT_TRAININGS_) return false;

  victimSlots.sort(function(a, b) { return a.startTime - b.startTime; });
  coverSlots.sort(function(a, b) { return a.startTime - b.startTime; });
  var uncovered = uncoveredSlots[0];
  var isBoundary = uncovered.slotId === victimSlots[0].slotId ||
    uncovered.slotId === victimSlots[victimSlots.length - 1].slotId;
  if (!isBoundary) return false;

  for (var i = 1; i < coverSlots.length; i++) {
    if (!timeKeysAdjacent_(slotTimeKey_(coverSlots[i - 1]), slotTimeKey_(coverSlots[i]))) {
      return false;
    }
  }
  return true;
}

function buildRehomePlanForUncoveredSlots_(sourceSlots, state, availability, masterMap, rules) {
  if (!sourceSlots || !sourceSlots.length) return null;
  var plan = [];
  var usedDestIds = {};
  for (var i = 0; i < sourceSlots.length; i++) {
    var dest = findInactiveExtensionDestination_(
      sourceSlots[i], state, availability, masterMap, rules, usedDestIds
    );
    if (!dest) return null;
    usedDestIds[dest.slot.slotId] = true;
    plan.push({
      source: sourceSlots[i],
      destination: dest.slot,
      coach: dest.coach
    });
  }
  return plan;
}

function findInactiveExtensionDestination_(sourceSlot, state, availability, masterMap, rules, usedDestIds) {
  var allSlots = state && state._allSlots ? state._allSlots : [];
  var names = Object.keys(masterMap);
  var candidates = [];

  for (var s = 0; s < allSlots.length; s++) {
    var slot = allSlots[s];
    if (!slot || !slot.inactive || slot.block === 'מנהל') continue;
    if (state.assigned[slot.slotId] && !state.assigned[slot.slotId].unfilled) continue;
    if (usedDestIds && usedDestIds[slot.slotId]) continue;

    for (var n = 0; n < names.length; n++) {
      var name = names[n];
      var emp = masterMap[name];
      if (!emp || !meetsLocationRestriction(emp, slot)) continue;
      if (!isAvailableForSlot(name, slot, availability)) continue;
      if (!coachEligibleForClassType_(name, sourceSlot.classType, masterMap, state._classTypeRules, rules)) continue;
      if (!canExtendExistingShiftWithSlot_(name, slot, state)) continue;

      var target = getShiftTarget(name, masterMap, availability, rules);
      var gap = target - countAssignedShifts_(name, state);
      candidates.push({
        slot: slot,
        coach: name,
        rank: normalizeMentorRank_(emp.rank),
        gap: gap,
        distance: rehomeDistance_(sourceSlot, slot)
      });
    }
  }

  if (!candidates.length) return null;
  candidates.sort(function(a, b) {
    if (a.gap !== b.gap) return b.gap - a.gap;
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.coach.localeCompare(b.coach, 'he');
  });
  return candidates[0];
}

function canExtendExistingShiftWithSlot_(name, slot, state) {
  var shifts = state.employeeShifts[name] || [];
  var sameBlock = [];
  for (var i = 0; i < shifts.length; i++) {
    var sh = shifts[i];
    if (sh.day === slot.day && sh.block === slot.block && sh.location === slot.location) {
      sameBlock.push(sh);
    }
  }
  if (!sameBlock.length || sameBlock.length >= MENTOR_FULL_SHIFT_TRAININGS_) return false;

  for (var s = 0; s < sameBlock.length; s++) {
    if (shiftTimesOverlap_(sameBlock[s].startTime, sameBlock[s].endTime, slot.startTime, slot.endTime)) {
      return false;
    }
    var before = Math.abs(sameBlock[s].endTime - slot.startTime) <= 0.5;
    var after = Math.abs(slot.endTime - sameBlock[s].startTime) <= 0.5;
    if (before || after) return true;
  }
  return false;
}

function rehomeDistance_(sourceSlot, destSlot) {
  var dayDistance = Math.abs(dayOrder_(sourceSlot.day) - dayOrder_(destSlot.day));
  var blockDistance = sourceSlot.block === destSlot.block ? 0 : 1;
  return dayDistance * 10 + blockDistance;
}

function applyRehomePlan_(plan, masterMap, state) {
  for (var i = 0; i < plan.length; i++) {
    var source = plan[i].source;
    var dest = plan[i].destination;
    var coach = plan[i].coach;

    dest.classType = source.classType;
    dest.inactive = false;
    source.inactive = true;
    source.rehomedToSlotId = dest.slotId;
    source.rehomedToCoach = coach;

    state.assigned[source.slotId] = {
      name: '',
      unfilled: true,
      inactiveRehomed: true,
      note: 'האימון הועבר לתא אחר כדי למנוע תא אדום בודד.'
    };
    assignEmployee(coach, dest, masterMap, state);
  }
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
        group: group,
        availability: availability
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

/** 2 trainings = half shift; 3+ trainings = full shift for target/status math. */
function shiftWeightForTrainingCount_(count) {
  if (count <= 0) return 0;
  if (count === MENTOR_MIN_SHIFT_TRAININGS_) return 0.5;
  return 1;
}

/**
 * Count weighted shifts from assigned trainings:
 * - exactly 2 trainings in a (day, block) = 0.5 shift
 * - 3+ trainings in a (day, block) = 1 shift
 */
function countWeightedShiftsFromTrainings_(trainings) {
  var byShift = {};
  for (var i = 0; i < trainings.length; i++) {
    var t = trainings[i];
    var key = t.day + '|' + t.block;
    byShift[key] = byShift[key] || { block: t.block, count: 0 };
    byShift[key].count++;
  }

  var out = { total: 0, morning: 0, evening: 0, other: 0 };
  var keys = Object.keys(byShift);
  for (var k = 0; k < keys.length; k++) {
    var item = byShift[keys[k]];
    var weight = shiftWeightForTrainingCount_(item.count);
    out.total += weight;
    if (item.block === 'בוקר') out.morning += weight;
    else if (item.block === 'ערב') out.evening += weight;
    else out.other += weight;
  }
  return out;
}

/** Count weighted shifts the coach is already assigned to. */
function countAssignedShifts_(name, state) {
  var arr = state.employeeShifts[name] || [];
  return countWeightedShiftsFromTrainings_(arr).total;
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
  // Count weighted shifts: 2 trainings = 0.5, 3+ trainings = 1.
  var currentCount = countAssignedShifts_(name, state);
  return currentCount + shiftWeightForTrainingCount_(additionalCount || 0) <= maxShifts;
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
  if (opts.preferredAnchorHour != null) {
    netOrder = biasNetOrderByAnchorHour_(candidate, netOrder, opts.preferredAnchorHour);
  }

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

function biasNetOrderByAnchorHour_(candidate, netOrder, preferredAnchorHour) {
  var scores = [];
  for (var i = 0; i < netOrder.length; i++) {
    var loc = netOrder[i];
    var anchorHour = null;
    for (var s = 0; s < candidate.group.slots.length; s++) {
      var slot = candidate.group.slots[s];
      if (slot.location !== loc) continue;
      if (anchorHour == null || slot.startTime < anchorHour) anchorHour = slot.startTime;
    }
    scores.push({
      loc: loc,
      idx: i,
      matches: anchorHour != null && Math.abs(anchorHour - preferredAnchorHour) < 0.01
    });
  }
  scores.sort(function(a, b) {
    if (a.matches !== b.matches) return a.matches ? -1 : 1;
    return a.idx - b.idx;
  });
  var out = [];
  for (var j = 0; j < scores.length; j++) out.push(scores[j].loc);
  return out;
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
    scores.push({
      loc: loc,
      score: score,
      blocked: countUnderTargetSubFullCoachesBlockedByNet_(candidate, loc, locs, state, masterMap, rules)
    });
  }

  scores.sort(function(a, b) {
    if (b.score !== a.score) return b.score - a.score;
    if (a.blocked !== b.blocked) return a.blocked - b.blocked;
    return a.loc.localeCompare(b.loc, 'he');
  });

  var out = [];
  for (var s = 0; s < scores.length; s++) out.push(scores[s].loc);
  return out;
}

/**
 * Penalize using a net when that net is the only remaining way for an
 * under-target short-window coach to land a real shift in this same block.
 * This keeps flexible 4h coaches from taking the 7-anchored bottleneck net
 * when a 7-10 coach can only fit there.
 */
function countUnderTargetSubFullCoachesBlockedByNet_(candidate, loc, locs, state, masterMap, rules) {
  var availability = candidate.availability;
  if (!availability || !candidate || !candidate.group) return 0;

  var group = candidate.group;
  var names = Object.keys(masterMap);
  var blocked = 0;
  for (var n = 0; n < names.length; n++) {
    var name = names[n];
    if (name === candidate.name) continue;
    var emp = masterMap[name];
    if (!emp) continue;

    var target = getShiftTarget(name, masterMap, availability, rules);
    if (target <= 0 || countAssignedShifts_(name, state) >= target) continue;
    if (hasSameDayOppositeBlockShift_(name, group.day, group.block, state)) continue;
    if (employeeAlreadyInBlock_(name, group.day, group.block, state)) continue;

    var ranges = availability[name] && availability[name][group.day];
    if (!ranges || !ranges.length || typeof ranges[0] === 'string') continue;

    var targetLocLen = bestAssignableRunOnLocation_(name, group, ranges, loc, state, masterMap, rules);
    if (targetLocLen < MENTOR_MIN_SHIFT_TRAININGS_ || targetLocLen >= MENTOR_FULL_SHIFT_TRAININGS_) continue;

    var hasOtherFit = false;
    for (var li = 0; li < locs.length; li++) {
      var otherLoc = locs[li];
      if (otherLoc === loc) continue;
      if (bestAssignableRunOnLocation_(name, group, ranges, otherLoc, state, masterMap, rules) >= MENTOR_MIN_SHIFT_TRAININGS_) {
        hasOtherFit = true;
        break;
      }
    }
    if (!hasOtherFit) blocked++;
  }
  return blocked;
}

function employeeAlreadyInBlock_(name, day, block, state) {
  var shifts = state && state.employeeShifts ? (state.employeeShifts[name] || []) : [];
  for (var i = 0; i < shifts.length; i++) {
    if (shifts[i].day === day && shifts[i].block === block) return true;
  }
  return false;
}

function bestAssignableRunOnLocation_(name, group, ranges, loc, state, masterMap, rules) {
  var best = 0;
  for (var r = 0; r < ranges.length; r++) {
    var keys = timeKeysCoveredByRange_(group, ranges[r]);
    var kept = [];
    for (var k = 0; k < keys.length; k++) {
      var slot = findSlotForLocationAtTime_(group.slotsByTime[keys[k]] || [], loc);
      if (!slot || state.assigned[slot.slotId]) continue;
      if (hasTimeConflict(name, slot, null, state)) continue;
      if (!coachEligibleForClassType_(name, slot.classType, masterMap, state._classTypeRules, rules)) continue;
      kept.push(keys[k]);
    }
    var run = computeLongestContiguousRun_(kept);
    if (run > best) best = run;
  }
  return Math.min(best, MENTOR_FULL_SHIFT_TRAININGS_);
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

/**
 * Hard guard for the "no morning + evening on the same calendar day" rule.
 * Returns true when the coach is already assigned to the OPPOSITE block on
 * the same `day` (i.e. trying to add morning when they already have evening,
 * or vice-versa). Applies to ALL ranks — including Rank 1 — per the staff
 * rule "regardless of starting hour or breaks in the middle".
 *
 * Used as a hard skip in the main pass / prepass / suggestion logic;
 * the existing `wouldCreateBackToBackShift_` stays as the soft signal for
 * the cross-day "evening then next-day morning" case.
 */
function hasSameDayOppositeBlockShift_(name, day, block, state) {
  if (!day || !block) return false;
  var opposite = (block === 'בוקר') ? 'ערב' : (block === 'ערב') ? 'בוקר' : null;
  if (!opposite) return false;
  var shifts = state && state.employeeShifts ? (state.employeeShifts[name] || []) : [];
  for (var i = 0; i < shifts.length; i++) {
    if (shifts[i].day === day && shifts[i].block === opposite) return true;
  }
  return false;
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

    // Weighted shifts: 2 trainings = 0.5, 3+ trainings = 1.
    var weighted = countWeightedShiftsFromTrainings_(trainings);
    var totalHours = 0;
    for (var sh = 0; sh < trainings.length; sh++) {
      var t = trainings[sh];
      totalHours += t.durationHours || 0;
    }

    employeeStats[empNames[e]] = {
      name: empNames[e],
      rank: emp.rank,
      shiftsCount: weighted.total,
      shiftTarget: getShiftTarget(empNames[e], masterMap, availability, rules),
      morningCount: weighted.morning,
      eveningCount: weighted.evening,
      trainingsCount: trainings.length,
      totalHours: totalHours
    };
  }
  return {
    assignments: state.assigned,
    warnings: state.warnings || [],
    employeeStats: employeeStats,
    passLog: state.passLog || [],
    globalReviewLog: state.globalReviewLog || []
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
    var count = countAssignedShifts_(names[i], state);
    if (count < target) total += (target - count);
  }
  return total;
}

function getGlobalReviewWeight_(rules, key, fallback) {
  var v = rules && rules[key] != null ? parseFloat(rules[key]) : fallback;
  return isNaN(v) ? fallback : v;
}

function scoreWeek_(slots, state, masterMap, availability, rules) {
  var redCells = 0;
  for (var s = 0; s < slots.length; s++) {
    if (slots[s].inactive) continue;
    var asgn = state.assigned[slots[s].slotId];
    if (asgn && asgn.unfilled) redCells++;
  }

  var rank1Under = 0;
  var rank2Under = 0;
  var rank3PlusZero = 0;
  var sumGap = 0;
  var names = Object.keys(masterMap);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (!hasSubmittedAnyAvailability_(name, availability)) continue;
    var emp = masterMap[name];
    var rank = normalizeMentorRank_(emp.rank);
    var target = getShiftTarget(name, masterMap, availability, rules);
    if (target <= 0) continue;
    var assigned = countAssignedShifts_(name, state);
    var gap = target - assigned;
    if (gap > 0.01) {
      sumGap += gap;
      if (rank === CONFIG.ranks.best) rank1Under += gap;
      else if (rank === 2) rank2Under += gap;
    }
    if (rank >= 3 && assigned <= 0) rank3PlusZero++;
  }

  // Partial clusters = (day, block, net) blocks where a coach is taking some
  // cells but others stay red. Staff strongly prefer clean clusters: either
  // a full-coverage assignment or a fully-red cluster waiting for manual
  // intervention. Penalize each partial cluster heavily so the cleanup
  // operator (opCleanPartialClusters_) wins the score comparison.
  var partialClusterCount = buildPartialClusters_(slots, state).length;

  var total =
    getGlobalReviewWeight_(rules, 'global_review_rank1_weight', 10000) * rank1Under +
    getGlobalReviewWeight_(rules, 'global_review_rank2_weight', 1000) * rank2Under +
    getGlobalReviewWeight_(rules, 'global_review_rank3_zero_weight', 500) * rank3PlusZero +
    getGlobalReviewWeight_(rules, 'global_review_partial_cluster_weight', 250) * partialClusterCount +
    getGlobalReviewWeight_(rules, 'global_review_red_weight', 100) * redCells +
    getGlobalReviewWeight_(rules, 'global_review_gap_weight', 10) * sumGap;

  return {
    total: total,
    redCells: redCells,
    rank1Under: rank1Under,
    rank2Under: rank2Under,
    rank3PlusZero: rank3PlusZero,
    sumGap: sumGap,
    partialClusterCount: partialClusterCount
  };
}

function snapshotOptimizerState_(state) {
  return {
    assigned: JSON.parse(JSON.stringify(state.assigned || {})),
    employeeShifts: JSON.parse(JSON.stringify(state.employeeShifts || {})),
    warningsLength: state.warnings ? state.warnings.length : 0
  };
}

function restoreOptimizerState_(state, snapshot) {
  state.assigned = snapshot.assigned || {};
  state.employeeShifts = snapshot.employeeShifts || {};
  if (state.warnings && state.warnings.length > snapshot.warningsLength) {
    state.warnings.length = snapshot.warningsLength;
  }
}

function globalScheduleReview_(slots, availability, masterMap, rules, state) {
  var maxIter = parseInt((rules && rules.global_review_max_iterations) || 50, 10);
  if (isNaN(maxIter) || maxIter < 1) maxIter = 50;
  var score = scoreWeek_(slots, state, masterMap, availability, rules);
  state.globalReviewLog = [{ iter: 0, op: 'init', score: score }];

  var ops = [
    opFillRedWithUnderTargetCoach_,
    opSwapUnderTargetCoach_,
    opMoveDeadClusterToHungrySlots_,
    opCleanPartialClusters_
  ];

  for (var iter = 1; iter <= maxIter; iter++) {
    var improved = false;
    for (var oi = 0; oi < ops.length; oi++) {
      var snap = snapshotOptimizerState_(state);
      var before = score.total;
      var changed = ops[oi](slots, availability, masterMap, rules, state);
      if (!changed) {
        restoreOptimizerState_(state, snap);
        continue;
      }
      var after = scoreWeek_(slots, state, masterMap, availability, rules);
      if (after.total < before - 0.01) {
        score = after;
        state.globalReviewLog.push({ iter: iter, op: ops[oi].name, score: after });
        improved = true;
        break;
      }
      restoreOptimizerState_(state, snap);
    }
    if (!improved) {
      state.globalReviewLog.push({ iter: iter, op: 'no-op', score: score });
      break;
    }
  }
}

function opFillRedWithUnderTargetCoach_(slots, availability, masterMap, rules, state) {
  var clusters = buildUnfilledClusters_(slots, state);
  clusters.sort(function(a, b) {
    if (b.slots.length !== a.slots.length) return b.slots.length - a.slots.length;
    return dayOrder_(a.day) - dayOrder_(b.day);
  });

  for (var c = 0; c < clusters.length; c++) {
    var cluster = clusters[c];
    var clusterSlots = cluster.slots.slice(0, MENTOR_FULL_SHIFT_TRAININGS_);
    var candidates = rankActualClusterCandidates_(clusterSlots, availability, masterMap, rules, state);
    if (candidates.length) {
      var name = candidates[0].name;
      for (var s = 0; s < clusterSlots.length; s++) {
        assignEmployee(name, clusterSlots[s], masterMap, state);
      }
      state.warnings.push(
        '🔎 שיפור גלובלי: ' + name + ' שובץ/ה ב-' + cluster.day + ' ' +
        cluster.block + ' ' + (CONFIG.locationNames[cluster.location] || cluster.location) +
        ' במקום תאים אדומים.'
      );
      return true;
    }

    if (clusterSlots.length >= MENTOR_MIN_SHIFT_TRAININGS_ + 1) {
      var partialApplied = tryPartialFillRedClusterWithRehome_(
        clusterSlots, cluster, availability, masterMap, rules, state
      );
      if (partialApplied) return true;
    }
  }
  return false;
}

/**
 * Fallback for `opFillRedWithUnderTargetCoach_`: when no coach can cover
 * EVERY slot in a red cluster, try a partial cover — N-1 of N slots — and
 * re-home the single uncovered boundary slot to an inactive cell elsewhere
 * (extending an existing shift). The unmatched boundary cell becomes
 * "אין אימון", trading 1 red cell for N-1 fills + 1 extension. Returns
 * true iff a partial cover was applied.
 */
function tryPartialFillRedClusterWithRehome_(clusterSlots, cluster, availability, masterMap, rules, state) {
  if (!clusterSlots || clusterSlots.length < MENTOR_MIN_SHIFT_TRAININGS_ + 1) return false;

  var names = Object.keys(masterMap);
  var ranked = [];
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var emp = masterMap[name];
    if (!emp) continue;
    var target = getShiftTarget(name, masterMap, availability, rules);
    var current = countAssignedShifts_(name, state);
    if (target <= 0 || current >= target) continue;
    if (!hasSubmittedAnyAvailability_(name, availability)) continue;
    if (hasSameDayOppositeBlockShift_(name, clusterSlots[0].day, clusterSlots[0].block, state)) continue;

    var cover = [];
    var uncovered = [];
    for (var s = 0; s < clusterSlots.length; s++) {
      var slot = clusterSlots[s];
      if (!meetsLocationRestriction(emp, slot)) { cover = null; break; }
      if (hasTimeConflict(name, slot, null, state)) { cover = null; break; }
      if (isAvailableForSlot(name, slot, availability) &&
          coachEligibleForClassType_(name, slot.classType, masterMap, state._classTypeRules, rules)) {
        cover.push(slot);
      } else {
        uncovered.push(slot);
      }
    }
    if (!cover || !cover.length) continue;
    if (cover.length < MENTOR_MIN_SHIFT_TRAININGS_) continue;
    if (uncovered.length !== 1) continue;
    if (!isBoundaryPartialSwap_(clusterSlots.slice(), cover, uncovered)) continue;
    if (!canTakeClusterRespectingExistingBlock_(name, cover, state)) continue;

    var plan = buildRehomePlanForUncoveredSlots_(uncovered, state, availability, masterMap, rules);
    if (!plan) continue;

    ranked.push({
      name: name,
      rank: normalizeMentorRank_(emp.rank),
      gap: target - current,
      cover: cover,
      uncovered: uncovered,
      plan: plan
    });
  }

  if (!ranked.length) return false;
  ranked.sort(function(a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.gap !== b.gap) return b.gap - a.gap;
    return a.name.localeCompare(b.name, 'he');
  });

  var pick = ranked[0];
  applyRehomePlan_(pick.plan, masterMap, state);
  for (var k = 0; k < pick.cover.length; k++) {
    assignEmployee(pick.name, pick.cover[k], masterMap, state);
  }
  state.warnings.push(
    '🔎 שיפור גלובלי: ' + pick.name + ' שובץ/ה ב-' + cluster.day + ' ' +
    cluster.block + ' ' + (CONFIG.locationNames[cluster.location] || cluster.location) +
    ' (כיסוי חלקי) — תא הקצה הומר ל"אין אימון" והאימון הועבר למקום אחר.'
  );
  return true;
}

function opSwapUnderTargetCoach_(slots, availability, masterMap, rules, state) {
  var names = Object.keys(masterMap);
  names.sort(function(a, b) {
    var rA = normalizeMentorRank_(masterMap[a].rank);
    var rB = normalizeMentorRank_(masterMap[b].rank);
    if (rA !== rB) return rA - rB;
    var gapA = getShiftTarget(a, masterMap, availability, rules) - countAssignedShifts_(a, state);
    var gapB = getShiftTarget(b, masterMap, availability, rules) - countAssignedShifts_(b, state);
    if (gapA !== gapB) return gapB - gapA;
    return a.localeCompare(b, 'he');
  });

  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var target = getShiftTarget(name, masterMap, availability, rules);
    if (target <= 0 || countAssignedShifts_(name, state) >= target) continue;
    if (!hasSubmittedAnyAvailability_(name, availability)) continue;
    if (tryGiveOneShiftBySwap_(
      name, masterMap[name], slots, availability, masterMap, rules, state, false, {
        warningSuffix: ' — שיפור גלובלי של איזון השבוע.',
        allowRank1Requester: normalizeMentorRank_(masterMap[name].rank) === CONFIG.ranks.best,
        allowPartialRehome: true
      }
    )) {
      return true;
    }
  }
  return false;
}

/**
 * Zero-sum operator: when a red cluster is structurally unfillable (no
 * coach can cover it, and no boundary-partial-cover with rehome works
 * either), close those cells back to "אין אימון" and open the same number
 * of inactive cells elsewhere where at least one under-target coach can
 * actually be assigned. Preserves the weekly total class count requested
 * by the user.
 *
 * Drives the user's "you decide אין אימון but you still must hit the
 * 101 classes" rule. Disabled if `global_review_close_dead_clusters` is
 * FALSE in Rules.
 */
function opMoveDeadClusterToHungrySlots_(slots, availability, masterMap, rules, state) {
  if (rules && rules.global_review_close_dead_clusters === false) return false;
  var allSlots = state && state._allSlots ? state._allSlots : slots;

  var deadClusters = buildUnfilledClusters_(slots, state);
  deadClusters.sort(function(a, b) {
    if (b.slots.length !== a.slots.length) return b.slots.length - a.slots.length;
    return dayOrder_(a.day) - dayOrder_(b.day);
  });

  for (var c = 0; c < deadClusters.length; c++) {
    var cluster = deadClusters[c];
    var deadSlots = cluster.slots.slice();
    if (deadSlots.length < MENTOR_MIN_SHIFT_TRAININGS_) continue;

    // Skip if any coach (full or partial) can take this cluster — let the
    // other operators handle those cases. We're only interested in the
    // genuinely unfillable remainder.
    var fullCands = rankActualClusterCandidates_(
      deadSlots.slice(0, MENTOR_FULL_SHIFT_TRAININGS_),
      availability, masterMap, rules, state
    );
    if (fullCands.length) continue;
    if (hasPartialFillCandidate_(deadSlots, availability, masterMap, rules, state)) continue;

    var move = findHungryInactiveDestination_(
      deadSlots.length, allSlots, availability, masterMap, rules, state
    );
    if (!move) continue;

    applyDeadToHungryMove_(deadSlots, move, slots, masterMap, state, cluster);
    return true;
  }
  return false;
}

/**
 * Cheap check: would `tryPartialFillRedClusterWithRehome_` accept any
 * coach for `clusterSlots`? Avoids running the operator's actual mutation
 * path — just probes whether a valid (coach, plan) pair exists.
 */
function hasPartialFillCandidate_(clusterSlots, availability, masterMap, rules, state) {
  if (!clusterSlots || clusterSlots.length < MENTOR_MIN_SHIFT_TRAININGS_ + 1) return false;
  var names = Object.keys(masterMap);
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var emp = masterMap[name];
    if (!emp) continue;
    var target = getShiftTarget(name, masterMap, availability, rules);
    var current = countAssignedShifts_(name, state);
    if (target <= 0 || current >= target) continue;
    if (!hasSubmittedAnyAvailability_(name, availability)) continue;
    if (hasSameDayOppositeBlockShift_(name, clusterSlots[0].day, clusterSlots[0].block, state)) continue;

    var cover = [];
    var uncovered = [];
    var hardBlock = false;
    for (var s = 0; s < clusterSlots.length; s++) {
      var slot = clusterSlots[s];
      if (!meetsLocationRestriction(emp, slot) || hasTimeConflict(name, slot, null, state)) {
        hardBlock = true;
        break;
      }
      if (isAvailableForSlot(name, slot, availability) &&
          coachEligibleForClassType_(name, slot.classType, masterMap, state._classTypeRules, rules)) {
        cover.push(slot);
      } else {
        uncovered.push(slot);
      }
    }
    if (hardBlock) continue;
    if (cover.length < MENTOR_MIN_SHIFT_TRAININGS_ || uncovered.length !== 1) continue;
    if (!isBoundaryPartialSwap_(clusterSlots.slice(), cover, uncovered)) continue;
    if (!canTakeClusterRespectingExistingBlock_(name, cover, state)) continue;
    var plan = buildRehomePlanForUncoveredSlots_(uncovered, state, availability, masterMap, rules);
    if (plan) return true;
  }
  return false;
}

/**
 * Find a contiguous run of inactive slots large enough to absorb `needed`
 * cells, where at least one under-target coach can be fully assigned to
 * the (newly active) destination cluster. Returns `{destSlots, coach}` or
 * null if no such hungry cluster exists.
 *
 * "Hungry" = inactive cells in a (day, block, location) where the
 * activated cluster would yield a coach who currently has gap > 0.
 */
function findHungryInactiveDestination_(needed, allSlots, availability, masterMap, rules, state) {
  if (!needed || needed < MENTOR_MIN_SHIFT_TRAININGS_) return null;
  var inactiveClusters = buildInactiveClusters_(allSlots, state);

  var bestMove = null;
  var bestKey = null;

  for (var i = 0; i < inactiveClusters.length; i++) {
    var ic = inactiveClusters[i];
    if (ic.slots.length < needed) continue;
    var dest = ic.slots.slice(0, needed);
    var cands = rankActualClusterCandidates_(dest, availability, masterMap, rules, state);
    if (!cands.length) continue;
    var top = cands[0];
    // Prefer destinations whose top candidate has bigger gap and lower (better) rank.
    var key = [-top.gap, top.rank, dayOrder_(ic.day)];
    if (!bestKey || compareKey_(key, bestKey) < 0) {
      bestKey = key;
      bestMove = { destSlots: dest, coach: top.name };
    }
  }
  return bestMove;
}

function compareKey_(a, b) {
  for (var i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Build clusters of contiguous INACTIVE slots, grouped by (day, block,
 * location). Mirror of `buildUnfilledClusters_` but on inactive cells.
 */
function buildInactiveClusters_(allSlots, state) {
  var groups = {};
  for (var i = 0; i < allSlots.length; i++) {
    var slot = allSlots[i];
    if (!slot || !slot.inactive || slot.block === 'מנהל') continue;
    var asgn = state.assigned[slot.slotId];
    if (asgn && !asgn.unfilled && !asgn.inactiveRehomed) continue;
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
          day: current[0].day, block: current[0].block,
          location: current[0].location, slots: current
        });
        current = [arr[j]];
      }
    }
    clusters.push({
      day: current[0].day, block: current[0].block,
      location: current[0].location, slots: current
    });
  }
  return clusters;
}

function applyDeadToHungryMove_(deadSlots, move, slots, masterMap, state, cluster) {
  // Close every dead slot and activate the matched destination slots,
  // copying class types over so the new slot inherits the moved class.
  for (var i = 0; i < deadSlots.length; i++) {
    var src = deadSlots[i];
    var dst = move.destSlots[i];

    dst.classType = src.classType || dst.classType || '';
    dst.inactive = false;
    src.inactive = true;
    src.rehomedToSlotId = dst.slotId;
    src.rehomedToCoach = move.coach;

    state.assigned[src.slotId] = {
      name: '',
      unfilled: true,
      inactiveRehomed: true,
      note: 'הקלאסטר נסגר אוטומטית — האימון הועבר ל-' + dst.day + ' ' + dst.block + '.'
    };
    delete state.assigned[dst.slotId];
    // Make the new active slot visible to subsequent global-review ops.
    if (slots.indexOf(dst) < 0) slots.push(dst);
    assignEmployee(move.coach, dst, masterMap, state);
  }
  var srcLabel = (CONFIG.locationNames[cluster.location] || cluster.location);
  var dstLabel = (CONFIG.locationNames[move.destSlots[0].location] || move.destSlots[0].location);
  state.warnings.push(
    '🔎 שיפור גלובלי: ' + deadSlots.length + ' אימונים הועברו מ-' +
    cluster.day + ' ' + cluster.block + ' ' + srcLabel +
    ' (קלאסטר אדום לא בר-שיבוץ) ל-' + move.destSlots[0].day + ' ' + move.destSlots[0].block +
    ' ' + dstLabel + ' — ' + move.coach + ' שובץ/ה שם.'
  );
}

/**
 * Cleanup operator: any (day, block, net) opening where a coach took
 * SOME cells but others are red is a "partial cluster". Staff strongly
 * prefer either a full green block or a fully red block — never mixed.
 *
 * For each partial cluster this op tries, in order:
 *   1. **Upgrade**: find a coach who can cover the WHOLE cluster (under
 *      target, not already in a same-day-opposite-block shift, etc.). If
 *      found, displace the current partial coach(es), assign the new coach
 *      to every cell.
 *   2. **Rehome reds**: move the red cells out to inactive slots elsewhere
 *      that extend an existing shift, turning the source cells into
 *      "אין אימון" and growing some other coach's shift by the same count.
 *      The cluster shrinks to a clean green block.
 *   3. **Revert**: un-assign the partial coach(es). The cluster becomes
 *      fully red — manual override needed. Guarded so we never strip a
 *      Rank 1 coach or drop someone to 0 shifts.
 *
 * The partial-cluster term in `scoreWeek_` ensures each successful run
 * lowers the global score, so the standard global-review loop accepts it.
 */
function opCleanPartialClusters_(slots, availability, masterMap, rules, state) {
  if (rules && rules.clean_partial_clusters === false) return false;

  var partials = buildPartialClusters_(slots, state);
  // Process larger reds first — they have higher visual impact.
  partials.sort(function(a, b) { return b.redSlots.length - a.redSlots.length; });

  for (var p = 0; p < partials.length; p++) {
    var partial = partials[p];

    // 1) Try upgrade: full-coverage candidate to displace partial coach(es).
    if (tryUpgradePartialCluster_(partial, availability, masterMap, rules, state)) {
      return true;
    }

    // 2) Try rehome the red cells.
    var rehomePlan = buildRehomePlanForUncoveredSlots_(
      partial.redSlots, state, availability, masterMap, rules
    );
    if (rehomePlan) {
      applyRehomePlan_(rehomePlan, masterMap, state);
      state.warnings.push(
        '🔎 שיפור גלובלי: ' + partial.day + ' ' + partial.block + ' ' +
        (CONFIG.locationNames[partial.location] || partial.location) +
        ': ' + partial.redSlots.length + ' תאים אדומים הומרו ל"אין אימון", ' +
        'האימון הועבר למשמרת קיימת אחרת. הקלאסטר נשאר ירוק נקי.'
      );
      return true;
    }

    // 3) Revert: clear the partial coach(es), leave full cluster red.
    if (rules && rules.revert_partial_when_no_rehome === false) continue;
    var revertResult = tryRevertPartialAssignment_(
      partial, state, masterMap, availability, rules
    );
    if (revertResult.reverted) {
      state.warnings.push(
        '🔎 שיפור גלובלי: ' + partial.day + ' ' + partial.block + ' ' +
        (CONFIG.locationNames[partial.location] || partial.location) +
        ': משמרת חלקית של ' + revertResult.coaches.join(', ') +
        ' בוטלה — אין מאמן לכיסוי מלא ולא נמצא יעד להעברת התאים האדומים. ' +
        'נדרש שיבוץ ידני לקלאסטר.'
      );
      return true;
    }
  }
  return false;
}

/**
 * Build clusters of contiguous ACTIVE slots grouped by (day, block,
 * location), each with a green/red split per slot. Returns only the
 * clusters with at least one green AND at least one red (i.e. true
 * partial clusters). Manager and inactive cells are skipped.
 */
function buildPartialClusters_(slots, state) {
  var groups = {};
  for (var i = 0; i < slots.length; i++) {
    var slot = slots[i];
    if (!slot || slot.inactive) continue;
    if (slot.block === 'מנהל') continue;
    var key = slot.day + '|' + slot.block + '|' + slot.location;
    (groups[key] = groups[key] || []).push(slot);
  }

  var clusters = [];
  var keys = Object.keys(groups);
  for (var k = 0; k < keys.length; k++) {
    var arr = groups[keys[k]];
    arr.sort(function(a, b) { return a.startTime - b.startTime; });

    var current = [arr[0]];
    for (var j = 1; j < arr.length; j++) {
      var gap = arr[j].startTime - arr[j - 1].endTime;
      if (gap >= -0.01 && gap <= 0.5) {
        current.push(arr[j]);
      } else {
        finalizePartialCluster_(current, state, clusters);
        current = [arr[j]];
      }
    }
    finalizePartialCluster_(current, state, clusters);
  }

  var out = [];
  for (var c = 0; c < clusters.length; c++) {
    if (clusters[c].greenSlots.length > 0 && clusters[c].redSlots.length > 0) {
      out.push(clusters[c]);
    }
  }
  return out;
}

function finalizePartialCluster_(slotsArr, state, outArr) {
  if (!slotsArr || !slotsArr.length) return;
  var green = [];
  var red = [];
  for (var i = 0; i < slotsArr.length; i++) {
    var asgn = state.assigned[slotsArr[i].slotId];
    if (!asgn || asgn.unfilled) {
      red.push(slotsArr[i]);
    } else if (asgn.managerSlot) {
      return; // Manager cluster — never touch.
    } else {
      green.push(slotsArr[i]);
    }
  }
  outArr.push({
    day: slotsArr[0].day,
    block: slotsArr[0].block,
    location: slotsArr[0].location,
    slots: slotsArr.slice(),
    greenSlots: green,
    redSlots: red
  });
}

/**
 * Step 1 of `opCleanPartialClusters_`: try to find a single under-target
 * coach who can cover the ENTIRE partial cluster (every cell). If found,
 * unassign the current partial coach(es) and assign the new coach.
 * Returns true if applied.
 */
function tryUpgradePartialCluster_(partial, availability, masterMap, rules, state) {
  var clusterSlots = partial.slots;
  if (!clusterSlots || clusterSlots.length < MENTOR_MIN_SHIFT_TRAININGS_) return false;

  // Collect the coaches currently in the cluster so we can exclude them
  // (they're already taking part of it — not a real upgrade).
  var currentCoaches = {};
  for (var g = 0; g < partial.greenSlots.length; g++) {
    var asgn = state.assigned[partial.greenSlots[g].slotId];
    if (asgn && asgn.name) currentCoaches[asgn.name] = true;
  }

  var names = Object.keys(masterMap);
  var ranked = [];
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (currentCoaches[name]) continue;
    var emp = masterMap[name];
    if (!emp) continue;
    var target = getShiftTarget(name, masterMap, availability, rules);
    var current = countAssignedShifts_(name, state);
    if (target <= 0 || current >= target) continue;
    if (!hasSubmittedAnyAvailability_(name, availability)) continue;
    if (hasSameDayOppositeBlockShift_(name, clusterSlots[0].day, clusterSlots[0].block, state)) continue;

    var canCoverAll = true;
    for (var s = 0; s < clusterSlots.length; s++) {
      var slot = clusterSlots[s];
      if (!meetsLocationRestriction(emp, slot)) { canCoverAll = false; break; }
      if (!isAvailableForSlot(name, slot, availability)) { canCoverAll = false; break; }
      // `hasTimeConflict` looks at the candidate's OWN shifts only — the
      // current partial coach(es) live in their own employeeShifts list,
      // so they don't block us. We just need to avoid the candidate's
      // existing shifts on the same day/block elsewhere.
      if (hasTimeConflict(name, slot, null, state)) { canCoverAll = false; break; }
      if (!coachEligibleForClassType_(name, slot.classType, masterMap, state._classTypeRules, rules)) {
        canCoverAll = false; break;
      }
    }
    if (!canCoverAll) continue;
    if (!canTakeClusterRespectingExistingBlock_(name, clusterSlots, state)) continue;

    ranked.push({
      name: name,
      rank: normalizeMentorRank_(emp.rank),
      gap: target - current
    });
  }
  if (!ranked.length) return false;

  ranked.sort(function(a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.gap !== b.gap) return b.gap - a.gap;
    return a.name.localeCompare(b.name, 'he');
  });

  var winner = ranked[0].name;
  // Evict current coaches from the green cells.
  for (var g2 = 0; g2 < partial.greenSlots.length; g2++) {
    unassignSlotFromCoach_(partial.greenSlots[g2], state);
  }
  // Assign the new coach to every cell.
  for (var s2 = 0; s2 < clusterSlots.length; s2++) {
    assignEmployee(winner, clusterSlots[s2], masterMap, state);
  }
  state.warnings.push(
    '🔎 שיפור גלובלי: ' + partial.day + ' ' + partial.block + ' ' +
    (CONFIG.locationNames[partial.location] || partial.location) +
    ': קלאסטר חלקי שודרג — ' + winner + ' תופס את כל ' + clusterSlots.length +
    ' התאים במקום משמרת חלקית.'
  );
  return true;
}

/**
 * Step 3 of `opCleanPartialClusters_`: clear out the partial coach(es) on
 * `partial.greenSlots`, marking every cell of the cluster as red so it
 * waits for manual intervention. Refuses to revert when:
 *   - Any partial coach is Rank 1 (must hit target, never strip).
 *   - The revert would leave a Rank 3+ coach with zero shifts (violates
 *     `enforce_min_shift_rank3plus`).
 * Returns `{reverted, coaches}` — `reverted=false` if any guard fired.
 */
function tryRevertPartialAssignment_(partial, state, masterMap, availability, rules) {
  var byCoach = {};
  for (var i = 0; i < partial.greenSlots.length; i++) {
    var slot = partial.greenSlots[i];
    var asgn = state.assigned[slot.slotId];
    if (!asgn || !asgn.name) continue;
    (byCoach[asgn.name] = byCoach[asgn.name] || []).push(slot);
  }
  var coachNames = Object.keys(byCoach);
  if (!coachNames.length) return { reverted: false };

  var enforceMin = !rules || rules.enforce_min_shift_rank3plus !== false;
  for (var cn = 0; cn < coachNames.length; cn++) {
    var name = coachNames[cn];
    var emp = masterMap[name];
    if (!emp) return { reverted: false };
    var rank = normalizeMentorRank_(emp.rank);
    if (rank === CONFIG.ranks.best) return { reverted: false };
    var totalShifts = countAssignedShifts_(name, state);
    var removed = shiftWeightForTrainingCount_(byCoach[name].length);
    if (enforceMin && rank >= 3 && totalShifts - removed < 0.99) {
      return { reverted: false };
    }
  }

  for (var cn2 = 0; cn2 < coachNames.length; cn2++) {
    var n = coachNames[cn2];
    var slotList = byCoach[n];
    var slotIdSet = {};
    for (var s = 0; s < slotList.length; s++) {
      slotIdSet[slotList[s].slotId] = true;
      state.assigned[slotList[s].slotId] = { name: '', unfilled: true };
    }
    if (state.employeeShifts[n]) {
      state.employeeShifts[n] = state.employeeShifts[n].filter(function(sh) {
        return !slotIdSet[sh.slotId];
      });
    }
  }
  return { reverted: true, coaches: coachNames };
}

/**
 * Drop the slot's current assignment from the state. Used by the partial-
 * cluster upgrade path to evict the current coach before assigning the
 * full-coverage replacement.
 */
function unassignSlotFromCoach_(slot, state) {
  var asgn = state.assigned[slot.slotId];
  if (!asgn || !asgn.name) return;
  var name = asgn.name;
  if (state.employeeShifts[name]) {
    state.employeeShifts[name] = state.employeeShifts[name].filter(function(sh) {
      return sh.slotId !== slot.slotId;
    });
  }
  state.assigned[slot.slotId] = { name: '', unfilled: true };
}

function rankActualClusterCandidates_(clusterSlots, availability, masterMap, rules, state) {
  var out = [];
  if (!clusterSlots || !clusterSlots.length) return out;
  var names = Object.keys(masterMap);
  var day = clusterSlots[0].day;
  var block = clusterSlots[0].block;
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var emp = masterMap[name];
    var target = getShiftTarget(name, masterMap, availability, rules);
    var current = countAssignedShifts_(name, state);
    if (target <= 0 || current >= target) continue;
    if (hasSameDayOppositeBlockShift_(name, day, block, state)) continue;
    if (!canTakeClusterRespectingExistingBlock_(name, clusterSlots, state)) continue;

    var ok = true;
    for (var s = 0; s < clusterSlots.length; s++) {
      var slot = clusterSlots[s];
      if (!isAvailableForSlot(name, slot, availability)) { ok = false; break; }
      if (!meetsLocationRestriction(emp, slot)) { ok = false; break; }
      if (hasTimeConflict(name, slot, null, state)) { ok = false; break; }
      if (!coachEligibleForClassType_(name, slot.classType, masterMap, state._classTypeRules, rules)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    out.push({
      name: name,
      rank: normalizeMentorRank_(emp.rank),
      gap: target - current
    });
  }

  out.sort(function(a, b) {
    if (a.rank !== b.rank) return a.rank - b.rank;
    if (a.gap !== b.gap) return b.gap - a.gap;
    return a.name.localeCompare(b.name, 'he');
  });
  return out;
}

function canTakeClusterRespectingExistingBlock_(name, clusterSlots, state) {
  var existing = state.employeeShifts[name] || [];
  var sameBlock = [];
  var first = clusterSlots[0];
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].day === first.day && existing[i].block === first.block) sameBlock.push(existing[i]);
  }
  if (!sameBlock.length) return clusterSlots.length >= MENTOR_MIN_SHIFT_TRAININGS_;

  sameBlock.sort(function(a, b) { return a.startTime - b.startTime; });
  for (var s = 0; s < sameBlock.length; s++) {
    if (sameBlock[s].location !== first.location) return false;
  }
  var existingStart = sameBlock[0].startTime;
  var existingEnd = sameBlock[sameBlock.length - 1].endTime;
  var clusterStart = clusterSlots[0].startTime;
  var clusterEnd = clusterSlots[clusterSlots.length - 1].endTime;
  return Math.abs(existingEnd - clusterStart) <= 0.5 ||
    Math.abs(clusterEnd - existingStart) <= 0.5;
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

    var currentCount = countAssignedShifts_(name, state);
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

  absorbSingletonUnfilledSlots_(slots, availability, masterMap, rules, state);

  // Anything still unfilled after the cluster pass: emit a per-slot warning
  // so the staff sees exactly which cells need a manual call.
  for (var s = 0; s < slots.length; s++) {
    var slot = slots[s];
    var asgn = state.assigned[slot.slotId];
    if (!asgn || !asgn.unfilled) continue;
    if (asgn.singletonWarning) continue;
    state.warnings.push(
      formatSlotHebrew(slot.slotId) + ' — לא נמצא עובד זמין למשמרת הזו.\n' +
      '   💡 כל העובדים כבר תפוסים, הגיעו למכסה, או לא סימנו זמינות.'
    );
  }
}

function absorbSingletonUnfilledSlots_(slots, availability, masterMap, rules, state) {
  var clusters = buildUnfilledClusters_(slots, state);
  for (var c = 0; c < clusters.length; c++) {
    var cluster = clusters[c];
    if (!cluster || cluster.slots.length !== 1) continue;
    var slot = cluster.slots[0];
    var extension = findAdjacentExtensionCandidate_(slot, slots, availability, masterMap, rules, state);
    if (extension) {
      assignSingletonExtensionSuggestion_(slot, extension.name, masterMap, state);
    } else {
      var asgn = state.assigned[slot.slotId];
      if (asgn) {
        asgn.singletonWarning = true;
        asgn.note = 'תא בודד אדום: אין מאמן סמוך זמין להאריך משמרת. צריך פנייה ידנית.';
      }
      state.warnings.push(
        formatSlotHebrew(slot.slotId) +
        ' — תא בודד אדום: אין מאמן סמוך זמין להאריך משמרת. צריך פנייה ידנית.'
      );
    }
  }
}

function findAdjacentExtensionCandidate_(slot, slots, availability, masterMap, rules, state) {
  var neighbors = [];
  for (var i = 0; i < slots.length; i++) {
    var other = slots[i];
    if (other.slotId === slot.slotId) continue;
    if (other.day !== slot.day || other.block !== slot.block || other.location !== slot.location) continue;
    var adjacentBefore = Math.abs(other.endTime - slot.startTime) <= 0.5;
    var adjacentAfter = Math.abs(slot.endTime - other.startTime) <= 0.5;
    if (!adjacentBefore && !adjacentAfter) continue;
    var asgn = state.assigned[other.slotId];
    if (!asgn || !asgn.name || asgn.unfilled || asgn.managerSlot) continue;
    neighbors.push({
      name: asgn.name,
      distance: Math.min(Math.abs(other.endTime - slot.startTime), Math.abs(slot.endTime - other.startTime))
    });
  }

  neighbors.sort(function(a, b) {
    if (a.distance !== b.distance) return a.distance - b.distance;
    var aGap = getShiftTarget(a.name, masterMap, availability, rules) - countAssignedShifts_(a.name, state);
    var bGap = getShiftTarget(b.name, masterMap, availability, rules) - countAssignedShifts_(b.name, state);
    if (aGap !== bGap) return bGap - aGap;
    return a.name.localeCompare(b.name, 'he');
  });

  var classTypeRules = state && state._classTypeRules;
  for (var n = 0; n < neighbors.length; n++) {
    var name = neighbors[n].name;
    var emp = masterMap[name];
    if (!emp) continue;
    var dayRanges = availability && availability[name] ? availability[name][slot.day] : null;
    if (!dayRanges || !coachHasBlockAvailability_(dayRanges, slot.block)) continue;
    if (!isAvailableForSlot(name, slot, availability)) continue;
    if (!meetsLocationRestriction(emp, slot)) continue;
    if (!coachEligibleForClassType_(name, slot.classType, masterMap, classTypeRules, rules)) continue;
    return neighbors[n];
  }
  return null;
}

function assignSingletonExtensionSuggestion_(slot, name, masterMap, state) {
  var emp = masterMap[name];
  var note = '💙 הצעת המערכת להארכת משמרת קיימת\n\n' +
    name + ' כבר משובץ/ת באותה רשת ובאותו חצי יום, והזמינות שלו/ה מכסה גם את ' +
    formatHourLabelHe_(slot.startTime) + '–' + formatHourLabelHe_(slot.endTime) + '.\n' +
    'צריך לאשר מול המאמן/ת.';

  state.assigned[slot.slotId] = {
    name: name,
    rank: emp ? emp.rank : 0,
    unfilled: false,
    suggested: true,
    note: note
  };
  if (!state.employeeShifts[name]) state.employeeShifts[name] = [];
  state.employeeShifts[name].push({
    slotId: slot.slotId,
    location: slot.location,
    day: slot.day,
    block: slot.block,
    startTime: slot.startTime,
    endTime: slot.endTime,
    durationHours: slot.durationHours
  });
  state.warnings.push(
    formatSlotHebrew(slot.slotId) + ' — 💙 הצעה להאריך את המשמרת של ' + name + '.'
  );
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
    if (slot.inactive) continue;
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

    // Respect "לא זמין": never suggest a coach for a day they explicitly
    // marked as not available. Suggestions are still allowed on days they
    // submitted *some* range, even outside that range (e.g. fill 11:00–12:00
    // for a coach who submitted 7:00–11:00 on the same day).
    var dayRanges = availability && availability[name]
      ? availability[name][cluster.day]
      : null;
    if (!dayRanges || dayRanges.length === 0) continue;
    if (!coachHasBlockAvailability_(dayRanges, cluster.block)) continue;

    var existing = state.employeeShifts[name] || [];
    var alreadyInBlock = false;
    for (var s = 0; s < existing.length; s++) {
      if (existing[s].day === cluster.day && existing[s].block === cluster.block) {
        alreadyInBlock = true;
        break;
      }
    }
    if (alreadyInBlock) continue;

    // Hard: never suggest morning+evening on the same calendar day.
    if (hasSameDayOppositeBlockShift_(name, cluster.day, cluster.block, state)) continue;

    var currentCount = countAssignedShifts_(name, state);
    var maxShifts = getEmployeeMaxShifts_(rules);

    var target = getShiftTarget(name, masterMap, availability, rules);
    if (target <= 0) continue;
    if (currentCount >= target) continue; // Do not suggest coaches beyond their target.
    if (currentCount + 1 > maxShifts) continue;

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

