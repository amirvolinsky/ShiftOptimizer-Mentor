/**
 * Builds / rebuilds the linked Google Form to match Mentor availability layout.
 * Requires forms scope (see appsscript.json).
 */

function syncMentorGoogleForm() {
  showRtlConfirmDialog_(
    'syncMentorGoogleForm',
    '📝 בנה מחדש טופס Google',
    'מה זה עושה: בונה את טופס Google של מנטור מאפס לפי הקוד —\n'
      + '• רשימת מאמנים: ' + FAKE_MENTOR_ROSTER_.length + ' שמות (מתוך הקוד, לא מ-MasterData)\n'
      + '• לכל יום (א\'–ה\' בוקר+ערב; שישי בוקר בלבד): טווחי שעות לבחירה (משמרת אחת או שתיים)\n'
      + '• שדה הערה חופשי לכל יום\n\n'
      + '⚠ מוחק את כל השאלות הקיימות בטופס ומחליף במבנה מנטור.\n'
      + 'תשובות קודמות בגיליון "' + CONFIG.sheets.responses + '" לא נמחקות.\n\n'
      + 'להמשיך?'
  );
}

/** Editor / clasp: rebuild form without HtmlService confirm dialog. */
function syncMentorGoogleFormFromEditor() {
  var form = openMentorGoogleForm_();
  rebuildMentorGoogleForm_(form);
  Logger.log('syncMentorGoogleFormFromEditor: rebuilt "' + form.getTitle() + '"');
}

function syncMentorGoogleFormRun_() {
  var form = openMentorGoogleForm_();
  rebuildMentorGoogleForm_(form);
  return menuActionSuccess_(
    '✅ הטופס נבנה מחדש',
    'טופס: ' + form.getTitle() + '\n\n'
      + '• ' + FAKE_MENTOR_ROSTER_.length + ' שמות מאמנים\n'
      + '• ' + MENTOR_WEEKDAYS_HE_.length + ' ימים (א\'–ו\'; שישי בוקר בלבד) + טווחי שעות והערה חופשית לכל יום\n\n'
      + 'ודאו שהטופס שולח תשובות לטאב "' + CONFIG.sheets.responses + '".'
  );
}

/**
 * Opens CONFIG.googleFormId, or the spreadsheet-linked form, or creates a new one.
 * @returns {GoogleAppsScript.Forms.Form}
 */
function openMentorGoogleForm_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var formId = String(CONFIG.googleFormId || '').trim();

  if (formId) {
    return FormApp.openById(formId);
  }

  var url = ss.getFormUrl();
  if (url) return FormApp.openByUrl(url);

  var form = FormApp.create('זמינות מאמנים — ' + CLIENT.brandNameHe);
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  return form;
}

function rebuildMentorGoogleForm_(form) {
  var items = form.getItems();
  for (var i = items.length - 1; i >= 0; i--) {
    form.deleteItem(i);
  }

  var nameItem = form.addListItem();
  nameItem.setTitle('שם מאמן').setRequired(true);
  var nameChoices = [];
  var coachNames = getMentorCoachNames_();
  for (var n = 0; n < coachNames.length; n++) {
    nameChoices.push(nameItem.createChoice(coachNames[n]));
  }
  nameItem.setChoices(nameChoices);

  for (var d = 0; d < MENTOR_WEEKDAYS_HE_.length; d++) {
    var dayHe = MENTOR_WEEKDAYS_HE_[d];
    var dayLabel = mentorDayBilingualLabel_(dayHe);
    form.addPageBreakItem().setTitle(dayLabel);

    // Retry the per-day checkbox up to 3 times. The Forms API occasionally
    // accepts createChoice/setChoices silently without persisting them, which
    // used to leave the form half-built. On miss we delete the bad checkbox
    // and rebuild it so subsequent days don't inherit a corrupted state.
    var dayItem = null;
    var expected = 0;
    var actualCount = -1;
    for (var attempt = 1; attempt <= 3 && actualCount !== expected; attempt++) {
      if (dayItem) {
        try { form.deleteItem(dayItem); } catch (ignore) {}
      }
      dayItem = form.addCheckboxItem();
      dayItem.setTitle(dayLabel).setRequired(true);
      expected = setMentorDayCheckboxChoices_(dayItem, mentorFormDayIncludesEvening_(dayHe));
      Utilities.sleep(120 * attempt);
      actualCount = dayItem.getChoices().length;
    }
    if (actualCount !== expected) {
      throw new Error(
        'בניית הטופס נכשלה ביום "' + dayLabel + '": נכתבו ' + actualCount +
        ' אפשרויות במקום ' + expected + ' לאחר 3 ניסיונות. נסה להריץ שוב "📝 בנה מחדש טופס Google".'
      );
    }

    var noteItem = form.addParagraphTextItem();
    noteItem.setTitle(mentorDayNoteHeader_(dayHe)).setRequired(false);
    Utilities.sleep(60);
  }

  // Weekly shift-target question (1–6) — placed last, on its own page, so
  // coaches first map out their availability per day and only then state
  // how many shifts they actually want this week. The optimizer prefers this
  // value over MasterData.WeeklyMax when present, and caps the effective
  // target at submitted_days + 1.
  form.addPageBreakItem().setTitle(MENTOR_WEEKLY_TARGET_HEADER_);
  var targetItem = form.addMultipleChoiceItem();
  targetItem
    .setTitle(MENTOR_WEEKLY_TARGET_HEADER_)
    .setHelpText('כמה משמרות רוצה לקבל השבוע?')
    .setRequired(true);
  var targetChoices = [];
  for (var tVal = MENTOR_WEEKLY_TARGET_MIN_; tVal <= MENTOR_WEEKLY_TARGET_MAX_; tVal++) {
    targetChoices.push(targetItem.createChoice(String(tVal)));
  }
  targetItem.setChoices(targetChoices);

  form.setConfirmationMessage('תודה! הזמינות נשמרה.');
  form.setAllowResponseEdits(true);
  form.setPublishingSummary(true);
}

/**
 * Populates a day checkbox item with morning (+ evening if not Friday) ranges
 * plus the "not available" option.
 *
 * @returns {number} expected number of choices that were written.
 */
function setMentorDayCheckboxChoices_(checkboxItem, includeEvening) {
  if (includeEvening === undefined) includeEvening = true;
  var labels = MENTOR_MORNING_LABELS_.slice();
  if (includeEvening) labels = labels.concat(MENTOR_EVENING_LABELS_);
  labels.push(mentorNotAvailableLabel_());
  var choices = [];
  for (var i = 0; i < labels.length; i++) {
    choices.push(checkboxItem.createChoice(labels[i]));
  }
  checkboxItem.setChoices(choices);
  return labels.length;
}
