/**
 * Mentor scheduling rules (key/value on the Rules sheet).
 *
 * Each rule is a behavior toggle the optimizer reads at runtime. Defaults come
 * from getDefaultMentorRules_() — the Rules sheet overrides them when present.
 * Missing keys fall back to defaults. Empty / missing sheet = defaults.
 *
 * To change a rule: edit the Value column in the Rules sheet (TRUE/FALSE for
 * toggles, numbers where applicable) and re-run "🚀 הרץ שיבוץ שבועי".
 */

/**
 * Default values for every configurable rule. The Rules sheet seeder writes
 * these as the initial row set, so the staff can edit in-place.
 */
function getDefaultMentorRules_() {
  return {
    // --- Mentor priority rules ---
    rank_1_unconditional: true,
    rank_priority_enabled: true,
    soft_cap_weekly_max: true,
    avoid_back_to_back: true,
    suggest_outside_availability: true,
    class_type_eligibility_enabled: true,
    enforce_min_shift_rank3plus: true,
    protect_under_target_rank12: true
  };
}

/**
 * Human-readable Hebrew description for every rule key, used by the Rules
 * sheet seeder so the staff understands what each toggle does without reading
 * code.
 */
function getMentorRuleDescriptions_() {
  return {
    rank_1_unconditional:
      'דרג 1 (בכיר) מקבל את כל המשמרות שהגיש זמינות עבורן, ללא תקרה. ' +
      'גם כשהוא מעל WeeklyMax — עדיין יקבל. כבה כדי להחיל תקרה גם על דרג 1.',
    rank_priority_enabled:
      'עדיפות לפי דרגה: 1 > 2 > 3 בכל שיבוץ. כבה כדי שכל הדרגות יתחרו שווה ' +
      'בשיבוץ (לפי gap בלבד).',
    soft_cap_weekly_max:
      'מאמני דרג 2-4 שהגיעו ל-WeeklyMax יורדים לסוף סדר הבחירה כדי לתת ' +
      'מקום לדרג נמוך יותר. כבה כדי לבטל את התקרה הרכה.',
    avoid_back_to_back:
      'להעדיף לא ליצור משמרות צמודות עם מנוחה קצרה — ערב עד 21:15 + בוקר מ-7:00 ' +
      'למחרת (פחות מ-10 שעות מנוחה), או יום עבודה מלא 7:00 ועד 21:15 באותו יום. ' +
      'תאים כאלה מסומנים כתום. כבה כדי לבטל את ההעדפה.',
    suggest_outside_availability:
      'להציע מאמן (סימון כחול) למשבצות ריקות גם אם לא סימן זמינות. ' +
      'כבה כדי שמשבצות ללא מועמדים יישארו אדומות "לא מולא".',
    class_type_eligibility_enabled:
      'לאכוף חוקי כשירות לסוגי כיתות (ילדים / הייטק / A–E / ליגה) לפי הטאב "ClassTypeRules". ' +
      'כשמשבצת ב-ShiftTemplate מתויגת בסוג כיתה, רק מאמנים שעומדים בחוק יוצעו לה. ' +
      'משבצות ללא תיוג זמינות לכל מאמן. כבה כדי לעקוף את הסינון לחלוטין (מצב חירום).',
    enforce_min_shift_rank3plus:
      'להבטיח שכל מאמן בדרג 3 ומעלה שהגיש זמינות מקבל לפחות משמרת אחת. ' +
      'אם לא נמצא לו מקום, המערכת מחליפה אותו עם מאמן אחר שיש לו ≥2 משמרות ' +
      '(לא מדרג 1 ולא ברשימת noSuggestCoaches). כבה כדי להחזיר התנהגות לפי דרגה בלבד.',
    protect_under_target_rank12:
      'מניעת רצפת דרג 3+ מלקיחת משבצת פנויה כשמאמן דרג 1-2 שעדיין מתחת ליעד השבועי ' +
      'יכול לאייש אותה. אחרי השלב המוגן, המערכת משבצת דרג 1-2 למשבצות שנשארו פנויות, ' +
      'ואז מנסה שוב דרג 3+ ללא הגנה (מינימום משמרת אחת). כבה כדי להחזיר התנהגות קודמת.'
  };
}

/**
 * Read rules from the Rules sheet, falling back to defaults for missing keys
 * or an empty/missing sheet.
 */
function loadRules() {
  var defaults = getDefaultMentorRules_();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.sheets.rules);
  if (!sheet) {
    Logger.log('Rules sheet not found, using defaults.');
    return defaults;
  }

  var data = sheet.getDataRange().getValues();
  var rules = {};

  for (var i = 1; i < data.length; i++) {
    var key = String(data[i][0]).trim().toLowerCase();
    if (!key) continue;
    rules[key] = parseRuleValue_(data[i][1]);
  }

  for (var k in defaults) {
    if (rules[k] === undefined) rules[k] = defaults[k];
  }

  return rules;
}

function parseRuleValue_(val) {
  if (typeof val === 'boolean') return val;
  var s = String(val).trim().toUpperCase();
  if (s === 'TRUE') return true;
  if (s === 'FALSE') return false;
  var n = parseFloat(val);
  return isNaN(n) ? val : n;
}

/**
 * Backwards-compat: returns the default Mentor rules (formerly used by
 * basicMode to skip the Rules sheet). Now that the sheet is always read,
 * this just delegates to defaults.
 */
function getPermissiveRules_() {
  return getDefaultMentorRules_();
}
