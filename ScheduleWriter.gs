/**
 * @OnlyCurrentDoc
 * Writes the optimized schedule to a single sheet.
 *
 * Unified weekly layout (one wide table):
 *   Row 1:      day headers (ראשון..שישי), each merged across 3 net columns.
 *   Row 2:      net sub-headers (רשת 1 / רשת 2 / רשת 3) under each day.
 *   Rows 3..N:  one row per hour-block. Time label in column 1 (right side under RTL).
 *               A coach assigned to consecutive adjacent hours in the same (day, net)
 *               is rendered as one tall merged cell.
 *               Friday's evening rows are greyed out (no trainings on Friday evening).
 *
 * Then a fairness table + legend at the bottom.
 *
 * DAY_GROUPS_ is still used by the WhatsApp share/export and refresh paths,
 * which have their own narrower layouts.
 */

var DAY_GROUPS_ = [
  ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי'],
  ['שישי'],
  ['שבת']
];

/** Unified Schedule grid layout constants. */
var SCHEDULE_TIME_COL_WIDTH_ = 70;
var SCHEDULE_NET_COL_WIDTH_ = 76;
var SCHEDULE_DAY_DIVIDER_COLOR_ = '#2E7D6B';
var SCHEDULE_DAY_EDGE_SUBHEADER_BG_ = '#D0D9DE';
var SCHEDULE_INACTIVE_BG_ = '#E5E7EB';
var SCHEDULE_INACTIVE_FG_ = '#9CA3AF';
var SCHEDULE_INACTIVE_LABEL_HE_ = 'אין אימון';
var UNIFIED_SCHEDULE_DAYS_ = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];

/**
 * Render a capacity slot that has no class scheduled this week: light-grey
 * background, faint "אין אימון" label, no coach dropdown, no hover note.
 */
function writeInactiveSlotCell_(cell) {
  cell.setValue(SCHEDULE_INACTIVE_LABEL_HE_)
    .setBackground(SCHEDULE_INACTIVE_BG_)
    .setFontColor(SCHEDULE_INACTIVE_FG_)
    .setFontWeight('normal');
  cell.setNote('');
  // Strip any previous data validation (coach-name dropdown) — there's
  // no coach to override here.
  cell.setDataValidation(null);
}

function writeSchedule(result, slots, masterMap, availability, notes, distribution) {
  HISTORY_SCORES_CACHE_ = null;
  notes = notes || {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.sheets.schedule);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.sheets.schedule);
  }
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
  sheet.clear();
  sheet.clearFormats();
  sheet.clearNotes();
  // Drop any data-validation rules left over from a previous run. Without this,
  // fairness / legend rows inherit coach-name dropdowns from the old grid and
  // flag every status text ("ביעד =)" וכו') as invalid (red dots).
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();

  var slotMap = buildSlotMap_(slots);
  var consecutiveShifts = computeConsecutiveShiftsMap_(slots, result.assignments);

  var lastDataRow = writeUnifiedScheduleGrid_(
    sheet, result.assignments, slots, slotMap, masterMap, availability, consecutiveShifts, 1
  );

  writeFairnessTable_(
    sheet, result.employeeStats, masterMap, availability, slots, lastDataRow + 2, notes
  );

  sheet.setRightToLeft(true);
  applyUnifiedScheduleLayout_(sheet, 1, lastDataRow);
  centerAllScheduleCells_(sheet);
}

/** Center-align horizontally + vertically across every used cell on the schedule sheet. */
function centerAllScheduleCells_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 0 || lastCol <= 0) return;
  sheet.getRange(1, 1, lastRow, lastCol)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
}

// ============================================================
//  Unified weekly grid: days across, hour blocks down
// ============================================================

/**
 * Writes the schedule as one wide table:
 *   Row 1: day headers (each merged across its 3 net columns)
 *   Row 2: net sub-headers (רשת 1 / 2 / 3) under each day
 *   Rows 3..N: one row per hour block. Time label in column 1.
 *
 * Same coach assigned to consecutive adjacent-time slots in the same (day, net)
 * column is rendered as one tall merged cell. Friday's evening rows are greyed
 * (no scheduled trainings on Friday evening).
 *
 * @returns {number} the row index of the last data row.
 */
function writeUnifiedScheduleGrid_(sheet, assignments, slots, slotMap, masterMap, availability, consecutiveShifts, startRow) {
  var DAYS = UNIFIED_SCHEDULE_DAYS_;
  var locations = CONFIG.locations;
  var locationLabels = CONFIG.locationNames || {};
  var perDayCols = locations.length;

  var timeGrid = buildOrderedTimeGrid_(slots);
  var slotIndex = buildSlotIndexByDayLocationTime_(slots);

  var headerRow = startRow;
  var subHeaderRow = startRow + 1;
  var firstDataRow = startRow + 2;

  sheet.getRange(headerRow, 1, 2, 1).merge()
    .setValue('שעה')
    .setFontWeight('bold')
    .setBackground(CONFIG.colors.headerBg)
    .setFontColor(CONFIG.colors.headerFont);

  for (var d = 0; d < DAYS.length; d++) {
    var dayStartCol = 2 + d * perDayCols;
    sheet.getRange(headerRow, dayStartCol, 1, perDayCols).merge()
      .setValue(mentorDayBilingualLabel_(DAYS[d]))
      .setFontWeight('bold')
      .setBackground(CONFIG.colors.headerBg)
      .setFontColor(CONFIG.colors.headerFont);

    for (var li = 0; li < locations.length; li++) {
      sheet.getRange(subHeaderRow, dayStartCol + li)
        .setValue(locationLabels[locations[li]] || locations[li])
        .setFontWeight('bold')
        .setBackground(CONFIG.colors.summaryRow);
    }
  }

  for (var t = 0; t < timeGrid.length; t++) {
    var row = firstDataRow + t;
    var tg = timeGrid[t];

    sheet.getRange(row, 1)
      .setValue(formatTime_(tg.startTime) + '-' + formatTime_(tg.endTime))
      .setFontWeight('bold')
      .setBackground(CONFIG.colors.summaryRow);

    for (var d2 = 0; d2 < DAYS.length; d2++) {
      var dayHe = DAYS[d2];
      var dayMap = slotIndex[dayHe] || {};

      for (var li2 = 0; li2 < locations.length; li2++) {
        var loc = locations[li2];
        var col = 2 + d2 * perDayCols + li2;
        var cell = sheet.getRange(row, col);
        var slot = dayMap[loc] && dayMap[loc][slotTimeKey_(tg)];

        if (!slot) {
          cell.setValue('').setBackground('#F0F0F0');
          continue;
        }

        // Slot exists in the template but no class is running this week
        // (auto-distribution skipped it). Render as a grey "אין אימון" cell
        // — distinct from red unfilled, no coach, no override dropdown.
        if (slot.inactive) {
          writeInactiveSlotCell_(cell);
          continue;
        }

        writeScheduleAssignmentCell_(
          cell, slot, assignments[slot.slotId],
          masterMap, availability, assignments, slotMap, consecutiveShifts
        );
      }
    }
  }

  var lastDataRow = firstDataRow + timeGrid.length - 1;
  mergeConsecutiveSameCoach_(sheet, firstDataRow, timeGrid, assignments, slotIndex, DAYS, locations);
  return lastDataRow;
}

/**
 * Equal net column widths, narrower time column, and a thick left border on the
 * first column of each day block so Sun–Fri read as separate 3-column panels.
 */
