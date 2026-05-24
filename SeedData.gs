/**
 * Seed functions for setting up the Google Sheet (Shift Optimizer Mentor).
 */

function setupTables() {
  showRtlConfirmDialog_(
    'setupTables',
    '🏗️ אתחל טבלאות (MasterData / ShiftTemplate / Rules / ClassTypeRules / WeeklyClasses)',
    'מה זה עושה: יוצר מחדש את חמש טבלאות ברירת המחדל של המערכת —\n'
      + '• "' + CONFIG.sheets.masterData + '" — רשימת ' + FAKE_MENTOR_ROSTER_.length + ' מאמני מנטור עם דרגה (1–4) ומגדר (M/F)\n'
      + '• "' + CONFIG.sheets.shiftTemplate + '" — שכבת אימונים שעתיים × 3 רשתות, א\'–ה\' בוקר+ערב, שישי בוקר בלבד (כולל עמודת ClassType ריקה לסיווג ידני)\n'
      + '• "' + CONFIG.sheets.rules + '" — דגלי שיבוץ ניתנים לכיבוי/הפעלה (TRUE/FALSE) עם תיאור בעברית\n'
      + '• "' + CONFIG.sheets.classTypeRules + '" — מי רשאי לאמן כל סוג כיתה (ילדים / הייטק / A–E / ליגה)\n'
      + '• "' + CONFIG.sheets.weeklyClasses + '" — כמות אימונים לכל סוג כיתה השבוע (ניתן לעריכה שבועית)\n\n'
      + '⚠ דורס כל תוכן קיים בחמש הטבלאות.\n'
      + 'לא נוגע ב-"' + CONFIG.sheets.responses + '" ולא בטופס Google.\n\n'
      + 'להמשיך?'
  );
}

/**
 * Seeds tables without HtmlService confirm dialog (avoids script.container.ui on first auth).
 */
function setupTablesQuick() {
  try {
    setupTablesCore_();
    try {
      ensureSpreadsheetOpenGuideTrigger_();
    } catch (ignore) {}
    SpreadsheetApp.getActive().toast(
      'MasterData, ShiftTemplate, Rules — עודכנו',
      CONFIG.toastBrandName,
      8
    );
  } catch (e) {
    SpreadsheetApp.getActive().toast('שגיאה: ' + e.message, CONFIG.toastBrandName, -1);
    throw e;
  }
}

/** Editor-only: no UI scopes. Run from Apps Script if the sheet menu is blocked. */
function setupTablesFromEditor() {
  setupTablesCore_();
  Logger.log('setupTablesFromEditor: MasterData, ShiftTemplate, Rules seeded.');
}

function setupTablesCore_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  seedMasterData_(ss);
  seedShiftTemplate_(ss);
  seedRules_(ss);
  seedClassTypeRules_(ss);
  seedWeeklyClasses_(ss);
}

function setupTablesRun_() {
  setupTablesCore_();
  try {
    ensureSpreadsheetOpenGuideTrigger_();
  } catch (ignore) {}
  return menuActionSuccess_(
    '✅ טבלאות אותחלו',
    '• ' + CONFIG.sheets.masterData + ' — ' + FAKE_MENTOR_ROSTER_.length + ' מאמני מנטור (דרגה + מגדר)\n'
      + '• ' + CONFIG.sheets.shiftTemplate + ' — שכבת אימונים שעתיים × 3 רשתות + עמודת ClassType\n'
      + '• ' + CONFIG.sheets.rules + ' — דגלי שיבוץ עם ערכי ברירת מחדל וטקסט הסבר\n'
      + '• ' + CONFIG.sheets.classTypeRules + ' — חוקי כשירות לסוגי כיתות (8 סוגים)\n'
      + '• ' + CONFIG.sheets.weeklyClasses + ' — כמות אימונים שבועית לכל סוג כיתה\n\n'
      + 'ודאו ש-"' + CONFIG.sheets.responses + '" מחובר לטופס Google.'
  );
}

function updateTrainingTemplate() {
  showRtlConfirmDialog_(
    'updateTrainingTemplate',
    '📅 עדכן תבנית אימונים',
    'מה זה עושה: ממלא מחדש את "' + CONFIG.sheets.shiftTemplate + '" — שכבת האימונים שהמערכת משבצת אליה:\n'
      + '• בוקר א\'–ו\': אימונים שעתיים 07:00–12:00 (5 אימונים)\n'
      + '• ערב א\'–ה\': 16:00–19:15 באימונים שעתיים + 19:15–20:15 + 20:15–21:15\n'
      + '• כל אימון מופיע על 3 רשתות (Net1–Net3) — קיבולת מקבילה באותו מקום\n\n'
      + '⚠ דורס תוכן קיים ב-"' + CONFIG.sheets.shiftTemplate + '".\n'
      + 'לא נוגע ב-MasterData, Rules או בתשובות הטופס.\n\n'
      + 'להמשיך?'
  );
}

function updateTrainingTemplateRun_() {
  seedShiftTemplate_(SpreadsheetApp.getActiveSpreadsheet());
  return menuActionSuccess_(
    '✅ תבנית אימונים עודכנה',
    'ShiftTemplate: א\'–ה\' בוקר+ערב, שישי בוקר בלבד, × 3 רשתות.\nהריצו שוב "🚀 הרץ שיבוץ שבועי".'
  );
}

function updateWeeklyClasses() {
  showRtlConfirmDialog_(
    'updateWeeklyClasses',
    '📊 כמויות אימונים שבועיות',
    'מה זה עושה: יוצר/מרענן את "' + CONFIG.sheets.weeklyClasses + '" — טבלה של כמויות אימונים שבועיות לכל סוג כיתה ' +
      '(ילדים / הייטק / A–E / ליגה). עדכנו את עמודת Count כל שבוע לפי הצורך.\n\n' +
      '⚠ דורס תוכן קיים ב-"' + CONFIG.sheets.weeklyClasses + '".\n' +
      'לא נוגע ב-MasterData, ShiftTemplate, Rules, ClassTypeRules או בתשובות הטופס.\n\n' +
      'להמשיך?'
  );
}

