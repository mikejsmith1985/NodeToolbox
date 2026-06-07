import{fn as k}from"./index-DeN4tkzB.js";const z="_container_1akz3_5",x="_boardRow_1akz3_17",H="_boardPill_1akz3_31",O="_clearBoardButton_1akz3_55",J="_quickFilterRow_1akz3_83",Y="_quickFilterChip_1akz3_97",$="_quickFilterChipActive_1akz3_129",e={container:z,boardRow:x,boardPill:H,clearBoardButton:O,quickFilterRow:J,quickFilterChip:Y,quickFilterChipActive:$};function E({boardName:d,boardQuickFilters:u,activeQuickFilterIds:M,onClearBoard:T,onToggleQuickFilter:D}){return d?React.createElement("div",{className:e.container},React.createElement("div",{className:e.boardRow},React.createElement("span",{className:e.boardPill},"📋 ",d,React.createElement("button",{"aria-label":"Clear board",className:e.clearBoardButton,onClick:T,title:"Remove board filter",type:"button"},"×"))),u.length>0&&React.createElement("div",{className:e.quickFilterRow},u.map(r=>{const m=!!M[r.id],U=m?`${e.quickFilterChip} ${e.quickFilterChipActive}`:e.quickFilterChip;return React.createElement("button",{"aria-pressed":m,className:U,key:r.id,onClick:()=>D(r.id),title:r.jql,type:"button"},r.name)}))):null}E.__docgenInfo={description:`Renders the active board as a pill with a dismiss button, and a row of\r
quick-filter toggle chips beneath it. Returns null if no board is selected.`,methods:[],displayName:"BoardPillAndFilters",props:{boardName:{required:!0,tsType:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}]},description:""},boardQuickFilters:{required:!0,tsType:{name:"Array",elements:[{name:"JiraBoardQuickFilter"}],raw:"JiraBoardQuickFilter[]"},description:""},activeQuickFilterIds:{required:!0,tsType:{name:"Record",elements:[{name:"number"},{name:"boolean"}],raw:"Record<number, boolean>"},description:""},onClearBoard:{required:!0,tsType:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}}},description:""},onToggleQuickFilter:{required:!0,tsType:{name:"signature",type:"function",raw:"(filterId: number) => void",signature:{arguments:[{type:{name:"number"},name:"filterId"}],return:{name:"void"}}},description:""}}};const c=[{id:1,name:"My Issues",jql:"assignee = currentUser()"},{id:2,name:"In Progress",jql:"status = 'In Progress'"},{id:3,name:"Recently Updated",jql:"updated >= -7d"}],K={title:"Components/BoardPillAndFilters",component:E,args:{onClearBoard:k(),onToggleQuickFilter:k()}},a={name:"Default (Board Selected with Mixed Filters)",args:{boardName:"Project Alpha Board",boardQuickFilters:c,activeQuickFilterIds:{1:!0,2:!1,3:!0}}},t={name:"No Board Selected (Returns Null)",args:{boardName:null,boardQuickFilters:c,activeQuickFilterIds:{1:!0,2:!1,3:!0}}},i={name:"Board Selected, No Quick Filters Available",args:{boardName:"Design System Board",boardQuickFilters:[],activeQuickFilterIds:{}}},s={name:"All Quick Filters Inactive",args:{boardName:"Platform Engineering Board",boardQuickFilters:c,activeQuickFilterIds:{1:!1,2:!1,3:!1}}},n={name:"All Quick Filters Active",args:{boardName:"Mobile Squad Board",boardQuickFilters:c,activeQuickFilterIds:{1:!0,2:!0,3:!0}}},l={name:"Single Quick Filter Available",args:{boardName:"Data Infrastructure Board",boardQuickFilters:[{id:7,name:"Blocked",jql:"label = 'blocked'"}],activeQuickFilterIds:{7:!1}}},o={name:"Many Quick Filters",args:{boardName:"Enterprise Backlog Board",boardQuickFilters:[{id:1,name:"My Issues",jql:"assignee = currentUser()"},{id:2,name:"In Progress",jql:"status = 'In Progress'"},{id:3,name:"Recently Updated",jql:"updated >= -7d"},{id:4,name:"High Priority",jql:"priority = High"},{id:5,name:"Bugs Only",jql:"issuetype = Bug"},{id:6,name:"Unassigned",jql:"assignee is EMPTY"},{id:7,name:"Blocked",jql:"label = 'blocked'"}],activeQuickFilterIds:{1:!0,2:!1,3:!0,4:!1,5:!1,6:!0,7:!1}}};var p,F,g;a.parameters={...a.parameters,docs:{...(p=a.parameters)==null?void 0:p.docs,source:{originalSource:`{
  name: 'Default (Board Selected with Mixed Filters)',
  args: {
    boardName: 'Project Alpha Board',
    boardQuickFilters: mockQuickFilters,
    activeQuickFilterIds: {
      1: true,
      2: false,
      3: true
    }
  }
}`,...(g=(F=a.parameters)==null?void 0:F.docs)==null?void 0:g.source}}};var b,Q,B;t.parameters={...t.parameters,docs:{...(b=t.parameters)==null?void 0:b.docs,source:{originalSource:`{
  name: 'No Board Selected (Returns Null)',
  args: {
    boardName: null,
    boardQuickFilters: mockQuickFilters,
    activeQuickFilterIds: {
      1: true,
      2: false,
      3: true
    }
  }
}`,...(B=(Q=t.parameters)==null?void 0:Q.docs)==null?void 0:B.source}}};var f,v,q;i.parameters={...i.parameters,docs:{...(f=i.parameters)==null?void 0:f.docs,source:{originalSource:`{
  name: 'Board Selected, No Quick Filters Available',
  args: {
    boardName: 'Design System Board',
    boardQuickFilters: [],
    activeQuickFilterIds: {}
  }
}`,...(q=(v=i.parameters)==null?void 0:v.docs)==null?void 0:q.source}}};var y,I,N;s.parameters={...s.parameters,docs:{...(y=s.parameters)==null?void 0:y.docs,source:{originalSource:`{
  name: 'All Quick Filters Inactive',
  args: {
    boardName: 'Platform Engineering Board',
    boardQuickFilters: mockQuickFilters,
    activeQuickFilterIds: {
      1: false,
      2: false,
      3: false
    }
  }
}`,...(N=(I=s.parameters)==null?void 0:I.docs)==null?void 0:N.source}}};var A,_,h;n.parameters={...n.parameters,docs:{...(A=n.parameters)==null?void 0:A.docs,source:{originalSource:`{
  name: 'All Quick Filters Active',
  args: {
    boardName: 'Mobile Squad Board',
    boardQuickFilters: mockQuickFilters,
    activeQuickFilterIds: {
      1: true,
      2: true,
      3: true
    }
  }
}`,...(h=(_=n.parameters)==null?void 0:_.docs)==null?void 0:h.source}}};var R,S,j;l.parameters={...l.parameters,docs:{...(R=l.parameters)==null?void 0:R.docs,source:{originalSource:`{
  name: 'Single Quick Filter Available',
  args: {
    boardName: 'Data Infrastructure Board',
    boardQuickFilters: [{
      id: 7,
      name: 'Blocked',
      jql: "label = 'blocked'"
    }],
    activeQuickFilterIds: {
      7: false
    }
  }
}`,...(j=(S=l.parameters)==null?void 0:S.docs)==null?void 0:j.source}}};var P,w,C;o.parameters={...o.parameters,docs:{...(P=o.parameters)==null?void 0:P.docs,source:{originalSource:`{
  name: 'Many Quick Filters',
  args: {
    boardName: 'Enterprise Backlog Board',
    boardQuickFilters: [{
      id: 1,
      name: 'My Issues',
      jql: 'assignee = currentUser()'
    }, {
      id: 2,
      name: 'In Progress',
      jql: "status = 'In Progress'"
    }, {
      id: 3,
      name: 'Recently Updated',
      jql: 'updated >= -7d'
    }, {
      id: 4,
      name: 'High Priority',
      jql: 'priority = High'
    }, {
      id: 5,
      name: 'Bugs Only',
      jql: 'issuetype = Bug'
    }, {
      id: 6,
      name: 'Unassigned',
      jql: 'assignee is EMPTY'
    }, {
      id: 7,
      name: 'Blocked',
      jql: "label = 'blocked'"
    }],
    activeQuickFilterIds: {
      1: true,
      2: false,
      3: true,
      4: false,
      5: false,
      6: true,
      7: false
    }
  }
}`,...(C=(w=o.parameters)==null?void 0:w.docs)==null?void 0:C.source}}};const L=["Default","NoBoardSelected","EmptyQuickFilters","AllFiltersInactive","AllFiltersActive","SingleFilter","ManyFilters"];export{n as AllFiltersActive,s as AllFiltersInactive,a as Default,i as EmptyQuickFilters,o as ManyFilters,t as NoBoardSelected,l as SingleFilter,L as __namedExportsOrder,K as default};
