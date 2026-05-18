/**
 * Time-overlap helpers for "no juniors alone" — rank א/ב need rank ג+ on site
 * for the full shift window (≥1h uncovered gap = alone).
 */

var JUNIOR_ALONE_MIN_GAP_HOURS = 1;

function shiftTimesOverlap_(s1, e1, s2, e2) {
  if (s1 === null || s1 === undefined || e1 === null || e1 === undefined) return false;
  if (s2 === null || s2 === undefined || e2 === null || e2 === undefined) return false;
  return s1 < e2 && s2 < e1;
}

function clipInterval_(start, end, winStart, winEnd) {
  var s = Math.max(start, winStart);
  var e = Math.min(end, winEnd);
  return s < e ? { start: s, end: e } : null;
}

function mergeTimeIntervals_(intervals) {
  if (!intervals || !intervals.length) return [];
  var sorted = intervals.slice().sort(function(a, b) { return a.start - b.start; });
  var merged = [{ start: sorted[0].start, end: sorted[0].end }];
  for (var i = 1; i < sorted.length; i++) {
    var last = merged[merged.length - 1];
    var cur = sorted[i];
    if (cur.start <= last.end) {
      if (cur.end > last.end) last.end = cur.end;
    } else {
      merged.push({ start: cur.start, end: cur.end });
    }
  }
  return merged;
}

/**
 * Longest continuous stretch within [winStart, winEnd] not covered by intervals.
 */
function maxUncoveredGapHours_(winStart, winEnd, coverIntervals) {
  var merged = mergeTimeIntervals_(coverIntervals);
  if (!merged.length) return winEnd - winStart;
  var maxGap = merged[0].start - winStart;
  for (var i = 1; i < merged.length; i++) {
    var g = merged[i].start - merged[i - 1].end;
    if (g > maxGap) maxGap = g;
  }
  var tail = winEnd - merged[merged.length - 1].end;
  if (tail > maxGap) maxGap = tail;
  return Math.max(0, maxGap);
}

/**
 * True when senior coverage leaves no gap ≥ minGapHours on the shift window.
 */
function isShiftCoveredBySeniors_(shiftStart, shiftEnd, seniorIntervals, minGapHours) {
  if (shiftStart === null || shiftStart === undefined || shiftEnd === null || shiftEnd === undefined) {
    return true;
  }
  var gap = minGapHours !== null && minGapHours !== undefined ? minGapHours : JUNIOR_ALONE_MIN_GAP_HOURS;
  var clipped = [];
  for (var i = 0; i < seniorIntervals.length; i++) {
    var iv = seniorIntervals[i];
    var c = clipInterval_(iv.start, iv.end, shiftStart, shiftEnd);
    if (c) clipped.push(c);
  }
  return maxUncoveredGapHours_(shiftStart, shiftEnd, clipped) < gap;
}

function buildSlotMap_(slots) {
  var map = {};
  for (var i = 0; i < slots.length; i++) {
    map[slots[i].slotId] = slots[i];
  }
  return map;
}

function collectSeniorIntervalsFromAssignments_(location, day, assignments, slotMap, excludeSlotId) {
  var intervals = [];
  var keys = Object.keys(assignments || {});
  for (var i = 0; i < keys.length; i++) {
    if (excludeSlotId && keys[i] === excludeSlotId) continue;
    var asgn = assignments[keys[i]];
    if (!asgn || asgn.unfilled || !asgn.name || asgn.managerSlot) continue;
    if ((asgn.rank || 0) < 3) continue;
    var slot = slotMap[keys[i]];
    if (!slot || slot.location !== location || slot.day !== day) continue;
    if (slot.startTime === null || slot.startTime === undefined) continue;
    if (slot.endTime === null || slot.endTime === undefined) continue;
    intervals.push({ start: slot.startTime, end: slot.endTime });
  }
  return intervals;
}

function collectSeniorIntervalsFromState_(location, day, state, slotMap, excludeSlotId) {
  return collectSeniorIntervalsFromAssignments_(location, day, state.assigned, slotMap, excludeSlotId);
}

/**
 * True when a rank א/ב assignment has ≥1h without rank ג+ overlap at same location.
 */
function isJuniorAloneForSlot_(slot, assignments, slotMap, minGapHours) {
  var asgn = assignments[slot.slotId];
  if (!asgn || asgn.unfilled || !asgn.name || asgn.managerSlot) return false;
  if ((asgn.rank || 0) > 2) return false;
  if (slot.startTime === null || slot.startTime === undefined) return false;
  if (slot.endTime === null || slot.endTime === undefined) return false;
  var seniors = collectSeniorIntervalsFromAssignments_(
    slot.location, slot.day, assignments, slotMap, slot.slotId
  );
  return !isShiftCoveredBySeniors_(slot.startTime, slot.endTime, seniors, minGapHours);
}

/**
 * True when existing seniors at location+day fully cover this slot's time window.
 */
function hasSeniorTimeCoverageForSlot_(slot, assignments, slotMap, minGapHours) {
  if (slot.startTime === null || slot.startTime === undefined) return true;
  if (slot.endTime === null || slot.endTime === undefined) return true;
  var seniors = collectSeniorIntervalsFromAssignments_(
    slot.location, slot.day, assignments, slotMap, null
  );
  return isShiftCoveredBySeniors_(slot.startTime, slot.endTime, seniors, minGapHours);
}

function wouldJuniorBeAloneAtSlot_(slot, juniorRank, assignments, slotMap, minGapHours) {
  if (juniorRank > 2) return false;
  if (slot.startTime === null || slot.startTime === undefined) return false;
  if (slot.endTime === null || slot.endTime === undefined) return false;
  var seniors = collectSeniorIntervalsFromAssignments_(
    slot.location, slot.day, assignments, slotMap, slot.slotId
  );
  return !isShiftCoveredBySeniors_(slot.startTime, slot.endTime, seniors, minGapHours);
}