function applyUnifiedScheduleLayout_(sheet, headerRow, lastDataRow) {
  var perDayCols = CONFIG.locations.length;
  var netColStart = 2;
  var netColEnd = netColStart + UNIFIED_SCHEDULE_DAYS_.length * perDayCols - 1;
  var subHeaderRow = headerRow + 1;
  var numRows = Math.max(lastDataRow - headerRow + 1, 2);

  sheet.setColumnWidth(1, SCHEDULE_TIME_COL_WIDTH_);
  for (var c = netColStart; c <= netColEnd; c++) {
    sheet.setColumnWidth(c, SCHEDULE_NET_COL_WIDTH_);
  }

  for (var d = 0; d < UNIFIED_SCHEDULE_DAYS_.length; d++) {
    var dayStartCol = netColStart + d * perDayCols;
    sheet.getRange(headerRow, dayStartCol, numRows, 1)
      .setBorder(null, true, null, null, null, null, SCHEDULE_DAY_DIVIDER_COLOR_, SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
    sheet.getRange(subHeaderRow, dayStartCol)
      .setBackground(SCHEDULE_DAY_EDGE_SUBHEADER_BG_);
  }
}

/** Fills one (day, net, hour) cell with the proper value, color, note and dropdown. */
function writeScheduleAssignmentCell_(cell, slot, asgn, masterMap, availability, assignments, slotMap, consecutiveShifts) {
  if (!asgn) {
    cell.setValue('');
    return;
  }

  if (asgn.managerSlot) {
    cell.setValue('מנהל')
        .setBackground('#D9E2F3')
        .setFontWeight('bold');
    cell.setNote('יובל / דורי / גלו — מחליטים ביניהם מי עולה.');
    return;
  }

  if (asgn.unfilled) {
    cell.setValue('⚠')
        .setBackground(CONFIG.colors.unfilled)
        .setFontColor('#9C0006');
    cell.setNote(buildOverrideNote_(slot, null, masterMap, availability, assignments));
    setOverrideDropdown_(cell, slot, masterMap);
    return;
  }

  cell.setValue(asgn.name);

  var consecutiveNote = consecutiveShifts && consecutiveShifts[slot.slotId];
  var bgColor = CONFIG.colors.ok;
  if (consecutiveNote) {
    bgColor = CONFIG.colors.overlap;
  } else if (asgn.suggested) {
    bgColor = CONFIG.colors.suggested;
  }
  cell.setBackground(bgColor);

  var noteText = buildOverrideNote_(slot, asgn, masterMap, availability, assignments);
  if (consecutiveNote) noteText = '🟠 ' + consecutiveNote + '\n\n' + noteText;
  cell.setNote(noteText);

  setOverrideDropdown_(cell, slot, masterMap);
}

function setOverrideDropdown_(cell, slot, masterMap) {
  var dropdown = getOverrideCandidates_(slot, masterMap);
  if (!dropdown || dropdown.length === 0) return;
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(dropdown, true)
    .setAllowInvalid(true)
    .build();
  cell.setDataValidation(rule);
}

/** Unique sorted list of {startTime, endTime, block} pairs across all slots. */
function buildOrderedTimeGrid_(slots) {
  var seen = {};
  var grid = [];
  for (var i = 0; i < slots.length; i++) {
    var s = slots[i];
    if (s.startTime === null || s.endTime === null) continue;
    var key = slotTimeKey_(s);
    if (seen[key]) continue;
    seen[key] = true;
    grid.push({ startTime: s.startTime, endTime: s.endTime, block: s.block });
  }
  grid.sort(function(a, b) { return a.startTime - b.startTime; });
  return grid;
}

/** Index slots by day → location → timeKey for fast O(1) lookup. */
function buildSlotIndexByDayLocationTime_(slots) {
  var index = {};
  for (var i = 0; i < slots.length; i++) {
    var s = slots[i];
    if (!index[s.day]) index[s.day] = {};
    if (!index[s.day][s.location]) index[s.day][s.location] = {};
    index[s.day][s.location][slotTimeKey_(s)] = s;
  }
  return index;
}

/**
 * Merge cells in each (day, net) column when the same coach is assigned to
 * adjacent rows. Top-left cell value/color/note/validation are kept; other
 * cells in the run are absorbed by the merge.
 *
 * Merge is purely name-based across the whole day-net column, so a coach who
 * covers BOTH morning and evening of the same day shows up as one tall cell.
 * Intra-shift gaps (e.g. 19:00→19:15) and the 12:00→16:00 gap between blocks
 * are absorbed by the merge.
 *
 * The merged cell keeps the top-left cell's background — green / blue / orange
 * are already set per-cell by writeScheduleAssignmentCell_() based on the
 * consecutiveShifts map (only TIGHT 7:00↔21:15 cases are orange).
 */
function mergeConsecutiveSameCoach_(sheet, firstDataRow, timeGrid, assignments, slotIndex, DAYS, locations) {
  for (var d = 0; d < DAYS.length; d++) {
    var dayHe = DAYS[d];
    var dayMap = slotIndex[dayHe] || {};

    for (var li = 0; li < locations.length; li++) {
      var loc = locations[li];
      var locMap = dayMap[loc] || {};
      var col = 2 + d * locations.length + li;

      var runStart = 0;
      var runEnd = -1;
      var runName = null;

      var finalizeRun = function(startRow, endRow) {
        if (endRow <= startRow) return;
        sheet.getRange(firstDataRow + startRow, col, endRow - startRow + 1, 1).merge();
      };

      for (var t = 0; t < timeGrid.length; t++) {
        var slot = locMap[slotTimeKey_(timeGrid[t])];
        var asgn = slot && assignments[slot.slotId];
        // Inactive slots ("אין אימון") explicitly break runs — they're not a
        // coach cell, and we don't want them swallowed into the merge above.
        var inactiveRowBreak = (slot && slot.inactive);
        var name = (!inactiveRowBreak && asgn && asgn.name && !asgn.unfilled && !asgn.managerSlot)
          ? asgn.name : null;

        var continuous = (name !== null && name === runName && t > 0);

        if (continuous) {
          runEnd = t;
        } else {
          if (runName !== null) finalizeRun(runStart, runEnd);
          runStart = t;
          runEnd = t;
          runName = name;
        }
      }
      if (runName !== null) finalizeRun(runStart, runEnd);
    }
  }
}

/**
 * Find coach assignments that form a TIGHT back-to-back schedule, i.e. less
 * than ~10 hours of rest between two shifts. Flagged cases:
 *  - Same coach works the LAST evening slot of day X (ending 21:15) AND the
 *    FIRST morning slot of day X+1 (starting 7:00).
 *  - Same coach works the FIRST morning slot of day X (starting 7:00) AND the
 *    LAST evening slot of day X (ending 21:15) — full ~14-hour day.
 *
 * Looser combinations (morning ending 12:00 + evening starting 18:00, or
 * evening ending 20:15 + next morning 8:00, etc.) are NOT flagged — there is
 * enough rest in between.
 *
 * Returns: { slotId: explanationHe } — every slotId that participates in such
 * a tight pair maps to a human-readable Hebrew note. The schedule writer
 * colors these cells orange and prepends the note to the hover tooltip.
 */
var TIGHT_EVENING_END_ = 21.25;   // 21:15
var TIGHT_MORNING_START_ = 7.0;   // 7:00

function computeConsecutiveShiftsMap_(slots, assignments) {
  var DAY_ORDER = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
  var dayIndexOf = {};
  for (var i = 0; i < DAY_ORDER.length; i++) dayIndexOf[DAY_ORDER[i]] = i;

  var slotById = {};
  for (var s = 0; s < slots.length; s++) slotById[slots[s].slotId] = slots[s];

  // Group: coach -> dayIndex -> { morning: [slotIds], evening: [slotIds] }
  var coachShifts = {};
  var slotIds = Object.keys(assignments);
  for (var k = 0; k < slotIds.length; k++) {
    var asgn = assignments[slotIds[k]];
    if (!asgn || asgn.unfilled || !asgn.name || asgn.managerSlot) continue;
    var slot = slotById[slotIds[k]];
    if (!slot) continue;
    var di = dayIndexOf[slot.day];
    if (di === undefined) continue;
    var blockKey = slot.block === 'בוקר' ? 'morning' : (slot.block === 'ערב' ? 'evening' : null);
    if (!blockKey) continue;

    if (!coachShifts[asgn.name]) coachShifts[asgn.name] = {};
    if (!coachShifts[asgn.name][di]) coachShifts[asgn.name][di] = { morning: [], evening: [] };
    coachShifts[asgn.name][di][blockKey].push(slotIds[k]);
  }

  var out = {};
  var names = Object.keys(coachShifts);
  for (var n = 0; n < names.length; n++) {
    var name = names[n];
    var byDay = coachShifts[name];
    var dayKeys = Object.keys(byDay).map(Number).sort(function(a, b) { return a - b; });

    for (var d = 0; d < dayKeys.length; d++) {
      var di2 = dayKeys[d];
      var dayHe = DAY_ORDER[di2];
      var morn = byDay[di2].morning;
      var even = byDay[di2].evening;

      if (morn.length > 0 && even.length > 0 &&
          blockStartsAt_(morn, slotById, TIGHT_MORNING_START_) &&
          blockEndsAt_(even, slotById, TIGHT_EVENING_END_)) {
        var mornSummary = summarizeBlockSlotIds_(morn, slotById);
        var evenSummary = summarizeBlockSlotIds_(even, slotById);
        var noteSameDay = 'יום עבודה ארוך במיוחד — ' + name + ': בוקר מ-7:00 (' + mornSummary +
          ') + ערב עד 21:15 (' + evenSummary + ') ביום ' + dayHe + '. כדאי לתאם איתו.';
        addConsecutiveNote_(out, morn, noteSameDay);
        addConsecutiveNote_(out, even, noteSameDay);
      }

      var nextDi = di2 + 1;
      if (nextDi < DAY_ORDER.length && byDay[nextDi]) {
        var nextDayHe = DAY_ORDER[nextDi];
        var nextMorn = byDay[nextDi].morning;
        if (even.length > 0 && nextMorn.length > 0 &&
            blockEndsAt_(even, slotById, TIGHT_EVENING_END_) &&
            blockStartsAt_(nextMorn, slotById, TIGHT_MORNING_START_)) {
          var evenSummaryCross = summarizeBlockSlotIds_(even, slotById);
          var nextMornSummary = summarizeBlockSlotIds_(nextMorn, slotById);
          var noteCross = 'מנוחה קצרה בין משמרות — ' + name + ': ערב ' + dayHe + ' עד 21:15 (' +
            evenSummaryCross + ') + בוקר ' + nextDayHe + ' מ-7:00 (' + nextMornSummary +
            '). פחות מ-10 שעות מנוחה — כדאי לתאם איתו.';
          addConsecutiveNote_(out, even, noteCross);
          addConsecutiveNote_(out, nextMorn, noteCross);
        }
      }
    }
  }

  return out;
}

/** True iff at least one slotId in ids has startTime === target (within 1 min). */
function blockStartsAt_(ids, slotById, target) {
  for (var i = 0; i < ids.length; i++) {
    var s = slotById[ids[i]];
    if (!s || s.startTime === null || s.startTime === undefined) continue;
    if (Math.abs(s.startTime - target) < 0.02) return true;
  }
  return false;
}

/** True iff at least one slotId in ids has endTime === target (within 1 min). */
function blockEndsAt_(ids, slotById, target) {
  for (var i = 0; i < ids.length; i++) {
    var s = slotById[ids[i]];
    if (!s || s.endTime === null || s.endTime === undefined) continue;
    if (Math.abs(s.endTime - target) < 0.02) return true;
  }
  return false;
}

function addConsecutiveNote_(map, ids, note) {
  for (var i = 0; i < ids.length; i++) {
    var existing = map[ids[i]];
    map[ids[i]] = existing ? existing + '\n' + note : note;
  }
}

/**
 * Hebrew summary of assignments in one half-day block: "רשת 1 7:00-12:00, רשת 2 …".
 */
function summarizeBlockSlotIds_(slotIds, slotById) {
  var locationLabels = CONFIG.locationNames || {};
  var byLoc = {};
  for (var i = 0; i < slotIds.length; i++) {
    var slot = slotById[slotIds[i]];
    if (!slot || slot.startTime === null || slot.endTime === null) continue;
    var locLabel = locationLabels[slot.location] || slot.location;
    if (!byLoc[locLabel]) {
      byLoc[locLabel] = { minStart: slot.startTime, maxEnd: slot.endTime };
    } else {
      if (slot.startTime < byLoc[locLabel].minStart) byLoc[locLabel].minStart = slot.startTime;
      if (slot.endTime > byLoc[locLabel].maxEnd) byLoc[locLabel].maxEnd = slot.endTime;
    }
  }
  var keys = Object.keys(byLoc).sort();
  var parts = [];
  for (var k = 0; k < keys.length; k++) {
    var w = byLoc[keys[k]];
    parts.push(keys[k] + ' ' + formatTime_(w.minStart) + '-' + formatTime_(w.maxEnd));
  }
  return parts.length ? parts.join(', ') : '—';
}

// ============================================================
//  Fairness table
// ============================================================

function writeFairnessTable_(sheet, employeeStats, masterMap, availability, slots, startRow, notes) {
  notes = notes || {};
  var headers = ['שם', 'דרגה', 'יעד', 'ימים זמין', 'זמין השבוע', 'קיבל', 'בוקר/ערב', 'הערות', 'סטטוס'];
  for (var h = 0; h < headers.length; h++) {
    sheet.getRange(startRow, h + 1).setValue(headers[h]);
  }
  sheet.getRange(startRow, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground(CONFIG.colors.headerBg)
    .setFontColor(CONFIG.colors.headerFont)
    .setHorizontalAlignment('center');

  var names = Object.keys(employeeStats);
  names.sort();

  var row = startRow + 1;
  for (var i = 0; i < names.length; i++) {
    var stat = employeeStats[names[i]];
    var emp = masterMap[names[i]];
    if (!emp) continue;

    var targetMax = stat.shiftTarget || getShiftTarget(names[i], masterMap, availability);
    var targetMin = getShiftTargetMin_(names[i], masterMap);
    var received = stat.shiftsCount || 0;
    var availableCount = countAvailableSlots_(names[i], availability, slots, emp);
    var availableDays = countAvailableDays_(names[i], availability);

    var satisfaction = '';
    if (availableDays === 0) {
      satisfaction = 'לא הגיש זמינות';
    } else if (targetMax > 0 && received > targetMax) {
      satisfaction = 'מעל היעד';
    } else if (received >= availableDays && targetMin > 0 && received < targetMin) {
      satisfaction = 'קיבל מקסימום אפשרי';
    } else if (targetMin > 0 && received < targetMin) {
      satisfaction = 'מתחת ליעד';
    } else if (targetMax > 0 && received >= targetMin && received <= targetMax) {
      satisfaction = 'ביעד =)';
    } else if (received >= availableDays) {
      satisfaction = 'קיבל מקסימום אפשרי';
    } else if (targetMax > 0 && received >= targetMax - 1) {
      satisfaction = 'כמעט מלא';
    } else {
      satisfaction = 'קיבל פחות =(';
    }

    var dist = getBlockDistribution_(names[i], employeeStats);
    var targetDisplay = formatShiftTargetRange_(targetMin, targetMax);

    sheet.getRange(row, 1).setValue(stat.name);
    sheet.getRange(row, 2).setValue(rankToHebrew(stat.rank));
    sheet.getRange(row, 3).setValue(targetDisplay);
    sheet.getRange(row, 4).setValue(availableDays);
    sheet.getRange(row, 5).setValue(availableCount);
    sheet.getRange(row, 6).setValue(received);
    sheet.getRange(row, 7).setValue(dist);
    sheet.getRange(row, 8).setValue(notes[stat.name] || '');
    sheet.getRange(row, 9).setValue(satisfaction);

    var satCell = sheet.getRange(row, 9);
    if (satisfaction === 'ביעד =)' || satisfaction === 'קיבל מקסימום אפשרי') {
      satCell.setBackground('#C6EFCE').setFontColor('#006100');
    } else if (satisfaction === 'מעל היעד') {
      satCell.setBackground('#FFEB9C').setFontColor('#9C6500');
    } else if (satisfaction === 'כמעט מלא') {
      satCell.setBackground('#FFEB9C').setFontColor('#9C6500');
    } else if (satisfaction === 'מתחת ליעד') {
      satCell.setBackground('#FFC7CE').setFontColor('#9C0006');
    } else if (satisfaction === 'קיבל פחות =(') {
      satCell.setBackground('#FFC7CE').setFontColor('#9C0006');
    } else if (satisfaction === 'לא הגיש זמינות') {
      satCell.setBackground('#E8E8E8').setFontColor('#666666');
    }

    sheet.getRange(row, 1, 1, headers.length)
      .setHorizontalAlignment('center')
      .setVerticalAlignment('middle');
    row++;
  }

  // Legend
  row += 1;
  sheet.getRange(row, 1).setValue('מקרא צבעים בלו"ז:').setFontWeight('bold');
  row++;
  sheet.getRange(row, 1).setValue('🟢');
  sheet.getRange(row, 2).setValue('שובץ בתוך החלון שהמאמן הגיש, ללא רצף משמרות — תקין.');
  sheet.getRange(row, 1, 1, 2).setBackground(CONFIG.colors.ok);
  row++;
  sheet.getRange(row, 1).setValue('🔵');
  sheet.getRange(row, 2).setValue('הצעת המערכת — שובץ מחוץ לחלון הזמינות שהגיש. דורש תיאום מולו. הסיבה לבחירה מופיעה בהערה.');
  sheet.getRange(row, 1, 1, 2).setBackground(CONFIG.colors.suggested);
  row++;
  sheet.getRange(row, 1).setValue('🟠');
  sheet.getRange(row, 2).setValue(
    'משמרות צמודות עם מנוחה קצרה — ערב עד 21:15 ואחריו בוקר מ-7:00 (פחות מ-10 שעות מנוחה), ' +
    'או יום עבודה מלא 7:00 + 21:15. צריך תיאום עם המאמן.'
  );
  sheet.getRange(row, 1, 1, 2).setBackground(CONFIG.colors.overlap);
  row++;
  sheet.getRange(row, 1).setValue('🔴');
  sheet.getRange(row, 2).setValue('משמרת לא מולאה — צריך שיבוץ ידני.');
  sheet.getRange(row, 1, 1, 2).setBackground(CONFIG.colors.unfilled);
  row++;
  sheet.getRange(row, 1).setValue('⚪');
  sheet.getRange(row, 2).setValue(
    'אין אימון השבוע — הזמן הזה נשאר ללא כיתה לפי כמויות ה-WeeklyClasses שהזנת. שנה את הכמויות בדיאלוג והרץ שוב כדי להוסיף.'
  );
  sheet.getRange(row, 1, 1, 2).setBackground(SCHEDULE_INACTIVE_BG_).setFontColor(SCHEDULE_INACTIVE_FG_);
}

// ============================================================
//  Manual override helpers
// ============================================================

/**
 * Get sorted list of ALL employee names for the override dropdown.
 * No filtering — Gal is the owner and can override any rule.
 */
function getOverrideCandidates_(slot, masterMap) {
  var names = Object.keys(masterMap);
  names.sort();
  return names;
}

/**
 * Build a smart hover-note for a shift cell.
 * Shows: current assignment info, and a ranked list of alternatives with
 * cost, rank, availability, conflict detection, and warnings.
 */
var HISTORY_SCORES_CACHE_ = null;

/**
 * Load cumulative satisfaction scores from ShiftHistory (cached per run).
 * Returns { name: overallScore% } for all employees.
 */
function getHistoryScores_() {
  if (HISTORY_SCORES_CACHE_) return HISTORY_SCORES_CACHE_;
  HISTORY_SCORES_CACHE_ = {};
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG.sheets.shiftHistory);
  if (!sh || sh.getLastRow() < 2) return HISTORY_SCORES_CACHE_;

  var data = sh.getDataRange().getValues();
  var empTotals = {};
  for (var r = 1; r < data.length; r++) {
    var week = String(data[r][0]).trim();
    if (!week || week === '📊 סיכום מצטבר') continue;
    var name = String(data[r][1]).trim();
    if (!name) continue;
    if (!empTotals[name]) empTotals[name] = { received: 0, target: 0 };
    empTotals[name].received += (parseInt(data[r][5]) || 0);
    empTotals[name].target += (parseInt(data[r][3]) || 0);
  }
  var names = Object.keys(empTotals);
  for (var i = 0; i < names.length; i++) {
    var t = empTotals[names[i]];
    HISTORY_SCORES_CACHE_[names[i]] = t.target > 0 ? Math.round((t.received / t.target) * 100) : 100;
  }
  return HISTORY_SCORES_CACHE_;
}

function buildOverrideNote_(slot, currentAsgn, masterMap, availability, assignments) {
  var hours = slot.durationHours || 0;
  var isSaturday = slot.day === 'שבת';
  var historyScores = getHistoryScores_();
  var classTypeRules = loadClassTypeRules_();
  var classRules = loadRules();
  var classTypeHe = slot.classType ? classTypeHebrew_(slot.classType) : '';
  var lines = [];

  if (currentAsgn && currentAsgn.name) {
    var curEmp = masterMap[currentAsgn.name];
    var curRank = curEmp ? rankToHebrew(curEmp.rank) : '?';
    var curHistory = historyScores[currentAsgn.name];
    var curScoreStr = curHistory ? ' | ציון היסטורי: ' + curHistory + '%' : '';
    lines.push('✅ משובץ: ' + currentAsgn.name + ' (דרגה ' + curRank + ')' + curScoreStr);
    if (currentAsgn.suggested) {
      var reason = currentAsgn.suggestedReason
        || 'שובץ מחוץ לחלון הזמינות שהמאמן הגיש בטופס. דורש תיאום מולו (לרוב כדי לעמוד ביעד השבועי).';
      lines.push('💙 הצעת מערכת: ' + reason);
    }
  } else {
    lines.push('⚠ משמרת ריקה — צריך שיבוץ ידני');
  }

  lines.push('');
  lines.push('🔄 חלופות:');

  var slotMap = buildSlotMap_(loadShiftTemplates());

  // Build who's already assigned this day (any location)
  var assignedToday = {};
  var allSlotIds = Object.keys(assignments);
  for (var i = 0; i < allSlotIds.length; i++) {
    var a = assignments[allSlotIds[i]];
    if (!a || a.unfilled || !a.name || a.managerSlot) continue;

    var parts = allSlotIds[i].split('_');
    if (parts[1] === slot.day) {
      if (!(currentAsgn && a.name === currentAsgn.name && allSlotIds[i] === slot.slotId)) {
        assignedToday[a.name] = (assignedToday[a.name] || []);
        var loc = CONFIG.locationNames[parts[0]] || parts[0];
        var peerSlot = slotMap[allSlotIds[i]];
        var t = peerSlot && peerSlot.startTime != null
          ? formatTime_(peerSlot.startTime) + '-' + formatTime_(peerSlot.endTime) : (parts[2] || '');
        assignedToday[a.name].push(loc + ' ' + t);
      }
    }
  }

  var names = Object.keys(masterMap);
  names.sort();

  var alts = [];
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (currentAsgn && name === currentAsgn.name) continue;
    var emp = masterMap[name];

    var flags = [];
    var hasConflict = false;

    // Already working this day?
    if (assignedToday[name]) {
      flags.push('🚫 כבר משובץ היום (' + assignedToday[name].join(', ') + ')');
      hasConflict = true;
    }


    var isAvail = isAvailableForSlot(name, slot, availability);
    if (!isAvail && !hasConflict) flags.push('❌ לא סימן זמינות');

    var classEligible = coachEligibleForClassType_(name, slot.classType, masterMap, classTypeRules, classRules);
    if (!classEligible) {
      flags.push('🚫 לא מוסמך/ת לאמן ' + (classTypeHe || slot.classType));
      hasConflict = true;
    }

    // How far from target? Target is in SHIFTS (day×block), not trainings.
    var target = getShiftTarget(name, masterMap, availability);
    var currentShifts = 0;
    var seenShifts = {};
    for (var si = 0; si < allSlotIds.length; si++) {
      var sa = assignments[allSlotIds[si]];
      if (!sa || sa.name !== name || sa.unfilled || sa.managerSlot) continue;
      var parts = allSlotIds[si].split('_');
      var shiftKey = parts[1] + '|' + parts[2];
      if (seenShifts[shiftKey]) continue;
      seenShifts[shiftKey] = true;
      currentShifts++;
    }
    var underTarget = target > 0 && currentShifts < target;
    if (underTarget && !hasConflict) {
      flags.push('📊 ' + currentShifts + '/' + target + ' מהיעד');
    }

    var rankLabel = rankToHebrew(emp.rank);
    var histLabel = historyScores[name] ? ' | 📜' + historyScores[name] + '%' : '';
    var line = '• ' + name + ' | ' + rankLabel + histLabel;
    if (flags.length > 0) line += '\n   ' + flags.join(' | ');

    alts.push({ line: line, isAvail: isAvail, rank: emp.rank, hasConflict: hasConflict, underTarget: underTarget });
  }

  // Sort priority:
  // 1. Available + no conflict (best)
  // 2. Not available + no conflict + under target (worth asking)
  // 3. Not available + no conflict (rest)
  // 4. Already assigned today (impossible — info only)
  alts.sort(function(a, b) {
    var aScore = a.hasConflict ? 3 : (a.isAvail ? 0 : (a.underTarget ? 1 : 2));
    var bScore = b.hasConflict ? 3 : (b.isAvail ? 0 : (b.underTarget ? 1 : 2));
    if (aScore !== bScore) return aScore - bScore;
    if (a.underTarget !== b.underTarget) return b.underTarget ? 1 : -1;
    return a.rank - b.rank;
  });

  var shown = Math.min(alts.length, 12);
  for (var i = 0; i < shown; i++) {
    lines.push(alts[i].line);
  }
  if (alts.length > shown) {
    lines.push('... ועוד ' + (alts.length - shown));
  }

  return lines.join('\n');
}

