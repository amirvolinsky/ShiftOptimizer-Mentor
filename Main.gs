/**
 * @OnlyCurrentDoc
 *
 * Shift Optimizer Mentor — main entry (see CLIENT in Config.gs).
 *
 * OAuth: If the browser shows "This app is blocked" / "sensitive info", that
 * is decided by Google Account / Google Cloud, not by comments in this code.
 * Fix: Apps Script -> Project settings -> see which GCP project is linked; in
 * Google Cloud Console (same project) open OAuth consent screen, set app to
 * "Testing" and add your account under Test users (External), or "Internal" for
 * a Workspace org-only app. Unlinked scripts use a default project; for custom
 * links you must configure the consent screen or Google blocks the scope.
 * Advanced Protection / Workspace "block 3p apps" can also require admin help.
 *
 * Creates the custom menu and orchestrates the full optimization pipeline:
 *   1. Load master data, availability, shift templates, rules
 *   2. Run the optimizer across both locations
 *   3. Write combined schedule sheet (both locations + fairness table)
 *   4. Show summary with warnings and fairness stats
 */

/**
 * Wrap text for native Ui.alert so Hebrew + embedded English (sheet names)
 * renders as a right-to-left paragraph in the Sheets dialog.
 */
function rtlUiText_(s) {
  if (s == null || s === undefined) return '';
  return '\u202B' + String(s) + '\u202C';
}

/**
 * Simple onOpen cannot call showModalDialog (limited auth). This installable on-open trigger
 * runs showGuideImpl_ with full auth so the RTL guide can appear every time the spreadsheet opens.
 * Must match the string passed to ScriptApp.newTrigger.
 */
function onSpreadsheetOpenShowGuide_() {
  showGuideImpl_();
}

/**
 * Creates an installable "spreadsheet open" trigger once (idempotent).
 * Called from onOpen (try), setupTablesRun_, and showGuide so the guide can auto-open after first auth.
 */
function ensureSpreadsheetOpenGuideTrigger_() {
  var handler = 'onSpreadsheetOpenShowGuide_';
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var tr = triggers[i];
    if (tr.getHandlerFunction() === handler && tr.getEventType() === ScriptApp.EventType.ON_OPEN) {
      return;
    }
  }
  ScriptApp.newTrigger(handler)
    .forSpreadsheet(SpreadsheetApp.getActive())
    .onOpen()
    .create();
}

/**
 * RTL modal confirmation (HtmlService). Native Ui.alert ignores paragraph direction for Hebrew.
 */
function showRtlConfirmDialog_(actionId, title, message) {
  var t = HtmlService.createTemplateFromFile('ConfirmDialog');
  t.actionId = actionId;
  t.title = title;
  t.message = message;
  SpreadsheetApp.getUi().showModalDialog(
    t.evaluate().setWidth(520).setHeight(460),
    title
  );
}

/**
 * Dispatched from ConfirmDialog after אישור.
 * Name must NOT end with "_" — private functions are blocked from google.script.run.
 */
function runMenuConfirmed(actionId) {
  switch (actionId) {
    case 'optimizeShifts':
      optimizeShiftsRun_();
      break;
    case 'refreshSchedule':
      refreshScheduleRun_();
      break;
    case 'shareSchedule':
      shareScheduleRun_();
      break;
    case 'clearSchedule':
      clearScheduleRun_();
      break;
    case 'setupTables':
      setupTablesRun_();
      break;
    case 'loadTestResponses':
      loadTestResponsesRun_();
      break;
    default:
      throw new Error('פעולה לא ידועה');
  }
}

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu(CONFIG.menuTitle)
    .addItem('🚀 הרץ אופטימייזר', 'optimizeShifts')
    .addItem('🔄 רענן שיבוץ', 'refreshSchedule')
    .addItem('📤 הפץ משמרות', 'shareSchedule')
    .addItem('❓ מי לא הגיש זמינות?', 'checkMissingResponses')
    .addItem('🗑️ נקה שיבוץ', 'clearSchedule')
    .addSeparator()
    .addItem('🏗️ הגדר טבלאות (MasterData, ShiftTemplate, Rules)', 'setupTables')
    .addItem('🧪 טען תשובות בדיקה (Form Responses)', 'loadTestResponses')
    .addItem('📖 מדריך שימוש', 'showGuide')
    .addToUi();

  try {
    ensureSpreadsheetOpenGuideTrigger_();
  } catch (ignore) {
    // Simple onOpen may lack permission to create triggers; showGuide / setupTables will retry.
  }
}

