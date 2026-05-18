/**
 * Reads business rules from the Rules sheet (key/value pairs in columns A and B).
 * Returns an object with all rules, using defaults for any missing keys.
 */
function loadRules() {
  var defaults = {
    no_juniors_alone: true,
    min_morning_score: 7,
    min_morning_score_geula: 7,
    min_morning_score_gordon: 6,
    // Soft target used for fairness and "suggested" (blue) assignments.
    // Hard weekly cap remains max_shifts_per_week.
    default_target_shifts_per_week: 5,
    max_shifts_per_week: 6,
    min_rest_hours: 0,
    allow_double_shift: false
  };

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.sheets.rules);
  if (!sheet) {
    Logger.log('Rules sheet not found, using all defaults.');
    return defaults;
  }

  var data = sheet.getDataRange().getValues();
  var rules = {};

  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0]).trim().toLowerCase();
    var val = data[i][1];
    if (!key) continue;

    if (typeof val === 'boolean') {
      rules[key] = val;
    } else {
      var strVal = String(val).trim().toUpperCase();
      if (strVal === 'TRUE') {
        rules[key] = true;
      } else if (strVal === 'FALSE') {
        rules[key] = false;
      } else {
        var numVal = parseFloat(val);
        rules[key] = isNaN(numVal) ? val : numVal;
      }
    }
  }

  for (var k in defaults) {
    if (rules[k] === undefined) {
      rules[k] = defaults[k];
    }
  }

  return rules;
}
