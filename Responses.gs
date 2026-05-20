/**
 * Parses Form Responses into availability for the optimizer.
 *
 * Supported layouts:
 *   A) Mentor day column (default): one column per day — time-range checkboxes
 *      (e.g. "7:00 עד 9:00"). Optimizer matches hourly training slots strictly inside ranges.
 *   Per-day notes: columns "הערה ראשון" … (optional paragraph in form).
 *   B) Split blocks: "ראשון בוקר", "ראשון ערב" (still supported).
 *   C) Legacy time columns: … בוקר התחלה/סיום (still supported).
 *   D) Legacy text: "בוקר", "ערב" in the day cell.
 */
/** Sheet the optimizer reads for availability (demo or live, per CONFIG.useDemoResponses). */
function getAvailabilitySheetName_() {
  return CONFIG.useDemoResponses ? CONFIG.sheets.responsesDemo : CONFIG.sheets.responses;
}

function getLiveResponsesSheetName_() {
  return CONFIG.sheets.responses;
}

function loadAvailability(optSheet) {
  var sheet;
  if (optSheet) {
    sheet = optSheet;
  } else {
    var sheetName = getAvailabilitySheetName_();
    sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (!sheet) {
      throw new Error(
        "Sheet '" + sheetName + "' not found." +
        (CONFIG.useDemoResponses
          ? ' הריצו מהתפריט: ⚙️ הגדרה ובדיקה → צור טאב תשובות דמו.'
          : '')
      );
    }
  }

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) throw new Error("Responses sheet is empty (no data rows).");

  var headers = data[0];
  var layout = detectResponsesLayout_(headers);
  var latestByName = buildLatestResponseRows_(data, layout.nameCol);

  var availability = {};
  var notes = {};
  var dayNotes = {};
  var names = Object.keys(latestByName);

  for (var n = 0; n < names.length; n++) {
    var empName = names[n];
    var row = latestByName[empName];
    availability[empName] = {};
    dayNotes[empName] = {};

    if (layout.mode === 'blocks') {
      for (var d = 0; d < CONFIG.days.length; d++) {
        var day = CONFIG.days[d];
        var blocks = blocksFromDayFields_(row, layout.dayFields[day]);
        availability[empName][day] = mentorRangesFromBlockLabels_(blocks, day);
      }
    } else {
      for (var d = 0; d < CONFIG.days.length; d++) {
        var day = CONFIG.days[d];
        var col = layout.dayColumns[day];
        if (col === undefined) {
          availability[empName][day] = [];
          continue;
        }
        if (layout.mode === 'dayRanges') {
          availability[empName][day] = mentorRangesFromDayCell_(row[col], day);
        } else {
          var legacyBlocks = blocksFromLegacyDayCell_(row[col]);
          availability[empName][day] = mentorRangesFromBlockLabels_(legacyBlocks, day);
        }
      }
    }

    if (layout.notesCol !== -1 && row[layout.notesCol]) {
      var noteText = String(row[layout.notesCol]).trim();
      if (noteText && noteText !== 'undefined') {
        notes[empName] = noteText;
      }
    }

    if (layout.dayNoteColumns) {
      for (var dn = 0; dn < MENTOR_WEEKDAYS_HE_.length; dn++) {
        var noteDay = MENTOR_WEEKDAYS_HE_[dn];
        var noteCol = layout.dayNoteColumns[noteDay];
        if (noteCol === undefined || noteCol < 0) continue;
        var dayNoteText = String(row[noteCol] || '').trim();
        if (dayNoteText && dayNoteText !== 'undefined') {
          dayNotes[empName][noteDay] = dayNoteText;
        }
      }
    }
  }

  return { availability: availability, notes: notes, dayNotes: dayNotes };
}

/**
 * @param {Array} headers
 * @returns {{mode:string, nameCol:number, notesCol:number, dayColumns:Object, dayFields:Object}}
 */