/**
 * Menu entry: register installable open trigger (if needed) and show the RTL guide.
 */
function showGuide() {
  try {
    ensureSpreadsheetOpenGuideTrigger_();
  } catch (ignore) {}
  showGuideImpl_();
}

/**
 * RTL welcome guide (HtmlService). Invoked from showGuide and from installable on-open trigger.
 */
function showGuideImpl_() {
  var shareTab = CONFIG.sheets.shareExport;
  var histTab = CONFIG.sheets.shiftHistory;

  var msg = [
    CONFIG.guideBannerHe,
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '🤖 מה האלגוריתם עושה?',
    'קורא זמינות מהטופס ומשבץ עובדים לפי כללים והוגנות (ללא עלויות):',
    '• אין א\'/ב\' לבד — חייב מנוסה במשמרת',
    '• ניקוד בוקר מינימלי (לפי Rules)',
    '• ד\' בשישי בוקר (הכי בכיר)',
    '• שני עובדים בסגירה בשישי/שבת',
    '• עובדי עדיפות (IsPriority) — מינימום משמרות לפי MasterData',
    '',
    '📋 איך להשתמש',
    'א. וודאו שכולם מילאו את טופס הזמינות.',
    'ב. "🚀 הרץ אופטימייזר" — שיבוץ אוטומטי לגיליון הלו"ז.',
    'ג. לעריכה ידנית: לחצו על תא ובחרו מהרשימה.',
    '   💡 רחפו על תא כדי לראות חלופות — זמינות, כבר משובץ היום, א\'/ב\' לבד, מרחק מהיעד.',
    'ד. אחרי שינויים בלו"ז — "🔄 רענן שיבוץ" (טבלת הוגנות והערות בתאים).',
    'ה. "📤 הפץ משמרות" —',
    '   • בונה גיליון "' + shareTab + '" (תצוגה נקייה להפצה)',
    '   • שומר היסטוריית שיבוץ ב"' + histTab + '" ומארכיון תשובות הטופס',
    '',
    '🔍 כלים נוספים',
    '• "❓ מי לא הגיש זמינות?" — רשימת חסרים וטקסט תזכורת.',
    '• "🗑️ נקה שיבוץ" — מוחק שיבוץ ומתחיל מחדש.',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    '📖 המדריך זמין תמיד מהתפריט. בהצלחה! 🙌'
  ].join('\n');

  // Native Ui.alert does not honor RTL for Hebrew; use HtmlService like ConfirmDialog.
  var t = HtmlService.createTemplateFromFile('GuideDialog');
  t.title = '📖 ברוכים הבאים!';
  t.message = msg;
  SpreadsheetApp.getUi().showModalDialog(
    t.evaluate().setWidth(560).setHeight(620),
    '📖 ברוכים הבאים!'
  );
}

function optimizeShifts() {
  showRtlConfirmDialog_(
    'optimizeShifts',
    '🚀 הרץ אופטימייזר',
    'מה זה עושה: קורא זמינות וכללים, ומשבץ עובדים אוטומטית לפי החוקים והוגנות.\n\n'
      + 'טבלאות:\n'
      + '• קורא בלבד: "' + CONFIG.sheets.masterData + '", "' + CONFIG.sheets.responses + '", '
      + '"' + CONFIG.sheets.shiftTemplate + '", "' + CONFIG.sheets.rules + '".\n'
      + '• כותב מחדש: גיליון "' + CONFIG.sheets.schedule + '" (כל התוכן הקודם במערך נמחק).\n\n'
      + 'להמשיך?'
  );
}

/**
 * Runs optimizer + writes schedule. No UI — for triggers / background use.
 * @returns {{masterMap:Object, employeeCount:number, respondentCount:number, slots:Array, result:Object, history:Object}}
 */
