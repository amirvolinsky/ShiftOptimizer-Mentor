/**
 * Reads employee master data from the MasterData sheet.
 *
 * Expected columns:
 *   Name | Rank (1–4) | IsPriority | MinShifts | MaxShifts | LocationRestriction | RequestedShifts | BlockRestriction
 *
 * Rank: 1 = א (entry), 4 = ד (most senior). Used for rules and morning-score.
 * IsPriority: TRUE = must receive MinShifts per week (mentors/leads — not salary-related).
 * LocationRestriction: blank = both sites, or "SiteA" / "SiteB"
 */
function loadMasterData() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.sheets.masterData);
  if (!sheet) throw new Error("Sheet '" + CONFIG.sheets.masterData + "' not found.");

  var data = sheet.getDataRange().getValues();
  if (data.length < 2) throw new Error('MasterData sheet is empty (no data rows).');

  var employees = {};

  for (var i = 1; i < data.length; i++) {
    var name = String(data[i][0]).trim();
    if (!name) continue;

    var rank = parseInt(data[i][1], 10) || 1;
    var isPriority = String(data[i][2]).trim().toUpperCase() === 'TRUE';
    var minShifts = parseInt(data[i][3], 10) || 0;
    var maxShifts = parseInt(data[i][4], 10) || 0;
    var locationRestriction = String(data[i][5] || '').trim();
    var requestedShifts = parseInt(data[i][6], 10) || 0;
    var blockRestriction = String(data[i][7] || '').trim();

    employees[name] = {
      name: name,
      rank: rank,
      isGlobal: isPriority,
      isPriority: isPriority,
      minShifts: minShifts,
      maxShifts: maxShifts,
      locationRestriction: locationRestriction || '',
      requestedShifts: requestedShifts,
      blockRestriction: blockRestriction || ''
    };
  }

  return employees;
}