function updateWeeklyClassesRun_() {
  seedWeeklyClasses_(SpreadsheetApp.getActiveSpreadsheet());
  return menuActionSuccess_(
    '✅ כמויות אימונים שבועיות',
    'הטאב "' + CONFIG.sheets.weeklyClasses + '" נטען עם 8 סוגי כיתות וברירות מחדל.\n' +
      'עדכנו את עמודת Count לפי השבוע הנוכחי.'
  );
}

function loadTestResponses() {
  showRtlConfirmDialog_(
    'loadTestResponses',
    '🧪 טען תשובות בדיקה',
    'מה זה עושה: ממלא את גיליון הדמו בתשובות לדוגמה — לבדיקה בלבד.\n\n'
      + '⚠ דורס תוכן ב-"' + CONFIG.sheets.responsesDemo + '".\n'
      + 'לא נוגע ב-"' + CONFIG.sheets.responses + '" (טופס אמיתי).\n\n'
      + 'להמשיך?'
  );
}

function loadTestResponsesRun_() {
  seedResponses_(SpreadsheetApp.getActiveSpreadsheet());
  return menuActionSuccess_('✅ תשובות בדיקה', 'תשובות בדיקה נטענו.\nהריצו "🚀 הרץ שיבוץ שבועי".');
}

/**
 * MasterData rows for the Mentor roster.
 *
 * Columns:
 *   Name  | Rank (1=best … 3=lowest)
 *   WeeklyMin | WeeklyMax — typical weekly shift count requested by the coach
 *                          (derived from the monthly view; a "shift" = morning
 *                           OR evening half-day block).
 *
 * Edit FAKE_MENTOR_ROSTER_ to change names/ranks, and MENTOR_WEEKLY_SHIFT_TARGETS_
 * to change the weekly targets.
 */
function buildMentorMasterDataRows_() {
  var data = [['Name', 'Rank', 'WeeklyMin', 'WeeklyMax', 'Gender']];
  for (var i = 0; i < FAKE_MENTOR_ROSTER_.length; i++) {
    var entry = FAKE_MENTOR_ROSTER_[i];
    var target = getMentorWeeklyTarget_(entry.name);
    data.push([
      entry.name,
      normalizeMentorRank_(entry.rank),
      target.min,
      target.max,
      normalizeMentorGender_(entry.gender)
    ]);
  }
  return data;
}

/** Coach display names for form dropdown and fake responses. */
function getMentorCoachNames_() {
  var names = [];
  for (var i = 0; i < FAKE_MENTOR_ROSTER_.length; i++) {
    names.push(FAKE_MENTOR_ROSTER_[i].name);
  }
  return names;
}

function writeMasterDataSheet_(sheet, data) {
  sheet.clear();
  sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  sheet.getRange(1, 1, 1, data[0].length)
    .setFontWeight('bold').setBackground('#2E7D6B').setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  for (var c = 1; c <= data[0].length; c++) sheet.autoResizeColumn(c);
}

function seedMasterData_(ss) {
  var sheet = ss.getSheetByName(CONFIG.sheets.masterData);
  if (!sheet) sheet = ss.insertSheet(CONFIG.sheets.masterData);
  writeMasterDataSheet_(sheet, buildMentorMasterDataRows_());
}

/**
 * Mentor training slots: Sun–Fri morning; Sun–Thu evening (no Friday evening).
 */
/**
 * Builds the ShiftTemplate rows in the compact form. One row per Day/Block/Time
 * with Location='*' meaning "all CONFIG.locations". The loader expands '*' rows
 * into one slot per net at read time, so the sheet stays at ~55 rows instead of
 * 3×55=165 with identical duplication across Net1/Net2/Net3.
 *
 * Columns: Location | Day | Block | StartTime | EndTime (one trainer per slot,
 * no headcount column — that information is intentionally fixed in code so
 * editors can't accidentally request multiple trainers per training).
 */
function buildMentorTrainingTemplateRows_() {
  var rows = [];
  var morning = [[7, 8], [8, 9], [9, 10], [10, 11], [11, 12]];
  var evening = [[16, 17], [17, 18], [18, 19], [19.25, 20.25], [20.25, 21.25]];

  for (var di = 0; di < MENTOR_WEEKDAYS_HE_.length; di++) {
    var day = MENTOR_WEEKDAYS_HE_[di];
    var isFri = isMentorFriday_(day);
    for (var h = 0; h < morning.length; h++) {
      // Friday morning ends at 11:00 — no 11–12 training on Fridays. The
      // operational rule is "Friday morning = 7–11 (4 trainings) only".
      if (isFri && morning[h][0] === 11) continue;
      rows.push(['*', day, 'בוקר', formatTemplateTime_(morning[h][0]), formatTemplateTime_(morning[h][1]), '']);
    }
    if (!isFri) {
      for (var h = 0; h < evening.length; h++) {
        rows.push(['*', day, 'ערב', formatTemplateTime_(evening[h][0]), formatTemplateTime_(evening[h][1]), '']);
      }
    }
  }
  return rows;
}

function formatTemplateTime_(decimalHour) {
  var h = Math.floor(decimalHour);
  var m = Math.round((decimalHour - h) * 60);
  return h + ':' + (m < 10 ? '0' : '') + m;
}

function seedShiftTemplate_(ss) {
  var sheet = ss.getSheetByName(CONFIG.sheets.shiftTemplate);
  if (!sheet) sheet = ss.insertSheet(CONFIG.sheets.shiftTemplate);
  sheet.clear();
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).clearDataValidations();

  var data = [['Location', 'Day', 'Block', 'StartTime', 'EndTime', 'ClassType']];
  var templateRows = buildMentorTrainingTemplateRows_();
  for (var i = 0; i < templateRows.length; i++) {
    data.push(templateRows[i]);
  }

  sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  sheet.getRange(1, 1, 1, data[0].length)
    .setFontWeight('bold').setBackground('#2E7D6B').setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);

  // ClassType dropdown — blank means "no class-type filter" (anyone may teach).
  if (templateRows.length > 0) {
    var classTypeRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(getClassTypeIds_(), true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, 6, templateRows.length, 1).setDataValidation(classTypeRule);
  }

  for (var c = 1; c <= data[0].length; c++) sheet.autoResizeColumn(c);
}