function optimizeShiftsRunCore_() {
  var masterMap = loadMasterData();
  var employeeCount = Object.keys(masterMap).length;
  if (employeeCount === 0) throw new Error('לא נמצאו עובדים בטבלת MasterData.');

  var responseData = loadAvailability();
  var availability = responseData.availability;
  var notes = responseData.notes || {};
  var respondentCount = Object.keys(availability).length;

  var slots = loadShiftTemplates();
  if (slots.length === 0) throw new Error('לא נמצאו משמרות בטבלת ShiftTemplate.');

  var rules = loadRules();
  var result = optimizeWeek(slots, availability, masterMap, rules);
  writeSchedule(result, slots, masterMap, availability, notes);
  var history = getFairnessHistory(4);

  return {
    masterMap: masterMap,
    employeeCount: employeeCount,
    respondentCount: respondentCount,
    availability: availability,
    slots: slots,
    result: result,
    history: history
  };
}

/**
 * Same text as the menu success dialog (for optimizeShiftsRun_ / silent run logging).
 */
function buildOptimizerSummaryMessage_(d) {
  var employeeCount = d.employeeCount;
  var respondentCount = d.respondentCount;
  var slots = d.slots;
  var result = d.result;
  var history = d.history;

  var msg = '✅ השיבוץ הושלם!\n\n';
  msg += '📊 סיכום כללי:\n';
  msg += '• עובדים במערכת: ' + employeeCount + '\n';
  msg += '• עובדים שמילאו טופס: ' + respondentCount + '\n';
  msg += '• סה"כ משמרות לשיבוץ: ' + slots.length + '\n';

  var unfilledCount = 0;
  var slotIds = Object.keys(result.assignments);
  for (var i = 0; i < slotIds.length; i++) {
    if (result.assignments[slotIds[i]].unfilled) unfilledCount++;
  }
  var filledCount = slots.length - unfilledCount;
  msg += '• משמרות שמולאו: ' + filledCount + '/' + slots.length;
  if (unfilledCount > 0) msg += ' (' + unfilledCount + ' לא מולאו ❌)';
  msg += '\n\n';

  if (result.warnings.length > 0) {
    msg += '\n⚠️ נקודות לתשומת לב (' + result.warnings.length + '):\n';
    for (var i = 0; i < Math.min(result.warnings.length, 15); i++) {
      msg += '• ' + result.warnings[i] + '\n';
    }
    if (result.warnings.length > 15) {
      msg += '... ועוד ' + (result.warnings.length - 15) + ' נקודות.\n';
    }
  }

  msg += '\n👥 חלוקת משמרות לעובד:\n';
  var statNames = Object.keys(result.employeeStats);
  statNames.sort(function(a, b) {
    return (result.employeeStats[b].shiftsCount || 0) - (result.employeeStats[a].shiftsCount || 0);
  });
  for (var i = 0; i < statNames.length; i++) {
    var stat = result.employeeStats[statNames[i]];
    if (stat.shiftsCount > 0) {
      var target = stat.shiftTarget || 0;
      var label = stat.name + ': ' + stat.shiftsCount + '/' + target + ' משמרות';
      if (stat.isGlobal || stat.isPriority) label += ' (עדיפות)';
      else if (stat.shiftsCount > target) label += ' ⚠ מעל היעד';
      else if (stat.shiftsCount === target) label += ' ✅';
      if (history && history[stat.name] && history[stat.name].weeks > 1) {
        label += ' (ממוצע ' + history[stat.name].avgShifts.toFixed(1) + ' ב-' + history[stat.name].weeks + ' שבועות)';
      }
      msg += '• ' + label + '\n';
    }
  }
  return msg;
}

