import{fn as B}from"./index-DeN4tkzB.js";const ee="_boardPickerContainer_wxloy_5",ae="_boardPickerLabel_wxloy_17",re="_searchInput_wxloy_31",ne="_boardList_wxloy_63",se="_boardButton_wxloy_79",te="_boardButtonSelected_wxloy_119",oe="_boardTypeBadge_wxloy_129",de="_loadingText_wxloy_153",ce="_noResultsText_wxloy_163",e={boardPickerContainer:ee,boardPickerLabel:ae,searchInput:re,boardList:ne,boardButton:se,boardButtonSelected:te,boardTypeBadge:oe,loadingText:de,noResultsText:ce};function ie(r,n){if(!n.trim())return r;const s=n.toLowerCase();return r.filter(y=>y.name.toLowerCase().includes(s))}function V({boards:r,selectedBoardId:n,searchQuery:s,onSearchChange:y,onSelectBoard:Y,isLoading:b}){const h=ie(r,s);return React.createElement("div",{className:e.boardPickerContainer},React.createElement("p",{className:e.boardPickerLabel},"Board"),React.createElement("input",{className:e.searchInput,onChange:a=>y(a.target.value),placeholder:"Search boards…",type:"text",value:s}),b&&React.createElement("p",{className:e.loadingText},"Loading boards…"),!b&&h.length===0&&React.createElement("p",{className:e.noResultsText},"No boards match your search."),!b&&h.length>0&&React.createElement("div",{className:e.boardList},h.map(a=>{const S=a.id===n,Z=S?`${e.boardButton} ${e.boardButtonSelected}`:e.boardButton;return React.createElement("button",{"aria-pressed":S,className:Z,key:a.id,onClick:()=>Y(a.id),type:"button"},React.createElement("span",null,a.name),React.createElement("span",{className:e.boardTypeBadge},a.type))})))}V.__docgenInfo={description:"Searchable list of Jira boards.\r\nCalls `onSelectBoard(boardId)` when the user picks one and `onSearchChange(text)`\r\nas the user types in the filter input.",methods:[],displayName:"BoardPicker",props:{boards:{required:!0,tsType:{name:"Array",elements:[{name:"JiraBoard"}],raw:"JiraBoard[]"},description:""},selectedBoardId:{required:!0,tsType:{name:"union",raw:"number | null",elements:[{name:"number"},{name:"null"}]},description:""},searchQuery:{required:!0,tsType:{name:"string"},description:""},onSearchChange:{required:!0,tsType:{name:"signature",type:"function",raw:"(query: string) => void",signature:{arguments:[{type:{name:"string"},name:"query"}],return:{name:"void"}}},description:""},onSelectBoard:{required:!0,tsType:{name:"signature",type:"function",raw:"(boardId: number) => void",signature:{arguments:[{type:{name:"number"},name:"boardId"}],return:{name:"void"}}},description:""},isLoading:{required:!0,tsType:{name:"boolean"},description:""}}};const X=[{id:1,name:"Platform Team",type:"scrum"},{id:2,name:"Frontend Sprint",type:"kanban"},{id:3,name:"Backend Services",type:"scrum"}],le=[{id:1,name:"Platform Team",type:"scrum"},{id:2,name:"Frontend Sprint",type:"kanban"},{id:3,name:"Backend Services",type:"scrum"},{id:4,name:"Mobile Development",type:"scrum"},{id:5,name:"DevOps & Infrastructure",type:"kanban"},{id:6,name:"QA & Testing",type:"scrum"},{id:7,name:"Design Systems",type:"kanban"},{id:8,name:"Data Engineering",type:"scrum"},{id:9,name:"Security & Compliance",type:"kanban"},{id:10,name:"Customer Success",type:"scrum"},{id:11,name:"Growth & Marketing",type:"kanban"},{id:12,name:"Product Analytics",type:"scrum"},{id:13,name:"API Integrations",type:"kanban"},{id:14,name:"Release Management",type:"scrum"},{id:15,name:"Localization",type:"kanban"}],ue={title:"Components/BoardPicker",component:V,args:{onSearchChange:B(),onSelectBoard:B()},argTypes:{boards:{control:"object"},selectedBoardId:{control:"number"},searchQuery:{control:"text"},isLoading:{control:"boolean"}}},t={name:"Default (Happy Path)",args:{boards:X,selectedBoardId:1,searchQuery:"",isLoading:!1}},o={name:"No Board Selected",args:{boards:X,selectedBoardId:null,searchQuery:"",isLoading:!1}},d={name:"Loading State",args:{boards:[],selectedBoardId:null,searchQuery:"",isLoading:!0}},c={name:"Search With Results",args:{boards:[{id:2,name:"Frontend Sprint",type:"kanban"}],selectedBoardId:null,searchQuery:"frontend",isLoading:!1}},i={name:"No Search Results",args:{boards:[],selectedBoardId:null,searchQuery:"zzznonexistent",isLoading:!1}},l={name:"Search With Special Characters",args:{boards:[],selectedBoardId:null,searchQuery:"  @#$%  ",isLoading:!1}},m={name:"Single Board in List",args:{boards:[{id:7,name:"Design Systems",type:"kanban"}],selectedBoardId:7,searchQuery:"",isLoading:!1}},u={name:"Large Board List (Scrollable)",args:{boards:le,selectedBoardId:8,searchQuery:"",isLoading:!1}},p={name:"Loading With Prior Selection",args:{boards:[],selectedBoardId:3,searchQuery:"",isLoading:!0}},g={name:"Active Search With Selection",args:{boards:[{id:1,name:"Platform Team",type:"scrum"},{id:3,name:"Backend Services",type:"scrum"}],selectedBoardId:3,searchQuery:"scrum",isLoading:!1}};var L,f,k;t.parameters={...t.parameters,docs:{...(L=t.parameters)==null?void 0:L.docs,source:{originalSource:`{
  name: 'Default (Happy Path)',
  args: {
    boards: mockBoards,
    selectedBoardId: 1,
    searchQuery: '',
    isLoading: false
  }
}`,...(k=(f=t.parameters)==null?void 0:f.docs)==null?void 0:k.source}}};var I,_,x;o.parameters={...o.parameters,docs:{...(I=o.parameters)==null?void 0:I.docs,source:{originalSource:`{
  name: 'No Board Selected',
  args: {
    boards: mockBoards,
    selectedBoardId: null,
    searchQuery: '',
    isLoading: false
  }
}`,...(x=(_=o.parameters)==null?void 0:_.docs)==null?void 0:x.source}}};var T,P,Q;d.parameters={...d.parameters,docs:{...(T=d.parameters)==null?void 0:T.docs,source:{originalSource:`{
  name: 'Loading State',
  args: {
    boards: [],
    selectedBoardId: null,
    searchQuery: '',
    isLoading: true
  }
}`,...(Q=(P=d.parameters)==null?void 0:P.docs)==null?void 0:Q.source}}};var v,C,R;c.parameters={...c.parameters,docs:{...(v=c.parameters)==null?void 0:v.docs,source:{originalSource:`{
  name: 'Search With Results',
  args: {
    boards: [{
      id: 2,
      name: 'Frontend Sprint',
      type: 'kanban'
    }],
    selectedBoardId: null,
    searchQuery: 'frontend',
    isLoading: false
  }
}`,...(R=(C=c.parameters)==null?void 0:C.docs)==null?void 0:R.source}}};var N,w,W;i.parameters={...i.parameters,docs:{...(N=i.parameters)==null?void 0:N.docs,source:{originalSource:`{
  name: 'No Search Results',
  args: {
    boards: [],
    selectedBoardId: null,
    searchQuery: 'zzznonexistent',
    isLoading: false
  }
}`,...(W=(w=i.parameters)==null?void 0:w.docs)==null?void 0:W.source}}};var E,D,q;l.parameters={...l.parameters,docs:{...(E=l.parameters)==null?void 0:E.docs,source:{originalSource:`{
  name: 'Search With Special Characters',
  args: {
    boards: [],
    selectedBoardId: null,
    searchQuery: '  @#$%  ',
    isLoading: false
  }
}`,...(q=(D=l.parameters)==null?void 0:D.docs)==null?void 0:q.source}}};var A,z,F;m.parameters={...m.parameters,docs:{...(A=m.parameters)==null?void 0:A.docs,source:{originalSource:`{
  name: 'Single Board in List',
  args: {
    boards: [{
      id: 7,
      name: 'Design Systems',
      type: 'kanban'
    }],
    selectedBoardId: 7,
    searchQuery: '',
    isLoading: false
  }
}`,...(F=(z=m.parameters)==null?void 0:z.docs)==null?void 0:F.source}}};var $,J,M;u.parameters={...u.parameters,docs:{...($=u.parameters)==null?void 0:$.docs,source:{originalSource:`{
  name: 'Large Board List (Scrollable)',
  args: {
    boards: largeBoardList,
    selectedBoardId: 8,
    searchQuery: '',
    isLoading: false
  }
}`,...(M=(J=u.parameters)==null?void 0:J.docs)==null?void 0:M.source}}};var H,O,j;p.parameters={...p.parameters,docs:{...(H=p.parameters)==null?void 0:H.docs,source:{originalSource:`{
  name: 'Loading With Prior Selection',
  args: {
    boards: [],
    selectedBoardId: 3,
    searchQuery: '',
    isLoading: true
  }
}`,...(j=(O=p.parameters)==null?void 0:O.docs)==null?void 0:j.source}}};var G,K,U;g.parameters={...g.parameters,docs:{...(G=g.parameters)==null?void 0:G.docs,source:{originalSource:`{
  name: 'Active Search With Selection',
  args: {
    boards: [{
      id: 1,
      name: 'Platform Team',
      type: 'scrum'
    }, {
      id: 3,
      name: 'Backend Services',
      type: 'scrum'
    }],
    selectedBoardId: 3,
    searchQuery: 'scrum',
    isLoading: false
  }
}`,...(U=(K=g.parameters)==null?void 0:K.docs)==null?void 0:U.source}}};const pe=["Default","NoSelection","LoadingState","SearchActive","NoSearchResults","SearchWithSpecialCharacters","SingleBoard","LargeBoardList","LoadingWithPreviousSelection","SearchWhileSelected"];export{t as Default,u as LargeBoardList,d as LoadingState,p as LoadingWithPreviousSelection,i as NoSearchResults,o as NoSelection,c as SearchActive,g as SearchWhileSelected,l as SearchWithSpecialCharacters,m as SingleBoard,pe as __namedExportsOrder,ue as default};
