// snowRelayShared.ts — The ServiceNow relay pieces shared by Toolbox's bookmarklet and the standalone SNow Wizard
// (feature 040). A separate, dependency-free file so the Wizard can use them without pulling in the whole Toolbox relay.

/**
 * Hostname fragments that identify each system, so ONE bookmarklet can choose its own relay.
 * Exported for the standalone SNow Wizard (feature 040), whose bookmark recognises ServiceNow the same way.
 */
export const SNOW_HOSTNAME_FRAGMENTS: readonly string[] = ['service-now', 'servicenow'];

/**
 * Finds the ServiceNow session token (`g_ck`) on the page the bookmarklet is clicked on, trying each place
 * ServiceNow is known to keep it. Exported so the standalone SNow Wizard (feature 040) runs the very same lookup
 * instead of a copy that could drift.
 */
export const SNOW_TOKEN_RESOLVER_SOURCE =
  'function resolveUserToken(){var token="";try{token=window.g_ck||"";}catch(e){}if(!token){try{token=(window.NOW&&window.NOW.GlideConfig&&window.NOW.GlideConfig.g_ck)||"";}catch(e){}}if(!token){try{var tokenInput=document.querySelector("input[name=\'sysparm_ck\']");if(tokenInput)token=tokenInput.value||"";}catch(e){}}if(!token){try{var tokenMeta=document.querySelector("meta[name=\'g_ck\'],meta[name=\'csrf-token\']");if(tokenMeta)token=tokenMeta.getAttribute("content")||"";}catch(e){}}return token;}';
