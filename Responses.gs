/**
 * Parses the responses sheet (configured in CONFIG) to build an availability map.
 *
 * Real form columns:
 *   Timestamp | Email Address | שם העובד | ראשון | שני | שלישי | רביעי | חמישי | שישי | שבת | הערות
 *
 * Weekday values: "בוקר", "ערב", or "לא זמין"
 * Weekend values: comma-separated, e.g. "בוקר, אמצע, ערב" or "לא זמין"
 *
 * If an employee submits multiple times, latest row wins.
 *
 * Returns: {
 *   availability: { "name": { "ראשון": ["בוקר"], "שישי": ["בוקר","אמצע","ערב"], ... } },
 *   notes: { "name": "free text from הערות" }
 * }
 */
function loadAvailability() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.sheets.responses);
  if (!sheet) throw new Error("Sheet '" + CONFIG.sheets.responses + "' not found.");

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) throw new Error("Responses sheet is empty (no data rows).");

  var headers = data[0];

  var dayColumns = {};
  var nameCol = -1;
  var notesCol = -1;

  var dayNames = CONFIG.days;

  for (var c = 0; c < headers.length; c++) {
    var header = String(headers[c]).trim();

    if (header === 'שם העובד') {
      nameCol = c;
      continue;
    }
    if (header === 'הערות') {
      notesCol = c;
      continue;
    }

    for (var d = 0; d < dayNames.length; d++) {
      if (header === dayNames[d]) {
        dayColumns[dayNames[d]] = c;
        break;
      }
    }
  }

  if (nameCol === -1) {
    nameCol = 2;
  }

  var latestByName = {};
  for (var r = 1; r < data.length; r++) {
    var name = String(data[r][nameCol]).trim();
    if (name && name !== 'לא זמין' && name !== '') {
      latestByName[name] = data[r];
    }
  }

  var availability = {};
  var notes = {};
  var names = Object.keys(latestByName);

  for (var n = 0; n < names.length; n++) {
    var empName = names[n];
    var row = latestByName[empName];
    availability[empName] = {};

    for (var d = 0; d < dayNames.length; d++) {
      var day = dayNames[d];
      var col = dayColumns[day];
      if (col === undefined) {
        availability[empName][day] = [];
        continue;
      }

      var cellVal = String(row[col]).trim();
      if (!cellVal || cellVal === 'לא זמין' || cellVal === 'undefined') {
        availability[empName][day] = [];
      } else {
        var blocks = cellVal.split(',').map(function(s) { return s.trim(); });
        blocks = blocks.filter(function(b) { return b && b !== 'לא זמין'; });
        availability[empName][day] = blocks;
      }
    }

    if (notesCol !== -1 && row[notesCol]) {
      var noteText = String(row[notesCol]).trim();
      if (noteText && noteText !== 'undefined') {
        notes[empName] = noteText;
      }
    }
  }

  return {
    availability: availability,
    notes: notes
  };
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
 * Document lock + archive form rows + physical row delete (same as end of "הפץ משמרות").
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
