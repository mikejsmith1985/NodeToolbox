// wizardDefaults.ts — The one place for the addresses and names built into the SNow Wizard file (research R-011).

/** Pre-fills the ServiceNow address setting; changeable in Settings. Owner, GH #449. */
export const DEFAULT_SNOW_URL = 'https://zilverton.service-now.com';

/**
 * Pre-fills the Jira address setting. Kept equal to Toolbox's own default in src/config/loader.js (a test checks), and
 * changeable in the Wizard's Settings so a Jira move needs no new file.
 */
export const DEFAULT_JIRA_URL = 'https://jira.healthspring-jira-prod.aws.zilverton.com';

/** The channel the Wizard page and the tabs running its relay bookmark talk on. */
export const WIZARD_CHANNEL_NAME = 'snowWizard';

/** Asks ServiceNow who is signed in — a harmless read that proves the relay works with the user's session. */
export const SNOW_IDENTITY_PATH =
  '/api/now/table/sys_user?sysparm_query=user_name=javascript:gs.getUserName()&sysparm_fields=name&sysparm_limit=1';

/** Asks Jira who is signed in. */
export const JIRA_IDENTITY_PATH = '/rest/api/2/myself';
