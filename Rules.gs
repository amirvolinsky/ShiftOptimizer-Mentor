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
    class_type_eligibility_enabled: false,
    enforce_min_shift_rank3plus: true,
    route_flexible_coaches_by_scarcity: false,
    protect_under_target_rank12: true,
    global_review_enabled: true,
    global_review_max_iterations: 50,
    global_review_rank1_weight: 10000,
    global_review_rank2_weight: 1000,
    global_review_rank3_zero_weight: 500,
    global_review_red_weight: 100,
    global_review_gap_weight: 10,
    global_review_partial_cluster_weight: 250,
    force_morning_seven_am_even_if_empty: false,
    morning_seven_am_anchor_supply_gap: 2,
    global_review_close_dead_clusters: true,
    drop_unfillable_residual_class: true,
    clean_partial_clusters: true,
    revert_partial_when_no_rehome: true,
    cap_target_by_structural_max: true
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
      'משבצות ללא תיוג זמינות לכל מאמן. כרגע כבוי כברירת מחדל: השיבוץ הוא לפי משמרות בלבד.',
    enforce_min_shift_rank3plus:
      'להבטיח שכל מאמן בדרג 3 ומעלה שהגיש זמינות מקבל לפחות משמרת אחת. ' +
      'אם לא נמצא לו מקום, המערכת מחליפה אותו עם מאמן אחר שיש לו ≥2 משמרות ' +
      '(לא מדרג 1 ולא ברשימת noSuggestCoaches). כבה כדי להחזיר התנהגות לפי דרגה בלבד.',
    route_flexible_coaches_by_scarcity:
      'ניתוב מוקדם של מאמן שסימן גם בוקר וגם ערב לאחד מהם בלבד. ברירת המחדל FALSE כדי לא למחוק זמינות לפני שהאופטימייזר רואה את כל השבוע.',
    protect_under_target_rank12:
      'מניעת רצפת דרג 3+ מלקיחת משבצת פנויה כשמאמן דרג 1-2 שעדיין מתחת ליעד השבועי ' +
      'יכול לאייש אותה. אחרי השלב המוגן, המערכת משבצת דרג 1-2 למשבצות שנשארו פנויות, ' +
      'ואז מנסה שוב דרג 3+ ללא הגנה (מינימום משמרת אחת). כבה כדי להחזיר התנהגות קודמת.',
    global_review_enabled:
      'להריץ מעבר שיפור גלובלי בסוף השיבוץ: מסתכל על כל השבוע, ממלא תאים אדומים עם מאמנים מתחת ליעד, ' +
      'ומנסה החלפות שמורידות את ציון הבעיה הכללי. כבה להשוואת A/B מול השיבוץ הגרידי המקורי.',
    global_review_max_iterations:
      'מספר ניסיונות מקסימלי למעבר השיפור הגלובלי. ברירת מחדל 50.',
    global_review_rank1_weight:
      'משקל ענישה למאמן דרג 1 שנשאר מתחת ליעד. גבוה מאוד כדי שדרג 1 יקבל עדיפות מוחלטת.',
    global_review_rank2_weight:
      'משקל ענישה למאמן דרג 2 שנשאר מתחת ליעד.',
    global_review_rank3_zero_weight:
      'משקל ענישה למאמן דרג 3+ שהגיש זמינות אבל נשאר עם 0 משמרות.',
    global_review_red_weight:
      'משקל ענישה לכל תא אימון פתוח שנשאר אדום ללא מאמן.',
    global_review_gap_weight:
      'משקל ענישה כללי לכל פער בין יעד לכמות משמרות בפועל.',
    force_morning_seven_am_even_if_empty:
      'אם FALSE (ברירת מחדל) — לא לפתוח רשת בעוגן 07:00 כאשר אף מאמן לא הגיש זמינות מ-07:00 ' +
      'באותו בוקר, או כאשר עוגן 08:00 גדול ב-morning_seven_am_anchor_supply_gap מאמנים או יותר. ' +
      'הפעל (TRUE) כדי לכפות תמיד רשת אחת ב-07:00 בכל בוקר, גם במחיר תא אדום ריק.',
    morning_seven_am_anchor_supply_gap:
      'פער ההיצע (בכמות מאמנים) שמעליו לא נכפה עוגן 07:00 בבוקר. ברירת מחדל 2: אם 08:00 גדול ' +
      'ב-2 מאמנים מ-07:00 — נשאיר את כל הרשתות ב-08:00. רלוונטי רק כאשר force_morning_seven_am_even_if_empty = FALSE.',
    global_review_close_dead_clusters:
      'במעבר השיפור הגלובלי: לסגור קלאסטר אדום שאי אפשר לשבץ בו אף מאמן ("תאים מתים") ולפתוח ' +
      'באותה כמות משבצות חדשות במקום אחר שבו יש היצע אמיתי של מאמנים מתחת ליעד ("תאים רעבים"). ' +
      'שומר על מספר השיעורים הכולל אך מעביר אותם למקום שאפשר באמת לאייש. כבה כדי להשאיר את התאים האדומים.',
    drop_unfillable_residual_class:
      'כשנשאר שיעור בודד אחרי פתיחת כל הבלוקים השלמים, לפתוח אותו רק אם הוא מאריך משמרת קיימת ' +
      'באותו (יום, בלוק, רשת) ל-4 תאים. אחרת — לוותר עליו במקום ליצור תא יחיד יתום של שעה אחת ' +
      'שאי אפשר לשבץ בו אף מאמן. כבה כדי להחזיר התנהגות קודמת (לפתוח תמיד גם תא יתום).',
    clean_partial_clusters:
      'במעבר השיפור הגלובלי: לתקן קלאסטרים חלקיים (חלק ירוק וחלק אדום באותה רשת). ' +
      'ניסיון 1 — להחליף עם מאמן שמכסה את כל התאים. ניסיון 2 — להעביר את התאים האדומים ' +
      'ל"אין אימון" במקום אחר. ניסיון 3 — לבטל את השיבוץ החלקי כדי שכל הקלאסטר יהיה ' +
      'אדום נקי (תלוי ב-revert_partial_when_no_rehome). כבה כדי לאפשר קלאסטרים מעורבים.',
    revert_partial_when_no_rehome:
      'כשלא נמצא מאמן לכיסוי מלא ולא ניתן להעביר את התאים האדומים — לבטל את השיבוץ ' +
      'החלקי כך שכל הקלאסטר יהיה אדום ויחכה לשיבוץ ידני. דרגה 1 לעולם לא מבוטלת, ' +
      'ומאמן דרגה 3+ לא מבוטל אם יישאר עם 0 משמרות. כבה אם אתה מעדיף משמרות חלקיות ' +
      'על פני קלאסטר אדום מלא.',
    global_review_partial_cluster_weight:
      'משקל ענישה לכל קלאסטר חלקי (חלק ירוק וחלק אדום באותה רשת). גבוה במיוחד (ברירת מחדל ' +
      '250 — יותר מתא אדום בודד שהוא 100) כדי שכל פעולת ניקוי שמוחקת קלאסטר חלקי תיבחר ' +
      'על ידי מעבר השיפור הגלובלי, גם אם מספר התאים האדומים עולה זמנית.',
    cap_target_by_structural_max:
      'אם TRUE (ברירת מחדל): כשיעד המאמן בטופס גדול מהתקרה שאפשר להגיע אליה לפי הזמינות שמילא ' +
      '("תקרה לפי זמינות") — האלגוריתם משתמש בתקרה כיעד אפקטיבי. דוגמה: מאמן ביקש 4 משמרות אבל ' +
      'הזמינות שלו מאפשרת רק 3 — האלגוריתם רודף אחרי 3, לא 4, ולא מבצע החלפות שיוצרות תאים אדומים ' +
      'בניסיון להגיע ליעד בלתי אפשרי. כבה (FALSE) כדי שהאלגוריתם ימשיך לרדוף אחרי היעד המקורי גם ' +
      'כשהוא מעבר ליכולת הזמינות.'
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