function optimizeShiftsRun_() {
  var ui = SpreadsheetApp.getUi();
  try {
    var d = optimizeShiftsRunCore_();
    try {
      ensureSpreadsheetOpenGuideTrigger_();
    } catch (ignore) {}
    var msg = buildOptimizerSummaryMessage_(d);
    ui.alert(rtlUiText_(CONFIG.optimizerResultsTitleHe), rtlUiText_(msg), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert(rtlUiText_('❌ שגיאה'), rtlUiText_('השיבוץ נכשל:\n\n' + e.message), ui.ButtonSet.OK);
    Logger.log('Optimization error: ' + e.message + '\n' + (e.stack || ''));
  }
}

/**
 * Menu: "רענן שיבוץ" — after manual edits, refresh fairness table and cell notes.
 */
function refreshSchedule() {
  showRtlConfirmDialog_(
    'refreshSchedule',
    '🔄 רענן שיבוץ',
    'מה זה עושה: אחרי שינוי שמות בתאים בלו"ז — מעדכן טבלת הוגנות והערות בתאים.\n\n'
      + 'טבלאות:\n'
      + '• קורא: "' + CONFIG.sheets.schedule + '", "' + CONFIG.sheets.masterData + '", '
      + '"' + CONFIG.sheets.shiftTemplate + '", "' + CONFIG.sheets.responses + '".\n'
      + '• מעדכן תוכן בגיליון "' + CONFIG.sheets.schedule + '" בלבד.\n\n'
      + 'להמשיך?'
  );
}

function refreshScheduleRun_() {
  HISTORY_SCORES_CACHE_ = null;
  var ui = SpreadsheetApp.getUi();
  try {
    var out = refreshScheduleFromSheet_();
    if (!out.ok) {
      ui.alert(rtlUiText_('שגיאה'), rtlUiText_(out.message), ui.ButtonSet.OK);
      return;
    }
    var msg = '✅ טבלת ההוגנות והערות בתאים עודכנו!\n';
    if (out.warnings && out.warnings.length > 0) {
      msg += '\n⚠ בעיות:\n';
      for (var w = 0; w < out.warnings.length; w++) {
        msg += '• ' + out.warnings[w] + '\n';
      }
    }
    ui.alert(rtlUiText_('🔄 רענון שיבוץ'), rtlUiText_(msg), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert(rtlUiText_('❌ שגיאה'), rtlUiText_('רענון שיבוץ נכשל:\n\n' + e.message), ui.ButtonSet.OK);
    Logger.log('refreshSchedule error: ' + e.message + '\n' + (e.stack || ''));
  }
}

/**
 * Menu: "מי לא הגיש זמינות?" — shows which employees haven't submitted the form,
 * with a ready-to-copy reminder message and a summary of who did submit + their notes.
 */
function checkMissingResponses() {
  var ui = SpreadsheetApp.getUi();
  try {
    var masterMap = loadMasterData();
    var allNames = Object.keys(masterMap);

    var responseData = loadAvailability();
    var submitted = responseData.availability;
    var notes = responseData.notes || {};

    var missing = [];
    var present = [];
    for (var i = 0; i < allNames.length; i++) {
      var name = allNames[i];
      if (submitted[name]) {
        present.push(name);
      } else {
        missing.push(name);
      }
    }

    var msg = '';

    if (missing.length === 0) {
      msg += '✅ כל העובדים הגישו זמינות! (' + present.length + '/' + allNames.length + ')\n';
    } else {
      msg += '⚠ ' + missing.length + ' מתוך ' + allNames.length + ' עובדים לא הגישו זמינות:\n\n';
      for (var i = 0; i < missing.length; i++) {
        var emp = masterMap[missing[i]];
        var rankLabel = rankToHebrew(emp.rank) + '\'';
        msg += '• ' + missing[i] + ' (דרגה ' + rankLabel + ')';
        if (emp.isGlobal || emp.isPriority) msg += ' — עדיפות';
        msg += '\n';
      }

      msg += '\n📋 הודעת תזכורת מוכנה להעתקה:\n';
      msg += '─────────────────────\n';
      msg += 'היי, עוד לא מילאתם את טופס הזמינות השבוע:\n';
      msg += missing.join(', ') + '\n';
      msg += 'בבקשה מלאו בהקדם 🙏\n';
      msg += '─────────────────────\n';
    }

    if (present.length > 0) {
      msg += '\n✅ הגישו (' + present.length + '):\n';
      for (var i = 0; i < present.length; i++) {
        var line = '• ' + present[i];
        var avail = submitted[present[i]];
        var dayCount = 0;
        var days = Object.keys(avail);
        for (var d = 0; d < days.length; d++) {
          if (avail[days[d]] && avail[days[d]].length > 0) dayCount++;
        }
        line += ' — ' + dayCount + ' ימים';
        if (notes[present[i]]) {
          line += ' 💬 "' + notes[present[i]] + '"';
        }
        msg += line + '\n';
      }
    }

    ui.alert(rtlUiText_('❓ מי לא הגיש זמינות?'), rtlUiText_(msg), ui.ButtonSet.OK);

  } catch (e) {
    ui.alert(rtlUiText_('שגיאה'), rtlUiText_(String(e.message || e)), ui.ButtonSet.OK);
    Logger.log('checkMissingResponses: ' + e + (e.stack ? '\n' + e.stack : ''));
  }
}

function clearSchedule() {
  showRtlConfirmDialog_(
    'clearSchedule',
    '🗑️ נקה שיבוץ',
    'מה זה עושה: מוחק את כל התוכן והעיצוב מגיליון הלו"ז — כדי להתחיל שיבוץ מחדש.\n\n'
      + 'טבלאות: נוגע רק בגיליון "' + CONFIG.sheets.schedule + '".\n'
      + 'לא נוגע ב-' + CONFIG.sheets.masterData + ', ' + CONFIG.sheets.responses + ', '
      + CONFIG.sheets.shiftTemplate + ', ' + CONFIG.sheets.rules + ', '
      + CONFIG.sheets.shiftHistory + '.\n\n'
      + 'להמשיך?'
  );
}

function clearScheduleRun_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.sheets.schedule);
  if (sheet) {
    sheet.clear();
    sheet.clearFormats();
    SpreadsheetApp.getUi().alert(rtlUiText_('גיליון השיבוץ נוקה.'));
  } else {
    SpreadsheetApp.getUi().alert(rtlUiText_('לא נמצא גיליון שיבוץ.'));
  }
}