function detectResponsesLayout_(headers) {
  var dayColumns = {};
  var dayFields = {};
  var dayNoteColumns = {};
  var nameCol = -1;
  var notesCol = -1;
  var currentDay = null;
  var blockFieldCount = 0;

  for (var d = 0; d < CONFIG.days.length; d++) {
    dayFields[CONFIG.days[d]] = {};
  }
  for (var nd = 0; nd < MENTOR_WEEKDAYS_HE_.length; nd++) {
    dayNoteColumns[MENTOR_WEEKDAYS_HE_[nd]] = -1;
  }

  for (var c = 0; c < headers.length; c++) {
    var header = String(headers[c]).trim();
    if (!header) continue;

    if (isNameResponseHeader_(header)) {
      nameCol = c;
      continue;
    }
    if (header === 'הערות') {
      notesCol = c;
      continue;
    }

    var noteDayMatch = matchMentorDayNoteHeader_(header);
    if (noteDayMatch) {
      dayNoteColumns[noteDayMatch] = c;
      continue;
    }
    if (header === 'Timestamp' || header === 'Email Address' || header.indexOf('חותמת') >= 0) {
      continue;
    }

    var bilingualDay = matchMentorDayColumnHeader_(header);
    if (bilingualDay) {
      dayColumns[bilingualDay] = c;
      currentDay = null;
      continue;
    }

    var matchedDay = null;
    for (var d = 0; d < CONFIG.days.length; d++) {
      if (header === CONFIG.days[d]) {
        dayColumns[CONFIG.days[d]] = c;
        matchedDay = CONFIG.days[d];
        break;
      }
      if (header.indexOf(CONFIG.days[d]) >= 0) {
        matchedDay = CONFIG.days[d];
      }
    }

    if (matchedDay && header === matchedDay) {
      currentDay = null;
      continue;
    }

    if (matchedDay) {
      currentDay = matchedDay;
    }

    if (!currentDay) continue;

    if (header.indexOf('בוקר') >= 0) {
      if (header.indexOf('התחלה') >= 0 || header.indexOf('התחל') >= 0) {
        dayFields[currentDay].morningStart = c;
        blockFieldCount++;
      } else if (header.indexOf('סיום') >= 0) {
        dayFields[currentDay].morningEnd = c;
        blockFieldCount++;
      } else {
        dayFields[currentDay].morningBlock = c;
        blockFieldCount++;
      }
    } else if (header.indexOf('ערב') >= 0) {
      if (header.indexOf('התחלה') >= 0 || header.indexOf('התחל') >= 0) {
        dayFields[currentDay].eveningStart = c;
        blockFieldCount++;
      } else if (header.indexOf('סיום') >= 0) {
        dayFields[currentDay].eveningEnd = c;
        blockFieldCount++;
      } else {
        dayFields[currentDay].eveningBlock = c;
        blockFieldCount++;
      }
    }
  }

  if (nameCol === -1) {
    nameCol = 1;
  }

  var hasDayColumns = false;
  for (var di = 0; di < CONFIG.days.length; di++) {
    if (dayColumns[CONFIG.days[di]] !== undefined) hasDayColumns = true;
  }

  var mode;
  if (blockFieldCount >= 2) {
    mode = 'blocks';
  } else if (hasDayColumns) {
    mode = 'dayRanges';
  } else {
    mode = 'legacy';
  }

  return {
    mode: mode,
    nameCol: nameCol,
    notesCol: notesCol,
    dayColumns: dayColumns,
    dayFields: dayFields,
    dayNoteColumns: dayNoteColumns
  };
}

/** Maps "הערה ראשון" / "הערה ראשון-Domingo" → Hebrew day key. */
function matchMentorDayNoteHeader_(header) {
  var h = String(header || '').trim();
  if (h.indexOf('הערה') !== 0) return null;
  for (var i = 0; i < MENTOR_WEEKDAYS_HE_.length; i++) {
    var day = MENTOR_WEEKDAYS_HE_[i];
    if (h === mentorDayNoteHeader_(day) || h.indexOf(day) >= 0) return day;
  }
  return null;
}

