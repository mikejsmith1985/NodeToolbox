import{h as u}from"./index-B5IrvpLZ.js";import{r as i}from"./index-Bc2G9s8g.js";import{j as be}from"./jiraApi-Zc4wcNPg.js";import{H as d}from"./cookieStore-CKwAPFhE.js";const he="tbxDefectFilters",Se=["summary","status","priority","assignee","issuetype","created","updated"].join(","),Re="created >= -90d",Te=200,Ne=24*60*60*1e3,p=0,ke=["","Highest","High","Medium","Low","Lowest"],Ce=["","new","indeterminate","done"],Pe=["priority-age","age","updated"];function Le(e){var n,o,l;const t=((l=(o=(n=e.fields)==null?void 0:n.issuetype)==null?void 0:o.name)==null?void 0:l.toLowerCase())??"",a=t.includes("bug"),r=t.includes("defect");return a||r}function Ie(e){var t;return _e((t=e.fields)==null?void 0:t.created)}function Be(e){var t;return _e((t=e.fields)==null?void 0:t.updated)}function Me(e){var a,r,n;const t=(n=(r=(a=e.fields)==null?void 0:a.status)==null?void 0:r.statusCategory)==null?void 0:n.key;return t==="indeterminate"||t==="done"?t:"new"}function B(e){const t=e.trim().toLowerCase();return["highest","critical","blocker"].includes(t)?0:t==="high"?1:t==="medium"?2:t==="low"||t==="lowest"?3:4}function je(e,t){return e.filter(a=>{const r=!t.priority||a.priority===t.priority,n=!t.statusCat||a.statusCat===t.statusCat,o=!t.unassignedOnly||!a.assignee;return r&&n&&o})}function xe(e,t){const a=[...e];return a.sort((r,n)=>He(r,n,t)),a}function Ae(){const[e,t]=i.useState(qe),[a,r]=i.useState([]),[n,o]=i.useState(p),[l,we]=i.useState(!1),[S,R]=i.useState(null);i.useEffect(()=>{Ke(e)},[e]);const T=i.useCallback(c=>{t(m=>({...m,projectKey:c}))},[]),N=i.useCallback(c=>{t(m=>({...m,extraJql:c}))},[]),k=i.useCallback((c,m)=>{t(I=>({...I,filter:{...I.filter,[c]:m}}))},[]),C=i.useCallback(c=>{t(m=>({...m,sort:c}))},[]),P=i.useCallback(async()=>{const c=Je(e.projectKey,e.extraJql);if(!c){r([]),o(p),R(null);return}await Oe(c,r,o,we,R)},[e.projectKey,e.extraJql]),L=i.useMemo(()=>xe(je(a,e.filter),e.sort),[a,e.filter,e.sort]);return i.useMemo(()=>({projectKey:e.projectKey,setProjectKey:T,extraJql:e.extraJql,setExtraJql:N,filter:e.filter,setFilter:k,sort:e.sort,setSort:C,isLoading:l,errorMessage:S,defects:L,rawIssueCount:n,reload:P}),[e,T,N,k,C,l,S,L,n,P])}function _e(e){if(!e)return p;const t=new Date(e).getTime();return Number.isFinite(t)?Math.max(p,Math.floor((Date.now()-t)/Ne)):p}function He(e,t,a){return a==="age"?t.ageDays-e.ageDays:a==="updated"?t.updatedDays-e.updatedDays:B(e.priority)-B(t.priority)||t.ageDays-e.ageDays}function ve(e){var a,r,n,o;const t=e.fields??{};return{key:e.key??"",summary:t.summary??"",priority:((a=t.priority)==null?void 0:a.name)??"",status:((r=t.status)==null?void 0:r.name)??"",statusCat:Me(e),assignee:((n=t.assignee)==null?void 0:n.displayName)??"",issueType:((o=t.issuetype)==null?void 0:o.name)??"",created:t.created??"",updated:t.updated??"",ageDays:Ie(e),updatedDays:Be(e)}}function Je(e,t){const a=e.trim().toUpperCase();if(!a)return null;const r=Xe(a,t);return`/rest/api/2/search?jql=${encodeURIComponent(r)}&fields=${Se}&maxResults=${Te}`}function Xe(e,t){const a=`project=${e} AND issuetype in (Bug, Defect) AND ${Re}`,r=Ue(t);return r?`${a} AND ${r}`:a}function Ue(e){return e.trim().replace(/^AND\s+/i,"")}async function Oe(e,t,a,r,n){r(!0),n(null);try{const l=(await be(e)).issues??[];a(l.length),t(l.filter(Le).map(ve))}catch(o){a(p),t([]),n(o instanceof Error?o.message:"Failed to load defects")}finally{r(!1)}}function y(){return{projectKey:"",extraJql:"",filter:{priority:"",statusCat:"",unassignedOnly:!1},sort:"priority-age"}}function qe(){if(typeof window>"u")return y();try{const e=window.localStorage.getItem(he);return e?Fe(JSON.parse(e)):y()}catch{return y()}}function Ke(e){typeof window>"u"||window.localStorage.setItem(he,JSON.stringify(e))}function Fe(e){if(!De(e))return y();const t=y();return{projectKey:typeof e.projectKey=="string"?e.projectKey:t.projectKey,extraJql:typeof e.extraJql=="string"?e.extraJql:t.extraJql,filter:Ve(e.filter),sort:Ge(e.sort)?e.sort:t.sort}}function Ve(e){return De(e)?{priority:$e(e.priority)?e.priority:"",statusCat:Ye(e.statusCat)?e.statusCat:"",unassignedOnly:e.unassignedOnly===!0}:y().filter}function $e(e){return ke.includes(e)}function Ye(e){return Ce.includes(e)}function Ge(e){return Pe.includes(e)}function De(e){return typeof e=="object"&&e!==null}const We="_defectManagementView_1o5na_5",ze="_pageHeader_1o5na_25",Qe="_pageTitle_1o5na_33",Ze="_pageSubtitle_1o5na_45",et="_controlsPanel_1o5na_57",tt="_filtersPanel_1o5na_59",at="_controlInput_1o5na_81",st="_controlLabel_1o5na_103",rt="_controlSelect_1o5na_119",nt="_checkboxLabel_1o5na_137",ot="_buttonPrimary_1o5na_181 _button_1o5na_153",it="_summaryBar_1o5na_207",ct="_statusMessage_1o5na_225",lt="_errorMessage_1o5na_235",ut="_tableScroll_1o5na_245",dt="_table_1o5na_245",mt="_tableHeader_1o5na_271",pt="_tableRow_1o5na_297",yt="_tableCell_1o5na_305",gt="_cellMonospace_1o5na_315 _tableCell_1o5na_305",ft="_cellSummary_1o5na_327 _tableCell_1o5na_305",ht="_issueLink_1o5na_343",_t="_priorityBadge_1o5na_363",Dt="_unassignedBadge_1o5na_365",Et="_emptyState_1o5na_405",s={defectManagementView:We,pageHeader:ze,pageTitle:Qe,pageSubtitle:Ze,controlsPanel:et,filtersPanel:tt,controlInput:at,controlLabel:st,controlSelect:rt,checkboxLabel:nt,buttonPrimary:ot,summaryBar:it,statusMessage:ct,errorMessage:lt,tableScroll:ut,table:dt,tableHeader:mt,tableRow:pt,tableCell:yt,cellMonospace:gt,cellSummary:ft,issueLink:ht,priorityBadge:_t,unassignedBadge:Dt,emptyState:Et},M="Defect Management",wt="Load recent Bug and Defect issues by Jira project, then triage them with legacy filters and sorts.",bt="Project key (e.g. TBX)",St="Optional extra JQL (e.g. statusCategory != Done)",Rt="Enter a Jira project key to load recent defects.",Tt="No defects match the current query and filters.",b="—",Nt="UNASSIGNED",kt="/browse/",Ct=["","Highest","High","Medium","Low","Lowest"],Pt=["","new","indeterminate","done"],Lt=[{value:"priority-age",label:"Priority, then age"},{value:"age",label:"Age"},{value:"updated",label:"Updated"}],j=["Key","Summary","Priority","Status","Assignee","Age","Updated"];function Ee(){const e=Ae(),t=e.projectKey.trim().length>0;return React.createElement("section",{className:s.defectManagementView,"aria-label":M},React.createElement("header",{className:s.pageHeader},React.createElement("h1",{className:s.pageTitle},M),React.createElement("p",{className:s.pageSubtitle},wt)),React.createElement("div",{className:s.controlsPanel},React.createElement("input",{className:s.controlInput,"aria-label":"Jira project key",placeholder:bt,value:e.projectKey,onChange:a=>e.setProjectKey(a.target.value)}),React.createElement("input",{className:s.controlInput,"aria-label":"Extra JQL",placeholder:St,value:e.extraJql,onChange:a=>e.setExtraJql(a.target.value)}),React.createElement("button",{type:"button",className:s.buttonPrimary,disabled:e.isLoading||!t,onClick:()=>{e.reload()}},e.isLoading?"Loading…":"↻ Load Defects")),React.createElement("div",{className:s.filtersPanel},React.createElement("label",{className:s.controlLabel},"Priority",React.createElement("select",{className:s.controlSelect,"aria-label":"Priority filter",value:e.filter.priority,onChange:a=>e.setFilter("priority",a.target.value)},Ct.map(a=>React.createElement("option",{key:a||"all-priorities",value:a},a||"All priorities")))),React.createElement("label",{className:s.controlLabel},"Status category",React.createElement("select",{className:s.controlSelect,"aria-label":"Status category filter",value:e.filter.statusCat,onChange:a=>e.setFilter("statusCat",a.target.value)},Pt.map(a=>React.createElement("option",{key:a||"all-statuses",value:a},a||"All statuses")))),React.createElement("label",{className:s.checkboxLabel},React.createElement("input",{type:"checkbox","aria-label":"Unassigned defects only",checked:e.filter.unassignedOnly,onChange:a=>e.setFilter("unassignedOnly",a.target.checked)}),"Unassigned only"),React.createElement("label",{className:s.controlLabel},"Sort",React.createElement("select",{className:s.controlSelect,"aria-label":"Sort defects",value:e.sort,onChange:a=>e.setSort(a.target.value)},Lt.map(a=>React.createElement("option",{key:a.value,value:a.value},a.label))))),React.createElement("div",{className:s.summaryBar,"aria-live":"polite"},"Showing ",e.defects.length," of ",e.rawIssueCount," defects"),e.isLoading&&React.createElement("p",{className:s.statusMessage,role:"status"},"Loading defects…"),e.errorMessage&&React.createElement("p",{className:s.errorMessage,role:"alert"},"⚠ ",e.errorMessage),React.createElement("div",{className:s.tableScroll},React.createElement("table",{className:s.table},React.createElement("thead",null,React.createElement("tr",{className:s.tableHeader},j.map(a=>React.createElement("th",{key:a},a)))),React.createElement("tbody",null,e.defects.length===0?React.createElement("tr",null,React.createElement("td",{colSpan:j.length,className:s.emptyState},t?Tt:Rt)):e.defects.map(a=>It(a))))))}function It(e){return React.createElement("tr",{key:e.key,className:s.tableRow},React.createElement("td",{className:s.cellMonospace},React.createElement("a",{className:s.issueLink,href:Mt(e.key),target:"_blank",rel:"noreferrer"},e.key)),React.createElement("td",{className:s.cellSummary,title:e.summary},e.summary||b),React.createElement("td",{className:s.tableCell},React.createElement("span",{className:s.priorityBadge},e.priority||b)),React.createElement("td",{className:s.tableCell},e.status||b),React.createElement("td",{className:s.tableCell},Bt(e.assignee)),React.createElement("td",{className:s.tableCell},x(e.ageDays)),React.createElement("td",{className:s.tableCell},x(e.updatedDays)))}function Bt(e){return e||React.createElement("span",{className:s.unassignedBadge},Nt)}function Mt(e){return`${kt}${encodeURIComponent(e)}`}function x(e){return`${e}d`}Ee.__docgenInfo={description:"Renders the standalone defect triage table and delegates stateful Jira work to `useDefectManagementState`.",methods:[],displayName:"DefectManagementView"};const jt=[u.get("/api/defects",()=>d.json({defects:[{key:"TBX-123",summary:"Login form fails on mobile Safari",priority:"High",status:"In Progress",assignee:"alice@example.com",ageDays:5,updatedDays:1},{key:"TBX-124",summary:"Database connection timeout",priority:"Highest",status:"New",assignee:"",ageDays:2,updatedDays:2}],rawIssueCount:42}))],Jt={title:"Components/DefectManagementView",component:Ee,parameters:{layout:"fullscreen",msw:{handlers:jt}}},g={parameters:{msw:{handlers:[u.get("/api/defects",()=>d.json({defects:[{key:"TBX-123",summary:"Login form fails on mobile Safari",priority:"High",status:"In Progress",assignee:"alice@example.com",ageDays:5,updatedDays:1},{key:"TBX-124",summary:"Database connection timeout",priority:"Highest",status:"New",assignee:"",ageDays:2,updatedDays:2}],rawIssueCount:42}))]}}},f={parameters:{msw:{handlers:[u.get("/api/defects",()=>d.json({defects:[],rawIssueCount:0}))]}},decorators:[e=>(localStorage.removeItem("defectManagement_projectKey"),React.createElement(e,null))]},h={parameters:{msw:{handlers:[u.get("/api/defects",async()=>(await new Promise(()=>{}),d.json({defects:[],rawIssueCount:0})))]}}},_={parameters:{msw:{handlers:[u.get("/api/defects",()=>d.json({error:"Unable to connect to Jira. Please check your credentials and network connection."},{status:500}))]}}},D={parameters:{msw:{handlers:[u.get("/api/defects",()=>d.json({defects:[],rawIssueCount:18}))]}}},E={parameters:{msw:{handlers:[u.get("/api/defects",()=>d.json({defects:[{key:"TBX-201",summary:"Checkout page crashes on iPad landscape mode",priority:"Highest",status:"New",assignee:"",ageDays:8,updatedDays:8},{key:"TBX-202",summary:"Email notifications not delivered after account creation",priority:"High",status:"New",assignee:"",ageDays:14,updatedDays:3},{key:"TBX-203",summary:"Search results return stale cached data",priority:"Medium",status:"In Progress",assignee:"",ageDays:6,updatedDays:1}],rawIssueCount:3}))]}}},w={parameters:{msw:{handlers:[u.get("/api/defects",()=>d.json({defects:[{key:"TBX-100",summary:"Application crashes on startup for Windows 7 users",priority:"Highest",status:"New",assignee:"",ageDays:21,updatedDays:21},{key:"TBX-101",summary:"Password reset link expires too quickly",priority:"High",status:"In Progress",assignee:"bob@example.com",ageDays:15,updatedDays:2},{key:"TBX-102",summary:"CSV export includes duplicate rows",priority:"High",status:"In Progress",assignee:"carol@example.com",ageDays:10,updatedDays:0},{key:"TBX-103",summary:"Dark mode toggle reverts after page refresh",priority:"Medium",status:"New",assignee:"dave@example.com",ageDays:7,updatedDays:5},{key:"TBX-104",summary:"Tooltip overlaps dropdown in admin panel",priority:"Low",status:"New",assignee:"",ageDays:30,updatedDays:30},{key:"TBX-105",summary:"API rate limiting not enforced on /search endpoint",priority:"Highest",status:"In Progress",assignee:"alice@example.com",ageDays:3,updatedDays:1},{key:"TBX-106",summary:"Notifications badge count incorrect after clearing",priority:"Medium",status:"New",assignee:"frank@example.com",ageDays:12,updatedDays:4},{key:"TBX-107",summary:"File upload silently fails for files over 50 MB",priority:"High",status:"New",assignee:"",ageDays:9,updatedDays:9}],rawIssueCount:87}))]}}};var A,H,v,J,X;g.parameters={...g.parameters,docs:{...(A=g.parameters)==null?void 0:A.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/defects', () => {
        return HttpResponse.json({
          defects: [{
            key: 'TBX-123',
            summary: 'Login form fails on mobile Safari',
            priority: 'High',
            status: 'In Progress',
            assignee: 'alice@example.com',
            ageDays: 5,
            updatedDays: 1
          }, {
            key: 'TBX-124',
            summary: 'Database connection timeout',
            priority: 'Highest',
            status: 'New',
            assignee: '',
            ageDays: 2,
            updatedDays: 2
          }],
          rawIssueCount: 42
        });
      })]
    }
  }
}`,...(v=(H=g.parameters)==null?void 0:H.docs)==null?void 0:v.source},description:{story:`Default happy-path story showing the defect management view with\r
realistic data loaded from the API.`,...(X=(J=g.parameters)==null?void 0:J.docs)==null?void 0:X.description}}};var U,O,q,K,F;f.parameters={...f.parameters,docs:{...(U=f.parameters)==null?void 0:U.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/defects', () => {
        return HttpResponse.json({
          defects: [],
          rawIssueCount: 0
        });
      })]
    }
  },
  // The component manages its own state; we use decorators to pre-set
  // initial conditions via localStorage or similar mechanisms if needed.
  decorators: [Story => {
    // Clear any cached project key so the component starts with an empty key
    localStorage.removeItem('defectManagement_projectKey');
    return <Story />;
  }]
}`,...(q=(O=f.parameters)==null?void 0:O.docs)==null?void 0:q.source},description:{story:`Edge case: The user has not yet entered a project key.\r
The view should prompt the user to provide one before loading defects.`,...(F=(K=f.parameters)==null?void 0:K.docs)==null?void 0:F.description}}};var V,$,Y,G,W;h.parameters={...h.parameters,docs:{...(V=h.parameters)==null?void 0:V.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/defects', async () => {
        // Delay forever to simulate a pending request
        await new Promise(() => {});
        return HttpResponse.json({
          defects: [],
          rawIssueCount: 0
        });
      })]
    }
  }
}`,...(Y=($=h.parameters)==null?void 0:$.docs)==null?void 0:Y.source},description:{story:`Edge case: API call is in progress. The reload button should be\r
disabled and a loading indicator should be visible.`,...(W=(G=h.parameters)==null?void 0:G.docs)==null?void 0:W.description}}};var z,Q,Z,ee,te;_.parameters={..._.parameters,docs:{...(z=_.parameters)==null?void 0:z.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/defects', () => {
        return HttpResponse.json({
          error: 'Unable to connect to Jira. Please check your credentials and network connection.'
        }, {
          status: 500
        });
      })]
    }
  }
}`,...(Z=(Q=_.parameters)==null?void 0:Q.docs)==null?void 0:Z.source},description:{story:`Edge case: The Jira API call failed. An error message should be\r
displayed to the user explaining that something went wrong.`,...(te=(ee=_.parameters)==null?void 0:ee.docs)==null?void 0:te.description}}};var ae,se,re,ne,oe;D.parameters={...D.parameters,docs:{...(ae=D.parameters)==null?void 0:ae.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/defects', () => {
        return HttpResponse.json({
          defects: [],
          rawIssueCount: 18
        });
      })]
    }
  }
}`,...(re=(se=D.parameters)==null?void 0:se.docs)==null?void 0:re.source},description:{story:`Edge case: The API returns issues, but after applying the active\r
filters (e.g. priority = High, statusCat = new, unassignedOnly = false)\r
the resulting defects array is empty.`,...(oe=(ne=D.parameters)==null?void 0:ne.docs)==null?void 0:oe.description}}};var ie,ce,le,ue,de;E.parameters={...E.parameters,docs:{...(ie=E.parameters)==null?void 0:ie.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/defects', () => {
        return HttpResponse.json({
          defects: [{
            key: 'TBX-201',
            summary: 'Checkout page crashes on iPad landscape mode',
            priority: 'Highest',
            status: 'New',
            assignee: '',
            ageDays: 8,
            updatedDays: 8
          }, {
            key: 'TBX-202',
            summary: 'Email notifications not delivered after account creation',
            priority: 'High',
            status: 'New',
            assignee: '',
            ageDays: 14,
            updatedDays: 3
          }, {
            key: 'TBX-203',
            summary: 'Search results return stale cached data',
            priority: 'Medium',
            status: 'In Progress',
            assignee: '',
            ageDays: 6,
            updatedDays: 1
          }],
          rawIssueCount: 3
        });
      })]
    }
  }
}`,...(le=(ce=E.parameters)==null?void 0:ce.docs)==null?void 0:le.source},description:{story:`Edge case: All defects in the list have no assignee (empty string).\r
The UI should gracefully render an "Unassigned" label or similar.`,...(de=(ue=E.parameters)==null?void 0:ue.docs)==null?void 0:de.description}}};var me,pe,ye,ge,fe;w.parameters={...w.parameters,docs:{...(me=w.parameters)==null?void 0:me.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/defects', () => {
        return HttpResponse.json({
          defects: [{
            key: 'TBX-100',
            summary: 'Application crashes on startup for Windows 7 users',
            priority: 'Highest',
            status: 'New',
            assignee: '',
            ageDays: 21,
            updatedDays: 21
          }, {
            key: 'TBX-101',
            summary: 'Password reset link expires too quickly',
            priority: 'High',
            status: 'In Progress',
            assignee: 'bob@example.com',
            ageDays: 15,
            updatedDays: 2
          }, {
            key: 'TBX-102',
            summary: 'CSV export includes duplicate rows',
            priority: 'High',
            status: 'In Progress',
            assignee: 'carol@example.com',
            ageDays: 10,
            updatedDays: 0
          }, {
            key: 'TBX-103',
            summary: 'Dark mode toggle reverts after page refresh',
            priority: 'Medium',
            status: 'New',
            assignee: 'dave@example.com',
            ageDays: 7,
            updatedDays: 5
          }, {
            key: 'TBX-104',
            summary: 'Tooltip overlaps dropdown in admin panel',
            priority: 'Low',
            status: 'New',
            assignee: '',
            ageDays: 30,
            updatedDays: 30
          }, {
            key: 'TBX-105',
            summary: 'API rate limiting not enforced on /search endpoint',
            priority: 'Highest',
            status: 'In Progress',
            assignee: 'alice@example.com',
            ageDays: 3,
            updatedDays: 1
          }, {
            key: 'TBX-106',
            summary: 'Notifications badge count incorrect after clearing',
            priority: 'Medium',
            status: 'New',
            assignee: 'frank@example.com',
            ageDays: 12,
            updatedDays: 4
          }, {
            key: 'TBX-107',
            summary: 'File upload silently fails for files over 50 MB',
            priority: 'High',
            status: 'New',
            assignee: '',
            ageDays: 9,
            updatedDays: 9
          }],
          rawIssueCount: 87
        });
      })]
    }
  }
}`,...(ye=(pe=w.parameters)==null?void 0:pe.docs)==null?void 0:ye.source},description:{story:`Shows a large list of defects with mixed priorities, statuses, and\r
assignees to validate list rendering, sort order, and pagination.`,...(fe=(ge=w.parameters)==null?void 0:ge.docs)==null?void 0:fe.description}}};const Xt=["Default","EmptyProjectKey","LoadingState","ErrorState","NoResults","UnassignedDefects","LargeDataset"];export{g as Default,f as EmptyProjectKey,_ as ErrorState,w as LargeDataset,h as LoadingState,D as NoResults,E as UnassignedDefects,Xt as __namedExportsOrder,Jt as default};