// ============================================================
//  Shift History — log each optimizer run for fairness tracking
// ============================================================

/**
 * Log shift data per employee to ShiftHistory.
 * Columns: שבוע | שם | דרגה | יעד | זמין | קיבל | בוקר | ערב | שביעות רצון
 * - Overwrites previous entries for the same week (re-share safe)
 * - Writes cumulative summary below the data
 */
function logShiftHistory(employeeStats, masterMap, availability, slots) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var shName = CONFIG.sheets.shiftHistory;
  var sh = ss.getSheetByName(shName);

  var HIST_COLS = 9;
  var headers = ['שבוע', 'שם', 'דרגה', 'יעד', 'ימים זמין', 'קיבל', 'בוקר', 'ערב', 'שביעות רצון %'];

  if (!sh) {
    sh = ss.insertSheet(shName);
    sh.getRange(1, 1, 1, HIST_COLS).setValues([headers])
      .setFontWeight('bold').setBackground('#4A90D9').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
  }

  // Ensure header row
  var firstCell = String(sh.getRange(1, 1).getValue()).trim();
  if (firstCell !== headers[0]) {
    sh.insertRowBefore(1);
    sh.getRange(1, 1, 1, HIST_COLS).setValues([headers])
      .setFontWeight('bold').setBackground('#4A90D9').setFontColor('#FFFFFF');
    sh.setFrozenRows(1);
    sh.setRightToLeft(true);
  }

  var tz = Session.getScriptTimeZone() || 'Asia/Jerusalem';
  var now = new Date();
  var sunday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  var weekLabel = Utilities.formatDate(sunday, tz, 'dd/MM/yyyy');

  // Delete old rows for this week + any summary block below data
  var allData = sh.getDataRange().getValues();
  var rowsToDelete = [];
  for (var r = allData.length - 1; r >= 1; r--) {
    var cellVal = String(allData[r][0]).trim();
    if (cellVal === weekLabel || cellVal === '' || cellVal === '📊 סיכום מצטבר') {
      rowsToDelete.push(r + 1);
    }
  }
  for (var i = 0; i < rowsToDelete.length; i++) {
    sh.deleteRow(rowsToDelete[i]);
  }

  // Build new rows
  var names = Object.keys(employeeStats);
  names.sort();

  var newRows = [];
  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    var stat = employeeStats[name];
    var emp = masterMap[name];
    if (!emp) continue;

    var target = stat.shiftTarget || getShiftTarget(name, masterMap, availability);
    var received = stat.shiftsCount || 0;
    var availDays = 0;
    if (availability && availability[name]) {
      var days = Object.keys(availability[name]);
      for (var d = 0; d < days.length; d++) {
        if (availability[name][days[d]] && availability[name][days[d]].length > 0) availDays++;
      }
    }

    var satisfaction = target > 0 ? Math.round((received / target) * 100) : (received > 0 ? 100 : 0);

    newRows.push([
      weekLabel,
      name,
      rankToHebrew(stat.rank),
      target,
      availDays,
      received,
      stat.morningCount || 0,
      stat.eveningCount || 0,
      satisfaction
    ]);
  }

  if (newRows.length > 0) {
    var lastRow = sh.getLastRow();
    sh.getRange(lastRow + 1, 1, newRows.length, HIST_COLS).setValues(newRows);
  }

  // Build cumulative summary
  writeCumulativeSummary_(sh, HIST_COLS);
}