function seedRules_(ss) {
  var sheet = ss.getSheetByName(CONFIG.sheets.rules);
  if (!sheet) sheet = ss.insertSheet(CONFIG.sheets.rules);
  sheet.clear();
  sheet.clearFormats();

  var defaults = getDefaultMentorRules_();
  var descriptions = getMentorRuleDescriptions_();

  // Order rules: Mentor-specific behavior toggles first (most impactful),
  // then dormant/legacy. Keys not present here will still be written below in
  // arbitrary order to be safe.
  var orderedKeys = [
    'rank_1_unconditional',
    'rank_priority_enabled',
    'soft_cap_weekly_max',
    'avoid_back_to_back',
    'suggest_outside_availability',
    'class_type_eligibility_enabled'
  ];
  var seenKey = {};
  for (var i = 0; i < orderedKeys.length; i++) seenKey[orderedKeys[i]] = true;
  var allKeys = Object.keys(defaults);
  for (var j = 0; j < allKeys.length; j++) {
    if (!seenKey[allKeys[j]]) orderedKeys.push(allKeys[j]);
  }

  var data = [['Key', 'Value', 'תיאור']];
  for (var k = 0; k < orderedKeys.length; k++) {
    var key = orderedKeys[k];
    data.push([key, defaults[key], descriptions[key] || '']);
  }

  sheet.getRange(1, 1, data.length, 3).setValues(data);
  sheet.getRange(1, 1, 1, 3)
    .setFontWeight('bold').setBackground('#2E7D6B').setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);

  // Add TRUE/FALSE dropdown on boolean rule cells so the staff can't type
  // free-form text by mistake.
  var trueFalseRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['TRUE', 'FALSE'], true)
    .setAllowInvalid(false)
    .build();
  for (var r = 0; r < orderedKeys.length; r++) {
    if (typeof defaults[orderedKeys[r]] === 'boolean') {
      sheet.getRange(r + 2, 2).setDataValidation(trueFalseRule);
    }
  }

  sheet.setColumnWidth(1, 230);
  sheet.setColumnWidth(2, 90);
  sheet.setColumnWidth(3, 520);
  sheet.getRange(1, 1, data.length, 3).setVerticalAlignment('middle').setWrap(true);
  sheet.getRange(2, 1, orderedKeys.length, 1).setFontFamily('Menlo').setFontSize(11);
}

/**
 * ClassTypeRules sheet: one row per class type with the eligibility DSL,
 * priority rank (optional), allow-split flag, and a readable Hebrew
 * description.
 */
function seedClassTypeRules_(ss) {
  var sheet = ss.getSheetByName(CONFIG.sheets.classTypeRules);
  if (!sheet) sheet = ss.insertSheet(CONFIG.sheets.classTypeRules);
  sheet.clear();
  sheet.clearFormats();

  var ids = getClassTypeIds_();
  var data = [['ClassType', 'EligibleRule', 'PriorityRank', 'AllowSplit', 'תיאור']];
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var spec = MENTOR_CLASS_TYPE_RULES_[id] || { eligible: '*', priorityRank: null, allowSplit: false };
    data.push([
      id,
      spec.eligible,
      spec.priorityRank == null ? '' : spec.priorityRank,
      spec.allowSplit ? 'TRUE' : 'FALSE',
      MENTOR_CLASS_TYPE_DESCRIPTIONS_[id] || ''
    ]);
  }

  sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  sheet.getRange(1, 1, 1, data[0].length)
    .setFontWeight('bold').setBackground('#2E7D6B').setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);

  var classTypeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(ids, true).setAllowInvalid(false).build();
  sheet.getRange(2, 1, ids.length, 1).setDataValidation(classTypeRule);

  var allowSplitRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['TRUE', 'FALSE'], true).setAllowInvalid(false).build();
  sheet.getRange(2, 4, ids.length, 1).setDataValidation(allowSplitRule);

  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 220);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidth(4, 110);
  sheet.setColumnWidth(5, 540);
  sheet.getRange(1, 1, data.length, data[0].length)
    .setVerticalAlignment('middle').setWrap(true);
  sheet.getRange(2, 2, ids.length, 1).setFontFamily('Menlo').setFontSize(11);
}

/**
 * WeeklyClasses sheet: one row per class type with a Count column. Seeded
 * blank (zeros) — the staff enters the per-class counts each week via the
 * "🚀 הרץ שיבוץ שבועי" dialog, which writes the values back into this sheet
 * before running the optimizer. The bottom `סה״כ` row sums the column.
 */
function seedWeeklyClasses_(ss) {
  var sheet = ss.getSheetByName(CONFIG.sheets.weeklyClasses);
  if (!sheet) sheet = ss.insertSheet(CONFIG.sheets.weeklyClasses);
  sheet.clear();
  sheet.clearFormats();

  var ids = getClassTypeIds_();
  var defaults = getDefaultWeeklyClassCountsByType_();

  var data = [['ClassType', 'Count', 'תיאור']];
  var total = 0;
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    var count = defaults[id] != null ? defaults[id] : 0;
    total += count;
    data.push([
      id,
      count,
      MENTOR_CLASS_TYPE_DESCRIPTIONS_[id] || ''
    ]);
  }
  data.push(['סה״כ', total, 'סכום אימוני השבוע — עדכנו את התאים שמעל לפי הצורך.']);

  sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  sheet.getRange(1, 1, 1, data[0].length)
    .setFontWeight('bold').setBackground('#2E7D6B').setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);

  var totalRow = data.length;
  sheet.getRange(totalRow, 1, 1, data[0].length)
    .setFontWeight('bold').setBackground('#E8E8E8');
  sheet.getRange(totalRow, 2)
    .setFormula('=SUM(B2:B' + (totalRow - 1) + ')');

  sheet.setColumnWidth(1, 130);
  sheet.setColumnWidth(2, 90);
  sheet.setColumnWidth(3, 520);
  sheet.getRange(1, 1, data.length, data[0].length)
    .setVerticalAlignment('middle').setWrap(true);
}

