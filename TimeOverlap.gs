/**
 * Time-overlap helpers.
 *
 * The Mentor optimizer uses these for one purpose: prevent the same coach from
 * being assigned to two parallel nets at the same hour (hard constraint in
 * hasTimeConflict). The legacy Chachos "no juniors alone" / "senior coverage"
 * helpers were removed because Mentor doesn't have that rule.
 */

function shiftTimesOverlap_(s1, e1, s2, e2) {
  if (s1 === null || s1 === undefined || e1 === null || e1 === undefined) return false;
  if (s2 === null || s2 === undefined || e2 === null || e2 === undefined) return false;
  return s1 < e2 && s2 < e1;
}

function buildSlotMap_(slots) {
  var map = {};
  for (var i = 0; i < slots.length; i++) {
    map[slots[i].slotId] = slots[i];
  }
  return map;
}
