// browserRelay.ts — Bookmarklet and tab-opening helpers for the ServiceNow relay.
//
// Chrome/Edge can sever direct tab-to-tab postMessage when ServiceNow applies
// Cross-Origin-Opener-Policy. The bookmarklet therefore talks to NodeToolbox
// through the local HTTP bridge at 127.0.0.1:5555, while still executing actual
// ServiceNow API calls inside the authenticated ServiceNow tab.

import { useConnectionStore } from '../store/connectionStore.ts';

const LOCAL_RELAY_SERVER_URL = 'http://127.0.0.1:5555';
const SNOW_RELAY_WINDOW_NAME = '__crg_snow';
const RELAY_OPENED_STORAGE_KEY = 'tbxRelayOpened';
const RELAY_RETURN_ROUTE_TTL_MS = 5 * 60 * 1000;

/**
 * localStorage key used as a safety-net restore point for the relay activation flow.
 * In normal operation the bookmarklet uses window.open("","toolbox") which focuses the
 * NodeToolbox window WITHOUT navigating it — no reload occurs and this key is never read.
 * The key is kept so that if an older bookmarklet (with the URL-navigation pattern) is
 * still in a user's bookmark bar, App.tsx can still redirect them back to the correct route.
 */
export const RELAY_RETURN_ROUTE_KEY = 'ntbx-relay-return-route';

/** Hostname fragments that identify each system, so ONE bookmarklet can choose its own relay. */
const SNOW_HOSTNAME_FRAGMENTS = ['service-now', 'servicenow'];
const SHAREPOINT_HOSTNAME_FRAGMENT = 'sharepoint.com';

/**
 * The lines both relay bodies open with: where NodeToolbox is, what page this is, and the on-page
 * status badge. Shared so the two bodies can sit inside ONE bookmarklet without either re-declaring
 * what the other already did.
 */
const RELAY_PREAMBLE = [
  `var relayServer="${LOCAL_RELAY_SERVER_URL}";`,
  'var currentHostname=location.hostname.toLowerCase();',
  'var relayStatusBadge=null;function showRelayStatus(message,backgroundColor){if(!relayStatusBadge||!relayStatusBadge.isConnected){relayStatusBadge=document.createElement("div");relayStatusBadge.onclick=function(){relayStatusBadge.remove();};document.body.appendChild(relayStatusBadge);}relayStatusBadge.style="position:fixed;bottom:16px;right:16px;background:"+backgroundColor+";color:#fff;padding:10px 16px;border-radius:8px;font:600 13px sans-serif;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,.4);cursor:pointer;max-width:440px";relayStatusBadge.textContent=message;return relayStatusBadge;}',
].join('');

/**
 * Marks the tab as the relay tab and asks before it is closed.
 *
 * A browser tab cannot pin itself; that needs an extension. So this does the two things a page
 * genuinely can: it renames the tab so it is findable among twenty others, and it raises the
 * browser's own "Leave site?" prompt on close, which is what stops an accidental one. Pinning
 * removes the close button outright, and only a person can do that, so the badge asks them to.
 */
const RELAY_TAB_GUARD = [
  'try{if(document.title.indexOf("RELAY -")!==0)document.title="RELAY - "+document.title;}catch(titleError){}',
  'window.addEventListener("beforeunload",function(unloadEvent){if(!isRunning)return;unloadEvent.preventDefault();unloadEvent.returnValue="";});',
].join('');

/** Refuses politely when clicked somewhere that is not the system it relays. */
function buildWrongPageGuard(systemLabel: string, whereToClickIt: string): string {
  return `if(!(${whereToClickIt})){alert("\\u26a0\\ufe0f Toolbox Relay\\n\\nClick this bookmarklet on ${systemLabel}.\\n\\nCurrent domain: "+currentHostname);return;}`;
}

/** Wraps a relay body as a complete, self-contained `javascript:` bookmarklet. */
function buildBookmarklet(bodyCode: string): string {
  return `javascript:(function(){${bodyCode}})()`;
}

const SNOW_PAGE_TEST = SNOW_HOSTNAME_FRAGMENTS
  .map((hostnameFragment) => `currentHostname.indexOf("${hostnameFragment}")>=0`)
  .join('||');
const SHAREPOINT_PAGE_TEST = `currentHostname.indexOf("${SHAREPOINT_HOSTNAME_FRAGMENT}")>=0`;

