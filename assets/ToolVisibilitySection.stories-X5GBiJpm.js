import{r as U}from"./index-Bc2G9s8g.js";import{s as a}from"./AdminHubView.module-BPj767VV.js";const g=[{id:"sprint-dashboard",route:"/sprint-dashboard",icon:"🏃",title:"Team Dashboard",description:"Team execution hub for sprint health, blockers, defects, standup, planning, Feature Review, PI Review, and release readiness.",tags:["Sprint","Kanban","Standup","DSU"],sectionKey:"agile"},{id:"art",route:"/art",icon:"🚂",title:"ART View",description:"Release-train workspace for PI health, dependencies, blueprint rollups, PI Review readouts, release visibility, and ART settings.",tags:["ART","RTE","Release Radar"],sectionKey:"agile"},{id:"my-issues",route:"/my-issues",icon:"📊",title:"My Issues",description:"Personal Jira and linked ServiceNow work queue with saved views, hygiene checks, swimlanes, and bulk actions.",tags:["Jira","My Work","Report"],sectionKey:"agile"},{id:"personal-toolbox",route:"/personal-toolbox",icon:"🧰",title:"Personal Toolbox",description:"Build your own workspace by choosing, reordering, and reusing the major NodeToolbox modules you need most.",tags:["Workspace","Personalization","Tabs"],sectionKey:"agile"},{id:"business-helper",route:"/business-helper",icon:"💼",title:"Business Helper",description:"Business-friendly Jira search plus the Stablization funding workflow with mappings, custom columns, and local draft support.",tags:["Jira","Search","Business"],sectionKey:"agile"},{id:"reports-hub",route:"/reports-hub",icon:"📈",title:"Reports Hub",description:"Leadership reporting hub for delivery, defects, risks, flow, quality, sprint health, throughput, and individual workload views.",tags:["Reports","Director","RTE","Dashboard"],sectionKey:"admin"},{id:"snow-hub",route:"/snow-hub",icon:"❄️",title:"SNow Hub",description:"ServiceNow workspace for change generation, PRB conversion, release management, configuration, and Jira-SNow sync monitoring.",tags:["ServiceNow","Jira","Change Request","PRB"],sectionKey:"snow"},{id:"text-tools",route:"/text-tools",icon:"🛠",title:"Text Tools",description:"Utility suite for smart formatting, JSON cleanup, case conversion, URL and Base64 transforms, and element extraction.",tags:["JSON","Markdown","Encode","Base64"],sectionKey:"text"},{id:"code-walkthrough",route:"/code-walkthrough",icon:"📖",title:"Code Walkthrough",description:"In-app technical reference for architecture, workspace map, security model, data flow, and Jira/ServiceNow write paths.",tags:["Security","Architecture","Audit"],sectionKey:"docs"},{id:"admin-hub",route:"/admin-hub",icon:"🛡️",title:"Admin Hub",description:"Platform controls for integrations, ART settings, enterprise standards, diagnostics, backup and restore, and tool visibility.",tags:["Admin","Leadership","Reports"],sectionKey:"admin"}],P="tbxToolVisibility";function B(){try{const e=localStorage.getItem(P);return e===null?{}:JSON.parse(e)}catch{return{}}}function y(e){try{localStorage.setItem(P,JSON.stringify(e))}catch{}}function S(e,o){return e[o]!==!1}function F({cardId:e,icon:o,title:n,isVisible:p,onToggle:m}){return React.createElement("label",{className:a.toolVisibilityItem},React.createElement("input",{type:"checkbox",checked:p,onChange:()=>m(e),"aria-label":`Toggle visibility of ${n}`}),React.createElement("span",{className:a.toolVisibilityIcon},o),React.createElement("span",{className:a.toolVisibilityLabel},n))}function M(){const[e,o]=U.useState(B);function n(t){o(r=>{const h={...r,[t]:!S(r,t)};return y(h),h})}function p(){const t={};for(const r of g)t[r.id]=!0;o(t),y(t)}function m(){const t={};for(const r of g)t[r.id]=!1;o(t),y(t)}return React.createElement("section",{className:a.sectionCard},React.createElement("h2",{className:a.sectionTitle},"🎯 Tool Visibility"),React.createElement("p",{className:a.adminDescription},"Controls which tool cards appear on the home screen. Changes persist to localStorage. Admin Hub is always visible regardless of this setting."),React.createElement("div",{className:a.inputRow},React.createElement("button",{className:a.actionButton,onClick:p},"Show All"),React.createElement("button",{className:a.actionButton,onClick:m},"Hide All")),React.createElement("div",{className:a.toolVisibilityGrid},g.map(t=>React.createElement(F,{key:t.id,cardId:t.id,icon:t.icon,title:t.title,isVisible:S(e,t.id),onToggle:n}))))}M.__docgenInfo={description:"Tool Visibility section — controls which tool cards appear on the Home view.",methods:[],displayName:"ToolVisibilitySection"};const j={title:"Components/ToolVisibilitySection",component:M,parameters:{layout:"padded",docs:{description:{component:"A section that allows users to control the visibility of tools/app cards. Persists state to localStorage when available, falls back to in-memory state otherwise."}}}},s={name:"Default (First Mount — All Visible)",decorators:[e=>{try{localStorage.removeItem("toolVisibility")}catch{}return React.createElement(e,null)}],parameters:{docs:{description:{story:"First mount with no prior localStorage data. All tools default to visible."}}}},i={name:"Some Tools Hidden (Restored from localStorage)",decorators:[e=>{try{const o={calculator:!1,colorPicker:!1,jsonFormatter:!0,markdownEditor:!0,base64Encoder:!0,regexTester:!1,unitConverter:!0,urlEncoder:!0};localStorage.setItem("toolVisibility",JSON.stringify(o))}catch{}return React.createElement(e,null)}],parameters:{docs:{description:{story:"Simulates a returning user whose localStorage already has some tools hidden. The component should restore that state on mount."}}}},l={name:"All Tools Hidden",decorators:[e=>{try{const o={calculator:!1,colorPicker:!1,jsonFormatter:!1,markdownEditor:!1,base64Encoder:!1,regexTester:!1,unitConverter:!1,urlEncoder:!1,timestampConverter:!1,uuidGenerator:!1};localStorage.setItem("toolVisibility",JSON.stringify(o))}catch{}return React.createElement(e,null)}],parameters:{docs:{description:{story:"All tools have been toggled off. Useful for verifying the empty/zero-visibility UI state."}}}},c={name:"localStorage Unavailable (Falls Back to In-Memory)",decorators:[e=>(Storage.prototype.getItem=()=>{throw new DOMException("localStorage is not available","SecurityError")},Storage.prototype.setItem=()=>{throw new DOMException("localStorage is not available","SecurityError")},Storage.prototype.removeItem=()=>{throw new DOMException("localStorage is not available","SecurityError")},React.createElement(e,null))],parameters:{docs:{description:{story:"Simulates an environment where localStorage is unavailable (e.g. private browsing with strict settings). The component should fall back to an empty map and keep state in memory only — all tools should still render and be interactable."}}}},d={name:"Corrupted localStorage Data",decorators:[e=>{try{localStorage.setItem("toolVisibility","{ this is not valid json %%}")}catch{}return React.createElement(e,null)}],parameters:{docs:{description:{story:"localStorage contains corrupted/non-parseable data. The component should gracefully fall back to an empty visibility map, treating all tools as visible by default."}}}},u={name:"localStorage Has Unexpected Data Shape",decorators:[e=>{try{localStorage.setItem("toolVisibility",JSON.stringify(["unexpected","array","value"]))}catch{}return React.createElement(e,null)}],parameters:{docs:{description:{story:"localStorage holds valid JSON but with an unexpected shape (e.g. an array instead of an object map). The component should handle this gracefully and default all tools to visible."}}}};var b,f,v;s.parameters={...s.parameters,docs:{...(b=s.parameters)==null?void 0:b.docs,source:{originalSource:`{
  name: 'Default (First Mount — All Visible)',
  decorators: [Story => {
    // Clear any pre-existing visibility data so we start fresh
    try {
      localStorage.removeItem('toolVisibility');
    } catch {
      // ignore
    }
    return <Story />;
  }],
  parameters: {
    docs: {
      description: {
        story: 'First mount with no prior localStorage data. All tools default to visible.'
      }
    }
  }
}`,...(v=(f=s.parameters)==null?void 0:f.docs)==null?void 0:v.source}}};var w,T,E;i.parameters={...i.parameters,docs:{...(w=i.parameters)==null?void 0:w.docs,source:{originalSource:`{
  name: 'Some Tools Hidden (Restored from localStorage)',
  decorators: [Story => {
    try {
      // Simulate a returning user who previously hid a couple of tools.
      // The keys here must match whatever APP_CARDS uses as identifiers.
      const storedVisibility: Record<string, boolean> = {
        calculator: false,
        colorPicker: false,
        jsonFormatter: true,
        markdownEditor: true,
        base64Encoder: true,
        regexTester: false,
        unitConverter: true,
        urlEncoder: true
      };
      localStorage.setItem('toolVisibility', JSON.stringify(storedVisibility));
    } catch {
      // ignore
    }
    return <Story />;
  }],
  parameters: {
    docs: {
      description: {
        story: 'Simulates a returning user whose localStorage already has some tools hidden. The component should restore that state on mount.'
      }
    }
  }
}`,...(E=(T=i.parameters)==null?void 0:T.docs)==null?void 0:E.source}}};var R,k,I;l.parameters={...l.parameters,docs:{...(R=l.parameters)==null?void 0:R.docs,source:{originalSource:`{
  name: 'All Tools Hidden',
  decorators: [Story => {
    try {
      const allHidden: Record<string, boolean> = {
        calculator: false,
        colorPicker: false,
        jsonFormatter: false,
        markdownEditor: false,
        base64Encoder: false,
        regexTester: false,
        unitConverter: false,
        urlEncoder: false,
        timestampConverter: false,
        uuidGenerator: false
      };
      localStorage.setItem('toolVisibility', JSON.stringify(allHidden));
    } catch {
      // ignore
    }
    return <Story />;
  }],
  parameters: {
    docs: {
      description: {
        story: 'All tools have been toggled off. Useful for verifying the empty/zero-visibility UI state.'
      }
    }
  }
}`,...(I=(k=l.parameters)==null?void 0:k.docs)==null?void 0:I.source}}};var x,N,V;c.parameters={...c.parameters,docs:{...(x=c.parameters)==null?void 0:x.docs,source:{originalSource:`{
  name: 'localStorage Unavailable (Falls Back to In-Memory)',
  decorators: [Story => {
    // Temporarily make localStorage throw to simulate private-browsing
    // restrictions or a full storage quota.
    const originalGetItem = Storage.prototype.getItem;
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    Storage.prototype.getItem = () => {
      throw new DOMException('localStorage is not available', 'SecurityError');
    };
    Storage.prototype.setItem = () => {
      throw new DOMException('localStorage is not available', 'SecurityError');
    };
    Storage.prototype.removeItem = () => {
      throw new DOMException('localStorage is not available', 'SecurityError');
    };
    return <Story />;

    // NOTE: In a real scenario you would restore these in a cleanup,
    // but Storybook decorators don't have a teardown hook in CSF3.
    // The overrides will persist until the story is unmounted / page refreshes.
  }],
  parameters: {
    docs: {
      description: {
        story: 'Simulates an environment where localStorage is unavailable (e.g. private browsing with strict settings). The component should fall back to an empty map and keep state in memory only — all tools should still render and be interactable.'
      }
    }
  }
}`,...(V=(N=c.parameters)==null?void 0:N.docs)==null?void 0:V.source}}};var A,O,C;d.parameters={...d.parameters,docs:{...(A=d.parameters)==null?void 0:A.docs,source:{originalSource:`{
  name: 'Corrupted localStorage Data',
  decorators: [Story => {
    try {
      // Write invalid JSON so JSON.parse throws on read
      localStorage.setItem('toolVisibility', '{ this is not valid json %%}');
    } catch {
      // ignore
    }
    return <Story />;
  }],
  parameters: {
    docs: {
      description: {
        story: 'localStorage contains corrupted/non-parseable data. The component should gracefully fall back to an empty visibility map, treating all tools as visible by default.'
      }
    }
  }
}`,...(C=(O=d.parameters)==null?void 0:O.docs)==null?void 0:C.source}}};var J,D,H;u.parameters={...u.parameters,docs:{...(J=u.parameters)==null?void 0:J.docs,source:{originalSource:`{
  name: 'localStorage Has Unexpected Data Shape',
  decorators: [Story => {
    try {
      // Valid JSON but not the expected Record<string, boolean> shape
      localStorage.setItem('toolVisibility', JSON.stringify(['unexpected', 'array', 'value']));
    } catch {
      // ignore
    }
    return <Story />;
  }],
  parameters: {
    docs: {
      description: {
        story: 'localStorage holds valid JSON but with an unexpected shape (e.g. an array instead of an object map). The component should handle this gracefully and default all tools to visible.'
      }
    }
  }
}`,...(H=(D=u.parameters)==null?void 0:D.docs)==null?void 0:H.source}}};const _=["Default","WithSomeToolsHidden","AllToolsHidden","LocalStorageUnavailable","CorruptedLocalStorage","LocalStorageUnexpectedShape"];export{l as AllToolsHidden,d as CorruptedLocalStorage,s as Default,c as LocalStorageUnavailable,u as LocalStorageUnexpectedShape,i as WithSomeToolsHidden,_ as __namedExportsOrder,j as default};
