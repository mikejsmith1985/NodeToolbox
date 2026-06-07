import{R as r}from"./index-Bc2G9s8g.js";const ue="_snowRow_1xjxb_5",_e="_typeIcon_1xjxb_43",ye="_recordNumber_1xjxb_71",ge="_summary_1xjxb_89",fe="_statusBadge_1xjxb_109",he="_statusNew_1xjxb_131",be="_statusProgress_1xjxb_133",we="_statusOnHold_1xjxb_135",Ce="_statusResolved_1xjxb_137",Ne="_statusClosed_1xjxb_139",Se="_statusDefault_1xjxb_141",Ie="_priorityBadge_1xjxb_149",Pe="_priorityCritical_1xjxb_167",xe="_priorityHigh_1xjxb_169",ve="_priorityModerate_1xjxb_171",ke="_priorityLow_1xjxb_173",Ee="_priorityDefault_1xjxb_175",Re="_openedDate_1xjxb_179",s={snowRow:ue,typeIcon:_e,recordNumber:ye,summary:ge,statusBadge:fe,statusNew:he,statusProgress:be,statusOnHold:we,statusResolved:Ce,statusClosed:Ne,statusDefault:Se,priorityBadge:Ie,priorityCritical:Pe,priorityHigh:xe,priorityModerate:ve,priorityLow:ke,priorityDefault:Ee,openedDate:Re},Te={incident:"INC",problem:"PRB",sc_task:"TASK",change_request:"CHG"};function Oe(e){const t=e.trim().toLowerCase();return t==="new"?s.statusNew:t==="in progress"?s.statusProgress:t==="on hold"?s.statusOnHold:t==="resolved"?s.statusResolved:t==="closed"||t==="cancelled"?s.statusClosed:s.statusDefault}function Ze(e){const t=e.trim().charAt(0);return t==="1"?s.priorityCritical:t==="2"?s.priorityHigh:t==="3"?s.priorityModerate:t==="4"?s.priorityLow:s.priorityDefault}function De(e){const t=e.indexOf("-");return t!==-1?e.slice(t+1).trim():e}function Me(e){try{return new Date(e).toLocaleDateString(void 0,{month:"short",day:"numeric",year:"numeric"})}catch{return e}}function pe({issue:e}){const t=Te[e.sys_class_name]??"SNow",me=`${s.statusBadge} ${Oe(e.state)}`,le=`${s.priorityBadge} ${Ze(e.priority)}`;return r.createElement("div",{className:s.snowRow,role:"row","aria-label":`SNow ${e.number}: ${e.short_description}`},r.createElement("span",{className:s.typeIcon,title:e.sys_class_name},t),r.createElement("span",{className:s.recordNumber,title:e.number},e.number),r.createElement("span",{className:s.summary,title:e.short_description},e.short_description),r.createElement("span",{className:me},e.state),r.createElement("span",{className:le},De(e.priority)),r.createElement("span",{className:s.openedDate},Me(e.opened_at)))}pe.__docgenInfo={description:`A single ServiceNow work item row for the My Issues table.\r
\r
The cyan left border visually distinguishes SNow rows from Jira rows,\r
which use the accent color. This makes it immediately clear which system\r
each issue originates from at a glance.`,methods:[],displayName:"SnowIssueRow",props:{issue:{required:!0,tsType:{name:"SnowMyIssue"},description:"The SNow issue to render."}}};const je={title:"Components/SnowIssueRow",component:pe,parameters:{layout:"fullwidth"},decorators:[e=>React.createElement("table",{style:{width:"100%",borderCollapse:"collapse"}},React.createElement("tbody",null,React.createElement(e,null)))]},n={args:{issue:{number:"INC0010001",short_description:"System login failed for user admin@example.com",sys_class_name:"incident",state:"In Progress",priority:"2 - High",opened_at:"2024-01-15T09:30:00Z"}}},a={args:{issue:{number:"INC0010042",short_description:"Email service intermittently failing for marketing team",sys_class_name:"incident",state:"Resolved",priority:"3 - Moderate",opened_at:"2024-01-10T14:22:00Z"}}},o={args:{issue:{number:"CHG0004321",short_description:"Upgrade production database from PostgreSQL 14 to 16",sys_class_name:"change_request",state:"Pending",priority:"1 - Critical",opened_at:"2024-01-20T08:00:00Z"}}},i={args:{issue:{number:"REQ0007891",short_description:"Request new MacBook Pro for onboarding employee Jane Smith",sys_class_name:"sc_request",state:"Open",priority:"4 - Low",opened_at:"2024-01-18T11:45:00Z"}}},c={args:{issue:{number:"PRB0001234",short_description:"Recurring network timeouts in EU-West data center",sys_class_name:"problem",state:"In Progress",priority:"2 - High",opened_at:"2024-01-12T16:30:00Z"}}},d={name:"Edge Case: Missing / Invalid sys_class_name (falls back to SNow label)",args:{issue:{number:"UNK0099999",short_description:"Unrecognized record type from legacy system integration",sys_class_name:"",state:"Open",priority:"3 - Moderate",opened_at:"2024-01-16T10:00:00Z"}}},p={name:"Edge Case: Unknown sys_class_name value (falls back to SNow label)",args:{issue:{number:"XYZ0001337",short_description:"Custom workflow item from third-party connector",sys_class_name:"custom_workflow_item",state:"Pending",priority:"2 - High",opened_at:"2024-01-17T13:15:00Z"}}},m={name:"Edge Case: Invalid ISO 8601 date in opened_at (falls back to raw timestamp)",args:{issue:{number:"INC0020002",short_description:"VPN connection drops after 30 minutes of inactivity",sys_class_name:"incident",state:"In Progress",priority:"2 - High",opened_at:"not-a-valid-date-at-all"}}},l={name:"Edge Case: Malformed partial date string in opened_at",args:{issue:{number:"INC0020003",short_description:"Printer on floor 3 not responding to print jobs",sys_class_name:"incident",state:"Open",priority:"4 - Low",opened_at:"2024-99-99T99:99:99"}}},u={name:"Edge Case: Unknown state value (uses default style)",args:{issue:{number:"INC0030003",short_description:"Shared drive permissions missing for finance team folder",sys_class_name:"incident",state:"Awaiting Vendor",priority:"3 - Moderate",opened_at:"2024-01-14T09:00:00Z"}}},_={name:"Edge Case: Unknown priority format not starting with a digit (uses default style)",args:{issue:{number:"INC0040004",short_description:"Monitor flickering on workstation assigned to Bob Johnson",sys_class_name:"incident",state:"Open",priority:"Unspecified",opened_at:"2024-01-19T07:30:00Z"}}},y={name:"Edge Case: Empty string for state and priority fields",args:{issue:{number:"INC0050005",short_description:"Application crashes when exporting reports to PDF format",sys_class_name:"incident",state:"",priority:"",opened_at:"2024-01-21T12:00:00Z"}}},g={name:"Edge Case: Whitespace-only strings for state and priority fields",args:{issue:{number:"INC0050006",short_description:"Keyboard shortcut for copy-paste stopped working in Chrome",sys_class_name:"incident",state:"   ",priority:"   ",opened_at:"2024-01-22T15:45:00Z"}}},f={name:"Critical Priority — Open Incident",args:{issue:{number:"INC0000001",short_description:"Production database is down — all services affected",sys_class_name:"incident",state:"Open",priority:"1 - Critical",opened_at:"2024-01-23T03:15:00Z"}}},h={name:"Closed Low-Priority Incident",args:{issue:{number:"INC0099999",short_description:"Screen saver settings not applying on remote desktop sessions",sys_class_name:"incident",state:"Closed",priority:"5 - Planning",opened_at:"2023-12-01T08:00:00Z"}}};var b,w,C;n.parameters={...n.parameters,docs:{...(b=n.parameters)==null?void 0:b.docs,source:{originalSource:`{
  args: {
    issue: {
      number: 'INC0010001',
      short_description: 'System login failed for user admin@example.com',
      sys_class_name: 'incident',
      state: 'In Progress',
      priority: '2 - High',
      opened_at: '2024-01-15T09:30:00Z'
    }
  }
}`,...(C=(w=n.parameters)==null?void 0:w.docs)==null?void 0:C.source}}};var N,S,I;a.parameters={...a.parameters,docs:{...(N=a.parameters)==null?void 0:N.docs,source:{originalSource:`{
  args: {
    issue: {
      number: 'INC0010042',
      short_description: 'Email service intermittently failing for marketing team',
      sys_class_name: 'incident',
      state: 'Resolved',
      priority: '3 - Moderate',
      opened_at: '2024-01-10T14:22:00Z'
    }
  }
}`,...(I=(S=a.parameters)==null?void 0:S.docs)==null?void 0:I.source}}};var P,x,v;o.parameters={...o.parameters,docs:{...(P=o.parameters)==null?void 0:P.docs,source:{originalSource:`{
  args: {
    issue: {
      number: 'CHG0004321',
      short_description: 'Upgrade production database from PostgreSQL 14 to 16',
      sys_class_name: 'change_request',
      state: 'Pending',
      priority: '1 - Critical',
      opened_at: '2024-01-20T08:00:00Z'
    }
  }
}`,...(v=(x=o.parameters)==null?void 0:x.docs)==null?void 0:v.source}}};var k,E,R;i.parameters={...i.parameters,docs:{...(k=i.parameters)==null?void 0:k.docs,source:{originalSource:`{
  args: {
    issue: {
      number: 'REQ0007891',
      short_description: 'Request new MacBook Pro for onboarding employee Jane Smith',
      sys_class_name: 'sc_request',
      state: 'Open',
      priority: '4 - Low',
      opened_at: '2024-01-18T11:45:00Z'
    }
  }
}`,...(R=(E=i.parameters)==null?void 0:E.docs)==null?void 0:R.source}}};var T,O,Z;c.parameters={...c.parameters,docs:{...(T=c.parameters)==null?void 0:T.docs,source:{originalSource:`{
  args: {
    issue: {
      number: 'PRB0001234',
      short_description: 'Recurring network timeouts in EU-West data center',
      sys_class_name: 'problem',
      state: 'In Progress',
      priority: '2 - High',
      opened_at: '2024-01-12T16:30:00Z'
    }
  }
}`,...(Z=(O=c.parameters)==null?void 0:O.docs)==null?void 0:Z.source}}};var D,M,U;d.parameters={...d.parameters,docs:{...(D=d.parameters)==null?void 0:D.docs,source:{originalSource:`{
  name: 'Edge Case: Missing / Invalid sys_class_name (falls back to SNow label)',
  args: {
    issue: {
      number: 'UNK0099999',
      short_description: 'Unrecognized record type from legacy system integration',
      sys_class_name: '',
      state: 'Open',
      priority: '3 - Moderate',
      opened_at: '2024-01-16T10:00:00Z'
    }
  }
}`,...(U=(M=d.parameters)==null?void 0:M.docs)==null?void 0:U.source}}};var j,L,H;p.parameters={...p.parameters,docs:{...(j=p.parameters)==null?void 0:j.docs,source:{originalSource:`{
  name: 'Edge Case: Unknown sys_class_name value (falls back to SNow label)',
  args: {
    issue: {
      number: 'XYZ0001337',
      short_description: 'Custom workflow item from third-party connector',
      sys_class_name: 'custom_workflow_item',
      state: 'Pending',
      priority: '2 - High',
      opened_at: '2024-01-17T13:15:00Z'
    }
  }
}`,...(H=(L=p.parameters)==null?void 0:L.docs)==null?void 0:H.source}}};var B,q,A;m.parameters={...m.parameters,docs:{...(B=m.parameters)==null?void 0:B.docs,source:{originalSource:`{
  name: 'Edge Case: Invalid ISO 8601 date in opened_at (falls back to raw timestamp)',
  args: {
    issue: {
      number: 'INC0020002',
      short_description: 'VPN connection drops after 30 minutes of inactivity',
      sys_class_name: 'incident',
      state: 'In Progress',
      priority: '2 - High',
      opened_at: 'not-a-valid-date-at-all'
    }
  }
}`,...(A=(q=m.parameters)==null?void 0:q.docs)==null?void 0:A.source}}};var W,$,F;l.parameters={...l.parameters,docs:{...(W=l.parameters)==null?void 0:W.docs,source:{originalSource:`{
  name: 'Edge Case: Malformed partial date string in opened_at',
  args: {
    issue: {
      number: 'INC0020003',
      short_description: 'Printer on floor 3 not responding to print jobs',
      sys_class_name: 'incident',
      state: 'Open',
      priority: '4 - Low',
      opened_at: '2024-99-99T99:99:99'
    }
  }
}`,...(F=($=l.parameters)==null?void 0:$.docs)==null?void 0:F.source}}};var V,J,K;u.parameters={...u.parameters,docs:{...(V=u.parameters)==null?void 0:V.docs,source:{originalSource:`{
  name: 'Edge Case: Unknown state value (uses default style)',
  args: {
    issue: {
      number: 'INC0030003',
      short_description: 'Shared drive permissions missing for finance team folder',
      sys_class_name: 'incident',
      state: 'Awaiting Vendor',
      priority: '3 - Moderate',
      opened_at: '2024-01-14T09:00:00Z'
    }
  }
}`,...(K=(J=u.parameters)==null?void 0:J.docs)==null?void 0:K.source}}};var Q,z,G;_.parameters={..._.parameters,docs:{...(Q=_.parameters)==null?void 0:Q.docs,source:{originalSource:`{
  name: 'Edge Case: Unknown priority format not starting with a digit (uses default style)',
  args: {
    issue: {
      number: 'INC0040004',
      short_description: 'Monitor flickering on workstation assigned to Bob Johnson',
      sys_class_name: 'incident',
      state: 'Open',
      priority: 'Unspecified',
      opened_at: '2024-01-19T07:30:00Z'
    }
  }
}`,...(G=(z=_.parameters)==null?void 0:z.docs)==null?void 0:G.source}}};var Y,X,ee;y.parameters={...y.parameters,docs:{...(Y=y.parameters)==null?void 0:Y.docs,source:{originalSource:`{
  name: 'Edge Case: Empty string for state and priority fields',
  args: {
    issue: {
      number: 'INC0050005',
      short_description: 'Application crashes when exporting reports to PDF format',
      sys_class_name: 'incident',
      state: '',
      priority: '',
      opened_at: '2024-01-21T12:00:00Z'
    }
  }
}`,...(ee=(X=y.parameters)==null?void 0:X.docs)==null?void 0:ee.source}}};var se,te,re;g.parameters={...g.parameters,docs:{...(se=g.parameters)==null?void 0:se.docs,source:{originalSource:`{
  name: 'Edge Case: Whitespace-only strings for state and priority fields',
  args: {
    issue: {
      number: 'INC0050006',
      short_description: 'Keyboard shortcut for copy-paste stopped working in Chrome',
      sys_class_name: 'incident',
      state: '   ',
      priority: '   ',
      opened_at: '2024-01-22T15:45:00Z'
    }
  }
}`,...(re=(te=g.parameters)==null?void 0:te.docs)==null?void 0:re.source}}};var ne,ae,oe;f.parameters={...f.parameters,docs:{...(ne=f.parameters)==null?void 0:ne.docs,source:{originalSource:`{
  name: 'Critical Priority — Open Incident',
  args: {
    issue: {
      number: 'INC0000001',
      short_description: 'Production database is down — all services affected',
      sys_class_name: 'incident',
      state: 'Open',
      priority: '1 - Critical',
      opened_at: '2024-01-23T03:15:00Z'
    }
  }
}`,...(oe=(ae=f.parameters)==null?void 0:ae.docs)==null?void 0:oe.source}}};var ie,ce,de;h.parameters={...h.parameters,docs:{...(ie=h.parameters)==null?void 0:ie.docs,source:{originalSource:`{
  name: 'Closed Low-Priority Incident',
  args: {
    issue: {
      number: 'INC0099999',
      short_description: 'Screen saver settings not applying on remote desktop sessions',
      sys_class_name: 'incident',
      state: 'Closed',
      priority: '5 - Planning',
      opened_at: '2023-12-01T08:00:00Z'
    }
  }
}`,...(de=(ce=h.parameters)==null?void 0:ce.docs)==null?void 0:de.source}}};const Le=["Default","ResolvedIncident","ChangeRequest","ServiceRequest","ProblemRecord","MissingOrInvalidSysClassName","UnknownSysClassName","InvalidDateFormat","MalformedDateTimestamp","UnknownStateValue","UnknownPriorityFormat","EmptyStateAndPriority","WhitespaceOnlyStateAndPriority","CriticalPriorityOpen","ClosedLowPriority"];export{o as ChangeRequest,h as ClosedLowPriority,f as CriticalPriorityOpen,n as Default,y as EmptyStateAndPriority,m as InvalidDateFormat,l as MalformedDateTimestamp,d as MissingOrInvalidSysClassName,c as ProblemRecord,a as ResolvedIncident,i as ServiceRequest,_ as UnknownPriorityFormat,u as UnknownStateValue,p as UnknownSysClassName,g as WhitespaceOnlyStateAndPriority,Le as __namedExportsOrder,je as default};