/**
 * Bookmarklet users drag into their browser toolbar, then click on an authenticated
 * ServiceNow page. It registers with the local bridge, polls for queued requests,
 * executes them on the ServiceNow origin, and posts results back to NodeToolbox.
 */
const SNOW_RELAY_BODY = [
  RELAY_PREAMBLE,
  RELAY_TAB_GUARD,
  'window.__crg_active=true;',
  'var sys="snow";',
  'var isRunning=true;',
  'var hasReportedSessionToken=false;',
  'function resolveUserToken(){var token="";try{token=window.g_ck||"";}catch(e){}if(!token){try{token=(window.NOW&&window.NOW.GlideConfig&&window.NOW.GlideConfig.g_ck)||"";}catch(e){}}if(!token){try{var tokenInput=document.querySelector("input[name=\'sysparm_ck\']");if(tokenInput)token=tokenInput.value||"";}catch(e){}}if(!token){try{var tokenMeta=document.querySelector("meta[name=\'g_ck\'],meta[name=\'csrf-token\']");if(tokenMeta)token=tokenMeta.getAttribute("content")||"";}catch(e){}}return token;}',
  'async function reportSessionTokenReady(){if(hasReportedSessionToken)return;var currentToken=resolveUserToken();if(!currentToken)return;hasReportedSessionToken=true;try{var tokenResponse=await fetch(relayServer+"/api/relay-bridge/session-token?sys="+sys+"&gck=1",{method:"POST",mode:"cors",cache:"no-store"});if(!tokenResponse.ok)hasReportedSessionToken=false;}catch(tokenRefreshError){hasReportedSessionToken=false;}}',
  'async function postRelayResult(resultPayload){await fetch(relayServer+"/api/relay-bridge/result",{method:"POST",mode:"cors",headers:{"Content-Type":"application/json"},body:JSON.stringify(resultPayload)});}',
  'async function executeRelayRequest(relayRequest){try{var requestHeaders={"Content-Type":"application/json","Accept":"application/json","X-Requested-With":"XMLHttpRequest"};var requestToken=resolveUserToken();if(requestToken)requestHeaders["X-UserToken"]=requestToken;if(relayRequest.authHeader)requestHeaders["Authorization"]=relayRequest.authHeader;var requestController=new AbortController();var timeoutId=setTimeout(function(){requestController.abort();},25000);var requestOptions={method:relayRequest.method||"GET",credentials:relayRequest.authHeader?"omit":"include",headers:requestHeaders,signal:requestController.signal};if(relayRequest.body!=null)requestOptions.body=JSON.stringify(relayRequest.body);var targetUrl=location.origin+relayRequest.path;var serviceNowResponse=await fetch(targetUrl,requestOptions);clearTimeout(timeoutId);var responseText=await serviceNowResponse.text();await postRelayResult({id:relayRequest.id,sys:sys,ok:serviceNowResponse.ok,status:serviceNowResponse.status,data:responseText,error:null});}catch(requestError){await postRelayResult({id:relayRequest.id,sys:sys,ok:false,status:0,data:null,error:requestError.message});}}',
  'async function reannounceIfAsked(pollPayload){if(!pollPayload||!pollPayload.shouldReregister)return;var currentToken=resolveUserToken();hasReportedSessionToken=!!currentToken;try{await fetch(relayServer+"/api/relay-bridge/register?sys="+sys+"&gck="+(currentToken?"1":"0")+"&origin="+encodeURIComponent(location.origin),{method:"POST",mode:"cors",cache:"no-store"});showRelayStatus("\uD83D\uDD0C Toolbox Relay reconnected \u2014 NodeToolbox restarted","#238636");}catch(reregisterError){}}async function pollRelayLoop(){while(isRunning){try{await reportSessionTokenReady();var pollResponse=await fetch(relayServer+"/api/relay-bridge/poll?sys="+sys,{method:"GET",mode:"cors",cache:"no-store"});var pollPayload=await pollResponse.json();await reannounceIfAsked(pollPayload);if(pollPayload&&pollPayload.request){await executeRelayRequest(pollPayload.request);}}catch(pollError){showRelayStatus("Toolbox Relay polling failed - "+pollError.message,"#991b1b");await new Promise(function(resolve){setTimeout(resolve,2000);});}}}',
  'window.addEventListener("pagehide",function(){isRunning=false;try{navigator.sendBeacon(relayServer+"/api/relay-bridge/deregister?sys="+sys);}catch(beaconError){}});',
  // Focus the NodeToolbox window by name WITHOUT navigating it.
  // window.open("", "toolbox") finds the existing window and brings it to the foreground;
  // passing an empty URL means the browser does not navigate the tab, so the React app
  // keeps running exactly where it was — no reload, no state loss, no blank dropdown delay.
  // Previously this passed relayServer as the URL which caused Chrome to navigate NodeToolbox
  // to the root URL, reloading the entire React app and wiping all in-progress form data.
  '(async function(){try{var initialToken=resolveUserToken();hasReportedSessionToken=!!initialToken;var registerResponse=await fetch(relayServer+"/api/relay-bridge/register?sys="+sys+"&gck="+(initialToken?"1":"0")+"&origin="+encodeURIComponent(location.origin),{method:"POST",mode:"cors",cache:"no-store"});if(!registerResponse.ok){throw new Error("HTTP "+registerResponse.status);}var label=initialToken?"\\u2713 g_ck found":"\\u26a0 no g_ck";showRelayStatus("\\uD83D\\uDD0C Toolbox Relay Active \\u2014 "+label+" \\u2014 NodeToolbox Connected",initialToken?"#238636":"#b08800");try{window.open("","toolbox");}catch(focusError){}pollRelayLoop();}catch(registerError){showRelayStatus("Toolbox Relay failed - cannot reach local bridge: "+registerError.message,"#991b1b");alert("\\u274c Toolbox Relay\\n\\nCould not reach NodeToolbox at "+relayServer+".\\n\\nMake sure NodeToolbox is running, then click the bookmark again.\\n\\nDetails: "+registerError.message);}})();',
].join('');