/**
 * Mentor coach roster — edit name + rank (1 = best, 4 = out-of-town reserve)
 * + gender ('M' / 'F'). Gender drives class-type eligibility (E classes are
 * male-only per Mentor staff policy), so it must travel with the data instead
 * of being hardcoded in the optimizer.
 *
 * Used by MasterData seed, form sync, and demo responses.
 */
var FAKE_MENTOR_ROSTER_ = [
  { name: 'רון',       rank: 1, gender: 'M' },
  { name: 'מנש',       rank: 1, gender: 'M' },
  { name: 'איתם',      rank: 1, gender: 'M' },
  { name: 'בבה',       rank: 2, gender: 'M' },
  { name: 'יובל כץ',   rank: 2, gender: 'M' },
  { name: 'דורון',     rank: 1, gender: 'M' },
  { name: 'עומר אופק', rank: 2, gender: 'M' },
  { name: 'קורין',     rank: 3, gender: 'F' },
  { name: 'שירי',      rank: 3, gender: 'F' },
  { name: 'לילוש',     rank: 3, gender: 'M' },
  { name: 'סהר כהן',   rank: 3, gender: 'M' },
  { name: 'מיתר',      rank: 4, gender: 'M' },
  { name: 'תומר אסף',  rank: 3, gender: 'M' },
  { name: 'טומי',      rank: 3, gender: 'M' },
  { name: 'טל נחמיאס', rank: 4, gender: 'M' },
  { name: 'ינון שוב',  rank: 4, gender: 'M' }
];

/**
 * Expected sheet: Timestamp, שם מאמן, then one column per day (ראשון–חמישי + שישי בוקר בלבד).
 * Form: one section per day; one question (checkbox) with all time-range options.
 */
function buildDefaultMentorFormHeaders_() {
  var headers = ['Timestamp', 'שם מאמן', MENTOR_WEEKLY_TARGET_HEADER_];
  for (var d = 0; d < MENTOR_WEEKDAYS_HE_.length; d++) {
    var day = MENTOR_WEEKDAYS_HE_[d];
    headers.push(mentorDayBilingualLabel_(day));
    headers.push(mentorDayNoteHeader_(day));
  }
  return headers;
}

/** Sheet column for per-day free-text note (matches Google Form paragraph title). */
function mentorDayNoteHeader_(dayHe) {
  return 'הערה ' + dayHe;
}

/**
 * Header / form-question label for the per-coach weekly shift-target field.
 * Lives right after the name column. Values 1–6 (integer choice in the form);
 * empty when the coach didn't submit. The optimizer caps the effective target
 * at submitted_days + 1, so a coach who picks 3 days but answers 6 here is
 * still scheduled at most 4 days this week.
 */
var MENTOR_WEEKLY_TARGET_HEADER_ = 'כמות משמרות מבוקשת';
var MENTOR_WEEKLY_TARGET_MIN_ = 1;
var MENTOR_WEEKLY_TARGET_MAX_ = 6;

/** Form + availability days: Sun–Fri (Friday morning only in form options). */
var MENTOR_WEEKDAYS_HE_ = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];

/** Portuguese day names as used by Mentor staff (ראשון-Domingo, …, שישי-Sexta) */
var MENTOR_WEEKDAYS_PT_ = [
  'Domingo',
  'Segunda',
  'Terça',
  'Quarta',
  'Quinta',
  'Sexta'
];

function isMentorFriday_(dayHe) {
  return String(dayHe || '').trim() === 'שישי';
}

/** Friday has morning availability only — no evening shifts or form options. */
function mentorFormDayIncludesEvening_(dayHe) {
  return !isMentorFriday_(dayHe);
}

function mentorDayBilingualLabel_(dayHe) {
  var i = MENTOR_WEEKDAYS_HE_.indexOf(dayHe);
  if (i < 0) return dayHe;
  return dayHe + '-' + MENTOR_WEEKDAYS_PT_[i];
}

/** Maps sheet column header to Hebrew day key (e.g. "ראשון-Domingo" → "ראשון"). */
function matchMentorDayColumnHeader_(header) {
  var h = String(header || '').trim();
  for (var i = 0; i < MENTOR_WEEKDAYS_HE_.length; i++) {
    var day = MENTOR_WEEKDAYS_HE_[i];
    if (h === day || h === mentorDayBilingualLabel_(day)) return day;
  }
  return null;
}

function mentorNotAvailableLabel_() {
  return 'לא זמין / Não disponível';
}

function isMentorNotAvailableText_(text) {
  var s = String(text || '').trim();
  if (!s) return true;
  if (/^לא\s*זמין/i.test(s)) return true;
  if (/n[aã]o\s*dispon[ií]vel/i.test(s)) return true;
  return false;
}

/**
 * All time-range options shown in the form, sorted chronologically
 * by start time, then end time. Used in fake data + parsing.
 */
var MENTOR_MORNING_LABELS_ = [
  '7:00 עד 9:00',
  '7:00 עד 10:00',
  '7:00 עד 11:00',
  '7:00 עד 12:00',
  '8:00 עד 10:00',
  '8:00 עד 11:00',
  '8:00 עד 12:00',
  '9:00 עד 11:00',
  '9:00 עד 12:00',
  '10:00 עד 12:00'
];
var MENTOR_EVENING_LABELS_ = [
  '16:00 עד 18:00',
  '16:00 עד 20:15',
  '16:00 עד 21:15',
  '17:00 עד 19:00',
  '17:00 עד 21:15',
  '18:00 עד 20:15',
  '18:00 עד 21:15',
  '19:00 עד 21:15',
  '19:15 עד 21:15'
];

/**
 * Weekly shift target per coach (min, max), derived from the monthly view
 * the staff aligned on. A "shift" = one morning OR one evening half-day block.
 *
 * This is the single source of truth for both:
 *   • The WeeklyMin/WeeklyMax columns in MasterData (the optimizer + fairness table)
 *   • The fake demo seeder, so the simulated form responses match what the real
 *     coaches actually request.
 */
