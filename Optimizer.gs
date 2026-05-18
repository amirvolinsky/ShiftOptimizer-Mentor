/**
 * Core optimization engine for weekly shift scheduling (Mentor).
 *
 * Two-phase greedy algorithm:
 *   Phase 1: Assign priority staff (IsPriority) to required MinShifts
 *   Phase 2: Fill remaining slots by fairness (under target first), not cost
 *
 * Cross-slot constraints enforced:
 *   - No double booking (same person, overlapping time, any location)
 *   - No juniors alone (Rank ≤ 2 needs Rank ≥ 3 overlap at same location)
 *   - Morning score minimum (א=1, ב=2, ג=3, ד=4, target ≥ 7 per block)
 *   - Location restrictions per employee
 *   - Max shifts per week
 *   - No rest time requirement (confirmed: closer can open next day)
 */

/**
 * Compute dynamic shift target for an employee.
 * Non-global: target = (days with availability) - 1, minimum 1.
 * Global: use their minShifts (typically 5).
 * This gives the scheduler breathing room while meeting employee expectations.
 */
var SHIFT_TARGET_RULES_CACHE_ = null;
function getShiftTarget(name, masterMap, availability, rules) {
  var emp = masterMap[name];
  if (!emp) return 0;

  // Optional: allow callers to pass rules; otherwise load once (cached).
  if (!rules) {
    if (!SHIFT_TARGET_RULES_CACHE_) SHIFT_TARGET_RULES_CACHE_ = loadRules();
    rules = SHIFT_TARGET_RULES_CACHE_;
  }

  var defaultTarget = Number(rules.default_target_shifts_per_week || 5);
  if (defaultTarget <= 0) defaultTarget = 5;

  if (emp.isGlobal) return emp.minShifts || defaultTarget;

  if (!availability || !availability[name]) return 0;

  var avail = availability[name];
  var daysWithAvail = 0;
  var days = Object.keys(avail);
  for (var d = 0; d < days.length; d++) {
    if (avail[days[d]] && avail[days[d]].length > 0) daysWithAvail++;
  }

  // Soft target: availability-1 but capped by defaultTarget (e.g. 7 days => 6, capped to 5).
  var dyn = Math.max(1, daysWithAvail - 1);
  return Math.min(dyn, defaultTarget);
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
  var state = {
    assigned: {},
    employeeShifts: {},
    warnings: [],
    _slotMap: buildSlotMap_(slots),
    optimizationMode: optimizationMode
  };

  var empNames = Object.keys(masterMap);
  for (var i = 0; i < empNames.length; i++) {
    state.employeeShifts[empNames[i]] = [];
  }

  var globals = [];
  var regular = [];
  for (var s = 0; s < slots.length; s++) {
    slots[s]._index = s;
    regular.push(slots[s]);
  }

  for (var e = 0; e < empNames.length; e++) {
    if (masterMap[empNames[e]].isGlobal) {
      globals.push(masterMap[empNames[e]]);
    }
  }

  // Phase 1: assign globals
  if (globals.length > 0) {
    assignGlobals(globals, slots, availability, masterMap, rules, state);
  }

  // Mark manager slots as pre-filled (not optimizable)
  for (var s = 0; s < slots.length; s++) {
    if (slots[s].block === 'מנהל') {
      state.assigned[slots[s].slotId] = {
        name: 'מנהל', rank: 3, unfilled: false, managerSlot: true
      };
    }
  }

  // Phase 2: fill remaining slots by fairness
  var unfilledSlots = [];
  for (var s = 0; s < slots.length; s++) {
    if (!state.assigned[slots[s].slotId]) {
      unfilledSlots.push(slots[s]);
    }
  }

  unfilledSlots.sort(function(a, b) {
    var aCount = countEligible(a, availability, masterMap, rules, state);
    var bCount = countEligible(b, availability, masterMap, rules, state);
    return aCount - bCount;
  });

  for (var s = 0; s < unfilledSlots.length; s++) {
    var slot = unfilledSlots[s];
    if (state.assigned[slot.slotId]) continue;

    var candidate = pickBestCandidate_(slot, availability, masterMap, rules, state);
    if (candidate) {
      assignEmployee(candidate, slot, masterMap, state);
    } else {
      state.assigned[slot.slotId] = {
        name: '', unfilled: true,
        note: 'לא נמצא עובד זמין.\nכל העובדים תפוסים, הגיעו למכסה, או לא סימנו זמינות.'
      };
    }
  }

  // Phase 3: suggest employees for unfilled slots
  suggestForUnfilled(slots, availability, masterMap, rules, state, optimizationMode);

  // Phase 3b: verify no-juniors-alone and try to fix violations
  if (rules.no_juniors_alone) {
    fixJuniorViolations(slots, availability, masterMap, rules, state);
  }

  return buildResultFromState_(state, masterMap, availability, rules);
}