/** The ServiceNow-only bookmarklet, still working for anyone who already has it in their bar. */
export const SNOW_RELAY_BOOKMARKLET_CODE = buildBookmarklet(
  RELAY_PREAMBLE + buildWrongPageGuard('a ServiceNow page', SNOW_PAGE_TEST) + SNOW_RELAY_BODY,
);

/**
 * Opens ServiceNow in the same named relay tab used by the original ToolBox flow.
 * The bookmarklet click in that tab completes registration with the local bridge.
 *
 * Stores the current pathname in localStorage as a safety net for edge cases where
 * an older bookmarklet (which called window.open with a URL) triggers a page reload.
 * The current bookmarklet uses window.open("","toolbox") to focus without reloading,
 * so this key is normally never consumed by App.tsx.
 */
export function openSnowRelay(snowBaseUrl: string): boolean {
  const normalizedSnowBaseUrl = snowBaseUrl.trim();
  if (normalizedSnowBaseUrl === '') {
    return false;
  }

  // Store the current route as a safety net for older bookmarklet versions that
  // navigate this window via window.open(url, "toolbox"). The current bookmarklet
  // uses window.open("", "toolbox") which focuses without reloading, so this key
  // is normally never consumed.
  const returnRoutePayload = {
    path: window.location.pathname,
    createdAt: Date.now(),
  };
  localStorage.setItem(RELAY_RETURN_ROUTE_KEY, JSON.stringify(returnRoutePayload));

  window.sessionStorage.setItem(RELAY_OPENED_STORAGE_KEY, '1');
  markSnowRelayDisconnected();

  const relayWindow = window.open(normalizedSnowBaseUrl, SNOW_RELAY_WINDOW_NAME, '');
  return relayWindow !== null;
}

// ── SharePoint relay ──────────────────────────────────────────────────────────
// Same mechanism as the ServiceNow bookmarklet, but for reading the intake List: it is clicked on
// an authenticated SharePoint tab, polls the local bridge for `sys=sharepoint` requests, executes
// them against the SharePoint origin with the user's session (Accept: JSON, no g_ck needed for
// reads), and posts results back. See feature 007.

const SHAREPOINT_RELAY_WINDOW_NAME = '__crg_sharepoint';