function isNameResponseHeader_(header) {
  if (header === 'שם העובד') return true;
  if (header.indexOf('שם') !== 0) return false;
  return header.indexOf('עובד') >= 0
    || header.indexOf('מאמן') >= 0
    || header.indexOf('מאבחן') >= 0
    || header.indexOf('מנטור') >= 0;
}

function buildLatestResponseRows_(data, nameCol) {
  var latestByName = {};
  for (var r = 1; r < data.length; r++) {
    var name = String(data[r][nameCol]).trim();
    if (name && name !== 'לא זמין') {
      latestByName[name] = data[r];
    }
  }
  return latestByName;
}

function hasTimeValue_(cell) {
  if (cell === null || cell === undefined) return false;
  if (cell instanceof Date && !isNaN(cell.getTime())) return true;
  var s = String(cell).trim();
  if (s === '' || s === 'undefined') return false;
  if (isMentorNotAvailableText_(s)) return false;
  return true;
}

/**
 * @param {Object} fields - { morningStart?, morningEnd?, eveningStart?, eveningEnd? }
 */
function blocksFromDayFields_(row, fields) {
  if (!fields) return [];
  var blocks = [];
  var morning = hasTimeValue_(row[fields.morningStart])
    || hasTimeValue_(row[fields.morningEnd])
    || hasTimeValue_(row[fields.morningBlock]);
  var evening = hasTimeValue_(row[fields.eveningStart])
    || hasTimeValue_(row[fields.eveningEnd])
    || hasTimeValue_(row[fields.eveningBlock]);
  if (morning) blocks.push('בוקר');
  if (evening) blocks.push('ערב');
  return blocks;
}

/** Last column index (1-based) with a real header — skips empty / "Column 13" placeholders. */
function countResponseHeaderColumns_(headers) {
  var last = 0;
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || '').trim();
    if (!h) continue;
    if (/^Column\s+\d+$/i.test(h)) continue;
    last = c + 1;
  }
  return last;
}

/** Header row for demo/live parsing — trims junk columns; falls back if legacy time form. */
function getResponseHeadersFromSheet_(sheet) {
  if (!sheet || sheet.getLastColumn() < 1) return buildDefaultMentorFormHeaders_();
  var raw = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  if (responsesHeadersNeedDefaultMentorFormat_(raw)) return buildDefaultMentorFormHeaders_();
  var n = countResponseHeaderColumns_(raw);
  if (n < 2) return buildDefaultMentorFormHeaders_();
  return raw.slice(0, n);
}

function trimResponseSheetColumns_(sheet, numCols) {
  if (!sheet || numCols < 1) return;
  var maxCols = sheet.getMaxColumns();
  if (maxCols > numCols) {
    sheet.deleteColumns(numCols + 1, maxCols - numCols);
  }
}

/** Removes Google Sheets "Table" objects (purple headers / extra empty columns). */
function removeSheetTables_(sheet) {
  if (!sheet) return;
  try {
    if (typeof sheet.getTables === 'function') {
      var tables = sheet.getTables();
      for (var i = tables.length - 1; i >= 0; i--) {
        tables[i].remove();
      }
    }
  } catch (e) {
    Logger.log('removeSheetTables_: ' + e);
  }
}

/**
 * Demo tab: plain sheet with header row only — NOT linked to Google Form.
 * Never copyTo() the live form tab (that copies Form table + purple columns).
 *
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function ensureDemoResponsesSheet_(ss) {
  ss = ss || SpreadsheetApp.getActiveSpreadsheet();
  var liveName = getLiveResponsesSheetName_();
  var demoName = CONFIG.sheets.responsesDemo;
  var live = ss.getSheetByName(liveName);
  var demo = ss.getSheetByName(demoName);
  var headers = live ? getResponseHeadersFromSheet_(live) : buildDefaultMentorFormHeaders_();

  if (!demo) {
    demo = ss.insertSheet(demoName);
  } else {
    removeSheetTables_(demo);
  }

  demo.clear();
  demo.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#2E7D6B').setFontColor('#FFFFFF');
  demo.setFrozenRows(1);
  trimResponseSheetColumns_(demo, headers.length);
  for (var col = 1; col <= headers.length; col++) demo.autoResizeColumn(col);

  return demo;
}

function blocksFromLegacyDayCell_(cellVal) {
  var s = String(cellVal || '').trim();
  if (!s || s === 'לא זמין' || s === 'undefined') return [];
  return s.split(',')
    .map(function(part) { return part.trim(); })
    .filter(function(b) { return b && b !== 'לא זמין'; });
}

/** Default availability window when legacy "בוקר" / "ערב" text is used. */
function mentorDefaultBlockWindow_(block, dayHe) {
  if (block === 'בוקר') {
    return { startHour: 7, endHour: 12 };
  }
  if (block === 'ערב' && mentorFormDayIncludesEvening_(dayHe)) {
    return { startHour: 16, endHour: 21.25 };
  }
  return null;
}

