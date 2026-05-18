/**
 * Reads shift template definitions from the ShiftTemplate sheet.
 *
 * Expected columns:
 *   Location | Day | Block | Headcount | StartTime | EndTime
 *
 * Location: "Geula" or "Gordon"
 * Day: Hebrew day name (ראשון, שני, ...)
 * Block: "בוקר", "אמצע", or "ערב"
 * Headcount: number of employees needed for this slot
 * StartTime: e.g., "7:00" or "7:30" (for cost calculation)
 * EndTime: e.g., "14:00" (for cost calculation)
 *
 * Returns an array of slot objects:
 * [{ location, day, block, headcount, startTime, endTime, durationHours, slotId }]
 */
function loadShiftTemplates() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.sheets.shiftTemplate);
  if (!sheet) throw new Error("Sheet '" + CONFIG.sheets.shiftTemplate + "' not found.");

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) throw new Error("ShiftTemplate sheet is empty (no data rows).");

  var slots = [];
  var positionCounters = {};

  for (var i = 1; i < data.length; i++) {
    var location = String(data[i][0]).trim();
    var day = String(data[i][1]).trim();
    var block = String(data[i][2]).trim();
    var headcount = parseInt(data[i][3], 10) || 1;
    var startTime = parseTimeValue(data[i][4]);
    var endTime = parseTimeValue(data[i][5]);

    if (!location || !day || !block) continue;

    var durationHours = 0;
    if (startTime !== null && endTime !== null) {
      durationHours = endTime - startTime;
      if (durationHours <= 0) durationHours += 24;
    }

    var counterKey = location + '_' + day + '_' + block;
    if (!positionCounters[counterKey]) positionCounters[counterKey] = 0;

    for (var h = 0; h < headcount; h++) {
      var globalPos = positionCounters[counterKey];
      positionCounters[counterKey]++;
      slots.push({
        location: location,
        day: day,
        block: block,
        headcount: headcount,
        positionIndex: globalPos,
        startTime: startTime,
        endTime: endTime,
        durationHours: durationHours,
        slotId: location + '_' + day + '_' + block + '_' + globalPos
      });
    }
  }

  return slots;
}

/**
 * Parse a time value from a cell. Handles:
 *  - Date objects (from formatted time cells)
 *  - Strings like "7:30", "14:00"
 *  - Numbers (fractional day, e.g., 0.3125 = 7:30)
 *
 * Returns decimal hours (e.g., 7.5 for 7:30) or null if unparseable.
 */
function parseTimeValue(val) {
  if (val === null || val === undefined || val === '') return null;

  if (val instanceof Date) {
    return val.getHours() + val.getMinutes() / 60;
  }

  if (typeof val === 'number') {
    if (val < 1) {
      var totalMinutes = Math.round(val * 24 * 60);
      return Math.floor(totalMinutes / 60) + (totalMinutes % 60) / 60;
    }
    return val;
  }

  var str = String(val).trim();
  var parts = str.split(':');
  if (parts.length === 2) {
    var hours = parseInt(parts[0], 10);
    var minutes = parseInt(parts[1], 10) || 0;
    if (!isNaN(hours)) return hours + minutes / 60;
  }

  return null;
}

/**
 * Get unique template rows (before headcount expansion) grouped by location and day.
 * Useful for writing the schedule output.
 *
 * Returns: { "Geula": { "ראשון": [{ block, startTime, endTime, headcount }], ... }, ... }
 */
function getTemplateGrid() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.sheets.shiftTemplate);
  if (!sheet) return {};

  var data = sheet.getDataRange().getValues();
  var grid = {};

  for (var i = 1; i < data.length; i++) {
    var location = String(data[i][0]).trim();
    var day = String(data[i][1]).trim();
    var block = String(data[i][2]).trim();
    var headcount = parseInt(data[i][3], 10) || 1;
    var startTime = parseTimeValue(data[i][4]);
    var endTime = parseTimeValue(data[i][5]);

    if (!location || !day || !block) continue;

    if (!grid[location]) grid[location] = {};
    if (!grid[location][day]) grid[location][day] = [];

    grid[location][day].push({
      block: block,
      startTime: startTime,
      endTime: endTime,
      headcount: headcount
    });
  }

  return grid;
}
