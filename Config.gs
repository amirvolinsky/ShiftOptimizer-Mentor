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
    /** Set to your linked form tab name (e.g. "Form Responses 1") */
    responses:     'Form Responses 1',
    shiftTemplate: 'ShiftTemplate',
    rules:         'Rules',
    schedule:      'Schedule',
    shareExport:   'Share_Export',
    shiftHistory:  'ShiftHistory'
  },

  locations: ['SiteA', 'SiteB'],

  locationNames: {
    'SiteA': 'סניף א',
    'SiteB': 'סניף ב'
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
    noSenior:    '#FFEB9C',
    unfilled:    '#FFC7CE',
    suggested:   '#BDD7EE',
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
  toastBrandName: CLIENT.toastBrandName
};
