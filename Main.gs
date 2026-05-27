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
 * Simple onEdit trigger — runs automatically (no auth) on every cell edit.
 * We only act on single-cell edits in the Schedule sheet where the staff
 * picked something from the dropdown:
 *   - Picked "אין אימון" → apply the inactive grey style in place. The
 *     dropdown stays so they can flip back to a coach later.
 *   - Picked anything else after the cell WAS "אין אימון" → clean up the
 *     grey style (default white) so the new coach name reads correctly.
 *     A full refresh (🔄 רענן לוח) is still needed to recompute hover
 *     notes and conflict colors.
 *
 * Keep this function tiny and tolerant — simple triggers swallow errors
 * silently in the user's UI, so we wrap everything in try/catch and log
 * to the script console for debugging.
 */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (!CONFIG || !CONFIG.sheets || sheet.getName() !== CONFIG.sheets.schedule) return;
    if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;

    var newVal = e.value == null ? '' : String(e.value).trim();
    var oldVal = e.oldValue == null ? '' : String(e.oldValue).trim();

    var INACTIVE = (typeof SCHEDULE_INACTIVE_LABEL_HE_ !== 'undefined')
      ? SCHEDULE_INACTIVE_LABEL_HE_
      : 'אין אימון';

    if (newVal === INACTIVE) {
      applyInactiveCellStyle_(e.range);
      return;
    }

    if (oldVal === INACTIVE && newVal !== INACTIVE && newVal !== '') {
      e.range
        .setBackground(null)
        .setFontColor(null)
        .setFontWeight('normal');
      e.range.setNote(
        'ערך זה הוחלף ידנית. הרץ "🔄 רענן לוח" כדי לעדכן צבעים והערות.'
      );
    }
  } catch (err) {
    Logger.log('onEdit failed: ' + err + (err && err.stack ? '\n' + err.stack : ''));
  }
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
 * Ui.alert while ConfirmDialog is open deadlocks ("מעבד…" forever). Use return value + toast.
 * @returns {{ok:boolean, title:string, message:string}}
 */
function menuActionSuccess_(title, message) {
  var short = String(message || '').split('\n')[0];
  if (short.length > 120) short = short.substring(0, 117) + '…';
  SpreadsheetApp.getActive().toast(short, String(title || CONFIG.toastBrandName), 8);
  return { ok: true, title: String(title || ''), message: String(message || '') };
}

/**
 * Dispatched from ConfirmDialog after אישור.
 * Name must NOT end with "_" — private functions are blocked from google.script.run.
 * @returns {{ok:boolean, title:string, message:string}}
 */