/**
 * Expand legacy block labels to time ranges for strict slot matching.
 * @param {string[]} blocks
 * @param {string} dayHe
 * @returns {Array<{startHour:number, endHour:number}>}
 */
function mentorRangesFromBlockLabels_(blocks, dayHe) {
  var ranges = [];
  if (!blocks || !blocks.length) return ranges;
  for (var i = 0; i < blocks.length; i++) {
    var win = mentorDefaultBlockWindow_(blocks[i], dayHe);
    if (win) ranges.push(win);
  }
  return ranges;
}

/**
 * Parse one range label "7:00 עד 9:00" → { startHour, endHour } (decimal hours).
 * @returns {Object|null}
 */
function parseMentorRangeFromText_(text) {
  var t = normalizeMentorRangeText_(text);
  if (!t || isMentorNotAvailableText_(t)) return null;

  var m = t.match(/(\d{1,2})(?::(\d{2}))?\s*עד\s*(\d{1,2})(?::(\d{2}))?/i);
  if (!m) return null;
  var startH = parseInt(m[1], 10);
  var startM = m[2] ? parseInt(m[2], 10) : 0;
  var endH = parseInt(m[3], 10);
  var endM = m[4] ? parseInt(m[4], 10) : 0;
  return {
    startHour: startH + startM / 60,
    endHour: endH + endM / 60
  };
}

/**
 * Parse a day cell into strict time ranges for the optimizer.
 * @param {*} cellVal
 * @param {string} dayHe
 * @returns {Array<{startHour:number, endHour:number}>}
 */
function mentorRangesFromDayCell_(cellVal, dayHe) {
  var s = String(cellVal || '').trim();
  if (!s || s === 'undefined' || isMentorNotAvailableText_(s)) return [];

  if (s.indexOf('בוקר') >= 0 || s.indexOf('ערב') >= 0) {
    return mentorRangesFromBlockLabels_(blocksFromLegacyDayCell_(cellVal), dayHe);
  }

  var parts = s.split(/[,;]+/)
    .map(function(part) { return part.trim(); })
    .filter(function(part) { return part && !isMentorNotAvailableText_(part); });

  var ranges = [];
  for (var p = 0; p < parts.length; p++) {
    var r = parseMentorRangeFromText_(parts[p]);
    if (r) ranges.push(r);
  }
  return ranges;
}

/**
 * True when slot [startTime, endTime] lies fully inside at least one availability range.
 */
function slotCoveredByMentorRanges_(slot, ranges) {
  if (!ranges || !ranges.length) return false;
  var st = slot.startTime;
  var en = slot.endTime;
  if (st === null || st === undefined || en === null || en === undefined) return false;
  for (var i = 0; i < ranges.length; i++) {
    var r = ranges[i];
    if (r.startHour <= st && r.endHour >= en) return true;
  }
  return false;
}

/**
 * @deprecated Block list from day cell — use mentorRangesFromDayCell_ for optimizer.
 * One column per day with time-range label(s), e.g. "7:00 עד 10:00, 16:00 עד 20:15".
 */