var MENTOR_WEEKLY_SHIFT_TARGETS_ = {
  'רון':       { min: 1, max: 1 },
  'מנש':       { min: 1, max: 1 },
  'איתם':      { min: 2, max: 3 },
  'בבה':       { min: 3, max: 4 },
  'יובל כץ':   { min: 3, max: 4 },
  'דורון':     { min: 1, max: 1 },
  'עומר אופק': { min: 3, max: 4 },
  'קורין':     { min: 1, max: 2 },
  'שירי':      { min: 1, max: 2 },
  'לילוש':     { min: 1, max: 2 },
  'סהר כהן':   { min: 1, max: 2 },
  'מיתר':      { min: 0, max: 1 },
  'תומר אסף':  { min: 1, max: 1 },
  'טומי':      { min: 1, max: 2 },
  'טל נחמיאס': { min: 0, max: 0 },
  'ינון שוב':  { min: 0, max: 1 }
};
var MENTOR_DEFAULT_WEEKLY_TARGET_ = { min: 1, max: 2 };

function getMentorWeeklyTarget_(coachName) {
  return MENTOR_WEEKLY_SHIFT_TARGETS_[coachName] || MENTOR_DEFAULT_WEEKLY_TARGET_;
}

function responsesHeadersUseLegacyTimeColumns_(headers) {
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || '');
    if (h.indexOf('התחלה') >= 0 || h.indexOf('סיום') >= 0) return true;
  }
  return false;
}

function responsesHeadersUseSplitDayBlocks_(headers) {
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || '').trim();
    if (/\sבוקר$/.test(h) || /\sערב$/.test(h)) return true;
  }
  return false;
}

function responsesHeadersNeedDefaultMentorFormat_(headers) {
  return responsesHeadersUseLegacyTimeColumns_(headers)
    || responsesHeadersUseSplitDayBlocks_(headers)
    || !responsesHeadersIncludeWeeklyTarget_(headers);
}

/**
 * True when the existing headers already contain the weekly-target column.
 * Used to force a re-seed of demo headers when an older sheet (built before
 * the May 2026 target field) is detected.
 */
function responsesHeadersIncludeWeeklyTarget_(headers) {
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c] || '').trim();
    if (isWeeklyTargetResponseHeader_(h)) return true;
  }
  return false;
}

function setupDemoResponsesTab() {
  showRtlConfirmDialog_(
    'setupDemoResponsesTab',
    '🔧 הכן טאב תשובות דמו',
    'מה זה עושה: יוצר או מנקה את "' + CONFIG.sheets.responsesDemo + '" — גיליון רגיל עם הכותרות של טופס מנטור בלבד, בלי קישור לטופס Google.\n\n'
      + 'הכותרות מסונכרנות מ-"' + CONFIG.sheets.responses + '" אם קיים, אחרת נבנות לפי המבנה הנוכחי בקוד.\n\n'
      + 'משמש לדמו / טסטים — האופטימייזר יקרא מ-"' + CONFIG.sheets.responsesDemo + '" כש-`useDemoResponses` ב-Config פעיל.\n\n'
      + 'להמשיך?'
  );
}

function setupDemoResponsesTabRun_() {
  ensureDemoResponsesSheet_(SpreadsheetApp.getActiveSpreadsheet());
  return menuActionSuccess_(
    '✅ טאב תשובות דמו מוכן',
    '• "' + CONFIG.sheets.responsesDemo + '" נוצר/נוקה עם כותרות מנטור\n'
      + '• האופטימייזר קורא מכאן כשמופעל מצב דמו ב-Config\n\n'
      + 'השלב הבא: "🧪 טען זמינות דמו לבדיקה".'
  );
}

function loadFakeMentorResponses() {
  showRtlConfirmDialog_(
    'loadFakeMentorResponses',
    '🧪 טען זמינות דמו לבדיקה',
    'מה זה עושה: טוען דאטה דמו מלא של מנטור — לבדיקת האלגוריתם בלי לחכות שמאמנים ימלאו טופס:\n'
      + '• דורס וממלא "' + CONFIG.sheets.masterData + '" ב-' + FAKE_MENTOR_ROSTER_.length + ' מאמני מנטור (עם דרגות)\n'
      + '• דורס וממלא "' + CONFIG.sheets.responsesDemo + '" ב-' + FAKE_MENTOR_ROSTER_.length + ' תשובות זמינות לדוגמה\n\n'
      + 'לא נוגע ב-"' + CONFIG.sheets.responses + '" (טופס Google האמיתי).\n\n'
      + 'להמשיך?'
  );
}

function loadFakeMentorResponsesRun_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  seedFakeMasterData_(ss);
  seedFakeMentorResponses_(ss);
  return menuActionSuccess_(
    '✅ זמינות דמו נטענה',
    '• ' + CONFIG.sheets.masterData + ' — ' + FAKE_MENTOR_ROSTER_.length + ' שורות מאמנים\n'
      + '• ' + CONFIG.sheets.responsesDemo + ' — ' + FAKE_MENTOR_ROSTER_.length + ' תשובות זמינות\n\n'
      + 'הריצו "🚀 הרץ שיבוץ שבועי" כדי לראות שיבוץ מלא.'
  );
}

function seedFakeMentorResponses_(ss) {
  var sheet = ensureDemoResponsesSheet_(ss);

  var headers;
  if (sheet.getLastRow() >= 1 && sheet.getLastColumn() >= 2) {
    headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var h1 = String(headers[1] || '').trim();
    if ((h1.indexOf('מאמן') < 0 && h1.indexOf('עובד') < 0) || responsesHeadersNeedDefaultMentorFormat_(headers)) {
      headers = buildDefaultMentorFormHeaders_();
    }
  } else {
    headers = buildDefaultMentorFormHeaders_();
  }

  var layout = detectResponsesLayout_(headers);
  var data = [headers];
  var baseTime = new Date();

  var coachNames = getMentorCoachNames_();
  for (var i = 0; i < coachNames.length; i++) {
    var row = [];
    for (var c = 0; c < headers.length; c++) row.push('');
    row[0] = new Date(baseTime.getTime() - i * 37 * 60 * 1000);
    row[layout.nameCol] = coachNames[i];
    fillFakeMentorAvailabilityRow_(row, layout, i, coachNames[i]);
    data.push(row);
  }

  sheet.clear();
  sheet.getRange(1, 1, data.length, headers.length).setValues(data);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold').setBackground('#2E7D6B').setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  for (var col = 1; col <= headers.length; col++) sheet.autoResizeColumn(col);
  resetMakeAvailabilityNotifyCycle_();

  // Refresh the per-coach availability summary columns (hours + shifts) so
  // the demo shows what each coach offered before the optimizer ever runs.
  try {
    var demoAvail = loadAvailability(sheet).availability;
    updateAvailabilitySummary_(sheet, demoAvail);
  } catch (e) {
    Logger.log('updateAvailabilitySummary_ (demo) failed: ' + e);
  }
}