// ============================================================
//  Shared helpers
// ============================================================

/**
 * Format morning/evening distribution as "Xב / Yע" (X morning / Y evening).
 */
function getBlockDistribution_(name, employeeStats) {
  var stat = employeeStats[name];
  if (!stat) return '';
  var m = stat.morningCount || 0;
  var e = stat.eveningCount || 0;
  var other = stat.shiftsCount - m - e;
  var parts = [];
  if (m > 0) parts.push(m + ' בוקר');
  if (e > 0) parts.push(e + ' ערב');
  if (other > 0) parts.push(other + ' אמצע');
  return parts.join(' / ') || '0';
}

/**
 * Count how many distinct DAYS this employee marked any availability.
 */
function countAvailableDays_(name, availability) {
  if (!availability || !availability[name]) return 0;
  var avail = availability[name];
  var count = 0;
  var days = Object.keys(avail);
  for (var d = 0; d < days.length; d++) {
    var dayData = avail[days[d]];
    if (dayData && dayData.length > 0) count++;
  }
  return count;
}

function countAvailableSlots_(name, availability, slots, emp) {
  if (!availability || !availability[name]) return 0;
  var avail = availability[name];
  var count = 0;
  var seen = {};

  for (var s = 0; s < slots.length; s++) {
    var slot = slots[s];
    if (slot.block === 'מנהל') continue;
    // Inactive slots ("אין אימון" — no class running this week) aren't part of
    // a coach's "available shifts this week" count.
    if (slot.inactive) continue;
    if (emp && emp.locationRestriction && emp.locationRestriction !== slot.location) continue;
    var dayAvail = avail[slot.day];
    if (!dayAvail || dayAvail.length === 0) continue;

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

function rankToHebrew(rank) {
  return String(normalizeMentorRank_(rank));
}

/**
 * Format the weekly target as "min-max" (e.g., "1-2"), or just the single
 * number when both bounds are equal, or "" when neither is set. Min === 0 is a
 * valid bound (e.g., "0-1" for coaches who often skip the week).
 */
function formatShiftTargetRange_(min, max) {
  var hasMin = (typeof min === 'number' && !isNaN(min) && min >= 0);
  var hasMax = (typeof max === 'number' && !isNaN(max) && max >= 0);
  if (!hasMin && !hasMax) return '';
  if (hasMin && hasMax) {
    if (min === max) return String(min);
    return min + '-' + max;
  }
  return String(hasMax ? max : min);
}

function formatTime_(decimalHours) {
  if (decimalHours === null || decimalHours === undefined) return '';
  var h = Math.floor(decimalHours);
  var m = Math.round((decimalHours - h) * 60);
  return h + ':' + (m < 10 ? '0' : '') + m;
}

// ============================================================
//  Share schedule: clean view for WhatsApp (no costs / colors)
// ============================================================

/**
 * Menu: "הפץ לו"ז וסגור שבוע" — writes Share_Export, logs ShiftHistory, archives form responses.
 */
function shareSchedule() {
  showRtlConfirmDialog_(
    'shareSchedule',
    '📤 הפץ לו"ז וסגור שבוע',
    'מה זה עושה: שלב הסיום של השבוע —\n'
      + '• בונה את "' + CONFIG.sheets.shareExport + '" — תצוגה נקייה של הלו"ז (להפצה ב-WhatsApp)\n'
      + '• רושם את שיבוצי השבוע ב-"' + CONFIG.sheets.shiftHistory + '" לטובת מעקב הוגנות\n'
      + '• מארכב את תשובות הטופס הנוכחיות ומנקה את "' + CONFIG.sheets.responses + '" לקראת השבוע הבא\n\n'
      + '⚠ דורס את "' + CONFIG.sheets.shareExport + '" ומנקה את "' + CONFIG.sheets.responses + '".\n'
      + 'הרץ רק אחרי שהלו"ז ב-"' + CONFIG.sheets.schedule + '" סופי.\n\n'
      + 'להמשיך?'
  );
}

function shareScheduleRun_() {
  try {
    var data = buildShareableScheduleData_();
    if (!data) {
      throw new Error('לא נמצא גיליון Schedule, או שלא מולאו במשבצות.');
    }

    exportShareableScheduleToSheet_(data);
    logHistoryFromSheet_();
    archiveAndClearFormResponsesLikeShare_();

    return menuActionSuccess_(
      '📤 הלו"ז הופץ והשבוע נסגר',
      '• "' + CONFIG.sheets.shareExport + '" מוכן להפצה.\n'
        + '• "' + CONFIG.sheets.shiftHistory + '" עודכן עם שיבוצי השבוע.\n'
        + '• תשובות הטופס אורכבו, "' + CONFIG.sheets.responses + '" נוקה לקראת השבוע הבא.'
    );
  } catch (e) {
    Logger.log('shareSchedule: ' + e + (e && e.stack ? '\n' + e.stack : ''));
    throw new Error(String(e.message || e));
  }
}

// ============================================================
//  טבלה להפצה — Share_Export → ערכים בלבד
// ============================================================

/** @type {Array<Array<string>>} [fromA1, toA1] Share_Export → גיליון הפצה (עמודה אחת בכל צד) */
var SHARE_EXPORT_TO_DISTRIBUTION_PAIRS_ = [
  ['B6:B10', 'P5:P9'],
  ['C6:C10', 'N5:N9'],
  ['D6:D10', 'L5:L9'],
  ['E6:E10', 'J5:J9'],
  ['F6:F10', 'H5:H9'],
  ['G12:G17', 'F5:F10'],
  ['H19:H27', 'D5:D13'],
  ['K6:K10', 'P13:P17'],
  ['L6:L10', 'N13:N17'],
  ['M6:M10', 'L13:L17'],
  ['N6:N10', 'J13:J17'],
  ['O6:O10', 'H13:H17'],
  ['P12:P16', 'F13:F17']
];

function colLettersToNumber_(letters) {
  letters = String(letters).toUpperCase();
  var n = 0;
  for (var i = 0; i < letters.length; i++) {
    var ch = letters.charCodeAt(i);
    if (ch < 65 || ch > 90) throw new Error('עמודה לא חוקית: ' + letters);
    n = n * 26 + (ch - 64);
  }
  return n;
}

/** @returns {{ col: number, r1: number, r2: number }} */
function parseA1SingleColumnRect_(a1) {
  var s = String(a1).replace(/\s/g, '');
  var m = s.match(/^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/);
  if (!m) throw new Error('טווח A1 לא חוקי (נדרש עמודה:שורה): ' + a1);
  var c1 = colLettersToNumber_(m[1]);
  var r1 = parseInt(m[2], 10);
  var c2 = colLettersToNumber_(m[3]);
  var r2 = parseInt(m[4], 10);
  if (c1 !== c2) throw new Error('רק עמודה אחת בכל טווח: ' + a1);
  if (r1 > r2) {
    var t = r1;
    r1 = r2;
    r2 = t;
  }
  return { col: c1, r1: r1, r2: r2 };
}

function getDistributionSyncMaxSpillRows_() {
  var n = CONFIG.distributionSyncMaxSpillRows;
  return typeof n === 'number' && n > 0 ? Math.floor(n) : 40;
}

function getDistributionTableSheet_(ss) {
  var name = CONFIG.sheets.distributionTable;
  if (!name || !String(name).trim()) return null;
  return ss.getSheetByName(String(name).trim()) || null;
}

function distributionSheetNamesForError_() {
  return String(CONFIG.sheets.distributionTable || '').trim() || '(לא הוגדר)';
}

function normalizeShareNameCell_(s) {
  var t = String(s == null ? '' : s).trim();
  if (t === '—' || t === '–' || t === '-') return '';
  return t;
}

/**
 * Reads one column from Share_Export starting at r1, up to maxRows, then drops trailing blanks.
 */
function readShareColumnSpill_(sheet, col, r1, maxRows) {
  var vals = [];
  for (var i = 0; i < maxRows; i++) {
    var raw = sheet.getRange(r1 + i, col).getDisplayValue();
    vals.push([normalizeShareNameCell_(raw)]);
  }
  while (vals.length > 0 && !vals[vals.length - 1][0]) vals.pop();
  return vals;
}

function getDistributionProtectedColumns_() {
  var p = CONFIG.distributionProtectedSheetColumns;
  if (p && p.length) return p;
  return [5, 7, 9, 11, 13, 15, 17];
}

function isDistributionColumnProtected_(col) {
  return getDistributionProtectedColumns_().indexOf(col) >= 0;
}

/** True if normalized text is an exact employee name key from MasterData. */
function isKnownMasterEmployeeName_(normalizedName, masterMap) {
  if (!normalizedName || !masterMap) return false;
  return Object.prototype.hasOwnProperty.call(masterMap, normalizedName) && !!masterMap[normalizedName];
}

/**
 * Value in Share_Export peek cell (row peekR, col) only if it normalizes to a known MasterData employee name.
 */
function peekEmployeeNameFromShareCell_(src, peekR, col, masterMap) {
  var raw = normalizeShareNameCell_(src.getRange(peekR, col).getDisplayValue());
  if (!raw || !isKnownMasterEmployeeName_(raw, masterMap)) return '';
  return raw;
}

/**
 * Clears only mapped **name** columns on the distribution sheet (never protected columns, e.g. Q).
 * Uses one cell at a time to reduce clearing merged regions that include location/hours.
 * Extent is based on Share_Export spill length + small pad (not a blind 40-row block unless needed).
 */
function clearDistributionTableNameTargets_(src, dst, masterMap) {
  var maxRead = getDistributionSyncMaxSpillRows_();
  var pad = 6;
  var i;
  for (i = 0; i < SHARE_EXPORT_TO_DISTRIBUTION_PAIRS_.length; i++) {
    var fp = parseA1SingleColumnRect_(SHARE_EXPORT_TO_DISTRIBUTION_PAIRS_[i][0]);
    var tp = parseA1SingleColumnRect_(SHARE_EXPORT_TO_DISTRIBUTION_PAIRS_[i][1]);
    if (isDistributionColumnProtected_(tp.col)) continue;

    var vals = readShareColumnSpill_(src, fp.col, fp.r1, maxRead);
    var peekR = fp.r2 + 1;
    var peekExtra = peekEmployeeNameFromShareCell_(src, peekR, fp.col, masterMap);
    var idx = peekR - fp.r1;
    var n = vals.length;
    if (peekExtra && (vals.length <= idx || !vals[idx] || !vals[idx][0])) {
      n = Math.max(n, idx + 1);
    }
    n = Math.max(n, tp.r2 - tp.r1 + 1);
    n = Math.min(n + pad, maxRead);
    var endR = tp.r1 + n - 1;
    var r;
    for (r = tp.r1; r <= endR; r++) {
      try { dst.getRange(r, tp.col).clearContent(); } catch (ce) { try { dst.getRange(r, tp.col).setValue(''); } catch (se) { /* skip protected/table cells */ } }
    }
  }
}

/**
 * Copies mapped Share_Export columns into the distribution sheet. Uses setValue per cell so merged
 * template cells do not cause setValues row-count errors; extra names below the original block spill down.
 *
 * Edge (once per mapping): row **fp.r2+1** in Share_Export is copied only if it matches an **employee name**
 * in MasterData (same normalized string as the Name column); random text in that cell is ignored.
 */
function copyShareExportSpillToDistribution_(src, dst, masterMap) {
  var maxRead = getDistributionSyncMaxSpillRows_();
  for (var i = 0; i < SHARE_EXPORT_TO_DISTRIBUTION_PAIRS_.length; i++) {
    var fp = parseA1SingleColumnRect_(SHARE_EXPORT_TO_DISTRIBUTION_PAIRS_[i][0]);
    var tp = parseA1SingleColumnRect_(SHARE_EXPORT_TO_DISTRIBUTION_PAIRS_[i][1]);
    if (isDistributionColumnProtected_(tp.col)) continue;
    var vals = readShareColumnSpill_(src, fp.col, fp.r1, maxRead);
    var peekR = fp.r2 + 1;
    var peekExtra = peekEmployeeNameFromShareCell_(src, peekR, fp.col, masterMap);
    var idx = peekR - fp.r1;
    if (!vals.length && !peekExtra) continue;
    var j;
    for (j = 0; j < vals.length; j++) {
      dst.getRange(tp.r1 + j, tp.col).setValue(vals[j][0]);
    }
    if (peekExtra && (vals.length <= idx || !vals[idx] || !vals[idx][0])) {
      dst.getRange(tp.r1 + idx, tp.col).setValue(peekExtra);
    }
  }
}

/**
 * Clears mapped strips on the distribution sheet, then copies from Share_Export (values only).
 */
function syncShareExportToDistributionTable_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var src = ss.getSheetByName(CONFIG.sheets.shareExport);
  var dst = getDistributionTableSheet_(ss);
  if (!src) throw new Error('לא נמצא גיליון "' + CONFIG.sheets.shareExport + '".');
  if (!dst) throw new Error('לא נמצא גיליון הפצה (' + distributionSheetNamesForError_() + ').');

  // Remove filter/table that can block cell writes
  var filter = dst.getFilter();
  if (filter) filter.remove();
  var bandings = dst.getBandings();
  for (var b = 0; b < bandings.length; b++) { try { bandings[b].remove(); } catch (x) {} }

  var masterMap = loadMasterData();
  clearDistributionTableNameTargets_(src, dst, masterMap);
  copyShareExportSpillToDistribution_(src, dst, masterMap);
}

/**
 * Read the FINAL schedule from the sheet (after manual edits) and log to ShiftHistory.
 * Called only when sharing — this is the "approved" schedule.
 */
function logHistoryFromSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.sheets.schedule);
  if (!sheet) return;

  var masterMap = loadMasterData();
  var responseData = loadAvailability();
  var availability = responseData.availability;
  // History/share path should also honor form-submitted targets when
  // computing the snapshot.
  setShiftTargetFormCache_(responseData.weeklyTargets || {});
  var slots = loadShiftTemplates();
  var sheetData = sheet.getDataRange().getValues();

  var empStats = {};
  var names = Object.keys(masterMap);
  for (var i = 0; i < names.length; i++) {
    empStats[names[i]] = {
      name: names[i],
      rank: masterMap[names[i]].rank,
      shiftsCount: 0, morningCount: 0, eveningCount: 0,
      shiftTarget: getShiftTarget(names[i], masterMap, availability)
    };
  }

  var locations = CONFIG.locations;
  for (var loc = 0; loc < locations.length; loc++) {
    var location = locations[loc];
    var locationLabel = CONFIG.locationNames[location] || location;
    var locationSlots = slots.filter(function(s) { return s.location === location; });

    var headerRow = -1;
    for (var r = 0; r < sheetData.length; r++) {
      for (var c = 0; c < sheetData[r].length; c++) {
        if (String(sheetData[r][c]).trim() === locationLabel) { headerRow = r; break; }
      }
      if (headerRow >= 0) break;
    }
    if (headerRow < 0) continue;

    for (var g = 0; g < DAY_GROUPS_.length; g++) {
      var days = DAY_GROUPS_[g];
      var groupStartCol = -1;
      for (var c = 0; c < sheetData[headerRow].length; c++) {
        if (String(sheetData[headerRow][c]).trim() === days[0]) { groupStartCol = c; break; }
      }
      if (groupStartCol < 0) continue;

      var dayRows = {};
      for (var d = 0; d < days.length; d++) {
        var day = days[d];
        var arr = locationSlots.filter(function(s) { return s.day === day; });
        arr.sort(function(a, b) {
          return (a.startTime || 0) - (b.startTime || 0) || (a.endTime || 0) - (b.endTime || 0);
        });
        dayRows[day] = arr;
      }

      for (var d = 0; d < days.length; d++) {
        var day = days[d];
        var arr = dayRows[day];
        for (var r = 0; r < arr.length; r++) {
          var slot = arr[r];
          var cellRow = headerRow + 1 + r;
          var cellCol = groupStartCol + d;
          var val = String(sheetData[cellRow] ? sheetData[cellRow][cellCol] || '' : '').trim();
          if (!val || val === '⚠' || val === 'מנהל') continue;

          var emp = masterMap[val];
          if (!emp || !empStats[val]) continue;

          empStats[val].shiftsCount++;
          if (slot.block === 'בוקר') empStats[val].morningCount++;
          else if (slot.block === 'ערב') empStats[val].eveningCount++;
        }
      }
    }
  }

  logShiftHistory(empStats, masterMap, availability, slots);
}