function blocksFromMentorDayCell_(cellVal) {
  var s = String(cellVal || '').trim();
  if (!s || s === 'undefined' || isMentorNotAvailableText_(s)) return [];

  if (s.indexOf('בוקר') >= 0 || s.indexOf('ערב') >= 0) {
    var legacy = blocksFromLegacyDayCell_(cellVal);
    var out = [];
    for (var i = 0; i < legacy.length; i++) {
      if (legacy[i] === 'בוקר' || legacy[i] === 'ערב') out.push(legacy[i]);
    }
    if (out.length > 0) return out;
  }

  var parts = s.split(/[,;]+/)
    .map(function(part) { return part.trim(); })
    .filter(function(part) { return part && !isMentorNotAvailableText_(part); });

  var hasMorning = false;
  var hasEvening = false;
  for (var p = 0; p < parts.length; p++) {
    if (mentorRangeIsMorning_(parts[p])) hasMorning = true;
    else if (mentorRangeIsEvening_(parts[p])) hasEvening = true;
  }

  var blocks = [];
  if (hasMorning) blocks.push('בוקר');
  if (hasEvening) blocks.push('ערב');
  return blocks;
}

function mentorRangeIsMorning_(text) {
  var t = normalizeMentorRangeText_(text);
  for (var i = 0; i < MENTOR_MORNING_LABELS_.length; i++) {
    if (t === normalizeMentorRangeText_(MENTOR_MORNING_LABELS_[i])) return true;
  }
  var h = parseMentorRangeStartHour_(t);
  return h !== null && h < 12;
}

function mentorRangeIsEvening_(text) {
  var t = normalizeMentorRangeText_(text);
  for (var i = 0; i < MENTOR_EVENING_LABELS_.length; i++) {
    if (t === normalizeMentorRangeText_(MENTOR_EVENING_LABELS_[i])) return true;
  }
  var h = parseMentorRangeStartHour_(t);
  return h !== null && h >= 12;
}

function normalizeMentorRangeText_(text) {
  return String(text || '').trim().replace(/\s+/g, ' ');
}

/** Start hour from "7:00 עד 10:00" or "7 עד 10". */
function parseMentorRangeStartHour_(text) {
  var m = String(text).match(/(\d{1,2})(?::(\d{2}))?\s*עד/i);
  if (!m) return null;
  return parseInt(m[1], 10);
}

// ============================================================
//  Raw form responses archive (weekly snapshots)
// ============================================================

/**
 * Archive all current rows from CONFIG.sheets.responses into a cumulative sheet.
 * Appends rows: ArchivedAt | WeekLabel | <original headers...>
 *
 * @returns {{archivedRows:number, weekLabel:string, archiveSheetName:string}}
 */
function archiveCurrentFormResponses_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sourceName = CONFIG.sheets.responses;
  var archiveName = 'FormResponsesArchive';

  var src = ss.getSheetByName(sourceName);
  if (!src) throw new Error("Sheet '" + sourceName + "' not found.");

  var lastRow = src.getLastRow();
  var lastCol = src.getLastColumn();
  if (lastRow < 2 || lastCol < 1) {
    return { archivedRows: 0, weekLabel: getCurrentWeekLabel_(), archiveSheetName: archiveName };
  }

  var headers = src.getRange(1, 1, 1, lastCol).getValues()[0];
  var data = src.getRange(2, 1, lastRow - 1, lastCol).getValues();
  if (!data || data.length === 0) {
    return { archivedRows: 0, weekLabel: getCurrentWeekLabel_(), archiveSheetName: archiveName };
  }

  var archive = ss.getSheetByName(archiveName);
  if (!archive) {
    archive = ss.insertSheet(archiveName);
    archive.setRightToLeft(true);
  }

  // Ensure archive headers exist and match expected shape.
  var expectedHeaders = ['ArchivedAt', 'WeekLabel'].concat(headers.map(function(h) { return String(h || '').trim(); }));
  var archiveLastRow = archive.getLastRow();
  if (archiveLastRow < 1) {
    archive.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders])
      .setFontWeight('bold')
      .setBackground('#2E75B6')
      .setFontColor('#FFFFFF');
    archive.setFrozenRows(1);
  } else {
    var existing = archive.getRange(1, 1, 1, archive.getLastColumn()).getValues()[0];
    var ok = existing.length >= expectedHeaders.length;
    if (ok) {
      for (var i = 0; i < expectedHeaders.length; i++) {
        if (String(existing[i] || '').trim() !== String(expectedHeaders[i] || '').trim()) { ok = false; break; }
      }
    }
    if (!ok) {
      // If someone edited the archive sheet, don't silently corrupt; fail fast.
      throw new Error(
        'כותרות הארכיון אינן תואמות. נא להחזיר את שורת הכותרות בטאב "' + archiveName + '" ' +
        'או ליצור טאב ארכיון חדש.'
      );
    }
  }

  var tz = Session.getScriptTimeZone() || 'Asia/Jerusalem';
  var archivedAt = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  var weekLabel = getCurrentWeekLabel_();

  var out = [];
  for (var r = 0; r < data.length; r++) {
    out.push([archivedAt, weekLabel].concat(data[r]));
  }

  archive.getRange(archive.getLastRow() + 1, 1, out.length, expectedHeaders.length).setValues(out);
  return { archivedRows: out.length, weekLabel: weekLabel, archiveSheetName: archiveName };
}