/** Bookmarklet users click on an authenticated SharePoint page to relay List reads to NodeToolbox. */
const SHAREPOINT_RELAY_BODY = [
  RELAY_PREAMBLE,
  RELAY_TAB_GUARD,
  'var sys="sharepoint";',
  'var isRunning=true;',
  'async function postRelayResult(resultPayload){await fetch(relayServer+"/api/relay-bridge/result",{method:"POST",mode:"cors",headers:{"Content-Type":"application/json"},body:JSON.stringify(resultPayload)});}',
  // SharePoint refuses every write without a form digest. It is obtainable right here, because the
  // bookmarklet runs ON the authenticated SharePoint page: POST /_api/contextinfo returns one, and
  // that call is itself digest-free. Cached per site for the digest's lifetime, refetched on 403 so a
  // long-running relay session cannot fail once the first one expires.
  'var cachedFormDigest="";',
  // Split rather than matched, and deliberately so. A regex literal cannot survive being written
  // inside a quoted string: `\/` collapses to `/` when the string is parsed, the literal then ends
  // early, and what follows is read as regex FLAGS. The whole javascript: URL fails to parse, so the
  // bookmarklet did nothing at all — no badge, no alert, nothing to report. String operations need no
  // escaping and cannot fail that way. This also picks up /teams/ sites, which the old form missed.
  'function siteRootOfPath(requestPath){var pathParts=String(requestPath||"").split("/");var managedPath=(pathParts[1]||"").toLowerCase();return (managedPath==="sites"||managedPath==="teams")&&pathParts[2]?"/"+pathParts[1]+"/"+pathParts[2]:"";}',
  'async function fetchFormDigest(requestPath){var contextUrl=location.origin+siteRootOfPath(requestPath)+"/_api/contextinfo";var contextResponse=await fetch(contextUrl,{method:"POST",credentials:"include",headers:{"Accept":"application/json;odata=nometadata"}});if(!contextResponse.ok)return "";var contextBody=await contextResponse.json();return (contextBody&&(contextBody.FormDigestValue||(contextBody.d&&contextBody.d.GetContextWebInformation&&contextBody.d.GetContextWebInformation.FormDigestValue)))||"";}',
  'async function executeRelayRequest(relayRequest){try{var requestMethod=relayRequest.method||"GET";var isWrite=requestMethod!=="GET";var requestController=new AbortController();var timeoutId=setTimeout(function(){requestController.abort();},25000);async function sendOnce(){var requestHeaders={"Accept":"application/json;odata=nometadata","X-Requested-With":"XMLHttpRequest"};if(isWrite){if(!cachedFormDigest){cachedFormDigest=await fetchFormDigest(relayRequest.path);}requestHeaders["X-RequestDigest"]=cachedFormDigest;}var requestOptions={method:requestMethod,credentials:"include",headers:requestHeaders,signal:requestController.signal};if(relayRequest.body!=null){requestHeaders["Content-Type"]="application/json;odata=nometadata";requestOptions.body=JSON.stringify(relayRequest.body);}return await fetch(location.origin+relayRequest.path,requestOptions);}var sharePointResponse=await sendOnce();if(isWrite&&sharePointResponse.status===403){cachedFormDigest="";sharePointResponse=await sendOnce();}clearTimeout(timeoutId);var responseData;if(relayRequest.responseType==="base64"){var responseBuffer=await sharePointResponse.arrayBuffer();var responseBytes=new Uint8Array(responseBuffer);var binaryChunks="";for(var byteIndex=0;byteIndex<responseBytes.length;byteIndex+=8192){binaryChunks+=String.fromCharCode.apply(null,responseBytes.subarray(byteIndex,byteIndex+8192));}responseData=btoa(binaryChunks);}else{responseData=await sharePointResponse.text();}await postRelayResult({id:relayRequest.id,sys:sys,ok:sharePointResponse.ok,status:sharePointResponse.status,data:responseData,error:null});}catch(requestError){await postRelayResult({id:relayRequest.id,sys:sys,ok:false,status:0,data:null,error:requestError.message});}}',
  'async function reannounceIfAsked(pollPayload){if(!pollPayload||!pollPayload.shouldReregister)return;try{await fetch(relayServer+"/api/relay-bridge/register?sys="+sys+"&origin="+encodeURIComponent(location.origin),{method:"POST",mode:"cors",cache:"no-store"});showRelayStatus("\uD83D\uDD0C Toolbox Relay reconnected \u2014 NodeToolbox restarted","#238636");}catch(reregisterError){}}async function pollRelayLoop(){while(isRunning){try{var pollResponse=await fetch(relayServer+"/api/relay-bridge/poll?sys="+sys,{method:"GET",mode:"cors",cache:"no-store"});var pollPayload=await pollResponse.json();await reannounceIfAsked(pollPayload);if(pollPayload&&pollPayload.request){await executeRelayRequest(pollPayload.request);}}catch(pollError){showRelayStatus("Toolbox Relay polling failed - "+pollError.message,"#991b1b");await new Promise(function(resolve){setTimeout(resolve,2000);});}}}',
  'window.addEventListener("pagehide",function(){isRunning=false;try{navigator.sendBeacon(relayServer+"/api/relay-bridge/deregister?sys="+sys);}catch(beaconError){}});',
  // After registering, focus the NodeToolbox window by name (window.name === "toolbox", set in
  // main.tsx) WITHOUT navigating it — identical to the ServiceNow bookmarklet. The empty URL means
  // no blank tab is created and Toolbox is not reloaded; the user is simply returned to it.
  '(async function(){try{var registerResponse=await fetch(relayServer+"/api/relay-bridge/register?sys="+sys+"&origin="+encodeURIComponent(location.origin),{method:"POST",mode:"cors",cache:"no-store"});if(!registerResponse.ok){throw new Error("HTTP "+registerResponse.status);}showRelayStatus("\\uD83D\\uDD0C Toolbox Relay Active \\u2014 NodeToolbox Connected","#238636");try{window.open("","toolbox");}catch(focusError){}pollRelayLoop();}catch(registerError){showRelayStatus("Toolbox Relay failed - cannot reach local bridge: "+registerError.message,"#991b1b");alert("\\u274c Toolbox Relay\\n\\nCould not reach NodeToolbox at "+relayServer+".\\n\\nMake sure NodeToolbox is running, then click the bookmark again.\\n\\nDetails: "+registerError.message);}})();',
].join('');