/**
 * Pads a row to exactly len columns.
 */
function padShareRow_(cells, len) {
  var out = [];
  for (var i = 0; i < len; i++) {
    out.push(i < cells.length && cells[i] != null && cells[i] !== undefined ? cells[i] : '');
  }
  return out;
}

/**
 * Pads or trims array to exactly len.
 */
function padArr_(arr, len, fill) {
  var out = arr.slice(0, len);
  while (out.length < len) out.push(fill || '');
  return out;
}

/**
 * Build data rows for one block of one location.
 * Returns [{ time, dayCells[7] }] — only the relevant day indices are filled.
 */
function buildBlockDataRows_(block) {
  var allDays = CONFIG.days;
  var dayIndices = [];
  for (var d = 0; d < block.days.length; d++) {
    for (var ai = 0; ai < allDays.length; ai++) {
      if (allDays[ai] === block.days[d]) { dayIndices.push(ai); break; }
    }
  }

  var rows = [];
  for (var ri = 0; ri < block.body.length; ri++) {
    var ro = block.body[ri];
    var dayCells = ['', '', '', '', '', '', ''];
    var hasContent = false;
    for (var di = 0; di < dayIndices.length; di++) {
      var name = sanitizeCellForShare_(ro.names[di] || '');
      dayCells[dayIndices[di]] = name;
      if (name && name !== '—') hasContent = true;
    }
    if (hasContent || ro.time) {
      rows.push({ time: ro.time || '', dayCells: dayCells });
    }
  }
  return rows;
}

