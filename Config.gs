/**
 * Shared technical configuration. Business-specific strings live in CLIENT.
 *
 * Shift Optimizer Mentor — rules-based scheduling (no cost optimization).
 */

/** Per-deployment profile — replace when forking for another organization. */
var CLIENT = {
  brandNameHe: 'מנטור',
  menuTitle: '📋 Shift Optimizer Mentor',
  guideBannerHe: '📋 Shift Optimizer Mentor — שיבוץ משמרות',
  optimizerResultsTitleHe: '📋 Mentor — תוצאות שיבוץ',
  toastBrandName: 'Shift Optimizer Mentor'
};

var CONFIG = {
  sheets: {
    masterData:    'MasterData',
    /** Linked Google Form tab — live submissions only; never overwritten by test seeders */
    responses:     'Form Responses 1',
    /** Copy of form headers + demo rows for optimizer testing */
    responsesDemo: 'Form Responses Demo',
    shiftTemplate: 'ShiftTemplate',
    rules:         'Rules',
    /** Per-class eligibility rules (who can teach Childs/E/League/etc.) */
    classTypeRules: 'ClassTypeRules',
    /** Editable weekly class counts per ClassType (drives target shift volume) */
    weeklyClasses: 'WeeklyClasses',
    schedule:      'Schedule',
    shareExport:   'Share_Export',
    shiftHistory:  'ShiftHistory'
  },

  /**
   * Beach volleyball nets (רשתות על החוף) — 3 courts. IDs Net1–Net3 = net, not "network".
   * No per-coach lock; all coaches may be assigned to any net.
   */
  locations: ['Net1', 'Net2', 'Net3'],

  locationNames: {
    'Net1': 'רשת 1',
    'Net2': 'רשת 2',
    'Net3': 'רשת 3'
  },

  days: ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'],

  blocks: {
    weekday: ['בוקר', 'ערב'],
    weekend: ['בוקר', 'אמצע', 'ערב']
  },

  weekendDays: ['שישי', 'שבת'],

  colors: {
    headerBg:    '#2E7D6B',
    headerFont:  '#FFFFFF',
    ok:          '#C6EFCE',
    unfilled:    '#FFC7CE',
    suggested:   '#BDD7EE',
    overlap:     '#FFB74D',
    summaryRow:  '#E8E8E8',
    normal:      '#FFFFFF'
  },

  availabilityMarker: 'V',

  brand: {
    nameHe: CLIENT.brandNameHe
  },

  menuTitle: CLIENT.menuTitle,
  guideBannerHe: CLIENT.guideBannerHe,
  optimizerResultsTitleHe: CLIENT.optimizerResultsTitleHe,
  toastBrandName: CLIENT.toastBrandName,

  /**
   * true = availability + fairness only (no Rules sheet enforcement).
   * Set false after adding business rules with the Mentor team.
   */
  basicMode: true,

  /**
   * Development: keep true — reads Form Responses Demo (פייק), not the live form tab.
   * Go-live: set false — reads Form Responses 1 (טופס אמיתי).
   */
  useDemoResponses: true,

  /**
   * Mentor availability form (edit URL in browser; script uses ID only).
   * https://docs.google.com/forms/d/1_8coyaLHL13nvYBncd3lZg_ep33EnQnw1Fs5Vn24ASs/edit
   */
  googleFormId: '1_8coyaLHL13nvYBncd3lZg_ep33EnQnw1Fs5Vn24ASs',

  /** Coach tiers: 1 = best, 4 = out-of-town reserve (fills gaps after 1–3). */
  ranks: {
    best: 1,
    min: 1,
    max: 4
  }
};

function isBasicMode_() {
  return CONFIG.basicMode !== false;
}

/** Clamp MasterData rank to Mentor 1–4 scale (1 = best, 4 = reserve). */
function normalizeMentorRank_(rank) {
  var r = parseInt(rank, 10);
  if (isNaN(r) || r < 1) return CONFIG.ranks.best;
  if (r > CONFIG.ranks.max) return CONFIG.ranks.max;
  return r;
}

/**
 * Normalize the MasterData Gender cell to 'M' / 'F'. Blank, English M/F,
 * Hebrew זכר/נקבה, and the words male/female (any case) are all accepted.
 * Anything unrecognised falls back to 'M' so missing data never breaks
 * eligibility checks.
 */
function normalizeMentorGender_(gender) {
  var s = String(gender == null ? '' : gender).trim();
  if (!s) return 'M';
  var u = s.toUpperCase();
  if (u === 'F' || u === 'FEMALE' || s === 'נקבה' || s === 'נ') return 'F';
  if (u === 'M' || u === 'MALE'   || s === 'זכר'  || s === 'ז') return 'M';
  return 'M';
}