function fillFakeMentorAvailabilityRow_(row, layout, seed, coachName) {
  var picks = pickFakeMentorWeek_(coachName, seed);
  applyMentorPicksToRow_(row, layout, picks, coachName, seed);
  applyFakeWeeklyTargetToRow_(row, layout, picks, coachName, seed);
}

/**
 * Write a sensible weekly-target value into the demo row's target column.
 *
 * Distribution rule (mirrors the runtime cap in getShiftTarget):
 *   - 0 submitted days → leave the cell blank (coach didn't really submit).
 *   - 1 day  → 1 or 2 (heavy on 1).
 *   - 2 days → 1..3, centered on 2.
 *   - 3 days → 2..4, centered on 3.
 *   - 4 days → 3..5, centered on 4.
 *   - 5 days → 4..6, centered on 5.
 *   - Always clamped to [1..6] and to (submittedDays + 1).
 */
var FAKE_MENTOR_FIXED_WEEKLY_TARGET_ = {
  'דורון':    1,
  'תומר אסף': 1
};

function applyFakeWeeklyTargetToRow_(row, layout, picks, coachName, seed) {
  if (!layout || layout.weeklyTargetCol === undefined || layout.weeklyTargetCol < 0) return;
  if (FAKE_MENTOR_FIXED_WEEKLY_TARGET_.hasOwnProperty(coachName)) {
    var forced = FAKE_MENTOR_FIXED_WEEKLY_TARGET_[coachName];
    row[layout.weeklyTargetCol] = (forced > 0) ? forced : '';
    return;
  }
  var distinctDays = {};
  for (var i = 0; i < picks.length; i++) distinctDays[picks[i].dayIndex] = true;
  var submittedDays = Object.keys(distinctDays).length;
  if (submittedDays === 0) {
    row[layout.weeklyTargetCol] = '';
    return;
  }
  // Demo realism (staff rule, May 23 2026): a coach never asks for MORE
  // shifts than they offered. The requested target is either equal to
  // submitted days or one less — never above. Floored at MIN (1) so a 1-day
  // submission still records a real request, and capped at MAX (6).
  var rng = makeMentorFakeRng_(coachName + '|weeklyTarget', seed);
  var offset = rng() < 0.5 ? -1 : 0;
  var target = submittedDays + offset;
  if (target < MENTOR_WEEKLY_TARGET_MIN_) target = MENTOR_WEEKLY_TARGET_MIN_;
  if (target > submittedDays) target = submittedDays;
  if (target > MENTOR_WEEKLY_TARGET_MAX_) target = MENTOR_WEEKLY_TARGET_MAX_;
  row[layout.weeklyTargetCol] = target;
}

/**
 * Probability that a coach's demo row includes a Friday-morning availability.
 * In real life mid-week is almost always covered, Friday is sparser. Keeping
 * this around 40% surfaces some Friday gaps without starving mid-week.
 */
var FAKE_MENTOR_FRIDAY_INCLUDE_PROB_ = 0.4;

/** Full shift windows used in demo form responses (matches Mentor half-day blocks). */
var FAKE_MENTOR_FULL_MORNING_LABEL_ = '7:00 עד 12:00';
var FAKE_MENTOR_FULL_EVENING_LABEL_ = '16:00 עד 21:15';

/** Rank from FAKE_MENTOR_ROSTER_ (demo seeder does not depend on MasterData sheet). */
function getCoachRankForDemo_(coachName) {
  for (var i = 0; i < FAKE_MENTOR_ROSTER_.length; i++) {
    if (FAKE_MENTOR_ROSTER_[i].name === coachName) {
      return normalizeMentorRank_(FAKE_MENTOR_ROSTER_[i].rank);
    }
  }
  return CONFIG.ranks.best;
}

/**
 * Coaches who, in real life, submit a tighter 3–4 shifts of availability
 * regardless of their rank-typical pattern. Demo pins them to exactly 3 or 4
 * picks total and skips the Friday bonus so the cap is hard, not approximate.
 */
var FAKE_MENTOR_HARD_CAP_3_TO_4_ = ['יובל כץ'];

function isMentorHardCap3To4_(coachName) {
  for (var i = 0; i < FAKE_MENTOR_HARD_CAP_3_TO_4_.length; i++) {
    if (FAKE_MENTOR_HARD_CAP_3_TO_4_[i] === coachName) return true;
  }
  return false;
}

/**
 * How many (day, block) availability picks a fake coach submits this week.
 * Rank 1: usually 1 (איתם 2–3). Rank 2: 4–5. Rank 3: 3–4. Rank 4: rarely 1.
 * Coaches in FAKE_MENTOR_HARD_CAP_3_TO_4_ override their rank with a 3–4 cap.
 */
function pickFakeWeeklyPickCount_(rank, coachName, rng) {
  if (isMentorHardCap3To4_(coachName)) return 3 + Math.floor(rng() * 2);
  if (rank === 1) {
    if (coachName === 'איתם') return 2 + Math.floor(rng() * 2);
    return 1;
  }
  if (rank === 2) return 4 + Math.floor(rng() * 2);
  if (rank === 3) return 3 + Math.floor(rng() * 2);
  if (rank === 4) return rng() < 0.25 ? 1 : 0;
  return 1;
}

/** Probability that a single picked weekday turns into an evening shift (otherwise morning). */
var FAKE_MENTOR_EVENING_BLOCK_PROB_ = 0.4;

/**
 * Hard-coded (day, block) picks for specific coaches whose real-life
 * availability is known and never changes. The seeder returns these
 * exactly, bypassing the rank-based random pick logic — so demo runs
 * stay consistent for staff-side scenarios that depend on these coaches.
 *
 * Day indices follow MENTOR_WEEKDAYS_HE_: 0=ראשון, 1=שני, 2=שלישי,
 * 3=רביעי, 4=חמישי, 5=שישי.
 */