/**
 * Sheet export: unified table per location with sub-blocks for each day-group,
 * both locations side by side, hours on the right, borderless poster look.
 * Sub-blocks are aligned across locations (padded to same height).
 */
function exportShareableScheduleToSheet_(data) {
  if (!data || !data.sections || !data.sections.length) return;

  var ss = SpreadsheetApp.getActive();
  var shName = CONFIG.sheets.shareExport;
  var sh = ss.getSheetByName(shName);
  if (!sh) {
    sh = ss.insertSheet(shName);
  } else {
    sh.clear();
    sh.clearFormats();
    sh.clearNotes();
    var mr = sh.getMaxRows(), mc = sh.getMaxColumns();
    if (mr > 0 && mc > 0) sh.getRange(1, 1, mr, mc).breakApart();
  }
  sh.setRightToLeft(true);

  var allDays = CONFIG.days;
  var nDays = allDays.length;
  var COLS_PER_LOC = nDays + 1; // time col + 7 day cols
  var GAP = 1;
  var numLocs = data.sections.length;
  var totalW = numLocs * COLS_PER_LOC + (numLocs - 1) * GAP;

  var HEADER_BG = '#2557a7';
  var HEADER_FG = '#FFFFFF';
  var LOC_BG = '#2557a7';
  var LOC_FG = '#FFFFFF';
  var TH_BG = '#e8edf4';
  var TH_FG = '#334155';
  var SUB_BG = '#dce6f1';
  var SUB_FG = '#1e3a5f';
  var TIME_FG = '#64748b';
  var STRIPE_A = '#FFFFFF';
  var STRIPE_B = '#f7f9fc';
  var EMPTY_FG = '#cbd5e1';
  var BG_FILL = '#f0f2f5';

  var grid = [];
  var meta = [];

  function addRow(cells, type) {
    grid.push(padShareRow_(cells, totalW));
    meta.push(type);
  }

  // Build a combined row from location cells: [loc0_cells] [gap] [loc1_cells] ...
  function combineLocCells(locCellArrays) {
    var combined = [];
    for (var si = 0; si < locCellArrays.length; si++) {
      var cells = locCellArrays[si];
      for (var c = 0; c < cells.length; c++) combined.push(cells[c]);
      if (si < locCellArrays.length - 1) combined.push('');
    }
    return combined;
  }

  // Make a single location's cell array: [time, day0, day1, ..., day6]
  function makeLocDataCells(dataRow) {
    if (!dataRow) return padArr_([], COLS_PER_LOC, '');
    var cells = [dataRow.time];
    for (var d = 0; d < nDays; d++) cells.push(dataRow.dayCells[d]);
    return cells;
  }

  function makeLocEmptyCells() {
    return padArr_([], COLS_PER_LOC, '');
  }

  // Title row
  addRow([data.title], 'title');
  addRow([''], 'spacer');

  // Location label row
  var locLabels = [];
  for (var si = 0; si < numLocs; si++) {
    var lbl = [data.sections[si].location];
    for (var x = 1; x < COLS_PER_LOC; x++) lbl.push('');
    locLabels.push(lbl);
  }
  addRow(combineLocCells(locLabels), 'loc');

  // Day header row
  var dayHeaders = [];
  for (var si = 0; si < numLocs; si++) {
    var dh = ['שעות'];
    for (var d = 0; d < nDays; d++) dh.push(allDays[d]);
    dayHeaders.push(dh);
  }
  addRow(combineLocCells(dayHeaders), 'thead');

  // Iterate block-by-block, aligned across locations
  var maxBlocks = 0;
  for (var si = 0; si < numLocs; si++) {
    if (data.sections[si].blocks.length > maxBlocks) maxBlocks = data.sections[si].blocks.length;
  }

  for (var bi = 0; bi < maxBlocks; bi++) {
    // Sub-header row — use the first location's subtitle
    var subLabel = '';
    for (var si = 0; si < numLocs; si++) {
      if (bi < data.sections[si].blocks.length) {
        subLabel = data.sections[si].blocks[bi].subtitle;
        break;
      }
    }

    // Check if any location has actual data for this block
    var anyData = false;
    var blockDataPerLoc = [];
    for (var si = 0; si < numLocs; si++) {
      if (bi < data.sections[si].blocks.length) {
        var rows = buildBlockDataRows_(data.sections[si].blocks[bi]);
        blockDataPerLoc.push(rows);
        if (rows.length > 0) anyData = true;
      } else {
        blockDataPerLoc.push([]);
      }
    }
    if (!anyData) continue;

    // Sub-header
    var subCells = [];
    for (var si = 0; si < numLocs; si++) {
      var sc = [subLabel];
      for (var x = 1; x < COLS_PER_LOC; x++) sc.push('');
      subCells.push(sc);
      if (si < numLocs - 1) subCells.push(['']); // gap
    }
    // Flatten subCells
    var subFlat = [];
    for (var si = 0; si < subCells.length; si++) {
      for (var c = 0; c < subCells[si].length; c++) subFlat.push(subCells[si][c]);
    }
    addRow(subFlat, 'subhead');

    // Find max data rows across locations for this block
    var maxDataRows = 0;
    for (var si = 0; si < numLocs; si++) {
      if (blockDataPerLoc[si].length > maxDataRows) maxDataRows = blockDataPerLoc[si].length;
    }

    // Data rows, padded to maxDataRows
    for (var ri = 0; ri < maxDataRows; ri++) {
      var rowCellArrays = [];
      for (var si = 0; si < numLocs; si++) {
        if (ri < blockDataPerLoc[si].length) {
          rowCellArrays.push(makeLocDataCells(blockDataPerLoc[si][ri]));
        } else {
          rowCellArrays.push(makeLocEmptyCells());
        }
      }
      addRow(combineLocCells(rowCellArrays), 'data');
    }
  }

  // Write grid
  var nRows = grid.length;
  if (nRows < 1) return;
  sh.getRange(1, 1, nRows, totalW).setValues(grid);
  sh.getRange(1, 1, nRows, totalW)
    .setFontFamily('Arial')
    .setFontSize(11)
    .setVerticalAlignment('middle')
    .setHorizontalAlignment('center')
    .setBackground('#FFFFFF')
    .setBorder(false, false, false, false, false, false);

  // Location column ranges
  var locCols = [];
  var col = 1;
  for (var si = 0; si < numLocs; si++) {
    locCols.push({ start: col, total: COLS_PER_LOC });
    col += COLS_PER_LOC + GAP;
  }

  var dataRowCount = 0;
  for (var ri = 0; ri < nRows; ri++) {
    var r = ri + 1;
    var ty = meta[ri];

    if (ty === 'title') {
      sh.getRange(r, 1, 1, totalW).merge()
        .setFontSize(15).setFontWeight('bold')
        .setBackground(HEADER_BG).setFontColor(HEADER_FG)
        .setHorizontalAlignment('center');
      sh.setRowHeight(r, 36);
      continue;
    }
    if (ty === 'spacer') {
      sh.getRange(r, 1, 1, totalW).setBackground(BG_FILL).setFontSize(4);
      sh.setRowHeight(r, 6);
      continue;
    }
    if (ty === 'loc') {
      for (var ci = 0; ci < locCols.length; ci++) {
        var lc = locCols[ci];
        sh.getRange(r, lc.start, 1, lc.total).merge()
          .setFontSize(13).setFontWeight('bold')
          .setBackground(LOC_BG).setFontColor(LOC_FG)
          .setHorizontalAlignment('center');
      }
      sh.setRowHeight(r, 30);
      continue;
    }
    if (ty === 'thead') {
      for (var ci = 0; ci < locCols.length; ci++) {
        var lc = locCols[ci];
        sh.getRange(r, lc.start, 1, lc.total)
          .setFontSize(11).setFontWeight('bold')
          .setBackground(TH_BG).setFontColor(TH_FG)
          .setHorizontalAlignment('center');
      }
      sh.setRowHeight(r, 26);
      continue;
    }
    if (ty === 'subhead') {
      dataRowCount = 0;
      for (var ci = 0; ci < locCols.length; ci++) {
        var lc = locCols[ci];
        sh.getRange(r, lc.start, 1, lc.total).merge()
          .setFontSize(10).setFontWeight('bold')
          .setBackground(SUB_BG).setFontColor(SUB_FG)
          .setHorizontalAlignment('center');
      }
      sh.setRowHeight(r, 22);
      continue;
    }
    if (ty === 'data') {
      dataRowCount++;
      var stripe = (dataRowCount % 2 === 1) ? STRIPE_A : STRIPE_B;
      for (var ci = 0; ci < locCols.length; ci++) {
        var lc = locCols[ci];
        sh.getRange(r, lc.start, 1, lc.total).setBackground(stripe).setFontSize(11);
        // Time column = first col in each loc block
        sh.getRange(r, lc.start)
          .setFontSize(9).setFontColor(TIME_FG).setFontWeight('bold');
        // Empty cells styling
        for (var cc = lc.start + 1; cc < lc.start + lc.total; cc++) {
          var val = sh.getRange(r, cc).getValue();
          if (val === '—' || val === '' || val === null) {
            sh.getRange(r, cc).setFontColor(EMPTY_FG);
          }
        }
      }
      sh.setRowHeight(r, 26);
      continue;
    }
  }

  // Column widths
  for (var ci = 0; ci < locCols.length; ci++) {
    var lc = locCols[ci];
    sh.setColumnWidth(lc.start, 76); // time col
    for (var cc = lc.start + 1; cc < lc.start + lc.total; cc++) {
      sh.setColumnWidth(cc, 64);
    }
  }
  // Gap columns
  for (var ci = 0; ci < locCols.length - 1; ci++) {
    var gapCol = locCols[ci].start + locCols[ci].total;
    sh.setColumnWidth(gapCol, 10);
  }

  ss.setActiveSheet(sh);
}

