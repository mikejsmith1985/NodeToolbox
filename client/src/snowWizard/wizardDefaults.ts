// wizardDefaults.ts — The one place for the addresses built into the SNow Wizard file (research R-011).

/** Used only by the installer page's "Open ServiceNow" button — the Wizard itself runs inside ServiceNow. Owner, GH #449. */
export const DEFAULT_SNOW_URL = 'https://zilverton.service-now.com';

/**
 * Pre-fills the Jira address setting. Kept equal to Toolbox's own default in src/config/loader.js (a test checks), and
 * changeable in the Wizard's Settings so a Jira move needs no new file.
 */
export const DEFAULT_JIRA_URL = 'https://jira.healthspring-jira-prod.aws.zilverton.com';

/** The channel the Wizard window, its ServiceNow tab and its Jira tab talk on (the probe used its own). */
export const WIZARD_CHANNEL_NAME = 'snowWizard';
