import{h as d}from"./index-B5IrvpLZ.js";import{r as s}from"./index-Bc2G9s8g.js";import{j as ve}from"./jiraApi-Zc4wcNPg.js";import{s as o}from"./JiraPicker.module-DUm0jMy4.js";import{H as c}from"./cookieStore-CKwAPFhE.js";import{d as me}from"./delay-F0IbJbgL.js";import"./isObject-DVTTJpIa.js";const L="/rest/agile/1.0/board",Ee="Select a board",ke="Loading boards…",we="Could not load Jira boards. You can still enter the board ID manually.",Ce="Current board";function Ke(e){return e?`${L}?projectKeyOrId=${encodeURIComponent(e)}`:L}function Oe(e){return`${Ce} (#${e})`}function ue({id:e,label:i,value:r,onChange:p,onBoardSelected:t,placeholder:je,projectKey:k}){const n=s.useMemo(()=>Ke(k),[k]),[m,w]=s.useState([]),[ye,C]=s.useState(null),[K,O]=s.useState(null);s.useEffect(()=>{let a=!0;async function u(){try{const v=await ve(n);if(!a)return;const Je=[...v.values].sort((Pe,Re)=>Pe.name.localeCompare(Re.name));w(Je),C(n),O(null)}catch{if(!a)return;w([]),C(null),O(n)}}return u(),()=>{a=!1}},[n]);const Se=ye!==n&&K!==n,Be=K===n,fe=s.useMemo(()=>r.length>0&&!m.some(a=>String(a.id)===r),[m,r]);return Be?React.createElement("div",{className:o.fieldGroup},React.createElement("label",{className:o.label,htmlFor:e},i),React.createElement("input",{className:o.fallbackInput,id:e,onChange:a=>{p(a.target.value),t==null||t(null)},type:"text",value:r}),React.createElement("p",{className:o.errorHint},we)):Se?React.createElement("div",{className:o.fieldGroup},React.createElement("label",{className:o.label,htmlFor:e},i),React.createElement("select",{className:o.select,defaultValue:"",disabled:!0,id:e},React.createElement("option",{value:""},ke))):React.createElement("div",{className:o.fieldGroup},React.createElement("label",{className:o.label,htmlFor:e},i),React.createElement("select",{className:o.select,id:e,onChange:a=>{const u=a.target.value;p(u),t==null||t(m.find(v=>String(v.id)===u)??null)},value:r},React.createElement("option",{disabled:!0,value:""},"— ",je??Ee," —"),fe&&React.createElement("option",{value:r},Oe(r)),m.map(a=>React.createElement("option",{key:a.id,value:String(a.id)},a.name," (#",a.id,")"))))}ue.__docgenInfo={description:"Loads Jira boards and lets settings panels store the selected Jira board ID as a string.",methods:[],displayName:"JiraBoardPicker",props:{id:{required:!0,tsType:{name:"string"},description:""},label:{required:!0,tsType:{name:"string"},description:""},value:{required:!0,tsType:{name:"string"},description:""},onChange:{required:!0,tsType:{name:"signature",type:"function",raw:"(boardId: string) => void",signature:{arguments:[{type:{name:"string"},name:"boardId"}],return:{name:"void"}}},description:""},onBoardSelected:{required:!1,tsType:{name:"signature",type:"function",raw:"(board: JiraBoard | null) => void",signature:{arguments:[{type:{name:"union",raw:"JiraBoard | null",elements:[{name:"JiraBoard"},{name:"null"}]},name:"board"}],return:{name:"void"}}},description:""},placeholder:{required:!1,tsType:{name:"string"},description:""},projectKey:{required:!1,tsType:{name:"string"},description:""}}};const be=[{id:42,name:"Team Alpha – Sprint Board",type:"scrum",projectKey:"PROJ"},{id:67,name:"Team Alpha – Kanban",type:"kanban",projectKey:"PROJ"},{id:101,name:"Release Planning Board",type:"scrum",projectKey:"PROJ"},{id:204,name:"Bug Triage",type:"kanban",projectKey:"PROJ"}],E=[...be,{id:300,name:"Marketing Campaign Tracker",type:"kanban",projectKey:"MKT"},{id:301,name:"Design Sprint Board",type:"scrum",projectKey:"DES"}],l=d.get("/api/jira/boards",({request:e})=>{const r=new URL(e.url).searchParams.get("projectKey"),p=r?be.filter(t=>t.projectKey===r):E;return c.json({boards:p})}),he=d.get("/api/jira/boards",()=>c.json({boards:E})),Le=d.get("/api/jira/boards",async()=>(await me("infinite"),c.json({boards:[]}))),ge=d.get("/api/jira/boards",()=>c.json({message:"Internal Server Error"},{status:500})),Ae=d.get("/api/jira/boards",async()=>(await me(1500),c.json({boards:E}))),_e={title:"Components/JiraBoardPicker",component:ue,parameters:{layout:"padded",msw:{handlers:[l]}},args:{id:"jira-board-picker",label:"Select Jira Board",value:"42",onChange:e=>console.log("onChange",e),onBoardSelected:e=>console.log("onBoardSelected",e),placeholder:"Choose a board",projectKey:"PROJ"},argTypes:{onChange:{action:"onChange"},onBoardSelected:{action:"onBoardSelected"},value:{control:"text"},projectKey:{control:"text"},placeholder:{control:"text"},id:{control:"text"},label:{control:"text"}}},b={name:"Default (Selected Board)",parameters:{msw:{handlers:[l]}},args:{id:"jira-board-picker",label:"Select Jira Board",value:"42",placeholder:"Choose a board",projectKey:"PROJ"}},h={name:"No Project Key Filter",parameters:{msw:{handlers:[he]}},args:{id:"jira-board-picker-all",label:"Select Jira Board",value:"300",placeholder:"Choose a board",projectKey:void 0}},g={name:"Loading State",parameters:{msw:{handlers:[Le]}},args:{id:"jira-board-picker-loading",label:"Select Jira Board",value:"",placeholder:"Choose a board",projectKey:"PROJ"}},j={name:"Error State (API Failure)",parameters:{msw:{handlers:[ge]}},args:{id:"jira-board-picker-error",label:"Select Jira Board",value:"",placeholder:"Choose a board",projectKey:"PROJ"}},y={name:"Error State with Existing Value",parameters:{msw:{handlers:[ge]}},args:{id:"jira-board-picker-error-value",label:"Select Jira Board",value:"42",placeholder:"Choose a board",projectKey:"PROJ"}},S={name:"Stale Value (Board Not in List)",parameters:{msw:{handlers:[l]}},args:{id:"jira-board-picker-stale",label:"Select Jira Board",value:"999",placeholder:"Choose a board",projectKey:"PROJ"}},B={name:"Empty Selection (Placeholder Visible)",parameters:{msw:{handlers:[l]}},args:{id:"jira-board-picker-empty",label:"Select Jira Board",value:"",placeholder:"Choose a board",projectKey:"PROJ"}},f={name:"Default Placeholder Text",parameters:{msw:{handlers:[he]}},args:{id:"jira-board-picker-default-placeholder",label:"Jira Board",value:"",placeholder:void 0,projectKey:void 0}},J={name:"Slow Network (Loading → Ready)",parameters:{msw:{handlers:[Ae]}},args:{id:"jira-board-picker-slow",label:"Select Jira Board",value:"67",placeholder:"Choose a board",projectKey:void 0}},P={name:"Custom Label Text",parameters:{msw:{handlers:[l]}},args:{id:"jira-board-picker-custom-label",label:"Sprint Retrospective Board",value:"101",placeholder:"Pick a board for this retrospective",projectKey:"PROJ"}},R={name:"Without Optional Callbacks",parameters:{msw:{handlers:[l]}},args:{id:"jira-board-picker-minimal",label:"Select Jira Board",value:"204",placeholder:"Choose a board",projectKey:"PROJ",onBoardSelected:void 0}};var A,T,H;b.parameters={...b.parameters,docs:{...(A=b.parameters)==null?void 0:A.docs,source:{originalSource:`{
  name: 'Default (Selected Board)',
  parameters: {
    msw: {
      handlers: [successHandlerFiltered]
    }
  },
  args: {
    id: 'jira-board-picker',
    label: 'Select Jira Board',
    value: '42',
    placeholder: 'Choose a board',
    projectKey: 'PROJ'
  }
}`,...(H=(T=b.parameters)==null?void 0:T.docs)==null?void 0:H.source}}};var N,x,F;h.parameters={...h.parameters,docs:{...(N=h.parameters)==null?void 0:N.docs,source:{originalSource:`{
  name: 'No Project Key Filter',
  parameters: {
    msw: {
      handlers: [successHandlerAll]
    }
  },
  args: {
    id: 'jira-board-picker-all',
    label: 'Select Jira Board',
    value: '300',
    placeholder: 'Choose a board',
    projectKey: undefined
  }
}`,...(F=(x=h.parameters)==null?void 0:x.docs)==null?void 0:F.source}}};var I,D,_;g.parameters={...g.parameters,docs:{...(I=g.parameters)==null?void 0:I.docs,source:{originalSource:`{
  name: 'Loading State',
  parameters: {
    msw: {
      handlers: [loadingHandler]
    }
  },
  args: {
    id: 'jira-board-picker-loading',
    label: 'Select Jira Board',
    value: '',
    placeholder: 'Choose a board',
    projectKey: 'PROJ'
  }
}`,...(_=(D=g.parameters)==null?void 0:D.docs)==null?void 0:_.source}}};var V,W,q;j.parameters={...j.parameters,docs:{...(V=j.parameters)==null?void 0:V.docs,source:{originalSource:`{
  name: 'Error State (API Failure)',
  parameters: {
    msw: {
      handlers: [errorHandler]
    }
  },
  args: {
    id: 'jira-board-picker-error',
    label: 'Select Jira Board',
    value: '',
    placeholder: 'Choose a board',
    projectKey: 'PROJ'
  }
}`,...(q=(W=j.parameters)==null?void 0:W.docs)==null?void 0:q.source}}};var G,M,U;y.parameters={...y.parameters,docs:{...(G=y.parameters)==null?void 0:G.docs,source:{originalSource:`{
  name: 'Error State with Existing Value',
  parameters: {
    msw: {
      handlers: [errorHandler]
    }
  },
  args: {
    id: 'jira-board-picker-error-value',
    label: 'Select Jira Board',
    value: '42',
    placeholder: 'Choose a board',
    projectKey: 'PROJ'
  }
}`,...(U=(M=y.parameters)==null?void 0:M.docs)==null?void 0:U.source}}};var $,X,Y;S.parameters={...S.parameters,docs:{...($=S.parameters)==null?void 0:$.docs,source:{originalSource:`{
  name: 'Stale Value (Board Not in List)',
  parameters: {
    msw: {
      handlers: [successHandlerFiltered]
    }
  },
  args: {
    id: 'jira-board-picker-stale',
    label: 'Select Jira Board',
    value: '999',
    // ID 999 does not exist in the mocked board list
    placeholder: 'Choose a board',
    projectKey: 'PROJ'
  }
}`,...(Y=(X=S.parameters)==null?void 0:X.docs)==null?void 0:Y.source}}};var z,Q,Z;B.parameters={...B.parameters,docs:{...(z=B.parameters)==null?void 0:z.docs,source:{originalSource:`{
  name: 'Empty Selection (Placeholder Visible)',
  parameters: {
    msw: {
      handlers: [successHandlerFiltered]
    }
  },
  args: {
    id: 'jira-board-picker-empty',
    label: 'Select Jira Board',
    value: '',
    placeholder: 'Choose a board',
    projectKey: 'PROJ'
  }
}`,...(Z=(Q=B.parameters)==null?void 0:Q.docs)==null?void 0:Z.source}}};var ee,ae,re;f.parameters={...f.parameters,docs:{...(ee=f.parameters)==null?void 0:ee.docs,source:{originalSource:`{
  name: 'Default Placeholder Text',
  parameters: {
    msw: {
      handlers: [successHandlerAll]
    }
  },
  args: {
    id: 'jira-board-picker-default-placeholder',
    label: 'Jira Board',
    value: '',
    placeholder: undefined,
    // should fall back to 'Select a board'
    projectKey: undefined
  }
}`,...(re=(ae=f.parameters)==null?void 0:ae.docs)==null?void 0:re.source}}};var oe,te,ne;J.parameters={...J.parameters,docs:{...(oe=J.parameters)==null?void 0:oe.docs,source:{originalSource:`{
  name: 'Slow Network (Loading → Ready)',
  parameters: {
    msw: {
      handlers: [slowSuccessHandler]
    }
  },
  args: {
    id: 'jira-board-picker-slow',
    label: 'Select Jira Board',
    value: '67',
    placeholder: 'Choose a board',
    projectKey: undefined
  }
}`,...(ne=(te=J.parameters)==null?void 0:te.docs)==null?void 0:ne.source}}};var se,le,de;P.parameters={...P.parameters,docs:{...(se=P.parameters)==null?void 0:se.docs,source:{originalSource:`{
  name: 'Custom Label Text',
  parameters: {
    msw: {
      handlers: [successHandlerFiltered]
    }
  },
  args: {
    id: 'jira-board-picker-custom-label',
    label: 'Sprint Retrospective Board',
    value: '101',
    placeholder: 'Pick a board for this retrospective',
    projectKey: 'PROJ'
  }
}`,...(de=(le=P.parameters)==null?void 0:le.docs)==null?void 0:de.source}}};var ce,ie,pe;R.parameters={...R.parameters,docs:{...(ce=R.parameters)==null?void 0:ce.docs,source:{originalSource:`{
  name: 'Without Optional Callbacks',
  parameters: {
    msw: {
      handlers: [successHandlerFiltered]
    }
  },
  args: {
    id: 'jira-board-picker-minimal',
    label: 'Select Jira Board',
    value: '204',
    placeholder: 'Choose a board',
    projectKey: 'PROJ',
    onBoardSelected: undefined
  }
}`,...(pe=(ie=R.parameters)==null?void 0:ie.docs)==null?void 0:pe.source}}};const Ve=["Default","WithoutProjectFilter","Loading","Error","ErrorWithExistingValue","StaleValue","EmptySelection","DefaultPlaceholder","SlowLoading","CustomLabel","WithoutOptionalCallbacks"];export{P as CustomLabel,b as Default,f as DefaultPlaceholder,B as EmptySelection,j as Error,y as ErrorWithExistingValue,g as Loading,J as SlowLoading,S as StaleValue,R as WithoutOptionalCallbacks,h as WithoutProjectFilter,Ve as __namedExportsOrder,_e as default};