/**
 * @returns {Object|null} { title, sections: [{ location, blocks: [{ subtitle, days, body: [{ time, names[] }] }] }] }
 */
function buildShareableScheduleData_() {
  var ss = SpreadsheetApp.getActive();
  var sheet = ss.getSheetByName(CONFIG.sheets.schedule);
  if (!sheet) return null;
  var data = sheet.getDataRange().getDisplayValues();
  if (!data || data.length === 0) return null;

  var title = 'לו"ז ' + formatWeekRangeHebrew_(new Date());
  var sections = [];

  var r = 0;
  while (r < data.length) {
    var row = data[r];
    if (isFairnessTableStart_(row) || isLegendOrFooterForShare_(row)) break;
    if (isEmptyRowForShare_(row)) { r++; continue; }
    if (isTotalRowForShare_(row)) { r++; continue; }

    var blocks = parseBlockHeaders_(row);
    if (blocks.length === 0) { r++; continue; }

    if (!isLocationNameForShare_(String(row[0]).trim()) || !isDayNameForShare_(String(row[1]).trim())) {
      r++;
      continue;
    }

    var firstLoc = blocks[0].location;
    var blockList = [];
    for (var bi = 0; bi < blocks.length; bi++) {
      blockList.push({ meta: blocks[bi], rows: [] });
    }

    r++;
    while (r < data.length) {
      var drow = data[r];
      if (isFairnessTableStart_(drow) || isLegendOrFooterForShare_(drow)) break;
      if (isEmptyRowForShare_(drow)) { r++; continue; }
      if (isCostRowForShare_(drow)) { r++; break; }
      if (isTotalRowForShare_(drow)) { r++; break; }
      if (isBlockHeaderRowForShare_(drow) && isLocationNameForShare_(String(drow[0]).trim()) && isDayNameForShare_(String(drow[1]).trim())) { break; }

      if (isRowAllEmptyInBlocksForShare_(drow, blocks)) { r++; continue; }

      for (var bj = 0; bj < blocks.length; bj++) {
        var m = blocks[bj];
        var t = m.colStart < drow.length ? drow[m.colStart] : '';
        var names = [];
        for (var jk = 0; jk < m.days.length; jk++) {
          var cidx = m.dayColStart + jk;
          var raw = cidx < drow.length ? drow[cidx] : '';
          names.push(sanitizeCellForShare_(raw));
        }
        blockList[bj].rows.push({ time: String(t).trim(), names: names });
      }
      r++;
    }

    var outBlocks = [];
    for (var bz = 0; bz < blockList.length; bz++) {
      var m0 = blockList[bz].meta;
      var sub = blockSubtitleForShare_(m0.days);
      outBlocks.push({ subtitle: sub, days: m0.days, body: blockList[bz].rows });
    }
    sections.push({ location: firstLoc, blocks: outBlocks });
  }

  if (sections.length === 0) return null;
  return { title: title, sections: sections };
}