var FAKE_MENTOR_FIXED_PICKS_ = {
  'רון':       [{ dayIndex: 1, block: 'morning' }],   // Monday morning, always & only
  'מנש':       [{ dayIndex: 3, block: 'evening' }],    // Wednesday evening, always & only
  'דורון':     [{ dayIndex: 1, block: 'evening' }, { dayIndex: 5, block: 'morning' }],
  'תומר אסף':  [{ dayIndex: 0, block: 'morning' }, { dayIndex: 2, block: 'morning' }],
  'טל נחמיאס': []
};

/**
 * Decide the (day, block) picks for one fake coach for the week.
 *
 * Real-world pattern (per Mentor staff): a coach almost never gives the same
 * day morning AND evening. The seeder therefore picks distinct days first,
 * then assigns at most one block per day (morning ~60% / evening ~40% for
 * weekdays). Friday is morning-only.
 *
 * Coaches listed in FAKE_MENTOR_FIXED_PICKS_ skip the random logic entirely.
 *
 * Deterministic by coachName+seed.
 *
 * @returns {Array<{dayIndex:number, block:'morning'|'evening'}>}
 */
function pickFakeMentorWeek_(coachName, seed) {
  if (FAKE_MENTOR_FIXED_PICKS_[coachName]) {
    // Return a fresh copy so downstream mutators (sorts etc.) can't pollute
    // the const table across coaches sharing the same array reference.
    var fixed = FAKE_MENTOR_FIXED_PICKS_[coachName];
    var out = [];
    for (var k = 0; k < fixed.length; k++) {
      out.push({ dayIndex: fixed[k].dayIndex, block: fixed[k].block });
    }
    return out;
  }

  var rank = getCoachRankForDemo_(coachName);
  var rng = makeMentorFakeRng_(coachName + '|count', seed);
  var n = pickFakeWeeklyPickCount_(rank, coachName, rng);
  if (n <= 0) return [];

  // Collect weekday indices (Sun–Thu) and shuffle. Friday is handled below.
  var weekdayIndices = [];
  for (var di = 0; di < MENTOR_WEEKDAYS_HE_.length; di++) {
    var dayHe = MENTOR_WEEKDAYS_HE_[di];
    if (!isMentorFriday_(dayHe)) weekdayIndices.push(di);
  }
  shuffleMentorPairsInPlace_(weekdayIndices, makeMentorFakeRng_(coachName + '|days', seed));

  var blockRng = makeMentorFakeRng_(coachName + '|block', seed);
  var picks = [];
  for (var p = 0; p < Math.min(n, weekdayIndices.length); p++) {
    var dayIdx = weekdayIndices[p];
    var block = blockRng() < FAKE_MENTOR_EVENING_BLOCK_PROB_ ? 'evening' : 'morning';
    picks.push({ dayIndex: dayIdx, block: block });
  }

  // Friday bonus is always morning and on a different day index, so it never
  // collides with the weekday picks (which exclude Friday by construction).
  if (!isMentorHardCap3To4_(coachName)) {
    var fridayIdx = -1;
    for (var fi = 0; fi < MENTOR_WEEKDAYS_HE_.length; fi++) {
      if (isMentorFriday_(MENTOR_WEEKDAYS_HE_[fi])) { fridayIdx = fi; break; }
    }
    if (fridayIdx >= 0) {
      var rngFri = makeMentorFakeRng_(coachName + '|friCoin', seed);
      if (rngFri() < FAKE_MENTOR_FRIDAY_INCLUDE_PROB_) {
        picks.push({ dayIndex: fridayIdx, block: 'morning' });
      }
    }
  }

  return picks;
}

function applyMentorPicksToRow_(row, layout, picks, coachName, seed) {
  var byDay = {};
  for (var i = 0; i < picks.length; i++) {
    var p = picks[i];
    if (!byDay[p.dayIndex]) byDay[p.dayIndex] = { morning: false, evening: false };
    byDay[p.dayIndex][p.block] = true;
  }

  if (layout.mode === 'dayRanges') {
    for (var di = 0; di < MENTOR_WEEKDAYS_HE_.length; di++) {
      var col = layout.dayColumns[MENTOR_WEEKDAYS_HE_[di]];
      if (col === undefined) continue;
      var blocks = byDay[di] || { morning: false, evening: false };
      writeFakeMentorDayCell_(row, col, blocks, coachName, seed, di);
    }
    return;
  }

  for (var di2 = 0; di2 < MENTOR_WEEKDAYS_HE_.length; di2++) {
    var fields = layout.dayFields[MENTOR_WEEKDAYS_HE_[di2]];
    if (!fields) continue;
    var b = byDay[di2] || { morning: false, evening: false };
    if (b.morning) {
      setFakeBlockChoice_(row, fields, 'morning', MENTOR_MORNING_LABELS_, seed, di2);
    } else {
      setFakeBlockUnavailable_(row, fields, 'morning');
    }
    if (b.evening) {
      setFakeBlockChoice_(row, fields, 'evening', MENTOR_EVENING_LABELS_, seed, di2);
    } else {
      setFakeBlockUnavailable_(row, fields, 'evening');
    }
  }
}

/** Day cell for the checkbox-per-day layout. Joins selected ranges, or "לא זמין" when empty. */
function writeFakeMentorDayCell_(row, col, blocks, coachName, seed, dayIndex) {
  var parts = [];
  if (blocks.morning) {
    parts.push(pickFakeMentorLabel_(MENTOR_MORNING_LABELS_, coachName, seed, dayIndex, 'morning'));
  }
  if (blocks.evening) {
    parts.push(pickFakeMentorLabel_(MENTOR_EVENING_LABELS_, coachName, seed, dayIndex, 'evening'));
  }
  row[col] = parts.length > 0 ? parts.join(', ') : mentorNotAvailableLabel_();
}

