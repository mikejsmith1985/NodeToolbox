import{fn as t}from"./index-DeN4tkzB.js";import{r as v}from"./index-Bc2G9s8g.js";const re="_moveWrapper_ozanr_5",ne="_triggerButton_ozanr_19",te="_dropdown_ozanr_53",ae="_sprintOptionButton_ozanr_77",se="_stateBadge_ozanr_121",ie="_feedbackText_ozanr_133",oe="_errorText_ozanr_143",e={moveWrapper:re,triggerButton:ne,dropdown:te,sprintOptionButton:ae,stateBadge:se,feedbackText:ie,errorText:oe};function pe(r,a){return a===null?r:r.filter(S=>S.id!==a)}function U({issueKey:r,currentSprintId:a,availableSprints:S,isLoadingAvailableSprints:g,onFetchSprints:G,onMoveToSprint:X}){const[f,Y]=v.useState(!1),[b,y]=v.useState("idle"),[O,P]=v.useState(null);function Z(){Y(!0),G()}async function $(n){y("moving"),P(null);try{await X(r,n)}catch(I){const ee=I instanceof Error?I.message:"Move failed";P(ee),y("error")}}const R=pe(S,a);return React.createElement("div",{className:e.moveWrapper},!f&&React.createElement("button",{className:e.triggerButton,onClick:Z,type:"button"},"↗ Move to sprint"),f&&React.createElement("div",{className:e.dropdown},g&&React.createElement("p",{className:e.feedbackText},"Loading…"),!g&&R.length===0&&React.createElement("p",{className:e.feedbackText},"No other sprints available."),!g&&R.map(n=>React.createElement("button",{className:e.sprintOptionButton,disabled:b==="moving",key:n.id,onClick:()=>$(n.id),type:"button"},n.name,React.createElement("span",{className:e.stateBadge},n.state==="future"?"(future)":"(active)"))),b==="error"&&O&&React.createElement("p",{className:e.errorText},"❌ ",O)))}U.__docgenInfo={description:"Inline move-to-sprint dropdown for a single issue.\r\nThe parent is responsible for loading `availableSprints` when `onFetchSprints` fires.",methods:[],displayName:"MoveToSprintButton",props:{issueKey:{required:!0,tsType:{name:"string"},description:""},currentSprintId:{required:!0,tsType:{name:"union",raw:"number | null",elements:[{name:"number"},{name:"null"}]},description:""},availableSprints:{required:!0,tsType:{name:"Array",elements:[{name:"JiraSprint"}],raw:"JiraSprint[]"},description:""},isLoadingAvailableSprints:{required:!0,tsType:{name:"boolean"},description:""},onFetchSprints:{required:!0,tsType:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}}},description:"Called the first time the dropdown is opened so the parent can lazily fetch sprints."},onMoveToSprint:{required:!0,tsType:{name:"signature",type:"function",raw:"(issueKey: string, targetSprintId: number) => Promise<void>",signature:{arguments:[{type:{name:"string"},name:"issueKey"},{type:{name:"number"},name:"targetSprintId"}],return:{name:"Promise",elements:[{name:"void"}],raw:"Promise<void>"}}},description:""}}};const ue={title:"Components/MoveToSprintButton",component:U,parameters:{layout:"centered"},args:{onFetchSprints:t(),onMoveToSprint:t().mockResolvedValue(void 0)}},m=[{id:43,name:"Sprint 43",state:"active"},{id:44,name:"Sprint 44",state:"future"}],s={args:{issueKey:"PROJ-123",currentSprintId:42,availableSprints:m,isLoadingAvailableSprints:!1}},i={args:{issueKey:"PROJ-456",currentSprintId:null,availableSprints:[{id:42,name:"Sprint 42",state:"active"},...m],isLoadingAvailableSprints:!1}},o={args:{issueKey:"PROJ-123",currentSprintId:42,availableSprints:[],isLoadingAvailableSprints:!0}},p={args:{issueKey:"PROJ-789",currentSprintId:43,availableSprints:[],isLoadingAvailableSprints:!1}},l={args:{issueKey:"PROJ-123",currentSprintId:42,availableSprints:m,isLoadingAvailableSprints:!1,onMoveToSprint:t().mockRejectedValue(new Error("Failed to move issue: Network error. Please try again."))}},c={args:{issueKey:"PROJ-321",currentSprintId:42,availableSprints:m,isLoadingAvailableSprints:!1,onMoveToSprint:t().mockImplementation(()=>new Promise(r=>setTimeout(r,6e4)))}},u={args:{issueKey:"PROJ-100",currentSprintId:40,availableSprints:[{id:41,name:"Sprint 41 — Bug Bash",state:"active"},{id:42,name:"Sprint 42 — Q3 Hardening",state:"future"},{id:43,name:"Sprint 43 — Feature Freeze",state:"future"},{id:44,name:"Sprint 44 — Release Prep",state:"future"},{id:45,name:"Sprint 45 — Post-Launch Cleanup",state:"future"}],isLoadingAvailableSprints:!1}},d={args:{issueKey:"PROJ-555",currentSprintId:null,availableSprints:[],isLoadingAvailableSprints:!1,onFetchSprints:t()}};var T,_,h;s.parameters={...s.parameters,docs:{...(T=s.parameters)==null?void 0:T.docs,source:{originalSource:`{
  args: {
    issueKey: 'PROJ-123',
    currentSprintId: 42,
    availableSprints: mockSprints,
    isLoadingAvailableSprints: false
  }
}`,...(h=(_=s.parameters)==null?void 0:_.docs)==null?void 0:h.source}}};var w,L,M;i.parameters={...i.parameters,docs:{...(w=i.parameters)==null?void 0:w.docs,source:{originalSource:`{
  args: {
    issueKey: 'PROJ-456',
    currentSprintId: null,
    availableSprints: [{
      id: 42,
      name: 'Sprint 42',
      state: 'active'
    }, ...mockSprints],
    isLoadingAvailableSprints: false
  }
}`,...(M=(L=i.parameters)==null?void 0:L.docs)==null?void 0:M.source}}};var k,B,K;o.parameters={...o.parameters,docs:{...(k=o.parameters)==null?void 0:k.docs,source:{originalSource:`{
  args: {
    issueKey: 'PROJ-123',
    currentSprintId: 42,
    availableSprints: [],
    isLoadingAvailableSprints: true
  }
}`,...(K=(B=o.parameters)==null?void 0:B.docs)==null?void 0:K.source}}};var A,E,J;p.parameters={...p.parameters,docs:{...(A=p.parameters)==null?void 0:A.docs,source:{originalSource:`{
  args: {
    issueKey: 'PROJ-789',
    currentSprintId: 43,
    availableSprints: [],
    isLoadingAvailableSprints: false
  }
}`,...(J=(E=p.parameters)==null?void 0:E.docs)==null?void 0:J.source}}};var F,N,x;l.parameters={...l.parameters,docs:{...(F=l.parameters)==null?void 0:F.docs,source:{originalSource:`{
  args: {
    issueKey: 'PROJ-123',
    currentSprintId: 42,
    availableSprints: mockSprints,
    isLoadingAvailableSprints: false,
    onMoveToSprint: fn().mockRejectedValue(new Error('Failed to move issue: Network error. Please try again.'))
  }
}`,...(x=(N=l.parameters)==null?void 0:N.docs)==null?void 0:x.source}}};var z,q,C;c.parameters={...c.parameters,docs:{...(z=c.parameters)==null?void 0:z.docs,source:{originalSource:`{
  args: {
    issueKey: 'PROJ-321',
    currentSprintId: 42,
    availableSprints: mockSprints,
    isLoadingAvailableSprints: false,
    onMoveToSprint: fn().mockImplementation(() => new Promise<void>(resolve => setTimeout(resolve, 60_000)))
  }
}`,...(C=(q=c.parameters)==null?void 0:q.docs)==null?void 0:C.source}}};var D,W,V;u.parameters={...u.parameters,docs:{...(D=u.parameters)==null?void 0:D.docs,source:{originalSource:`{
  args: {
    issueKey: 'PROJ-100',
    currentSprintId: 40,
    availableSprints: [{
      id: 41,
      name: 'Sprint 41 — Bug Bash',
      state: 'active'
    }, {
      id: 42,
      name: 'Sprint 42 — Q3 Hardening',
      state: 'future'
    }, {
      id: 43,
      name: 'Sprint 43 — Feature Freeze',
      state: 'future'
    }, {
      id: 44,
      name: 'Sprint 44 — Release Prep',
      state: 'future'
    }, {
      id: 45,
      name: 'Sprint 45 — Post-Launch Cleanup',
      state: 'future'
    }],
    isLoadingAvailableSprints: false
  }
}`,...(V=(W=u.parameters)==null?void 0:W.docs)==null?void 0:V.source}}};var j,H,Q;d.parameters={...d.parameters,docs:{...(j=d.parameters)==null?void 0:j.docs,source:{originalSource:`{
  args: {
    issueKey: 'PROJ-555',
    currentSprintId: null,
    availableSprints: [],
    isLoadingAvailableSprints: false,
    onFetchSprints: fn()
  }
}`,...(Q=(H=d.parameters)==null?void 0:H.docs)==null?void 0:Q.source}}};const de=["Default","UnassignedIssue","LoadingSprints","NoAvailableSprints","MoveError","MovingInProgress","ManySprints","LazyFetchOnFirstOpen"];export{s as Default,d as LazyFetchOnFirstOpen,o as LoadingSprints,u as ManySprints,l as MoveError,c as MovingInProgress,p as NoAvailableSprints,i as UnassignedIssue,de as __namedExportsOrder,ue as default};