function blockSubtitleForShare_(days) {
  if (!days || !days.length) return '';
  if (days.length === 5 && days[0] === 'ראשון' && days[4] === 'חמישי') {
    return 'ראשון – חמישי';
  }
  if (days.length === 1) return days[0];
  return days.join(' · ');
}

function parseBlockHeaders_(row) {
  var blocks = [];
  if (!row || !row.length) return blocks;
  var c = 0;
  var maxC = row.length;
  while (c < maxC) {
    while (c < maxC && (row[c] === '' || row[c] == null)) c++;
    if (c >= maxC) break;
    var a = String(row[c]).trim();
    if (c + 1 >= maxC) break;
    var b = String(row[c + 1]).trim();
    if (!isLocationNameForShare_(a) || !isDayNameForShare_(b)) { c++; continue; }
    var colStart = c;
    c++;
    var days = [];
    while (c < maxC && isDayNameForShare_(String(row[c]).trim())) {
      days.push(String(row[c]).trim());
      c++;
    }
    if (days.length) {
      blocks.push({ location: a, colStart: colStart, dayColStart: colStart + 1, days: days, width: 1 + days.length });
    }
  }
  return blocks;
}

function isBlockHeaderRowForShare_(row) {
  if (!row || !row[0] || !row[1]) return false;
  return isLocationNameForShare_(String(row[0]).trim()) && isDayNameForShare_(String(row[1]).trim());
}

function isRowAllEmptyInBlocksForShare_(row, blocks) {
  var has = false;
  for (var b = 0; b < blocks.length; b++) {
    var m = blocks[b];
    var to = m.colStart + m.width;
    for (var i = m.colStart; i < to && i < row.length; i++) {
      if (row[i] != null && String(row[i]).trim() !== '') { has = true; break; }
    }
  }
  return !has;
}

function isEmptyRowForShare_(row) {
  for (var i = 0; i < row.length; i++) {
    if (row[i] != null && String(row[i]).trim() !== '') return false;
  }
  return true;
}

function isDayNameForShare_(s) {
  s = String(s).trim();
  for (var i = 0; i < CONFIG.days.length; i++) {
    if (CONFIG.days[i] === s) return true;
  }
  return false;
}

function isLocationNameForShare_(s) {
  s = String(s).trim();
  var locs = CONFIG.locationNames;
  for (var k in locs) {
    if (locs.hasOwnProperty(k) && locs[k] === s) return true;
  }
  return s === 'גאולה' || s === 'גורדון';
}

function isCostRowForShare_(row) {
  for (var i = 0; i < row.length; i++) {
    if (String(row[i]).trim() === 'עלות יומית') return true;
  }
  return false;
}

function isTotalRowForShare_(row) {
  if (!row || row[0] == null) return false;
  return String(row[0]).indexOf('סה"כ') === 0;
}

function isFairnessTableStart_(row) {
  if (!row || !row[0] || !row[1]) return false;
  return String(row[0]).trim() === 'שם' && String(row[1]).trim() === 'דרגה';
}

function isLegendOrFooterForShare_(row) {
  if (!row[0]) return false;
  var t = String(row[0]).trim();
  return t.indexOf('מקרא') === 0;
}

function sanitizeCellForShare_(v) {
  if (v == null) return '—';
  var s = String(v).trim();
  if (s === '' || s === '—') return '—';
  if (s === '⚠' || s.indexOf('⚠') >= 0) return '—';
  if (s.charCodeAt(0) === 9888) return '—';
  s = s.replace(/^\s*💰/g, '');
  return s;
}

function formatWeekRangeHebrew_(d) {
  var tz = Session.getScriptTimeZone() || 'Asia/Jerusalem';
  var now = d || new Date();
  var start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  var end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return Utilities.formatDate(start, tz, 'dd/MM/yyyy') + ' – ' + Utilities.formatDate(end, tz, 'dd/MM/yyyy');
}

/**
 * Build full HTML for the modal — beautiful poster-style schedule for screenshots.
 * Locations side-by-side, days RTL, borderless clean look.
 */
function buildShareScheduleDialogHtml_(data) {
  var bodyHtml = buildShareSchedulesTableHtml_(data);
  var h = [
    '<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="UTF-8">',
    '<base target="_top">',
    '<style>',
    '@import url("https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;600;700;800;900&display=swap");',
    '* { box-sizing: border-box; margin: 0; padding: 0; }',
    'body { font-family: "Heebo", "Arial Hebrew", Tahoma, sans-serif; font-size: 14px; background: #eef1f5; direction: rtl; color: #1a1a2e; -webkit-font-smoothing: antialiased; }',
    '',
    '.toolbar { position: sticky; top: 0; z-index: 100; background: rgba(255,255,255,0.92); backdrop-filter: blur(8px); border-bottom: 1px solid #e0e0e0; padding: 8px 16px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }',
    '.toolbar button { font-family: inherit; font-weight: 600; font-size: 13px; border: none; border-radius: 8px; padding: 8px 16px; cursor: pointer; transition: all 0.2s; }',
    '.btn-copy { background: #2563eb; color: #fff; }',
    '.btn-copy:hover { background: #1d4ed8; }',
    '.toolbar .hint { font-size: 11px; color: #888; }',
    '.toolbar .status { font-size: 12px; font-weight: 600; color: #16a34a; }',
    '',
    '#capture { max-width: 1100px; margin: 10px auto 16px; background: #fff; border-radius: 18px; overflow: hidden; box-shadow: 0 4px 30px rgba(0,0,0,0.07); }',
    '',
    '.hdr { background: linear-gradient(135deg, #1a2e4a 0%, #2557a7 60%, #3b82f6 100%); padding: 22px 24px 18px; text-align: center; position: relative; }',
    '.hdr-name { font-size: 22px; font-weight: 800; color: #fff; letter-spacing: 0.3px; }',
    '.hdr-week { font-size: 14px; font-weight: 400; color: rgba(255,255,255,0.8); margin-top: 2px; }',
    '',
    '.body { padding: 16px 18px 20px; }',
    '',
    '.day-group { margin-bottom: 18px; }',
    '.day-group:last-child { margin-bottom: 0; }',
    '.dg-title { font-size: 14px; font-weight: 700; color: #1e3a5f; margin-bottom: 8px; padding-right: 2px; }',
    '',
    '.pair { display: flex; gap: 14px; }',
    '.loc-col { flex: 1; min-width: 0; }',
    '.loc-label { font-size: 12px; font-weight: 700; color: #fff; background: #2557a7; display: inline-block; padding: 3px 14px; border-radius: 6px 6px 0 0; margin-bottom: 0; letter-spacing: 0.2px; }',
    '',
    '.grid { width: 100%; border-collapse: collapse; border-radius: 0 8px 8px 8px; overflow: hidden; background: #f7f9fc; }',
    '.grid th { background: #e8edf4; color: #334155; font-weight: 600; font-size: 12px; padding: 7px 4px; text-align: center; }',
    '.grid th.t-col { color: #64748b; font-size: 10px; font-weight: 600; }',
    '.grid td { padding: 7px 4px; text-align: center; font-size: 12px; font-weight: 500; color: #1e293b; }',
    '.grid td.t-cell { font-size: 10px; font-weight: 600; color: #94a3b8; white-space: nowrap; }',
    '.grid tr:nth-child(odd) td { background: #fff; }',
    '.grid tr:nth-child(even) td { background: #f7f9fc; }',
    '.grid .empty { color: #cbd5e1; }',
    '.grid .mgr { color: #7c3aed; font-weight: 600; }',
    '',
    '.ftr { padding: 10px 24px; background: #f8fafc; text-align: center; font-size: 10px; color: #a0aec0; }',
    '.ftr b { color: #64748b; }',
    '</style></head><body>',
    '<div class="toolbar">',
    '  <button class="btn-copy" type="button" onclick="copyTxt()">העתק טקסט ל-WhatsApp</button>',
    '  <span class="status" id="st"></span>',
    '  <span class="hint">צילום מסך: Cmd+Shift+4 (Mac) / Win+Shift+S</span>',
    '</div>',
    '<div id="capture">',
    bodyHtml,
    '</div>',
    '<script>',
    'function copyTxt(){',
    '  var el=document.getElementById("capture"); if(!el) return;',
    '  var txt=el.innerText;',
    '  var st=document.getElementById("st");',
    '  if(navigator.clipboard&&navigator.clipboard.writeText){',
    '    navigator.clipboard.writeText(txt).then(function(){st.textContent="\\u2705 הועתק!";}).catch(function(){st.textContent="Ctrl/Cmd+C";});',
    '  } else { st.textContent="בחרו והעתיקו ידנית"; }',
    '}',
    '</script>',
    '</body></html>'
  ];
  return h.join('\n');
}

/**
 * @param {Object} data from buildShareableScheduleData_()
 * @returns {string} inner HTML — poster-style, screenshot-ready, locations side by side, days RTL
 */
function buildShareSchedulesTableHtml_(data) {
  if (!data || !data.sections || !data.sections.length) return '<p style="padding:40px;text-align:center;color:#999;">אין נתונים</p>';
  return buildShareSchedulesTableHtmlImpl_(data);
}

/**
 * Merge sections (locations) into paired day-groups shown side by side.
 * Each location has blocks with matching day-groups (Sun-Thu, Friday, Saturday).
 * Days are reversed so Sunday is rightmost (RTL reading).
 */
