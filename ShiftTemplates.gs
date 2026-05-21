/**
 * Reads shift template definitions from the ShiftTemplate sheet.
 *
 * Expected columns (matched by header name, order is flexible):
 *   Location | Day | Block | StartTime | EndTime | ClassType
 *
 * Location: a specific location name (e.g. "Net1") OR "*"/empty to mean
 *           "this slot exists on every location in CONFIG.locations".
 *           Using "*" avoids duplicating every training slot once per net.
 * Day:      Hebrew day name (ראשון, שני, ...)
 * Block:    "בוקר", "אמצע", or "ערב"
 * StartTime / EndTime: e.g., "7:00", "14:00"
 * ClassType: one of the ids from ClassTypes.gs (Childs / Hi-Tech / A / B /
 *            C / D / E / League). Blank = no class-type filter (anyone
 *            available may teach).
 *
 * Legacy: a `Headcount` column is still honored if present (back-compat with
 * older seeded sheets), otherwise every row produces exactly one slot per
 * resolved location.
 *
 * Returns an array of slot objects:
 * [{ location, day, block, headcount, startTime, endTime, durationHours, classType, slotId }]
 */
function loadShiftTemplates() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.sheets.shiftTemplate);
  if (!sheet) throw new Error("Sheet '" + CONFIG.sheets.shiftTemplate + "' not found.");

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) throw new Error("ShiftTemplate sheet is empty (no data rows).");

  var cols = mapShiftTemplateColumns_(data[0]);
  var slots = [];
  var positionCounters = {};

  for (var i = 1; i < data.length; i++) {
    var rawLocation = String(data[i][cols.location]).trim();
    var day = String(data[i][cols.day]).trim();
    var block = String(data[i][cols.block]).trim();
    var headcount = cols.headcount >= 0
      ? (parseInt(data[i][cols.headcount], 10) || 1)
      : 1;
    var startTime = parseTimeValue(data[i][cols.startTime]);
    var endTime = parseTimeValue(data[i][cols.endTime]);
    var classType = cols.classType >= 0
      ? normalizeClassTypeId_(data[i][cols.classType])
      : '';

    if (!day || !block) continue;

    var locationsForRow = expandTemplateLocations_(rawLocation);
    if (locationsForRow.length === 0) continue;

    var durationHours = 0;
    if (startTime !== null && endTime !== null) {
      durationHours = endTime - startTime;
      if (durationHours <= 0) durationHours += 24;
    }

    for (var li = 0; li < locationsForRow.length; li++) {
      var location = locationsForRow[li];
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
          classType: classType,
          slotId: location + '_' + day + '_' + block + '_' + globalPos
        });
      }
    }
  }

  return slots;
}

/**
 * Resolve ShiftTemplate column positions by header name.
 * Returns { location, day, block, startTime, endTime, headcount, classType }.
 * `headcount` and `classType` are -1 when the column is absent (back-compat).
 */
function mapShiftTemplateColumns_(headerRow) {
  var headers = [];
  for (var h = 0; h < headerRow.length; h++) {
    headers.push(String(headerRow[h]).trim());
  }
  function idx(name, fallback) {
    var i = headers.indexOf(name);
    return i >= 0 ? i : fallback;
  }
  return {
    location:  idx('Location', 0),
    day:       idx('Day', 1),
    block:     idx('Block', 2),
    startTime: idx('StartTime', 3),
    endTime:   idx('EndTime', 4),
    headcount: idx('Headcount', -1),
    classType: idx('ClassType', -1)
  };
}

/**
 * Resolves a raw Location cell into the list of concrete locations it covers.
 *  - "*" / "" / "ALL"        → all CONFIG.locations
 *  - "Net1,Net2" / "Net1|Net2" → split list (each trimmed) intersected with CONFIG.locations
 *  - any other single value   → returned as-is (preserved for non-template rows)
 */
function expandTemplateLocations_(rawLocation) {
  var cfgLocations = (CONFIG && CONFIG.locations) ? CONFIG.locations : [];
  var trimmed = String(rawLocation || '').trim();

  if (trimmed === '' || trimmed === '*' || trimmed.toUpperCase() === 'ALL') {
    return cfgLocations.slice();
  }

  if (trimmed.indexOf(',') >= 0 || trimmed.indexOf('|') >= 0) {
    var parts = trimmed.split(/[,|]/);
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var name = parts[i].trim();
      if (name) out.push(name);
    }
    return out;
  }

  return [trimmed];
}

/**
 * Parse a time value from a cell. Handles:
 *  - Date objects (from formatted time cells)
 *  - Strings like "7:30", "14:00"
 *  - Numbers (fractional day, e.g., 0.3125 = 7:30)
 *
 * Returns decimal hours (e.g., 7.5 for 7:30) or null if unparseable.
 *
 * NOTE: Sheets stores time-only values on epoch date 1899-12-30. Reading them
 * with getHours()/getMinutes() applies the Asia/Jerusalem LMT offset (+2:20:54)
 * for pre-1900 dates, which corrupts the time. Always read as UTC.
 */
function parseTimeValue(val) {
  if (val === null || val === undefined || val === '') return null;

  if (val instanceof Date) {
    return val.getUTCHours() + val.getUTCMinutes() / 60;
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
 * Get unique template rows grouped by location and day.
 * Used by the schedule writer to render the output grid.
 *
 * Returns: { "Net1": { "ראשון": [{ block, startTime, endTime, headcount }], ... }, ... }
 */
function getTemplateGrid() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.sheets.shiftTemplate);
  if (!sheet) return {};

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) return {};

  var cols = mapShiftTemplateColumns_(data[0]);
  var grid = {};

  for (var i = 1; i < data.length; i++) {
    var rawLocation = String(data[i][cols.location]).trim();
    var day = String(data[i][cols.day]).trim();
    var block = String(data[i][cols.block]).trim();
    var headcount = cols.headcount >= 0
      ? (parseInt(data[i][cols.headcount], 10) || 1)
      : 1;
    var startTime = parseTimeValue(data[i][cols.startTime]);
    var endTime = parseTimeValue(data[i][cols.endTime]);
    var classType = cols.classType >= 0
      ? normalizeClassTypeId_(data[i][cols.classType])
      : '';

    if (!day || !block) continue;

    var locationsForRow = expandTemplateLocations_(rawLocation);
    for (var li = 0; li < locationsForRow.length; li++) {
      var location = locationsForRow[li];
      if (!grid[location]) grid[location] = {};
      if (!grid[location][day]) grid[location][day] = [];

      grid[location][day].push({
        block: block,
        startTime: startTime,
        endTime: endTime,
        headcount: headcount,
        classType: classType
      });
    }
  }

  return grid;
}