/**
 * Remove all data rows (keep header row) from CONFIG.sheets.responses.
 * Uses physical row deletion — not clearContent — so the linked Google Form
 * resumes appending new submissions at row 2 instead of after "ghost" empty rows.
 *
 * @returns {{clearedRows:number, sheetName:string}}
 */
function clearFormResponsesDataRows_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sourceName = CONFIG.sheets.responses;
  var src = ss.getSheetByName(sourceName);
  if (!src) throw new Error("Sheet '" + sourceName + "' not found.");

  var lastRow = src.getLastRow();
  if (lastRow < 2) {
    resetMakeAvailabilityNotifyCycle_();
    return { clearedRows: 0, sheetName: sourceName };
  }

  var numDataRows = lastRow - 1;
  src.deleteRows(2, numDataRows);
  resetMakeAvailabilityNotifyCycle_();
  return { clearedRows: numDataRows, sheetName: sourceName };
}

/**
 * Document lock + archive form rows + physical row delete (same as end of "הפץ לו"ז וסגור שבוע").
 * Does not build share sheet or update ShiftHistory.
 */
function archiveAndClearFormResponsesLikeShare_() {
  try {
    var lock = LockService.getDocumentLock();
    if (!lock.tryLock(15 * 1000)) {
      SpreadsheetApp.getActive().toast(
        'לא הצלחתי לקבל נעילה לארכוב תשובות טופס. נסו שוב בעוד רגע (לא נוקה ולא הועתק).',
        '⚠️ ארכוב טופס',
        8
      );
      return;
    }
    try {
      var arch = archiveCurrentFormResponses_();
      if (arch && arch.archivedRows > 0) {
        var cleared = clearFormResponsesDataRows_();
        SpreadsheetApp.getActive().toast(
          'נשמרו ' +
            arch.archivedRows +
            ' תשובות ל-"' +
            arch.archiveSheetName +
            '" (שבוע ' +
            arch.weekLabel +
            '), ונוקה "' +
            cleared.sheetName +
            '".',
          '🗂️ ארכוב טופס',
          8
        );
      }
    } finally {
      lock.releaseLock();
    }
  } catch (e2) {
    Logger.log('archive/clear responses failed: ' + e2 + (e2 && e2.stack ? '\n' + e2.stack : ''));
    SpreadsheetApp.getActive().toast(
      'ארכוב/ניקוי תשובות הטופס נכשל: ' + String(e2 && e2.message ? e2.message : e2),
      '⚠️ ארכוב טופס',
      10
    );
  }
}

/**
 * Week label = Sunday date of current week, formatted dd/MM/yyyy.
 * Matches ShiftHistory's week label logic.
 */
function getCurrentWeekLabel_() {
  var tz = Session.getScriptTimeZone() || 'Asia/Jerusalem';
  var now = new Date();
  var sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  return Utilities.formatDate(sunday, tz, 'dd/MM/yyyy');
}

// ============================================================
//  Per-coach availability summary (extra columns in Responses)
// ============================================================