function buildShareSchedulesTableHtmlImpl_(data) {
  var p = [];
  var brand = (CONFIG && CONFIG.brand) ? CONFIG.brand : {};
  var cafeName = brand.nameHe || '';
  // Header
  p.push('<div class="hdr">');
  if (cafeName) {
    p.push('<div class="hdr-name">' + escapeHtmlForShare_(cafeName) + ' — לו"ז משמרות</div>');
  }
  p.push('<div class="hdr-week">' + escapeHtmlForShare_(data.title) + '</div>');
  p.push('</div>');

  p.push('<div class="body">');

  // Build a map: blockIndex -> [{location, block}]
  var maxBlocks = 0;
  for (var s = 0; s < data.sections.length; s++) {
    if (data.sections[s].blocks.length > maxBlocks) maxBlocks = data.sections[s].blocks.length;
  }

  for (var bi = 0; bi < maxBlocks; bi++) {
    // Collect all locations that have this block index
    var pairs = [];
    for (var s = 0; s < data.sections.length; s++) {
      if (bi < data.sections[s].blocks.length) {
        pairs.push({ location: data.sections[s].location, block: data.sections[s].blocks[bi] });
      }
    }
    if (pairs.length === 0) continue;

    var groupTitle = pairs[0].block.subtitle;
    p.push('<div class="day-group">');
    p.push('<div class="dg-title">' + escapeHtmlForShare_(groupTitle) + '</div>');
    p.push('<div class="pair">');

    for (var pi = 0; pi < pairs.length; pi++) {
      var loc = pairs[pi].location;
      var bl = pairs[pi].block;
      var days = bl.days.slice().reverse();

      p.push('<div class="loc-col">');
      p.push('<div class="loc-label">' + escapeHtmlForShare_(loc) + '</div>');
      p.push('<table class="grid"><thead><tr>');
      for (var d = 0; d < days.length; d++) {
        p.push('<th>' + escapeHtmlForShare_(days[d]) + '</th>');
      }
      p.push('<th class="t-col">שעות</th>');
      p.push('</tr></thead><tbody>');

      for (var r = 0; r < bl.body.length; r++) {
        var ro = bl.body[r];
        var names = ro.names.slice().reverse();
        p.push('<tr>');
        for (var n = 0; n < names.length; n++) {
          var v = names[n];
          var cls = '';
          if (!v || v === '—') cls = ' class="empty"';
          else if (v === 'מנהל') cls = ' class="mgr"';
          p.push('<td' + cls + '>' + escapeHtmlForShare_(v) + '</td>');
        }
        p.push('<td class="t-cell">' + escapeHtmlForShare_(ro.time || '') + '</td>');
        p.push('</tr>');
      }

      p.push('</tbody></table>');
      p.push('</div>');
    }

    p.push('</div>'); // .pair
    p.push('</div>'); // .day-group
  }

  p.push('</div>'); // .body

  p.push('<div class="ftr">');
  if (cafeName) p.push('<b>' + escapeHtmlForShare_(cafeName) + '</b> · ');
  p.push('נוצר אוטומטית ע"י מערכת שיבוץ חכמה');
  p.push('</div>');

  return p.join('');
}

function escapeHtmlForShare_(s) {
  if (s == null) return '';
  s = String(s);
  s = s.replace(/&/g, '&amp;');
  s = s.replace(/</g, '&lt;');
  s = s.replace(/>/g, '&gt;');
  s = s.replace(/"/g, '&quot;');
  return s;
}

/** True when row 1 col 1 is the unified grid time header ("שעה"). */
function isUnifiedScheduleSheet_(data) {
  if (!data || data.length < 3) return false;
  return String(data[0][0]).trim() === 'שעה';
}

/**
 * Read coach names from the unified Schedule grid (handles merged cells via getDisplayValue).
 * @returns {Object} slotId → assignment object
 */
function readUnifiedScheduleAssignments_(sheet, timeGrid, slotIndex, masterMap, warnings) {
  var locations = CONFIG.locations;
  var perDayCols = locations.length;
  var firstDataRow = 3;
  var assignments = {};
  warnings = warnings || [];

  for (var t = 0; t < timeGrid.length; t++) {
    var row = firstDataRow + t;
    for (var d = 0; d < UNIFIED_SCHEDULE_DAYS_.length; d++) {
      var dayHe = UNIFIED_SCHEDULE_DAYS_[d];
      var dayMap = slotIndex[dayHe] || {};

      for (var li = 0; li < locations.length; li++) {
        var loc = locations[li];
        var col = 2 + d * perDayCols + li;
        var slot = dayMap[loc] && dayMap[loc][slotTimeKey_(timeGrid[t])];
        if (!slot) continue;

        var cellValue = String(sheet.getRange(row, col).getDisplayValue()).trim();
        if (!cellValue) continue;

        if (cellValue === SCHEDULE_INACTIVE_LABEL_HE_) {
          // Capacity slot marked "no class this week" — mark inactive and
          // skip the assignment lookup entirely.
          slot.inactive = true;
          continue;
        }
        if (cellValue === '⚠') {
          assignments[slot.slotId] = { unfilled: true };
          continue;
        }
        if (cellValue === 'מנהל') {
          assignments[slot.slotId] = { managerSlot: true, name: 'מנהל', unfilled: false };
          continue;
        }

        var emp = masterMap[cellValue];
        if (!emp) {
          warnings.push(cellValue + ' — לא נמצא ב-MasterData');
          continue;
        }
        assignments[slot.slotId] = { name: cellValue, rank: emp.rank, unfilled: false };
      }
    }
  }
  return assignments;
}

/**
 * Reapply green/orange/blue backgrounds and hover notes on every filled unified-grid cell.
 */
function reapplyUnifiedScheduleCellStyles_(
  sheet, timeGrid, slotIndex, assignments, masterMap, availability, slotMap, consecutiveShifts
) {
  var locations = CONFIG.locations;
  var perDayCols = locations.length;
  var firstDataRow = 3;

  for (var t = 0; t < timeGrid.length; t++) {
    var row = firstDataRow + t;
    for (var d = 0; d < UNIFIED_SCHEDULE_DAYS_.length; d++) {
      var dayHe = UNIFIED_SCHEDULE_DAYS_[d];
      var dayMap = slotIndex[dayHe] || {};

      for (var li = 0; li < locations.length; li++) {
        var loc = locations[li];
        var col = 2 + d * perDayCols + li;
        var slot = dayMap[loc] && dayMap[loc][slotTimeKey_(timeGrid[t])];
        if (!slot) continue;

        // Preserve "אין אימון" cells across refresh — they were tagged on
        // the slot during readUnifiedScheduleAssignments_.
        if (slot.inactive) {
          writeInactiveSlotCell_(sheet.getRange(row, col));
          continue;
        }

        var asgn = assignments[slot.slotId];
        if (!asgn && !sheet.getRange(row, col).getDisplayValue()) continue;

        writeScheduleAssignmentCell_(
          sheet.getRange(row, col), slot, asgn,
          masterMap, availability, assignments, slotMap, consecutiveShifts
        );
      }
    }
  }
}

/**
 * After manual schedule edits: refresh cell colors/notes and fairness table.
 * @returns {{ok:boolean, message:string, warnings:string[]}}
 */
function refreshScheduleFromSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.sheets.schedule);
  if (!sheet) {
    return { ok: false, message: 'לא נמצא טאב "' + CONFIG.sheets.schedule + '".', warnings: [] };
  }

  var masterMap = loadMasterData();
  var slots = loadShiftTemplates();
  var responseData = loadAvailability();
  var availability = responseData.availability;
  var notes = responseData.notes || {};
  // Refresh path also needs the form-target cache for getShiftTarget.
  setShiftTargetFormCache_(responseData.weeklyTargets || {});
  var data = sheet.getDataRange().getValues();
  var slotMap = buildSlotMap_(slots);
  var warnings = [];

  if (!isUnifiedScheduleSheet_(data)) {
    return {
      ok: false,
      message: 'גיליון הלו"ז אינו בפריסה המאוחדת (שורה 1: "שעה"). הרץ שיבוץ שבועי לבניית הלו"ז.',
      warnings: warnings
    };
  }

  var timeGrid = buildOrderedTimeGrid_(slots);
  var slotIndex = buildSlotIndexByDayLocationTime_(slots);
  var currentAssignments = readUnifiedScheduleAssignments_(sheet, timeGrid, slotIndex, masterMap, warnings);
  var consecutiveShifts = computeConsecutiveShiftsMap_(slots, currentAssignments);
  // Wipe stale validations before re-applying styles. The grid cells get fresh
  // coach-name dropdowns added back via setOverrideDropdown_; fairness/legend
  // cells stay validation-free so their status text doesn't trip "Invalid".
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();
  reapplyUnifiedScheduleCellStyles_(
    sheet, timeGrid, slotIndex, currentAssignments, masterMap, availability, slotMap, consecutiveShifts
  );

  var lastDataRow = 2 + timeGrid.length;
  applyUnifiedScheduleLayout_(sheet, 1, lastDataRow);

  var empStats = {};
  var allNames = Object.keys(masterMap);
  for (var i = 0; i < allNames.length; i++) {
    empStats[allNames[i]] = {
      name: allNames[i],
      rank: masterMap[allNames[i]].rank,
      shiftsCount: 0,
      morningCount: 0,
      eveningCount: 0,
      shiftTarget: getShiftTarget(allNames[i], masterMap, availability)
    };
  }
  var asgnKeys = Object.keys(currentAssignments);
  for (var i = 0; i < asgnKeys.length; i++) {
    var a = currentAssignments[asgnKeys[i]];
    if (!a || !a.name || !empStats[a.name]) continue;
    empStats[a.name].shiftsCount++;
    var parts = asgnKeys[i].split('_');
    var block = parts[2] || '';
    if (block === 'בוקר') empStats[a.name].morningCount++;
    else if (block === 'ערב') empStats[a.name].eveningCount++;
  }

  var fairnessHeaderRow = -1;
  for (var r = 0; r < data.length; r++) {
    if (String(data[r][0]).trim() === 'שם' && String(data[r][1]).trim() === 'דרגה') {
      fairnessHeaderRow = r;
      break;
    }
  }
  if (fairnessHeaderRow >= 0) {
    writeFairnessTable_(sheet, empStats, masterMap, availability, slots, fairnessHeaderRow + 1, notes);
  }

  centerAllScheduleCells_(sheet);

  return { ok: true, message: '', warnings: warnings };
}