/**
 * Write a cumulative summary block at the bottom of ShiftHistory.
 * Over-time view: total score, weekly average, trend arrow, rank.
 */
function writeCumulativeSummary_(sh, numCols) {
  var allData = sh.getDataRange().getValues();

  // Collect unique weeks in order + per-employee stats
  var weekSet = {};
  var empData = {};
  for (var r = 1; r < allData.length; r++) {
    var week = String(allData[r][0]).trim();
    if (!week || week === '📊 סיכום מצטבר') continue;
    var name = String(allData[r][1]).trim();
    if (!name) continue;

    weekSet[week] = true;
    if (!empData[name]) {
      empData[name] = {
        weeks: 0, totalReceived: 0, totalTarget: 0,
        rank: String(allData[r][2]).trim(),
        weeklyScores: {}
      };
    }
    var received = parseInt(allData[r][5]) || 0;
    var target = parseInt(allData[r][3]) || 0;
    empData[name].weeks++;
    empData[name].totalReceived += received;
    empData[name].totalTarget += target;
    var satPct = parseInt(String(allData[r][8]).replace('%', ''), 10);
    if (isNaN(satPct)) {
      satPct = target > 0 ? Math.round((received / target) * 100) : (received > 0 ? 100 : 0);
    }
    empData[name].weeklyScores[week] = satPct;
  }

  var weekList = Object.keys(weekSet).sort(function(a, b) {
    var pa = a.split('/'), pb = b.split('/');
    var da = new Date(parseInt(pa[2]), parseInt(pa[1]) - 1, parseInt(pa[0]));
    var db = new Date(parseInt(pb[2]), parseInt(pb[1]) - 1, parseInt(pb[0]));
    return da - db;
  });
  var totalWeeks = weekList.length;

  // 100% = ideal. Distance from 100 determines ranking (further = worse).
  var empNames = Object.keys(empData);
  for (var i = 0; i < empNames.length; i++) {
    var d = empData[empNames[i]];
    d.overallScore = d.totalTarget > 0 ? Math.round((d.totalReceived / d.totalTarget) * 100) : 100;
    d.deviation = Math.abs(d.overallScore - 100);

    // Trend: is the employee getting closer to 100% or further?
    if (totalWeeks >= 2) {
      var prev = d.weeklyScores[weekList[totalWeeks - 2]];
      var curr = d.weeklyScores[weekList[totalWeeks - 1]];
      if (prev !== undefined && curr !== undefined) {
        var prevDist = Math.abs(prev - 100);
        var currDist = Math.abs(curr - 100);
        d.trend = currDist < prevDist ? '📈' : (currDist > prevDist ? '📉' : '➡');
      } else {
        d.trend = '—';
      }
    } else {
      d.trend = '—';
    }
  }

  // Sort by deviation descending — furthest from 100% at top (needs most attention)
  empNames.sort(function(a, b) {
    return empData[b].deviation - empData[a].deviation;
  });

  var summaryStartRow = sh.getLastRow() + 2;

  var sumHeaders = ['📊 סיכום מצטבר', 'שם', 'דרגה', 'שבועות', 'סה"כ קיבל', 'סה"כ יעד', 'ציון כולל %', 'מגמה', 'מקום'];
  sh.getRange(summaryStartRow, 1, 1, numCols).setValues([sumHeaders])
    .setFontWeight('bold').setBackground('#2E75B6').setFontColor('#FFFFFF');

  var sumRows = [];
  var total = empNames.length;
  for (var i = 0; i < empNames.length; i++) {
    var name = empNames[i];
    var d = empData[name];
    var place = total - i;
    var placeLabel = place + '/' + total;

    sumRows.push({
      row: ['', name, d.rank, d.weeks, d.totalReceived, d.totalTarget,
            d.overallScore + '%', d.trend, placeLabel],
      score: d.overallScore,
      deviation: d.deviation
    });
  }

  if (sumRows.length > 0) {
    var dataRows = [];
    for (var i = 0; i < sumRows.length; i++) dataRows.push(sumRows[i].row);
    sh.getRange(summaryStartRow + 1, 1, dataRows.length, numCols).setValues(dataRows);

    for (var i = 0; i < sumRows.length; i++) {
      var rowRange = sh.getRange(summaryStartRow + 1 + i, 1, 1, numCols);
      rowRange.setHorizontalAlignment('center');

      var satCell = sh.getRange(summaryStartRow + 1 + i, 7);
      var dev = sumRows[i].deviation;
      if (dev <= 10) {
        satCell.setBackground('#C6EFCE').setFontColor('#006100');
      } else if (dev <= 30) {
        satCell.setBackground('#FFEB9C').setFontColor('#9C6500');
      } else {
        satCell.setBackground('#FFC7CE').setFontColor('#9C0006');
      }
    }
  }
}

