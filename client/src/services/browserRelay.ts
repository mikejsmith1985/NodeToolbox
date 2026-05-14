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

/**
 * Bookmarklet users drag into their browser toolbar, then click on an authenticated
 * ServiceNow page. It registers with the local bridge, polls for queued requests,
 * executes them on the ServiceNow origin, and posts results back to NodeToolbox.
 */
export const SNOW_RELAY_BOOKMARKLET_CODE = [
  'javascript:(function(){',
  `var relayServer="${LOCAL_RELAY_SERVER_URL}";`,
  'var currentHostname=location.hostname.toLowerCase();',
  'function showRelayStatus(message,backgroundColor){var statusBadge=document.createElement("div");statusBadge.style="position:fixed;bottom:16px;right:16px;background:"+backgroundColor+";color:#fff;padding:10px 16px;border-radius:8px;font:600 13px sans-serif;z-index:2147483647;box-shadow:0 4px 16px rgba(0,0,0,.4);cursor:pointer;max-width:440px";statusBadge.textContent=message;statusBadge.onclick=function(){statusBadge.remove();};document.body.appendChild(statusBadge);return statusBadge;}',
  'if(currentHostname.indexOf("service-now")<0&&currentHostname.indexOf("servicenow")<0){alert("\\u26a0\\ufe0f NodeToolbox Relay\\n\\nThis bookmarklet should be clicked on a ServiceNow page.\\n\\nCurrent domain: "+currentHostname);return;}',
  'window.__crg_active=true;',
  'var sys="snow";',
  'var isRunning=true;',
  'var hasReportedSessionToken=false;',
  'function resolveUserToken(){var token="";try{token=window.g_ck||"";}catch(e){}if(!token){try{token=(window.NOW&&window.NOW.GlideConfig&&window.NOW.GlideConfig.g_ck)||"";}catch(e){}}if(!token){try{var tokenInput=document.querySelector("input[name=\'sysparm_ck\']");if(tokenInput)token=tokenInput.value||"";}catch(e){}}if(!token){try{var tokenMeta=document.querySelector("meta[name=\'g_ck\'],meta[name=\'csrf-token\']");if(tokenMeta)token=tokenMeta.getAttribute("content")||"";}catch(e){}}return token;}',
  'async function reportSessionTokenReady(){if(hasReportedSessionToken)return;var currentToken=resolveUserToken();if(!currentToken)return;hasReportedSessionToken=true;try{var tokenResponse=await fetch(relayServer+"/api/relay-bridge/session-token?sys="+sys+"&gck=1",{method:"POST",mode:"cors",cache:"no-store"});if(!tokenResponse.ok)hasReportedSessionToken=false;}catch(tokenRefreshError){hasReportedSessionToken=false;}}',
  'async function postRelayResult(resultPayload){await fetch(relayServer+"/api/relay-bridge/result",{method:"POST",mode:"cors",headers:{"Content-Type":"application/json"},body:JSON.stringify(resultPayload)});}',
  'async function executeRelayRequest(relayRequest){try{var requestHeaders={"Content-Type":"application/json","Accept":"application/json","X-Requested-With":"XMLHttpRequest"};var requestToken=resolveUserToken();if(requestToken)requestHeaders["X-UserToken"]=requestToken;if(relayRequest.authHeader)requestHeaders["Authorization"]=relayRequest.authHeader;var requestController=new AbortController();var timeoutId=setTimeout(function(){requestController.abort();},25000);var requestOptions={method:relayRequest.method||"GET",credentials:relayRequest.authHeader?"omit":"include",headers:requestHeaders,signal:requestController.signal};if(relayRequest.body!=null)requestOptions.body=JSON.stringify(relayRequest.body);var targetUrl=location.origin+relayRequest.path;var serviceNowResponse=await fetch(targetUrl,requestOptions);clearTimeout(timeoutId);var responseText=await serviceNowResponse.text();await postRelayResult({id:relayRequest.id,sys:sys,ok:serviceNowResponse.ok,status:serviceNowResponse.status,data:responseText,error:null});}catch(requestError){await postRelayResult({id:relayRequest.id,sys:sys,ok:false,status:0,data:null,error:requestError.message});}}',
  'async function pollRelayLoop(){while(isRunning){try{await reportSessionTokenReady();var pollResponse=await fetch(relayServer+"/api/relay-bridge/poll?sys="+sys,{method:"GET",mode:"cors",cache:"no-store"});var pollPayload=await pollResponse.json();if(pollPayload&&pollPayload.request){await executeRelayRequest(pollPayload.request);}}catch(pollError){showRelayStatus("NodeToolbox relay polling failed - "+pollError.message,"#991b1b");await new Promise(function(resolve){setTimeout(resolve,2000);});}}}',
  'window.addEventListener("pagehide",function(){isRunning=false;try{navigator.sendBeacon(relayServer+"/api/relay-bridge/deregister?sys="+sys);}catch(beaconError){}});',
  // Focus the NodeToolbox window by name WITHOUT navigating it.
  // window.open("", "toolbox") finds the existing window and brings it to the foreground;
  // passing an empty URL means the browser does not navigate the tab, so the React app
  // keeps running exactly where it was — no reload, no state loss, no blank dropdown delay.
  // Previously this passed relayServer as the URL which caused Chrome to navigate NodeToolbox
  // to the root URL, reloading the entire React app and wiping all in-progress form data.
  '(async function(){try{var initialToken=resolveUserToken();hasReportedSessionToken=!!initialToken;var registerResponse=await fetch(relayServer+"/api/relay-bridge/register?sys="+sys+"&gck="+(initialToken?"1":"0"),{method:"POST",mode:"cors",cache:"no-store"});if(!registerResponse.ok){throw new Error("HTTP "+registerResponse.status);}var label=initialToken?"\\u2713 g_ck found":"\\u26a0 no g_ck";showRelayStatus("\\uD83D\\uDD0C Relay Active \\u2014 "+label+" \\u2014 NodeToolbox Connected",initialToken?"#238636":"#b08800");try{window.open("","toolbox");}catch(focusError){}pollRelayLoop();}catch(registerError){showRelayStatus("NodeToolbox relay failed - cannot reach local bridge: "+registerError.message,"#991b1b");alert("\\u274c NodeToolbox Relay\\n\\nCould not reach NodeToolbox at "+relayServer+".\\n\\nMake sure NodeToolbox is running, then click the bookmark again.\\n\\nDetails: "+registerError.message);}})();',
  '})()',
].join('');

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
