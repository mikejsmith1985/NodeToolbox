import{r as U,R as e}from"./index-Bc2G9s8g.js";const $="_actionButton_1iaec_469",F="_primaryButton_1iaec_499",q="_runtimeDiagnosticsPanel_1iaec_733",G="_runtimeDiagnosticsTitle_1iaec_753",z="_runtimeDiagnosticsBody_1iaec_765",K="_runtimeDiagnosticsActions_1iaec_777",Q="_runtimeDiagnosticsPre_1iaec_789",n={actionButton:$,primaryButton:F,runtimeDiagnosticsPanel:q,runtimeDiagnosticsTitle:G,runtimeDiagnosticsBody:z,runtimeDiagnosticsActions:K,runtimeDiagnosticsPre:Q},V=["tbxARTSettings","tbxReportsHubHelp","tbxReportsLastGenerated"];function J(){const r={};for(const t of V)try{r[t]=localStorage.getItem(t)}catch{r[t]="<unavailable>"}return r}function h(r){return JSON.stringify({area:"ReportsHub",capturedAt:r.capturedAtIso,errorMessage:r.errorMessage,errorStack:r.errorStack,componentStack:r.componentStack,url:typeof window<"u"?window.location.href:"<unknown>",userAgent:typeof navigator<"u"?navigator.userAgent:"<unknown>",storageSnapshot:J()},null,2)}class M extends U.Component{constructor(){super(...arguments),this.state={hasRuntimeError:!1,errorMessage:"",errorStack:"",componentStack:"",capturedAtIso:""},this.handleCopyDiagnostics=async()=>{const t=h(this.state);await navigator.clipboard.writeText(t)},this.handleReloadReportsHub=()=>{window.location.reload()}}static getDerivedStateFromError(t){return{hasRuntimeError:!0,errorMessage:t.message,errorStack:t.stack??"",capturedAtIso:new Date().toISOString()}}componentDidCatch(t,L){this.setState({hasRuntimeError:!0,errorMessage:t.message,errorStack:t.stack??"",componentStack:L.componentStack??"",capturedAtIso:new Date().toISOString()})}render(){if(!this.state.hasRuntimeError)return this.props.children;const t=h(this.state);return React.createElement("section",{className:n.runtimeDiagnosticsPanel,role:"alert"},React.createElement("h2",{className:n.runtimeDiagnosticsTitle},"Reports Hub encountered a runtime error"),React.createElement("p",{className:n.runtimeDiagnosticsBody},"The report view was prevented from going blank. Copy the diagnostics below and share them so we can fix the root cause quickly."),React.createElement("div",{className:n.runtimeDiagnosticsActions},React.createElement("button",{className:n.actionButton,onClick:()=>void this.handleCopyDiagnostics(),type:"button"},"Copy diagnostics"),React.createElement("button",{className:`${n.actionButton} ${n.primaryButton}`,onClick:this.handleReloadReportsHub,type:"button"},"Reload Reports Hub")),React.createElement("pre",{className:n.runtimeDiagnosticsPre},t))}}M.__docgenInfo={description:`Captures render-time runtime errors in Reports Hub and replaces blank-screen failure\r
with an on-page diagnostic panel that can be copied for triage.`,methods:[],displayName:"ReportsHubRuntimeBoundary",props:{children:{required:!0,tsType:{name:"ReactNode"},description:""}}};const ee={title:"Components/ReportsHubRuntimeBoundary",component:M,parameters:{layout:"fullscreen",docs:{description:{component:"An error boundary that catches runtime errors during child rendering and displays a diagnostic panel instead of a blank screen."}}}},I=()=>e.createElement("div",{style:{padding:"24px",fontFamily:"sans-serif"}},e.createElement("h1",{style:{fontSize:"24px",fontWeight:700,marginBottom:"16px"}},"Q3 2024 Revenue Report"),e.createElement("p",{style:{color:"#555",marginBottom:"12px"}},"Total revenue for Q3 2024 was ",e.createElement("strong",null,"$4,812,340"),", representing a"," ",e.createElement("strong",null,"12.4% increase")," over the same period last year."),e.createElement("table",{style:{width:"100%",borderCollapse:"collapse",marginTop:"16px",fontSize:"14px"}},e.createElement("thead",null,e.createElement("tr",{style:{backgroundColor:"#f0f4f8"}},e.createElement("th",{style:{padding:"8px 12px",textAlign:"left",border:"1px solid #ddd"}},"Region"),e.createElement("th",{style:{padding:"8px 12px",textAlign:"right",border:"1px solid #ddd"}},"Revenue"),e.createElement("th",{style:{padding:"8px 12px",textAlign:"right",border:"1px solid #ddd"}},"Growth"))),e.createElement("tbody",null,[{region:"North America",revenue:"$2,104,800",growth:"+9.2%"},{region:"Europe",revenue:"$1,380,220",growth:"+14.7%"},{region:"Asia Pacific",revenue:"$987,450",growth:"+18.1%"},{region:"Latin America",revenue:"$339,870",growth:"+6.5%"}].map(r=>e.createElement("tr",{key:r.region},e.createElement("td",{style:{padding:"8px 12px",border:"1px solid #ddd"}},r.region),e.createElement("td",{style:{padding:"8px 12px",textAlign:"right",border:"1px solid #ddd"}},r.revenue),e.createElement("td",{style:{padding:"8px 12px",textAlign:"right",border:"1px solid #ddd",color:"#2e7d32"}},r.growth)))))),g=({message:r})=>{throw new Error(r??'Unexpected failure in ReportChart: Cannot read properties of undefined (reading "data")')},Y=()=>{const r=new Error("ChartRenderer crashed: dataset is null");throw r.stack=void 0,r},X=()=>{throw U.useEffect(()=>{},[]),new Error("PivotTable failed to initialize: dataSource.rows is not iterable")},a={name:"Normal render — children pass through transparently",args:{children:e.createElement(I,null)},parameters:{docs:{description:{story:"Happy path: the boundary renders nothing of its own and simply passes children through when no error occurs."}}}},o={name:"Runtime error during child render — diagnostic panel shown",args:{children:e.createElement(g,{message:"Unexpected failure in ReportChart: Cannot read properties of undefined (reading 'data')"})},parameters:{docs:{description:{story:"When a child component throws during rendering, the boundary catches it and replaces the blank screen with a diagnostic panel showing the error message and stack trace."}}}},s={name:"Error without stack trace — uses empty string fallback",args:{children:e.createElement(Y,null)},parameters:{docs:{description:{story:"When the caught error has no `stack` property, the diagnostic panel renders an empty string rather than crashing again."}}}},i={name:"localStorage unavailable — shows <unavailable> marker in diagnostics",decorators:[r=>{const t=Object.getOwnPropertyDescriptor(window,"localStorage");return Object.defineProperty(window,"localStorage",{get(){throw new DOMException("SecurityError: localStorage is not available for opaque origins")},configurable:!0}),setTimeout(()=>{t&&Object.defineProperty(window,"localStorage",t)},0),e.createElement(r,null)}],args:{children:e.createElement(g,{message:"DashboardWidget render failed: Cannot destructure property 'filters' of undefined"})},parameters:{docs:{description:{story:"When `localStorage` is inaccessible (e.g. in sandboxed iframes or private browsing with strict settings), the diagnostic panel shows `<unavailable>` rather than crashing."}}}},c={name:"window and navigator unavailable — uses <unknown> fallbacks",decorators:[r=>{const t=Object.getOwnPropertyDescriptor(window.navigator,"userAgent");try{Object.defineProperty(window.navigator,"userAgent",{get(){throw new Error("navigator.userAgent is not accessible")},configurable:!0})}catch{}return setTimeout(()=>{if(t)try{Object.defineProperty(window.navigator,"userAgent",t)}catch{}},0),e.createElement(r,null)}],args:{children:e.createElement(g,{message:"ScheduledReportRunner crashed: environment detection failed"})},parameters:{docs:{description:{story:"When `window` or `navigator` properties are unavailable (e.g. SSR, restricted environments), the boundary substitutes `<unknown>` placeholders in the diagnostics."}}}},d={name:"Deeply nested child throws — boundary still catches it",args:{children:e.createElement("div",null,e.createElement("div",{style:{padding:"16px"}},e.createElement("h2",null,"Report Dashboard"),e.createElement("div",null,e.createElement("div",null,e.createElement("div",null,e.createElement(g,{message:"DeepNestedChart: Cannot read properties of null (reading 'series')"}))))))},parameters:{docs:{description:{story:"Confirms that the error boundary catches errors thrown anywhere in the subtree, regardless of nesting depth."}}}},l={name:"Sibling content and error — entire subtree replaced by diagnostic",args:{children:e.createElement(e.Fragment,null,e.createElement(I,null),e.createElement(X,null))},parameters:{docs:{description:{story:"When one sibling in the children throws, the entire boundary subtree is replaced with the diagnostic panel — consistent with React error boundary semantics."}}}},p={name:"Simple string/element children pass through",args:{children:e.createElement("div",{style:{padding:"24px",fontFamily:"sans-serif",color:"#333"}},e.createElement("p",null,"This is a minimal report view with ",e.createElement("strong",null,"no interactive components"),". The boundary is completely transparent when no errors occur."))},parameters:{docs:{description:{story:"Verifies that plain, non-throwing children are rendered without any wrapping or modification."}}}};var u,m,w;a.parameters={...a.parameters,docs:{...(u=a.parameters)==null?void 0:u.docs,source:{originalSource:`{
  name: 'Normal render — children pass through transparently',
  args: {
    children: <ReportContent />
  },
  parameters: {
    docs: {
      description: {
        story: 'Happy path: the boundary renders nothing of its own and simply passes children through when no error occurs.'
      }
    }
  }
}`,...(w=(m=a.parameters)==null?void 0:m.docs)==null?void 0:w.source}}};var y,b,f;o.parameters={...o.parameters,docs:{...(y=o.parameters)==null?void 0:y.docs,source:{originalSource:`{
  name: 'Runtime error during child render — diagnostic panel shown',
  args: {
    children: <ThrowOnRender message="Unexpected failure in ReportChart: Cannot read properties of undefined (reading 'data')" />
  },
  parameters: {
    docs: {
      description: {
        story: 'When a child component throws during rendering, the boundary catches it and replaces the blank screen with a diagnostic panel showing the error message and stack trace.'
      }
    }
  }
}`,...(f=(b=o.parameters)==null?void 0:b.docs)==null?void 0:f.source}}};var v,S,E;s.parameters={...s.parameters,docs:{...(v=s.parameters)==null?void 0:v.docs,source:{originalSource:`{
  name: 'Error without stack trace — uses empty string fallback',
  args: {
    children: <ThrowNoStack />
  },
  parameters: {
    docs: {
      description: {
        story: 'When the caught error has no \`stack\` property, the diagnostic panel renders an empty string rather than crashing again.'
      }
    }
  }
}`,...(E=(S=s.parameters)==null?void 0:S.docs)==null?void 0:E.source}}};var R,x,k;i.parameters={...i.parameters,docs:{...(R=i.parameters)==null?void 0:R.docs,source:{originalSource:`{
  name: 'localStorage unavailable — shows <unavailable> marker in diagnostics',
  decorators: [Story => {
    // Temporarily make localStorage throw
    const originalLocalStorage = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('SecurityError: localStorage is not available for opaque origins');
      },
      configurable: true
    });

    // Restore after render
    setTimeout(() => {
      if (originalLocalStorage) {
        Object.defineProperty(window, 'localStorage', originalLocalStorage);
      }
    }, 0);
    return <Story />;
  }],
  args: {
    children: <ThrowOnRender message="DashboardWidget render failed: Cannot destructure property 'filters' of undefined" />
  },
  parameters: {
    docs: {
      description: {
        story: 'When \`localStorage\` is inaccessible (e.g. in sandboxed iframes or private browsing with strict settings), the diagnostic panel shows \`<unavailable>\` rather than crashing.'
      }
    }
  }
}`,...(k=(x=i.parameters)==null?void 0:x.docs)==null?void 0:k.source}}};var D,A,C;c.parameters={...c.parameters,docs:{...(D=c.parameters)==null?void 0:D.docs,source:{originalSource:`{
  name: 'window and navigator unavailable — uses <unknown> fallbacks',
  decorators: [Story => {
    const originalUserAgent = Object.getOwnPropertyDescriptor(window.navigator, 'userAgent');
    const originalHref = Object.getOwnPropertyDescriptor(window.location, 'href');
    try {
      Object.defineProperty(window.navigator, 'userAgent', {
        get() {
          throw new Error('navigator.userAgent is not accessible');
        },
        configurable: true
      });
    } catch {
      // Some browsers won't allow redefining these; swallow silently
    }
    setTimeout(() => {
      if (originalUserAgent) {
        try {
          Object.defineProperty(window.navigator, 'userAgent', originalUserAgent);
        } catch {
          // swallow
        }
      }
    }, 0);
    return <Story />;
  }],
  args: {
    children: <ThrowOnRender message="ScheduledReportRunner crashed: environment detection failed" />
  },
  parameters: {
    docs: {
      description: {
        story: 'When \`window\` or \`navigator\` properties are unavailable (e.g. SSR, restricted environments), the boundary substitutes \`<unknown>\` placeholders in the diagnostics.'
      }
    }
  }
}`,...(C=(A=c.parameters)==null?void 0:A.docs)==null?void 0:C.source}}};var T,O,P;d.parameters={...d.parameters,docs:{...(T=d.parameters)==null?void 0:T.docs,source:{originalSource:`{
  name: 'Deeply nested child throws — boundary still catches it',
  args: {
    children: <div>\r
        <div style={{
        padding: '16px'
      }}>\r
          <h2>Report Dashboard</h2>\r
          <div>\r
            <div>\r
              <div>\r
                {/* Error is deeply nested but the boundary still catches it */}\r
                <ThrowOnRender message="DeepNestedChart: Cannot read properties of null (reading 'series')" />\r
              </div>\r
            </div>\r
          </div>\r
        </div>\r
      </div>
  },
  parameters: {
    docs: {
      description: {
        story: 'Confirms that the error boundary catches errors thrown anywhere in the subtree, regardless of nesting depth.'
      }
    }
  }
}`,...(P=(O=d.parameters)==null?void 0:O.docs)==null?void 0:P.source}}};var _,N,B;l.parameters={...l.parameters,docs:{...(_=l.parameters)==null?void 0:_.docs,source:{originalSource:`{
  name: 'Sibling content and error — entire subtree replaced by diagnostic',
  args: {
    children: <>\r
        <ReportContent />\r
        <ThrowAfterMount />\r
      </>
  },
  parameters: {
    docs: {
      description: {
        story: 'When one sibling in the children throws, the entire boundary subtree is replaced with the diagnostic panel — consistent with React error boundary semantics.'
      }
    }
  }
}`,...(B=(N=l.parameters)==null?void 0:N.docs)==null?void 0:B.source}}};var W,H,j;p.parameters={...p.parameters,docs:{...(W=p.parameters)==null?void 0:W.docs,source:{originalSource:`{
  name: 'Simple string/element children pass through',
  args: {
    children: <div style={{
      padding: '24px',
      fontFamily: 'sans-serif',
      color: '#333'
    }}>\r
        <p>\r
          This is a minimal report view with <strong>no interactive components</strong>. The\r
          boundary is completely transparent when no errors occur.\r
        </p>\r
      </div>
  },
  parameters: {
    docs: {
      description: {
        story: 'Verifies that plain, non-throwing children are rendered without any wrapping or modification.'
      }
    }
  }
}`,...(j=(H=p.parameters)==null?void 0:H.docs)==null?void 0:j.source}}};const re=["NormalRender","RuntimeErrorCaught","ErrorWithoutStackTrace","LocalStorageUnavailable","WindowAndNavigatorUnavailable","DeepChildThrows","MixedContentWithError","SimpleChildPassthrough"];export{d as DeepChildThrows,s as ErrorWithoutStackTrace,i as LocalStorageUnavailable,l as MixedContentWithError,a as NormalRender,o as RuntimeErrorCaught,p as SimpleChildPassthrough,c as WindowAndNavigatorUnavailable,re as __namedExportsOrder,ee as default};