/**
 * Per-duration weights for fake form labels. Real-world Mentor pattern:
 * 3h / 4h / 5h windows are all common (≈30% each), 2h windows are rare
 * (~5%), and anything shorter never happens. The optimizer is expected
 * to handle a 5h submission by scheduling a 4-training anchor inside it.
 *
 * The 5h label appears only once in MENTOR_*_LABELS_ while 4h appears
 * twice and 3h three times, so per-label weights are biased upward for
 * 5h to keep the total per-duration probabilities roughly equal.
 */
function fakeLabelDurationHours_(label) {
  var m = String(label).match(/(\d{1,2}):(\d{2})\s*עד\s*(\d{1,2}):(\d{2})/);
  if (!m) return 0;
  var start = parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
  var end = parseInt(m[3], 10) + parseInt(m[4], 10) / 60;
  return Math.max(0, end - start);
}

function fakeLabelWeight_(label) {
  var d = fakeLabelDurationHours_(label);
  if (d >= 4.5) return 60;    // 5h windows — most common
  if (d >= 3.5) return 30;    // 4h windows — most common (2 labels per block)
  if (d >= 2.5) return 3;     // 3h windows — rare per staff
  if (d >= 1.5) return 1.5;   // 2h windows — very rare
  return 0;                   // ≤1h → never picked
}

/**
 * Pick a fake submission label using duration-weighted random choice.
 *
 * Target distribution (per Mentor staff "real coaches submit 4 or 5
 * hours most of the time; 3h is rare, 2h is very rare"):
 *   5h  → ~45%   4h → ~45%   3h → ~5%   2h → ~5%
 *
 * Deterministic by (coachName, seed, dayIndex, blockTag).
 */
function pickFakeMentorLabel_(labels, coachName, seed, dayIndex, blockTag) {
  var pool = [];
  var totalWeight = 0;
  for (var i = 0; i < labels.length; i++) {
    var w = fakeLabelWeight_(labels[i]);
    if (w <= 0) continue;
    pool.push({ label: labels[i], weight: w });
    totalWeight += w;
  }
  if (!pool.length || totalWeight <= 0) {
    return blockTag === 'morning'
      ? FAKE_MENTOR_FULL_MORNING_LABEL_
      : FAKE_MENTOR_FULL_EVENING_LABEL_;
  }

  var pickRng = makeMentorFakeRng_(coachName + '|label|pick|' + blockTag + '|' + dayIndex, seed);
  var r = pickRng() * totalWeight;
  var acc = 0;
  for (var j = 0; j < pool.length; j++) {
    acc += pool[j].weight;
    if (r < acc) return pool[j].label;
  }
  return pool[pool.length - 1].label;
}


/** In-place Fisher-Yates shuffle using a deterministic PRNG. */
function shuffleMentorPairsInPlace_(arr, rng) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(rng() * (i + 1));
    var tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

/**
 * Tiny deterministic PRNG (xorshift32 seeded by an FNV-1a-style hash of the key).
 * Same key + same seed always produces the same sequence — so fake responses are
 * stable across reseeds, but vary between coaches and across runs.
 */
function makeMentorFakeRng_(key, seed) {
  var s = 0x811c9dc5;
  var str = String(key) + ':' + String(seed);
  for (var i = 0; i < str.length; i++) {
    s ^= str.charCodeAt(i);
    s = Math.imul(s, 16777619) >>> 0;
  }
  if (s === 0) s = 1;
  return function() {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

function setFakeBlockUnavailable_(row, fields, block) {
  var na = 'לא זמין';
  if (block === 'morning') {
    if (fields.morningBlock !== undefined) row[fields.morningBlock] = na;
    if (fields.morningStart !== undefined) row[fields.morningStart] = na;
    if (fields.morningEnd !== undefined) row[fields.morningEnd] = na;
  } else {
    if (fields.eveningBlock !== undefined) row[fields.eveningBlock] = na;
    if (fields.eveningStart !== undefined) row[fields.eveningStart] = na;
    if (fields.eveningEnd !== undefined) row[fields.eveningEnd] = na;
  }
}

/** Fills one block column (dropdown label) or legacy start/end pair. */
function setFakeBlockChoice_(row, fields, block, labels, seed, dayIndex) {
  var label = labels[(seed + dayIndex) % labels.length];
  if (block === 'morning') {
    if (fields.morningBlock !== undefined) {
      row[fields.morningBlock] = label;
    } else if (fields.morningStart !== undefined || fields.morningEnd !== undefined) {
      var parts = label.replace(/:/g, '').split(/\s*עד\s*/);
      if (fields.morningStart !== undefined) row[fields.morningStart] = parts[0] || label;
      if (fields.morningEnd !== undefined) row[fields.morningEnd] = parts[1] || '';
    }
  } else {
    if (fields.eveningBlock !== undefined) {
      row[fields.eveningBlock] = label;
    } else if (fields.eveningStart !== undefined || fields.eveningEnd !== undefined) {
      var partsE = label.split(/\s*עד\s*/);
      if (fields.eveningStart !== undefined) row[fields.eveningStart] = partsE[0] || label;
      if (fields.eveningEnd !== undefined) row[fields.eveningEnd] = partsE[1] || '';
    }
  }
}

function seedFakeMasterData_(ss) {
  seedMasterData_(ss);
}

function seedResponses_(ss) {
  var sheet = ensureDemoResponsesSheet_(ss);
  sheet.clear();

  var headers = ['Timestamp', 'שם העובד', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת', 'הערות', 'Email Address'];
  var names = ['דנה', 'יוסי', 'מיה', 'עומר', 'נועה', 'איתי'];
  var data = [headers];

  for (var n = 0; n < names.length; n++) {
    data.push([
      '1/1/2026 10:00:00',
      names[n],
      'בוקר',
      'בוקר, ערב',
      'בוקר',
      'ערב',
      'בוקר, ערב',
      'בוקר, אמצע',
      'בוקר, ערב',
      '',
      names[n].replace(/\s/g, '') + '@test.com'
    ]);
  }

  sheet.getRange(1, 1, data.length, headers.length).setValues(data);
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold').setBackground('#2E7D6B').setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  for (var c = 1; c <= headers.length; c++) sheet.autoResizeColumn(c);
  resetMakeAvailabilityNotifyCycle_();
}
