/**
 * Reads employee master data from the MasterData sheet.
 *
 * Columns:
 *   Name      | Rank (1–4, 1 = best, 4 = reserve; default 1 if missing)
 *   WeeklyMin | WeeklyMax — typical weekly shift target window (a "shift" =
 *                           morning OR evening half-day block). Both optional;
 *                           default to 0 / unlimited respectively.
 *   Gender                — 'M' / 'F'. Used by class-type eligibility rules
 *                           (e.g. E classes are male-only). Defaults to 'M'
 *                           when the column or cell is blank.
 *   LocationRestriction   — optional, locks a coach to a specific net.
 */
function loadMasterData() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.sheets.masterData);
  if (!sheet) throw new Error("Sheet '" + CONFIG.sheets.masterData + "' not found.");

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) throw new Error('MasterData sheet is empty (no data rows).');

  var cols = mapMasterDataColumns_(data[0]);
  var employees = {};

  for (var i = 1; i < data.length; i++) {
    var name = String(data[i][cols.name]).trim();
    if (!name) continue;

    var rank = normalizeMentorRank_(data[i][cols.rank]);
    var locationRestriction = cols.location >= 0
      ? String(data[i][cols.location] || '').trim()
      : '';

    var weeklyMin = cols.weeklyMin >= 0 ? parseShiftTargetNumber_(data[i][cols.weeklyMin], 0) : 0;
    var weeklyMax = cols.weeklyMax >= 0 ? parseShiftTargetNumber_(data[i][cols.weeklyMax], null) : null;
    if (weeklyMax !== null && weeklyMax < weeklyMin) weeklyMax = weeklyMin;

    var gender = cols.gender >= 0
      ? normalizeMentorGender_(data[i][cols.gender])
      : 'M';

    employees[name] = {
      name: name,
      rank: rank,
      locationRestriction: locationRestriction || '',
      weeklyMin: weeklyMin,
      weeklyMax: weeklyMax,
      gender: gender
    };
  }

  return employees;
}

/**
 * Parses a numeric shift-target cell. Empty / non-numeric → `fallback`.
 */
function parseShiftTargetNumber_(val, fallback) {
  if (val === null || val === undefined || val === '') return fallback;
  var n = Number(val);
  if (isNaN(n) || n < 0) return fallback;
  return Math.floor(n);
}

/**
 * @param {Array} headerRow
 * @returns {{name:number, rank:number, location:number, weeklyMin:number, weeklyMax:number, gender:number}}
 */
function mapMasterDataColumns_(headerRow) {
  var headers = [];
  for (var h = 0; h < headerRow.length; h++) {
    headers.push(String(headerRow[h]).trim());
  }

  function idx(name, fallback) {
    var i = headers.indexOf(name);
    return i >= 0 ? i : fallback;
  }

  return {
    name: idx('Name', 0),
    rank: idx('Rank', 1),
    location: idx('LocationRestriction', -1),
    weeklyMin: idx('WeeklyMin', -1),
    weeklyMax: idx('WeeklyMax', -1),
    gender: idx('Gender', -1)
  };
}

/** Technical cap on training slots per coach per week (WeeklyMax is the real limit). */
function getEmployeeMaxShifts_(rules) {
  if (isBasicMode_()) return 99;
  return 6;
}