function runMenuConfirmed(actionId) {
  switch (actionId) {
    case 'optimizeShifts':
      return optimizeShiftsRun_();
    case 'refreshSchedule':
      return refreshScheduleRun_();
    case 'shareSchedule':
      return shareScheduleRun_();
    case 'clearSchedule':
      return clearScheduleRun_();
    case 'setupTables':
      return setupTablesRun_();
    case 'loadTestResponses':
      return loadTestResponsesRun_();
    case 'loadFakeMentorResponses':
      return loadFakeMentorResponsesRun_();
    case 'setupDemoResponsesTab':
      return setupDemoResponsesTabRun_();
    case 'updateTrainingTemplate':
      return updateTrainingTemplateRun_();
    case 'updateWeeklyClasses':
      return updateWeeklyClassesRun_();
    case 'syncMentorGoogleForm':
      return syncMentorGoogleFormRun_();
    case 'refreshLiveResponsesSummary':
      return refreshLiveResponsesSummaryRun_();
    default:
      throw new Error('פעולה לא ידועה');
  }
}

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu(CONFIG.menuTitle)
    .addItem('🚀 הרץ שיבוץ שבועי', 'optimizeShifts')
    .addItem('🔄 רענן לו"ז אחרי עריכה ידנית', 'refreshSchedule')
    .addItem('📤 הפץ לו"ז וסגור שבוע', 'shareSchedule')
    .addItem('❓ מי לא מילא טופס זמינות?', 'checkMissingResponses')
    .addSeparator()
    .addItem('🗑️ נקה את גיליון הלו"ז', 'clearSchedule')
    .addItem('📖 מדריך שימוש', 'showGuide')
    .addSubMenu(
      ui.createMenu('⚙️ הגדרה ובדיקה')
        .addItem('🏗️ אתחל טבלאות (MasterData / ShiftTemplate / Rules / ClassTypeRules / WeeklyClasses)', 'setupTables')
        .addItem('📅 עדכן תבנית אימונים', 'updateTrainingTemplate')
        .addItem('📊 כמויות אימונים שבועיות', 'updateWeeklyClasses')
        .addItem('📝 בנה מחדש טופס Google', 'syncMentorGoogleForm')
        .addItem('🔢 רענן סיכום זמינות בטופס', 'refreshLiveResponsesSummary')
        .addItem('🔧 הכן טאב תשובות דמו', 'setupDemoResponsesTab')
        .addItem('🧪 טען זמינות דמו לבדיקה', 'loadFakeMentorResponses')
    )
    .addToUi();

  try {
    ensureSpreadsheetOpenGuideTrigger_();
  } catch (ignore) {
    // Simple onOpen may lack permission to create triggers; showGuide / setupTables will retry.
  }

  try {
    ensureMentorFormSubmitTrigger_();
  } catch (ignore) {
    // Same auth caveat as guide trigger; menu refresh action installs it later if needed.
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
    '🤖 איך השיבוץ עובד?',
    'יש שתי שכבות:',
    '• שכבת זמינות — המאמן מסמן בטופס את חלון המשמרת שהוא יכול (למשל 7:00–10:00).',
    '• שכבת אימונים — בכל יום יש אימונים שעתיים על 3 רשתות (קיבולת מקבילה באותו מקום).',
    'המערכת משבצת את המאמן לאימונים רצופים שנכנסים בתוך החלון שביקש.',
    '',
    'כללי שיבוץ:',
    '• דרגה 1 — מקבלת עדיפות מלאה למה שסימנה.',
    '• דרגה 2 — לפני דרגה 3, אחרי דרגה 1.',
    '• דרגה 3 — אחרי דרגות 1–2; ממלא חורים שנשארו.',
    '• דרגה 4 (רזרבה מחוץ לת"א) — רק כשאין מועמד מדרגות 1–3 למשבצת.',
    '• דרגות 2–4 — המערכת משתדלת לא ליצור משמרות צמודות (בוקר→ערב באותו יום או ערב→בוקר למחרת).',
    '• רשתות 1–3 אנונימיות — הצבת שם בעמודת רשת היא לקריאות בלבד, המאמנים מסתדרים ביניהם בפועל.',
    '• אין חישוב עלויות. אין חוקים פעילים מגיליון Rules כרגע.',
    '',
    '📋 איך משתמשים?',
    'א. ודאו שהמאמנים מילאו את טופס Google של מנטור.',
    'ב. "🚀 הרץ שיבוץ שבועי" — בונה לו"ז לגיליון "' + CONFIG.sheets.schedule + '".',
    'ג. לעריכה ידנית — לחצו על תא ובחרו שם מהרשימה.',
    '   💡 רחפו על תא כדי לראות חלופות (זמינות / כבר משובץ היום / מרחק מהיעד).',
    'ד. אחרי עריכה ידנית — "🔄 רענן לו"ז אחרי עריכה ידנית" (טבלת הוגנות + הערות).',
    'ה. "📤 הפץ לו"ז וסגור שבוע" —',
    '   • בונה את גיליון "' + shareTab + '" (תצוגה נקייה להפצה).',
    '   • מעדכן את "' + histTab + '" עם נתוני השבוע.',
    '   • מארכב את תשובות הטופס וממנקה את "' + CONFIG.sheets.responses + '" לקראת השבוע הבא.',
    '',
    '🔍 כלים נוספים',
    '• "❓ מי לא מילא טופס זמינות?" — רשימת חסרים + טקסט תזכורת מוכן להעתקה.',
    '• "🗑️ נקה את גיליון הלו"ז" — מוחק את "' + CONFIG.sheets.schedule + '" כדי להתחיל מחדש.',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━',
    '📖 המדריך תמיד זמין מהתפריט. בהצלחה! 🙌'
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
  showWeeklyClassCountsDialog_();
}

/**
 * Opens the RTL dialog that asks the user to enter the weekly count per
 * class type. On submit the dialog calls runOptimizeWithClassCounts (defined
 * below) which writes the counts into the WeeklyClasses sheet and runs the
 * optimizer + result toast just like the legacy confirm flow used to.
 */
function showWeeklyClassCountsDialog_() {
  var existing = loadWeeklyClassCountsFromSheet_();
  var ids = getClassTypeIds_();
  var rows = [];
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i];
    rows.push({
      id: id,
      he: classTypeHebrew_(id),
      count: existing[id] != null ? existing[id] : 0
    });
  }
  var t = HtmlService.createTemplateFromFile('WeeklyClassCountsDialog');
  t.classTypes = rows;
  t.sheetName = CONFIG.sheets.weeklyClasses;
  t.capacity = computeWeeklyClassCapacity_();
  SpreadsheetApp.getUi().showModalDialog(
    t.evaluate().setWidth(560).setHeight(680),
    '🚀 הרץ שיבוץ שבועי'
  );
}