var AVAIL_SUMMARY_HOURS_HEADER_ = 'שעות זמינות';
var AVAIL_SUMMARY_SHIFTS_HEADER_ = 'משמרות זמינות';

/**
 * Append/refresh two summary columns at the right edge of a responses sheet:
 *   • "שעות זמינות"   — total submitted availability hours per coach
 *   • "משמרות זמינות" — distinct (day, morning/evening) shifts the coach
 *                       submitted at least one availability range for
 *
 * Idempotent: re-runs reuse the existing columns. Works on both the live
 * Form-bound sheet and the demo sheet. Adding columns to the right of the
 * form-bound columns is safe — Google Forms only writes to its own columns.
 */
function updateAvailabilitySummary_(sheet, availability) {
  if (!sheet || !availability) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  var nameCol = -1;
  var hoursCol = -1;
  var shiftsCol = -1;
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || '').trim();
    if (h === AVAIL_SUMMARY_HOURS_HEADER_) hoursCol = c + 1;
    else if (h === AVAIL_SUMMARY_SHIFTS_HEADER_) shiftsCol = c + 1;
    else if (nameCol === -1 && isNameResponseHeader_(h)) nameCol = c + 1;
  }
  if (nameCol === -1) return;

  if (hoursCol === -1) {
    hoursCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, hoursCol).setValue(AVAIL_SUMMARY_HOURS_HEADER_)
      .setFontWeight('bold').setBackground('#2E7D6B').setFontColor('#FFFFFF');
  }
  if (shiftsCol === -1) {
    shiftsCol = sheet.getLastColumn() + 1;
    sheet.getRange(1, shiftsCol).setValue(AVAIL_SUMMARY_SHIFTS_HEADER_)
      .setFontWeight('bold').setBackground('#2E7D6B').setFontColor('#FFFFFF');
  }

  var nameValues = sheet.getRange(2, nameCol, lastRow - 1, 1).getValues();
  var hoursValues = [];
  var shiftsValues = [];
  for (var r = 0; r < nameValues.length; r++) {
    var name = String(nameValues[r][0] || '').trim();
    var stats = computeAvailabilityStats_(name ? availability[name] : null);
    hoursValues.push([stats.hours]);
    shiftsValues.push([stats.shifts]);
  }
  sheet.getRange(2, hoursCol, hoursValues.length, 1).setValues(hoursValues);
  sheet.getRange(2, shiftsCol, shiftsValues.length, 1).setValues(shiftsValues);
  sheet.autoResizeColumn(hoursCol);
  sheet.autoResizeColumn(shiftsCol);
}

/**
 * Sum hours and count distinct (day, block) shifts from one coach's parsed
 * availability. Returns { hours: number, shifts: number }.
 */
function computeAvailabilityStats_(coachAvail) {
  if (!coachAvail) return { hours: 0, shifts: 0 };
  var hours = 0;
  var seenShifts = {};
  var days = Object.keys(coachAvail);

  for (var d = 0; d < days.length; d++) {
    var day = days[d];
    var ranges = coachAvail[day];
    if (!ranges || !ranges.length) continue;

    if (typeof ranges[0] === 'string') {
      // Legacy "בוקר" / "ערב" labels — assume 5 trainings (5 hours) per block.
      for (var b = 0; b < ranges.length; b++) {
        var label = ranges[b];
        if (label !== 'בוקר' && label !== 'ערב') continue;
        var legacyKey = day + '|' + label;
        if (seenShifts[legacyKey]) continue;
        seenShifts[legacyKey] = true;
        hours += 5;
      }
    } else {
      for (var rr = 0; rr < ranges.length; rr++) {
        var span = ranges[rr].endHour - ranges[rr].startHour;
        if (span > 0) hours += span;
        var blockKey = ranges[rr].startHour < 12 ? 'בוקר' : 'ערב';
        seenShifts[day + '|' + blockKey] = true;
      }
    }
  }
  return {
    hours: Math.round(hours * 100) / 100,
    shifts: Object.keys(seenShifts).length
  };
}