/**
 * Build optimizer result object from assignment state.
 */
function buildResultFromState_(state, masterMap, availability, rules) {
  var empNames = Object.keys(masterMap);
  var employeeStats = {};
  for (var e = 0; e < empNames.length; e++) {
    var emp = masterMap[empNames[e]];
    var shifts = state.employeeShifts[empNames[e]] || [];
    var totalHours = 0;
    var morningCount = 0;
    var eveningCount = 0;
    for (var sh = 0; sh < shifts.length; sh++) {
      totalHours += shifts[sh].durationHours || 0;
      if (shifts[sh].block === 'בוקר') morningCount++;
      else if (shifts[sh].block === 'ערב') eveningCount++;
    }
    employeeStats[empNames[e]] = {
      name: empNames[e],
      rank: emp.rank,
      shiftsCount: shifts.length,
      shiftTarget: getShiftTarget(empNames[e], masterMap, availability, rules),
      morningCount: morningCount,
      eveningCount: eveningCount,
      totalHours: totalHours,
      isGlobal: emp.isGlobal,
      isPriority: emp.isPriority
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
    _slotMap: buildSlotMap_(slots)
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
      if (!meetsBlockRestriction_(emp, slot)) continue;
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
  var isMorning = opts.isMorning;

  if (opts.needMorePoints || opts.needAnySenior || opts.needRank4ForFriday) {
    if (empA.rank !== empB.rank) return empB.rank - empA.rank;
  }

  if (empA.isGlobal !== empB.isGlobal) {
    return empA.isGlobal ? -1 : 1;
  }

  if (isMorning && empA.rank === 4 && empB.rank !== 4) return -1;
  if (isMorning && empB.rank === 4 && empA.rank !== 4) return 1;

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

  var blockScore = getBlockScore(slot, state, masterMap);
  var minScore = getMinMorningScoreForLocation_(rules, slot.location);
  var isMorning = slot.block === 'בוקר';
  var needMorePoints = isMorning && minScore > 0 && blockScore < minScore;
  var slotMap = state._slotMap || {};
  var needAnySenior = rules.no_juniors_alone
    && !hasSeniorTimeCoverageForSlot_(slot, state.assigned, slotMap);

  var isFriday = slot.day === 'שישי';
  var needRank4ForFriday = isFriday && slot.endTime !== null && slot.endTime <= 14
    && !hasRank4InBlock_(slot, state, masterMap);

  var opts = {
    needMorePoints: needMorePoints,
    needAnySenior: needAnySenior,
    needRank4ForFriday: needRank4ForFriday,
    slotIsMorning: (slot.block === 'בוקר'),
    slotIsEvening: (slot.block === 'ערב'),
    isMorning: isMorning
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

  for (var i = 0; i < empNames.length; i++) {
    var name = empNames[i];
    var emp = masterMap[name];

    if (!isAvailableForSlot(name, slot, availability)) continue;
    if (!meetsLocationRestriction(emp, slot)) continue;
    if (!meetsBlockRestriction_(emp, slot)) continue;
    if (hasTimeConflict(name, slot, null, state)) continue;

    var currentCount = (state.employeeShifts[name] || []).length;
    var maxShifts = emp.maxShifts || rules.max_shifts_per_week || 6;
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

  for (var i = 0; i < dayAvail.length; i++) {
    if (dayAvail[i] === slot.block) return true;
  }

  return false;
}

/**
 * Check if employee's location restriction allows this slot.
 */
function meetsLocationRestriction(emp, slot) {
  if (!emp.locationRestriction) return true;
  return emp.locationRestriction === slot.location;
}

/**
 * Check if employee's block restriction allows this slot.
 * e.g. blockRestriction = "בוקר" means only morning slots allowed.
 */
function meetsBlockRestriction_(emp, slot) {
  if (!emp.blockRestriction) return true;
  return emp.blockRestriction === slot.block;
}

/**
 * Check if assigning this employee to this slot would create a conflict.
 * Rule: one employee = one shift per day, at one location only.
 * Any existing assignment on the same day blocks a new one.
 */
function hasTimeConflict(name, newSlot, allSlots, state) {
  var shifts = state.employeeShifts[name] || [];

  for (var i = 0; i < shifts.length; i++) {
    var existing = shifts[i];
    if (existing.day !== newSlot.day) continue;
    return true;
  }

  return false;
}

/**
 * Minimum morning experience score for a location (from Rules sheet).
 * Keys: min_morning_score_<locationId> with lowercase id (e.g. min_morning_score_geula, min_morning_score_main).
 * Falls back to min_morning_score if unset.
 */
function getMinMorningScoreForLocation_(rules, location) {
  var loc = String(location || '').trim().toLowerCase();
  if (!loc) return rules.min_morning_score || 0;
  var key = 'min_morning_score_' + loc;
  var v = rules[key];
  if (v !== undefined && v !== null && String(v) !== '') return Number(v);
  return rules.min_morning_score || 0;
}

/**
 * Calculate the total experience score of assigned employees in a block.
 * Rank א(1)=1pt, ב(2)=2pts, ג(3)=3pts, ד(4)=4pts (ד = most senior).
 */
function getBlockScore(slot, state, masterMap) {
  var score = 0;
  var prefix = slot.location + '_' + slot.day + '_' + slot.block + '_';
  var allSlotIds = Object.keys(state.assigned);

  for (var i = 0; i < allSlotIds.length; i++) {
    if (allSlotIds[i].indexOf(prefix) !== 0) continue;
    var asgn = state.assigned[allSlotIds[i]];
    if (!asgn || asgn.unfilled || !asgn.name) continue;

    var emp = masterMap[asgn.name];
    if (emp) score += emp.rank;
  }

  return score;
}

/**
 * Check if there's a Rank 4 (ד, top tier) employee assigned to morning slots (endTime <= 14)
 * for the same location+day. Used for the Friday senior rule.
 */
function hasRank4InBlock_(slot, state, masterMap) {
  var prefix = slot.location + '_' + slot.day + '_' + slot.block + '_';
  var allSlotIds = Object.keys(state.assigned);
  for (var i = 0; i < allSlotIds.length; i++) {
    if (allSlotIds[i].indexOf(prefix) !== 0) continue;
    var asgn = state.assigned[allSlotIds[i]];
    if (!asgn || asgn.unfilled || !asgn.name) continue;
    var emp = masterMap[asgn.name];
    if (emp && emp.rank === 4) return true;
  }
  return false;
}

/** @deprecated use hasSeniorTimeCoverageForSlot_ — kept for any external refs */
function hasSeniorInBlock(slot, state, masterMap) {
  var slotMap = state._slotMap || {};
  return hasSeniorTimeCoverageForSlot_(slot, state.assigned, slotMap);
}

/**
 * Record an assignment in the state.
 */
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
 * Phase 3: For unfilled slots, suggest the best employee who didn't mark availability
 * but still has room under their RequestedShifts target.
 * Marks these as "suggested" (blue) -- not confirmed assignments.
 */
function suggestForUnfilled(slots, availability, masterMap, rules, state, optimizationMode) {
  optimizationMode = optimizationMode || state.optimizationMode || 'economical';
  var empNames = Object.keys(masterMap);

  for (var s = 0; s < slots.length; s++) {
    var slot = slots[s];
    var asgn = state.assigned[slot.slotId];
    if (!asgn || !asgn.unfilled) continue;

    var ranked = rankSuggestionCandidates_(slot, empNames, masterMap, rules, state, availability, optimizationMode);

    if (ranked.length > 0) {
      var bestCandidate = ranked[0].name;
      var emp = masterMap[bestCandidate];
      if (!state.employeeShifts[bestCandidate]) {
        state.employeeShifts[bestCandidate] = [];
      }
      state.employeeShifts[bestCandidate].push({
        slotId: slot.slotId,
        location: slot.location,
        day: slot.day,
        block: slot.block,
        startTime: slot.startTime,
        endTime: slot.endTime,
        durationHours: slot.durationHours
      });

      var afterCount = state.employeeShifts[bestCandidate].length;
      var availCount = countAvailableBlocks_(bestCandidate, availability, slots, emp);
      var dynTarget = getShiftTarget(bestCandidate, masterMap, availability, rules);
      var maxShifts = emp.maxShifts || rules.max_shifts_per_week || 6;

      var note = '💙 הצעת המערכת (לא שיבוץ מאושר)\n\n' +
        bestCandidate + ' לא סימן/ה זמינות למשמרת הזו.\n' +
        'יעד (ברירת מחדל 5, או זמינות-1): ' + dynTarget + ' משמרות בשבוע.\n' +
        'מקסימום שבועי (חריגה אפשרית לסגירת חורים): ' + maxShifts + '\n' +
        'הגיש/ה זמינות ל-' + availCount + ' משמרות.\n' +
        'סה"כ עם ההצעה: ' + afterCount + ' משמרות.\n\n' +
        'צריך לאשר מול ' + bestCandidate + '.';

      if (ranked.length > 1) {
        var alt = ranked[1];
        var altAvail = countAvailableBlocks_(alt.name, availability, slots, masterMap[alt.name]);
        var altCurrent = (state.employeeShifts[alt.name] || []).length;
        var altTarget = getShiftTarget(alt.name, masterMap, availability, rules);
        note += '\n\n🔄 חלופה: ' + alt.name +
          '\nיעד: ' + altTarget + ' משמרות' +
          ', הגיש/ה ' + altAvail +
          ', כרגע ' + altCurrent;
      }

      state.assigned[slot.slotId] = {
        name: bestCandidate,
        rank: emp.rank,
        unfilled: false,
        suggested: true,
        note: note
      };

      state.warnings.push(
        formatSlotHebrew(slot.slotId) + ' — 💙 הצעת המערכת (לא שיבוץ מאושר): ' + bestCandidate + '.\n' +
        '   💡 ' + bestCandidate + ' לא סימן/ה זמינות, יעד ' + dynTarget +
        ', הגיש/ה ' + availCount + ', סה"כ עם ההצעה: ' + afterCount + '. צריך אישור.'
      );
    } else {
      state.warnings.push(
        formatSlotHebrew(slot.slotId) + ' — לא נמצא עובד זמין למשמרת הזו.\n' +
        '   💡 כל העובדים כבר תפוסים, הגיעו למכסה, או לא סימנו זמינות.'
      );
    }
  }
}

/**
 * Rank suggestion candidates for an unfilled slot.
 * Mode-aware: fair/balanced prefer under-target; economical prefers cost.
 */
function rankSuggestionCandidates_(slot, empNames, masterMap, rules, state, availability, optimizationMode) {
  optimizationMode = optimizationMode || state.optimizationMode || 'economical';
  var candidates = [];

  for (var e = 0; e < empNames.length; e++) {
    var name = empNames[e];
    var emp = masterMap[name];

    if (emp.locationRestriction && emp.locationRestriction !== slot.location) continue;
    if (!meetsBlockRestriction_(emp, slot)) continue;
    if (hasTimeConflict(name, slot, null, state)) continue;

    var currentCount = (state.employeeShifts[name] || []).length;
    var maxShifts = emp.maxShifts || rules.max_shifts_per_week || 6;
    if (currentCount >= maxShifts) continue;

    var target = getShiftTarget(name, masterMap, availability, rules);
    if (target <= 0) continue;

    var gapSoft = target - currentCount;
    var remainingCap = maxShifts - currentCount;

    candidates.push({
      name: name,
      gapSoft: gapSoft,
      remainingCap: remainingCap
    });
  }

  candidates.sort(function(a, b) {
    var aUnder = a.gapSoft > 0 ? 1 : 0;
    var bUnder = b.gapSoft > 0 ? 1 : 0;
    if (aUnder !== bUnder) return bUnder - aUnder;
    if (aUnder && a.gapSoft !== b.gapSoft) return b.gapSoft - a.gapSoft;
    if (a.remainingCap !== b.remainingCap) return b.remainingCap - a.remainingCap;
    return a.name.localeCompare(b.name, 'he');
  });

  return candidates;
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
    if (emp.locationRestriction && emp.locationRestriction !== slot.location) continue;
    var dayAvail = avail[slot.day];
    if (!dayAvail) continue;
    for (var b = 0; b < dayAvail.length; b++) {
      if (dayAvail[b] === slot.block) {
        var key = slot.day + '_' + slot.block;
        if (!seen[key]) { seen[key] = true; count++; }
        break;
      }
    }
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

/**
 * Post-processing: check for constraint violations and warn.
 * Checks: no-juniors-alone, morning block score minimum.
 */
function fixJuniorViolations(slots, availability, masterMap, rules, state) {
  var slotMap = state._slotMap || buildSlotMap_(slots);
  var blockGroups = {};
  var allSlotIds = Object.keys(state.assigned);

  for (var i = 0; i < allSlotIds.length; i++) {
    var asgn = state.assigned[allSlotIds[i]];
    if (!asgn || asgn.unfilled || !asgn.name || asgn.managerSlot) continue;

    var slot = slotMap[allSlotIds[i]];
    if (slot && isJuniorAloneForSlot_(slot, state.assigned, slotMap)) {
      var timeStr = (slot.startTime != null && slot.endTime != null)
        ? formatTime_(slot.startTime) + '-' + formatTime_(slot.endTime) : '';
      state.warnings.push(
        formatSlotHebrew(allSlotIds[i]) + (timeStr ? ' (' + timeStr + ')' : '')
        + ' — ⚠ ' + asgn.name + ' לבד ללא מנוסה (ג\'/ד\') לשעה+ במשמרת.\n'
        + '   💡 צריך חפיפה בזמן עם עובד דרגה ג\' או ד\' באותו סניף.'
      );
    }

    var parts = allSlotIds[i].split('_');
    var groupKey = parts[0] + '_' + parts[1] + '_' + parts[2];

    if (!blockGroups[groupKey]) blockGroups[groupKey] = { members: [], block: parts[2] };
    blockGroups[groupKey].members.push({
      slotId: allSlotIds[i],
      name: asgn.name,
      rank: asgn.rank
    });
  }

  var groupKeys = Object.keys(blockGroups);
  for (var g = 0; g < groupKeys.length; g++) {
    var group = blockGroups[groupKeys[g]];
    var totalScore = 0;

    for (var m = 0; m < group.members.length; m++) {
      totalScore += group.members[m].rank;
    }

    var label = formatSlotHebrew(groupKeys[g]);
    var locParts = groupKeys[g].split('_');
    var groupLocation = locParts[0] || '';
    var minScore = getMinMorningScoreForLocation_(rules, groupLocation);

    if (group.block === 'בוקר' && minScore > 0 && totalScore < minScore) {
      var names = [];
      for (var m = 0; m < group.members.length; m++) {
        names.push(group.members[m].name + '(' + rankToHebrew(group.members[m].rank) + '\')');
      }
      state.warnings.push(
        label + ' — ⚠ ניקוד ניסיון: ' + totalScore + ' מתוך ' + minScore + ' נדרש.\n' +
        '   👥 הצוות: ' + names.join(', ')
      );
    }

    // Friday rule: must have at least one Rank 4 (ד) until 14:00
    var groupDay = locParts[1];
    if (groupDay === 'שישי' && group.block === 'בוקר') {
      var hasRank4 = false;
      for (var m = 0; m < group.members.length; m++) {
        if (group.members[m].rank === 4) { hasRank4 = true; break; }
      }
      if (!hasRank4) {
        state.warnings.push(
          label + ' — ⚠ בשישי חייב עובד דרגה ד\' (הכי בכיר) עד 14:00.\n' +
          '   💡 לא נמצא עובד דרגה ד\' זמין לבוקר של שישי.'
        );
      }
    }
  }

  // Check Friday+Saturday closing: last block must have ≥ 2 employees
  checkClosingRule_(slots, state);
}

/**
 * Verify that on Friday and Saturday, the closing block (ערב) has at least 2 employees.
 */
function checkClosingRule_(slots, state) {
  var closingDays = ['שישי', 'שבת'];
  var locations = CONFIG.locations;

  for (var l = 0; l < locations.length; l++) {
    for (var d = 0; d < closingDays.length; d++) {
      var day = closingDays[d];
      var prefix = locations[l] + '_' + day + '_ערב_';
      var closingCount = 0;

      var allSlotIds = Object.keys(state.assigned);
      for (var i = 0; i < allSlotIds.length; i++) {
        if (allSlotIds[i].indexOf(prefix) !== 0) continue;
        var asgn = state.assigned[allSlotIds[i]];
        if (asgn && !asgn.unfilled && !asgn.managerSlot) closingCount++;
      }

      if (closingCount > 0 && closingCount < 2) {
        var locationLabel = CONFIG.locationNames[locations[l]] || locations[l];
        state.warnings.push(
          locationLabel + ' | ' + day + ' | ערב — ⚠ בסגירה חייבים 2 עובדים, יש רק ' + closingCount + '.\n' +
          '   💡 צריך להוסיף עובד נוסף לסגירה.'
        );
      }
    }
  }
}