/**
 * Dispatched from WeeklyClassCountsDialog after the user enters counts and
 * clicks "אישור והרץ שיבוץ". Saves the counts, then runs the optimizer and
 * returns the standard {ok, title, message} object so the dialog can render
 * the result panel in place.
 *
 * Name must NOT end with "_" — private functions are blocked from
 * google.script.run.
 */
function runOptimizeWithClassCounts(counts) {
  counts = counts || {};

  // Server-side capacity guard. The dialog already validates total in the
  // browser, but we double-check here so a stale or hand-crafted POST can't
  // silently overflow the grid.
  var capacity = computeWeeklyClassCapacity_();
  var total = 0;
  var ids = getClassTypeIds_();
  for (var i = 0; i < ids.length; i++) {
    var n = parseInt(counts[ids[i]], 10);
    if (!isNaN(n) && n > 0) total += n;
  }
  if (total === 0) {
    throw new Error(
      'לא הוזנו אימונים השבוע. הזן לפחות כיתה אחת לפני הרצת השיבוץ.'
    );
  }
  if (total > capacity) {
    throw new Error(
      'סה"כ אימוני השבוע (' + total + ') גדול מהקיבולת המקסימלית של ' +
      CONFIG.sheets.shiftTemplate + ' (' + capacity + '). ' +
      'הפחת את הכמויות לפני הרצה.'
    );
  }

  try {
    saveWeeklyClassCounts_(counts);
  } catch (e) {
    Logger.log('saveWeeklyClassCounts_ failed: ' + e + (e && e.stack ? '\n' + e.stack : ''));
    throw new Error('שמירת כמויות האימונים נכשלה:\n\n' + (e && e.message ? e.message : e));
  }
  return optimizeShiftsRun_();
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
  // Make the form-submitted weekly targets available to getShiftTarget for
  // the rest of this run (and the schedule writer that follows).
  setShiftTargetFormCache_(responseData.weeklyTargets || {});

  // Refresh the per-coach summary columns (hours / shifts) at the right edge
  // of the responses sheet so the staff can see what each coach offered.
  try {
    var responsesSheet = SpreadsheetApp.getActiveSpreadsheet()
      .getSheetByName(getAvailabilitySheetName_());
    if (responsesSheet) updateAvailabilitySummary_(responsesSheet, availability);
  } catch (e) {
    Logger.log('updateAvailabilitySummary_ (live) failed: ' + e);
  }

  var allSlots = loadShiftTemplates();
  if (allSlots.length === 0) throw new Error('לא נמצאו אימונים בטבלת ShiftTemplate.');

  // Distribute the staff-entered weekly class counts across the capacity
  // grid: tag the active slots with a classType, mark the rest inactive.
  // Passing `availability` lets buildSlotFillPriority_ pick a supply-aware
  // Net 3 anchor per day — e.g. anchor at 08:00 on Sun morn (where only
  // יובל has a 7-X start and he's already on Net 1) instead of 07:00.
  var weeklyCounts = loadWeeklyClassCountsFromSheet_();
  var distribution = distributeClassesIntoSlots_(allSlots, weeklyCounts, availability);
  var activeSlots = distribution.activeSlots;
  if (activeSlots.length === 0) {
    throw new Error(
      'לא הוגדרו אימונים השבוע (סה"כ Count ב-' + CONFIG.sheets.weeklyClasses + ' = 0).\n' +
      'הזן כמויות בדיאלוג "🚀 הרץ שיבוץ שבועי" לפני שמריצים שיבוץ.'
    );
  }

  var rules = loadRules();
  var result = optimizeWeek(activeSlots, availability, masterMap, rules, allSlots);

  // Surface any distribution warnings (e.g. requested > capacity) up to the
  // user as part of the post-run summary.
  if (distribution && distribution.warnings && distribution.warnings.length) {
    result.warnings = (result.warnings || []).concat(distribution.warnings);
  }

  writeSchedule(result, allSlots, masterMap, availability, notes, distribution);
  var history = getFairnessHistory(4);

  return {
    masterMap: masterMap,
    employeeCount: employeeCount,
    respondentCount: respondentCount,
    availability: availability,
    slots: activeSlots,
    distribution: distribution,
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
  if (d.distribution) {
    msg += '• סה"כ אימונים השבוע: ' + d.distribution.activeTotal +
      ' (מתוך קיבולת ' + d.distribution.capacity + ')\n';
    var placed = d.distribution.placedByType || {};
    var ids = getClassTypeIds_();
    var parts = [];
    for (var ci = 0; ci < ids.length; ci++) {
      var pid = ids[ci];
      var pCount = placed[pid] || 0;
      if (pCount > 0) parts.push(classTypeHebrew_(pid) + ': ' + pCount);
    }
    if (parts.length) msg += '• פילוח לפי סוג: ' + parts.join(' · ') + '\n';
    if (d.distribution.residualSingleOpened) {
      msg += '• נפתח אימון יחיד נוסף כדי לשמור על הסה"כ שביקשת (אי-זוגי).\n';
    }
  } else {
    msg += '• סה"כ אימונים לשיבוץ: ' + slots.length + '\n';
  }

  var unfilledCount = 0;
  var slotIds = Object.keys(result.assignments);
  for (var i = 0; i < slotIds.length; i++) {
    if (result.assignments[slotIds[i]].unfilled) unfilledCount++;
  }
  var filledCount = slots.length - unfilledCount;
  msg += '• אימונים שמולאו: ' + filledCount + '/' + slots.length;
  if (unfilledCount > 0) msg += ' (' + unfilledCount + ' לא מולאו ❌)';
  msg += '\n\n';

  if (result.globalReviewLog && result.globalReviewLog.length > 0) {
    var lastReview = result.globalReviewLog[result.globalReviewLog.length - 1];
    msg += '• מעבר שיפור גלובלי: ' + (result.globalReviewLog.length - 1) +
      ' איטרציות, ציון סופי ' + (lastReview.score ? lastReview.score.total : '') + '\n';
  }

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
      if (stat.shiftsCount > target) label += ' ⚠ מעל היעד';
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
  try {
    var d = optimizeShiftsRunCore_();
    try {
      ensureSpreadsheetOpenGuideTrigger_();
    } catch (ignore) {}
    var msg = buildOptimizerSummaryMessage_(d);
    Logger.log(msg);
    return menuActionSuccess_(CONFIG.optimizerResultsTitleHe, msg);
  } catch (e) {
    Logger.log('Optimization error: ' + e.message + '\n' + (e.stack || ''));
    throw new Error('השיבוץ נכשל:\n\n' + (e.message || e));
  }
}

/**
 * Menu: "רענן לו"ז אחרי עריכה ידנית" — refresh fairness table and cell notes.
 */
function refreshSchedule() {
  showRtlConfirmDialog_(
    'refreshSchedule',
    '🔄 רענן לו"ז אחרי עריכה ידנית',
    'מה זה עושה: אחרי שערכת ידנית שמות בתאי הלו"ז — מחשב מחדש צבעי תאים (ירוק/כתום/כחול), ' +
      'טבלת ההוגנות, ואת הערות העזר בתאים (זמינות / חלופות / מרחק מהיעד).\n\n' +
      'לא מריץ שיבוץ אוטומטי — רק מסנכרן את הסטטיסטיקות אחרי שינויים ידניים.\n\n'
      + 'טבלאות:\n'
      + '• קורא: "' + CONFIG.sheets.schedule + '", "' + CONFIG.sheets.masterData + '", '
      + '"' + CONFIG.sheets.shiftTemplate + '", "' + getAvailabilitySheetName_() + '".\n'
      + '• מעדכן תוכן בגיליון "' + CONFIG.sheets.schedule + '" בלבד.\n\n'
      + 'להמשיך?'
  );
}

function refreshScheduleRun_() {
  HISTORY_SCORES_CACHE_ = null;
  try {
    var out = refreshScheduleFromSheet_();
    if (!out.ok) {
      throw new Error(out.message);
    }
    var msg = '✅ צבעי התאים, טבלת ההוגנות והערות עודכנו!\n';
    if (out.warnings && out.warnings.length > 0) {
      msg += '\n⚠ בעיות:\n';
      for (var w = 0; w < out.warnings.length; w++) {
        msg += '• ' + out.warnings[w] + '\n';
      }
    }
    return menuActionSuccess_('🔄 רענון לו"ז', msg);
  } catch (e) {
    Logger.log('refreshSchedule error: ' + e.message + '\n' + (e.stack || ''));
    throw new Error('רענון שיבוץ נכשל:\n\n' + (e.message || e));
  }
}

/**
 * Menu: "מי לא מילא טופס זמינות?" — shows which mentors haven't submitted the form,
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
    var dayNotes = responseData.dayNotes || {};

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
      msg += '✅ כל המאמנים מילאו את טופס הזמינות! (' + present.length + '/' + allNames.length + ')\n';
    } else {
      msg += '⚠ ' + missing.length + ' מתוך ' + allNames.length + ' מאמנים עוד לא מילאו את הטופס:\n\n';
      for (var i = 0; i < missing.length; i++) {
        var emp = masterMap[missing[i]];
        msg += '• ' + missing[i] + ' (דרגה ' + rankToHebrew(emp.rank) + ')';
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
      msg += '\n✅ מילאו (' + present.length + '):\n';
      for (var i = 0; i < present.length; i++) {
        var line = '• ' + present[i];
        var avail = submitted[present[i]];
        var dayCount = 0;
        var days = Object.keys(avail);
        for (var d = 0; d < days.length; d++) {
          if (avail[days[d]] && avail[days[d]].length > 0) dayCount++;
        }
        line += ' — ' + dayCount + ' ימים זמינים';
        if (notes[present[i]]) {
          line += ' 💬 "' + notes[present[i]] + '"';
        }
        var empDayNotes = dayNotes[present[i]];
        if (empDayNotes) {
          var noteDays = Object.keys(empDayNotes);
          for (var nd = 0; nd < noteDays.length; nd++) {
            if (empDayNotes[noteDays[nd]]) {
              line += '\n   📝 ' + noteDays[nd] + ': "' + empDayNotes[noteDays[nd]] + '"';
            }
          }
        }
        msg += line + '\n';
      }
    }

    ui.alert(rtlUiText_('❓ מי לא מילא טופס זמינות?'), rtlUiText_(msg), ui.ButtonSet.OK);

  } catch (e) {
    ui.alert(rtlUiText_('שגיאה'), rtlUiText_(String(e.message || e)), ui.ButtonSet.OK);
    Logger.log('checkMissingResponses: ' + e + (e.stack ? '\n' + e.stack : ''));
  }
}

function clearSchedule() {
  showRtlConfirmDialog_(
    'clearSchedule',
    '🗑️ נקה את גיליון הלו"ז',
    'מה זה עושה: מוחק את כל התוכן והעיצוב מגיליון "' + CONFIG.sheets.schedule + '" — כדי להתחיל שיבוץ מחדש מאפס.\n\n'
      + 'לא נוגע ב-"' + CONFIG.sheets.masterData + '", "' + CONFIG.sheets.responses + '", '
      + '"' + CONFIG.sheets.shiftTemplate + '", "' + CONFIG.sheets.rules + '", '
      + '"' + CONFIG.sheets.shiftHistory + '".\n\n'
      + 'להמשיך?'
  );
}

function clearScheduleRun_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.sheets.schedule);
  if (sheet) {
    sheet.clear();
    sheet.clearFormats();
    return menuActionSuccess_('🗑️ ניקוי גיליון לו"ז', 'גיליון הלו"ז נוקה.');
  }
  throw new Error('לא נמצא גיליון שיבוץ.');
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
 * Approve OAuth scopes. Safe from the script editor (getUi is not available there).
 * For script.container.ui, use menu "אשר הרשאות חלונות" from the spreadsheet after GCP test-user setup.
 */
function authorizeForDialogs() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('אין גיליון מקושר. ודאו שהסקריפט קשור ל-Mentor spreadsheet.');
  }

  // Touches spreadsheet + scriptapp scopes (works from editor).
  ss.getName();
  ScriptApp.getProjectTriggers();

  try {
    authorizeForDialogsFromSheet_();
    return;
  } catch (e) {
    var msg = String(e.message || e);
    if (msg.indexOf('getUi') === -1 && msg.indexOf('context') === -1) {
      throw e;
    }
  }

  Logger.log(
    '✓ הרשאות גיליון + טריגרים אושרו מהעורך.\n' +
    'להרשאת חלונות (container.ui): פתחו את הגיליון, רעננו, ובחרו בתפריט:\n' +
    '  "' + CONFIG.menuTitle + '" → "🔐 אשר הרשאות חלונות"'
  );
}

/** Sheet only — opens a tiny dialog to grant script.container.ui. */
function authorizeForDialogsFromSheet_() {
  var html =
    '<!DOCTYPE html><html lang="he" dir="rtl"><head><meta charset="utf-8"/>' +
    '<style>body{font-family:sans-serif;padding:8px;direction:rtl;}</style></head><body>' +
    '<p>אם מופיע חלון זה — ההרשאה לחלונות הוענקה. אפשר לסגור.</p></body></html>';
  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(400).setHeight(160),
    'אישור הרשאה לתצוגת חלונות'
  );
}

/** Menu entry for authorizeForDialogsFromSheet_ */
function authorizeForDialogsMenu() {
  authorizeForDialogsFromSheet_();
}
