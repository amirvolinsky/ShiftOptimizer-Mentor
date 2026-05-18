/**
 * Seed functions for setting up the Google Sheet (Shift Optimizer Mentor).
 */

function setupTables() {
  showRtlConfirmDialog_(
    'setupTables',
    '🏗️ הגדר טבלאות',
    'מה זה עושה: יוצר או ממלא מחדש את טבלאות ברירת המחדל לעובדים, משמרות וחוקים.\n\n'
      + 'טבלאות: דורס תוכן קיים בגיליונות "' + CONFIG.sheets.masterData + '", '
      + '"' + CONFIG.sheets.shiftTemplate + '", "' + CONFIG.sheets.rules + '".\n'
      + 'לא נוגע ב-' + CONFIG.sheets.responses + '.\n\n'
      + 'להמשיך?'
  );
}

function setupTablesRun_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  seedMasterData_(ss);
  seedShiftTemplate_(ss);
  seedRules_(ss);
  try {
    ensureSpreadsheetOpenGuideTrigger_();
  } catch (ignore) {}
  SpreadsheetApp.getUi().alert(
    rtlUiText_('✅ טבלאות הוגדרו!'),
    rtlUiText_(
      '• MasterData — רשימת עובדים לדוגמה\n'
      + '• ShiftTemplate — תבנית משמרות (שני סניפים)\n'
      + '• Rules — חוקים\n\n'
      + 'ערכו את הטבלאות לפי הארגון שלכם.\n'
      + 'ודאו ש-' + CONFIG.sheets.responses + ' מחובר לטופס Google.'
    ),
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function loadTestResponses() {
  showRtlConfirmDialog_(
    'loadTestResponses',
    '🧪 טען תשובות בדיקה',
    'מה זה עושה: ממלא את גיליון הטופס בתשובות לדוגמה — רק לבדיקה.\n\n'
      + 'טבלאות: דורס את כל התוכן בגיליון "' + CONFIG.sheets.responses + '".\n'
      + 'אם יש שם הגשות אמיתיות — אל תאשר.\n\n'
      + 'להמשיך?'
  );
}

function loadTestResponsesRun_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  seedResponses_(ss);
  SpreadsheetApp.getUi().alert(
    rtlUiText_('✅ תשובות בדיקה נטענו.\nלחצו הרץ אופטימייזר.')
  );
}

function seedMasterData_(ss) {
  var sheet = ss.getSheetByName(CONFIG.sheets.masterData);
  if (!sheet) sheet = ss.insertSheet(CONFIG.sheets.masterData);
  sheet.clear();

  var data = [
    ['Name', 'Rank', 'IsPriority', 'MinShifts', 'MaxShifts', 'LocationRestriction', 'RequestedShifts', 'BlockRestriction'],
    ['מנטור א', 4, true, 5, 6, 'SiteA', 5, ''],
    ['מנטור ב', 4, true, 5, 6, 'SiteB', 5, ''],
    ['דנה', 3, false, 0, 6, '', 4, ''],
    ['יוסי', 3, false, 0, 6, '', 5, ''],
    ['מיה', 2, false, 0, 6, 'SiteA', 4, ''],
    ['עומר', 2, false, 0, 6, 'SiteB', 4, ''],
    ['נועה', 1, false, 0, 6, '', 5, ''],
    ['איתי', 1, false, 0, 6, '', 4, '']
  ];

  sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  sheet.getRange(1, 1, 1, data[0].length)
    .setFontWeight('bold').setBackground('#2E7D6B').setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  for (var c = 1; c <= data[0].length; c++) sheet.autoResizeColumn(c);
}

function seedShiftTemplate_(ss) {
  var sheet = ss.getSheetByName(CONFIG.sheets.shiftTemplate);
  if (!sheet) sheet = ss.insertSheet(CONFIG.sheets.shiftTemplate);
  sheet.clear();

  var data = [['Location', 'Day', 'Block', 'Headcount', 'StartTime', 'EndTime']];
  var weekdays = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי'];
  var locations = CONFIG.locations;

  for (var li = 0; li < locations.length; li++) {
    var loc = locations[li];
    for (var i = 0; i < weekdays.length; i++) {
      var day = weekdays[i];
      data.push([loc, day, 'בוקר', 2, '8:00', '14:00']);
      data.push([loc, day, 'בוקר', 1, '9:00', '14:00']);
      data.push([loc, day, 'ערב', 2, '14:00', '20:00']);
    }
    data.push([loc, 'שישי', 'בוקר', 1, '8:00', '14:00']);
    data.push([loc, 'שישי', 'אמצע', 1, '10:00', '17:00']);
    data.push([loc, 'שישי', 'ערב', 2, '14:00', '19:00']);
    if (loc === 'SiteA') {
      data.push([loc, 'שבת', 'בוקר', 2, '8:00', '14:00']);
      data.push([loc, 'שבת', 'ערב', 2, '14:00', '19:00']);
    }
  }

  sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
  sheet.getRange(1, 1, 1, data[0].length)
    .setFontWeight('bold').setBackground('#2E7D6B').setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  for (var c = 1; c <= data[0].length; c++) sheet.autoResizeColumn(c);
}

function seedRules_(ss) {
  var sheet = ss.getSheetByName(CONFIG.sheets.rules);
  if (!sheet) sheet = ss.insertSheet(CONFIG.sheets.rules);
  sheet.clear();

  var data = [
    ['Key', 'Value'],
    ['no_juniors_alone', 'TRUE'],
    ['min_morning_score', 7],
    ['min_morning_score_sitea', 7],
    ['min_morning_score_siteb', 6],
    ['default_target_shifts_per_week', 5],
    ['max_shifts_per_week', 6],
    ['min_rest_hours', 0],
    ['allow_double_shift', 'FALSE']
  ];

  sheet.getRange(1, 1, data.length, 2).setValues(data);
  sheet.getRange(1, 1, 1, 2)
    .setFontWeight('bold').setBackground('#2E7D6B').setFontColor('#FFFFFF');
  sheet.setFrozenRows(1);
  sheet.autoResizeColumn(1);
  sheet.autoResizeColumn(2);
}

function seedResponses_(ss) {
  var sheetName = CONFIG.sheets.responses;
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);
  sheet.clear();

  var headers = ['Timestamp', 'שם העובד', 'ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת', 'הערות', 'Email Address'];
  var names = ['דנה', 'יוסי', 'מיה', 'עומר', 'נועה', 'איתי', 'מנטור א', 'מנטור ב'];
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