/** The SharePoint-only bookmarklet, still working for anyone who already has it in their bar. */
export const SHAREPOINT_RELAY_BOOKMARKLET_CODE = buildBookmarklet(
  RELAY_PREAMBLE + buildWrongPageGuard('your SharePoint site tab', SHAREPOINT_PAGE_TEST) + SHAREPOINT_RELAY_BODY,
);

/**
 * ONE bookmarklet for both systems, choosing by the tab it is clicked in.
 *
 * Two bookmarks was never a requirement; it was an accident of the two being written months apart.
 * The page already knows which system it is, so the bookmark does not need to. The same click works
 * on ServiceNow and on SharePoint, and clicking the wrong one stops being possible.
 *
 * Each body runs inside its OWN function, so the two can share a preamble without either one seeing
 * the other's declarations.
 */
export const UNIFIED_RELAY_BOOKMARKLET_CODE = buildBookmarklet(
  RELAY_PREAMBLE
  + `if(${SNOW_PAGE_TEST}){(function(){${SNOW_RELAY_BODY}})();}`
  + `else if(${SHAREPOINT_PAGE_TEST}){(function(){${SHAREPOINT_RELAY_BODY}})();}`
  + 'else{alert("\\u26a0\\ufe0f Toolbox Relay\\n\\nClick this on a ServiceNow or SharePoint tab.\\n\\nCurrent domain: "+currentHostname);}',
);

/** Opens (or focuses) the SharePoint site in a named tab so the user can click the bookmarklet there. */
export function openSharePointRelay(sharePointSiteUrl: string): boolean {
  const normalizedSiteUrl = sharePointSiteUrl.trim();
  if (normalizedSiteUrl === '') {
    return false;
  }
  const relayWindow = window.open(normalizedSiteUrl, SHAREPOINT_RELAY_WINDOW_NAME, '');
  return relayWindow !== null;
}

/** Resets shared relay status; exposed only for focused unit tests. */
export function resetBrowserRelayForTests(): void {
  markSnowRelayDisconnected();
}

function markSnowRelayDisconnected(): void {
  useConnectionStore.getState().setRelayBridgeStatus({
    system: 'snow',
    isConnected: false,
    lastPingAt: null,
    version: null,
    hasSessionToken: false,
  });
}

export function parseRelayReturnRoute(storedValue: string | null, nowMs: number = Date.now()): string | null {
  if (storedValue === null) {
    return null;
  }

  try {
    const parsedValue = JSON.parse(storedValue) as { path?: unknown; createdAt?: unknown };
    const path = typeof parsedValue.path === 'string' ? parsedValue.path : null;
    const createdAt = typeof parsedValue.createdAt === 'number' ? parsedValue.createdAt : 0;
    const isFreshRelayReturn = nowMs - createdAt <= RELAY_RETURN_ROUTE_TTL_MS;
    return path !== null && isFreshRelayReturn ? path : null;
  } catch {
    // Plain strings were written by older versions and can linger forever; ignore them so
    // stale relay state cannot keep forcing users back to SNow Hub on unrelated app starts.
    return null;
  }
}