/**
 * Build a rolling fairness summary from ShiftHistory.
 * Returns { name: { weeks, totalShifts, avgShifts } } for the last N weeks.
 */
function getFairnessHistory(weeksBack) {
  weeksBack = weeksBack || 4;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(CONFIG.sheets.shiftHistory);
  if (!sh || sh.getLastRow() < 2) return null;

  var data = sh.getDataRange().getValues();
  var tz = Session.getScriptTimeZone() || 'Asia/Jerusalem';
  var now = new Date();
  var cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (weeksBack * 7));

  var stats = {};
  for (var r = 1; r < data.length; r++) {
    var weekStr = String(data[r][0]).trim();
    if (weekStr === '📊 סיכום מצטבר' || weekStr === '') continue;
    var parts = weekStr.split('/');
    if (parts.length < 3) continue;
    var weekDate = new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
    if (weekDate < cutoff) continue;

    var name = String(data[r][1]).trim();
    var received = parseInt(data[r][5]) || 0;

    if (!stats[name]) stats[name] = { weeks: 0, totalShifts: 0 };
    // Count unique weeks
    if (!stats[name]['_w_' + weekStr]) {
      stats[name]['_w_' + weekStr] = true;
      stats[name].weeks++;
    }
    stats[name].totalShifts += received;
  }

  var result = {};
  var names = Object.keys(stats);
  for (var i = 0; i < names.length; i++) {
    var s = stats[names[i]];
    result[names[i]] = {
      weeks: s.weeks,
      totalShifts: s.totalShifts,
      avgShifts: s.weeks > 0 ? (s.totalShifts / s.weeks) : 0
    };
  }
  return result;
}

/**
 * Force OAuth for script.container.ui scope.
 * Run from Apps Script editor to approve permissions.
 */
function authorizeForDialogs() {
  var html =
    '<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"/>' +
    '<style>body{font-family:sans-serif;padding:8px;direction:rtl;}</style></head><body><p>אם מופיע חלון זה — ההרשאה לחלונות הוענקה. אפשר לסגור.</p></body></html>';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(400).setHeight(160),
    'אישור הרשאה לתצוגת חלונות'
  );
}
