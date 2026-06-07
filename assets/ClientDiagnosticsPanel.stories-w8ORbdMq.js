import{u as y}from"./settingsStore-D1ohuLZB.js";import{s as a}from"./AdminHubView.module-BPj767VV.js";import{R as r}from"./index-Bc2G9s8g.js";import"./react-Li0Ki8N_.js";function W(){try{return JSON.stringify(localStorage).length}catch{return 0}}function c({label:e,children:t,valueTestId:o}){return React.createElement("div",{className:a.diagnosticsRow},React.createElement("span",{className:a.diagnosticsLabel},e),React.createElement("span",{className:a.diagnosticsValue,"data-testid":o},t))}function K(){const e=y(i=>i.changeRequestGeneratorJiraUrl),t=y(i=>i.changeRequestGeneratorSnowUrl),o=y(i=>i.theme),n=W();return React.createElement("section",{className:a.sectionCard},React.createElement("h2",{className:a.sectionTitle},"🔍 Client Diagnostics"),React.createElement("p",{className:a.adminDescription},"Read-only snapshot of the browser environment and current settings. For API call tracing, use the Dev Panel."),React.createElement("div",{className:a.diagnosticsGrid},React.createElement(c,{label:"Browser",valueTestId:"diagnostics-user-agent"},navigator.userAgent),React.createElement(c,{label:"localStorage Usage"},"≈ ",n.toLocaleString()," chars"),React.createElement(c,{label:"Jira Base URL"},e!==""?e:"—"),React.createElement(c,{label:"ServiceNow URL"},t!==""?t:"—"),React.createElement(c,{label:"Theme",valueTestId:"diagnostics-theme"},o)),React.createElement("div",{className:a.inputRow},React.createElement("a",{href:"/dev-panel",className:a.actionButton},"🔍 Open Dev Panel")))}K.__docgenInfo={description:"Client-side Diagnostics panel — browser environment and current settings snapshot.",methods:[],displayName:"ClientDiagnosticsPanel"};function h(){try{localStorage.clear()}catch{}}function f(e){h();for(const[t,o]of Object.entries(e))try{localStorage.setItem(t,o)}catch{}}const H=r.createContext(void 0),S={theme:"dark",language:"en-US",timezone:"America/New_York",notifications:!0,analyticsEnabled:!0,featureFlags:{newDashboard:!0,betaReporting:!1,experimentalSearch:!0},userId:"usr_4f8a2b19c73e",apiEndpoint:"https://api.acme.io/v3"},Q={theme:"",language:"",timezone:"",notifications:!1,analyticsEnabled:!1,featureFlags:{},userId:void 0,apiEndpoint:void 0};function s({value:e,children:t}){return r.createElement(H.Provider,{value:e},t)}const w={"acme.auth.token":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3JfNGY4YTJiMTljNzNlIiwiZXhwIjoxNzE4MDAwMDAwfQ.abc123","acme.auth.refresh":"rt_9x2mP4kL7qRsT1uVwXyZa3bCdEfGhIj","acme.user.preferences":JSON.stringify({sidebarCollapsed:!1,defaultView:"grid",recentSearches:["revenue report","Q2 forecast","team capacity"]}),"acme.cache.dashboard":'{"widgets":["revenue","users","events"],"lastFetched":1717900000000}',"acme.onboarding.completed":"true","acme.notifications.lastSeen":"1717900000000","acme.feature.dismissedBanners":JSON.stringify(["new-ui-banner","cookie-notice"]),"acme.debug.sessionId":"sess_7GhJkLmNoPqRsTuVwXyZ"},ee={...w,"acme.cache.reports":JSON.stringify(Array.from({length:500},(e,t)=>({id:`report_${t}`,name:`Report ${t+1}`,generatedAt:Date.now()-t*6e4,rows:Array.from({length:50},(o,n)=>({label:`Row ${n+1}`,value:Math.random()*1e4}))}))),"acme.cache.auditLog":JSON.stringify(Array.from({length:1e3},(e,t)=>({eventId:`evt_${t}`,actor:`user_${t%25+1}@acme.io`,action:["login","update","delete","export"][t%4],timestamp:Date.now()-t*3e4}))),"acme.cache.rawExport":"x".repeat(2e5)},ne={title:"Diagnostics/ClientDiagnosticsPanel",component:K,parameters:{layout:"padded",docs:{description:{component:"Displays client-side diagnostic information including settings store values and localStorage usage. Useful for support and debugging workflows."}}}},l={decorators:[e=>(f(w),r.createElement(s,{value:S},r.createElement(e,null)))]},d={name:"Empty / Undefined Settings Store",decorators:[e=>(f(w),r.createElement(s,{value:Q},r.createElement(e,null)))],parameters:{docs:{description:{story:"All settings store values are empty strings, `false`, or `undefined`. The panel should render gracefully without crashing."}}}},g={name:"Empty localStorage",decorators:[e=>(h(),r.createElement(s,{value:S},r.createElement(e,null)))],parameters:{docs:{description:{story:"localStorage has no entries. The panel should show zero usage and an empty key list."}}}},p={name:"localStorage Unavailable (Security Error)",decorators:[e=>{const t=Object.getOwnPropertyDescriptor(window,"localStorage");try{Object.defineProperty(window,"localStorage",{get(){throw new DOMException("The operation is insecure.","SecurityError")},configurable:!0})}catch{}const o=r.createElement(s,{value:S},r.createElement(e,null));if(t)try{Object.defineProperty(window,"localStorage",t)}catch{}return o}],parameters:{docs:{description:{story:"Simulates a SecurityError when accessing `localStorage` (e.g. cross-origin iframe or locked-down private mode). The panel must handle the exception gracefully."}}}},m={name:"All Empty (Settings + localStorage)",decorators:[e=>(h(),r.createElement(s,{value:Q},r.createElement(e,null)))],parameters:{docs:{description:{story:"Combined worst case: the settings store is fully unpopulated and localStorage is empty."}}}},u={name:"Very Large localStorage Usage",decorators:[e=>(f(ee),r.createElement(s,{value:S},r.createElement(e,null)))],parameters:{docs:{description:{story:"localStorage contains hundreds of cached records plus a 200 KB synthetic blob (~2.5 MB total). Verifies that the panel renders large usage figures without layout breakage."}}}};var v,E,b,R,L;l.parameters={...l.parameters,docs:{...(v=l.parameters)==null?void 0:v.docs,source:{originalSource:`{
  decorators: [Story => {
    populateLocalStorage(realisticLocalStorage);
    return <SettingsProvider value={fullSettings}>\r
          <Story />\r
        </SettingsProvider>;
  }]
}`,...(b=(E=l.parameters)==null?void 0:E.docs)==null?void 0:b.source},description:{story:"Happy path – realistic settings and a populated localStorage.",...(L=(R=l.parameters)==null?void 0:R.docs)==null?void 0:L.description}}};var P,D,N,_,I;d.parameters={...d.parameters,docs:{...(P=d.parameters)==null?void 0:P.docs,source:{originalSource:`{
  name: 'Empty / Undefined Settings Store',
  decorators: [Story => {
    populateLocalStorage(realisticLocalStorage);
    return <SettingsProvider value={emptySettings}>\r
          <Story />\r
        </SettingsProvider>;
  }],
  parameters: {
    docs: {
      description: {
        story: 'All settings store values are empty strings, \`false\`, or \`undefined\`. The panel should render gracefully without crashing.'
      }
    }
  }
}`,...(N=(D=d.parameters)==null?void 0:D.docs)==null?void 0:N.source},description:{story:`The settings store contains only empty / undefined values –\r
mimics a freshly provisioned account or a failed store hydration.`,...(I=(_=d.parameters)==null?void 0:_.docs)==null?void 0:I.description}}};var O,T,C,U,k;g.parameters={...g.parameters,docs:{...(O=g.parameters)==null?void 0:O.docs,source:{originalSource:`{
  name: 'Empty localStorage',
  decorators: [Story => {
    clearLocalStorage();
    return <SettingsProvider value={fullSettings}>\r
          <Story />\r
        </SettingsProvider>;
  }],
  parameters: {
    docs: {
      description: {
        story: 'localStorage has no entries. The panel should show zero usage and an empty key list.'
      }
    }
  }
}`,...(C=(T=g.parameters)==null?void 0:T.docs)==null?void 0:C.source},description:{story:`localStorage is completely empty – new private-browsing session or\r
first-ever page load before anything is written.`,...(k=(U=g.parameters)==null?void 0:U.docs)==null?void 0:k.description}}};var x,A,J,j,V;p.parameters={...p.parameters,docs:{...(x=p.parameters)==null?void 0:x.docs,source:{originalSource:`{
  name: 'localStorage Unavailable (Security Error)',
  decorators: [Story => {
    // Temporarily override localStorage to throw
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    try {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('The operation is insecure.', 'SecurityError');
        },
        configurable: true
      });
    } catch (_) {
      /* some browsers disallow redefining localStorage in stories */
    }
    const node = <SettingsProvider value={fullSettings}>\r
          <Story />\r
        </SettingsProvider>;

    // Restore after render (best-effort)
    if (originalDescriptor) {
      try {
        Object.defineProperty(window, 'localStorage', originalDescriptor);
      } catch (_) {
        /* ignore */
      }
    }
    return node;
  }],
  parameters: {
    docs: {
      description: {
        story: 'Simulates a SecurityError when accessing \`localStorage\` (e.g. cross-origin iframe or locked-down private mode). The panel must handle the exception gracefully.'
      }
    }
  }
}`,...(J=(A=p.parameters)==null?void 0:A.docs)==null?void 0:J.source},description:{story:"localStorage is unavailable (SecurityError / private-mode restriction).\r\nWe simulate this by temporarily replacing `localStorage` with a throwing proxy.",...(V=(j=p.parameters)==null?void 0:j.docs)==null?void 0:V.description}}};var B,z,M,G,$;m.parameters={...m.parameters,docs:{...(B=m.parameters)==null?void 0:B.docs,source:{originalSource:`{
  name: 'All Empty (Settings + localStorage)',
  decorators: [Story => {
    clearLocalStorage();
    return <SettingsProvider value={emptySettings}>\r
          <Story />\r
        </SettingsProvider>;
  }],
  parameters: {
    docs: {
      description: {
        story: 'Combined worst case: the settings store is fully unpopulated and localStorage is empty.'
      }
    }
  }
}`,...(M=(z=m.parameters)==null?void 0:z.docs)==null?void 0:M.source},description:{story:"Both the settings store and localStorage are in their worst-case empty state.",...($=(G=m.parameters)==null?void 0:G.docs)==null?void 0:$.description}}};var q,F,X,Y,Z;u.parameters={...u.parameters,docs:{...(q=u.parameters)==null?void 0:q.docs,source:{originalSource:`{
  name: 'Very Large localStorage Usage',
  decorators: [Story => {
    populateLocalStorage(largeLocalStorage);
    return <SettingsProvider value={fullSettings}>\r
          <Story />\r
        </SettingsProvider>;
  }],
  parameters: {
    docs: {
      description: {
        story: 'localStorage contains hundreds of cached records plus a 200 KB synthetic blob (~2.5 MB total). Verifies that the panel renders large usage figures without layout breakage.'
      }
    }
  }
}`,...(X=(F=u.parameters)==null?void 0:F.docs)==null?void 0:X.source},description:{story:`localStorage is filled with a large volume of cached data –\r
tests layout stability and performance with hundreds of entries / large values.`,...(Z=(Y=u.parameters)==null?void 0:Y.docs)==null?void 0:Z.description}}};const se=["Default","EmptySettingsStore","EmptyLocalStorage","LocalStorageUnavailable","AllEmpty","VeryLargeLocalStorage"];export{m as AllEmpty,l as Default,g as EmptyLocalStorage,d as EmptySettingsStore,p as LocalStorageUnavailable,u as VeryLargeLocalStorage,se as __namedExportsOrder,ne as default};
