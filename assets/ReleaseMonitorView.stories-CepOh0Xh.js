import{h as k}from"./index-B5IrvpLZ.js";import{r as n}from"./index-Bc2G9s8g.js";import{j as K}from"./jiraApi-Zc4wcNPg.js";import{H as b}from"./cookieStore-CKwAPFhE.js";const D=0,We=100,qe=new Set(["highest","critical"]);function Qe(e,s=je()){return e?e.released?"released":e.releaseDate&&e.releaseDate<s?"overdue":"on-track":"unknown"}function Ze(e){var l;const s=((l=e.priorityName)==null?void 0:l.trim().toLowerCase())??"",a=qe.has(s),r=(e.labels??[]).some(o=>o.trim().toLowerCase()==="blocker");return a||r}function es(e,s=je()){return!e.duedate||e.statusCategoryKey==="done"?!1:e.duedate<s}function ss(e){const s=e.length,a=e.filter(r=>r.statusCategoryKey==="done").length;return{total:s,done:a,completionPct:ts(a,s),blockers:e.filter(r=>r.isBlocker).length,overdue:e.filter(r=>r.isOverdue).length}}function ts(e,s){return s===D?D:Math.round(e/s*We)}function je(){return new Date().toISOString().slice(0,10)}const as="summary,status,assignee,priority,issuetype,duedate,labels",rs=200,ns="tbxReleaseMonitorState",j="Failed to load release monitor data.",os="Enter both a Jira project key and fixVersion before loading release issues.",is="Enter a Jira project key before fetching fixVersions.",Ue=ns;function cs(e){return`/rest/api/2/project/${encodeURIComponent(e)}/versions`}function ls(e,s){const a=`project=${e} AND fixVersion="${s}"`;return`/rest/api/2/search?jql=${encodeURIComponent(a)}&fields=${as}&maxResults=${rs}`}function us(){const[e]=n.useState(()=>ps()),[s,a]=n.useState(e.projectKey),[r,l]=n.useState(e.fixVersion),[o,m]=n.useState([]),[p,y]=n.useState([]),[V,C]=n.useState(!1),[Je,f]=n.useState(null);n.useEffect(()=>{ys({projectKey:s,fixVersion:r})},[r,s]);const x=n.useMemo(()=>o.find(u=>u.name===r.trim())??null,[r,o]),Fe=n.useMemo(()=>Qe(x),[x]),Ge=n.useMemo(()=>ss(p),[p]),Ye=n.useCallback(async()=>{const u=U(s);if(!u){f(is),m([]);return}C(!0),f(null);try{const g=await K(cs(u));m(g.filter(_=>!_.archived))}catch(g){m([]),f(X(g,j))}finally{C(!1)}},[s]),ze=n.useCallback(async()=>{const u=U(s),g=r.trim();if(!u||!g){f(os),y([]);return}C(!0),f(null);try{const _=await K(ls(u,g));y((_.issues??[]).map($e=>ds($e)))}catch(_){y([]),f(X(_,j))}finally{C(!1)}},[r,s]);return{projectKey:s,setProjectKey:a,fixVersion:r,setFixVersion:l,isLoading:V,errorMessage:Je,versions:o,selectedVersion:x,releaseStatus:Fe,issues:p,stats:Ge,loadVersions:Ye,loadIssues:ze}}function ds(e){var o,m,p,y,V;const s=e.fields??{},a=ms((m=(o=s.status)==null?void 0:o.statusCategory)==null?void 0:m.key),r=((p=s.priority)==null?void 0:p.name)??"None",l={key:e.key,summary:s.summary??"Untitled Jira issue",statusName:((y=s.status)==null?void 0:y.name)??"Unknown",statusCategoryKey:a,assigneeName:((V=s.assignee)==null?void 0:V.displayName)??null,priorityName:r,duedate:s.duedate??null,isBlocker:!1,isOverdue:!1};return{...l,isBlocker:Ze({priorityName:r,labels:s.labels??[]}),isOverdue:es(l)}}function ms(e){return e==="new"||e==="indeterminate"||e==="done"?e:"unknown"}function U(e){return e.trim().toUpperCase()}function ps(){if(typeof window>"u")return O();try{const e=window.localStorage.getItem(Ue);return e?fs(JSON.parse(e)):O()}catch{return O()}}function ys(e){typeof window>"u"||window.localStorage.setItem(Ue,JSON.stringify(e))}function fs(e){return gs(e)?{projectKey:typeof e.projectKey=="string"?e.projectKey:"",fixVersion:typeof e.fixVersion=="string"?e.fixVersion:""}:O()}function O(){return{projectKey:"",fixVersion:""}}function gs(e){return typeof e=="object"&&e!==null}function X(e,s){return e instanceof Error?e.message:s}const ks="_releaseMonitorView_17e0b_5",bs="_pageHeader_17e0b_25",_s="_pageTitle_17e0b_39",Ns="_pageSubtitle_17e0b_51",Es="_controlsPanel_17e0b_63",hs="_fieldLabel_17e0b_85",Rs="_controlInput_17e0b_103",vs="_buttonRow_17e0b_123",Ss="_button_17e0b_123",ws="_buttonPrimary_17e0b_167 _button_17e0b_123",Is="_statsBar_17e0b_193",Ts="_statTile_17e0b_205",Bs="_statusReleased_17e0b_241",Vs="_statusOverdue_17e0b_243",Cs="_statusOnTrack_17e0b_245",Ps="_statusUnknown_17e0b_247",Os="_errorMessage_17e0b_313",Ls="_emptyState_17e0b_325",xs="_boardGrid_17e0b_341",Hs="_boardColumn_17e0b_357",Ms="_columnHeader_17e0b_375",As="_issueList_17e0b_411",Ks="_issueCard_17e0b_423",Ds="_issueHeader_17e0b_443",js="_issueMeta_17e0b_445",Us="_riskRow_17e0b_447",Xs="_issueKey_17e0b_469",Js="_issueSummary_17e0b_481",Fs="_statusBadge_17e0b_503",Gs="_blockerBadge_17e0b_505",Ys="_overdueBadge_17e0b_507",t={releaseMonitorView:ks,pageHeader:bs,pageTitle:_s,pageSubtitle:Ns,controlsPanel:Es,fieldLabel:hs,controlInput:Rs,buttonRow:vs,button:Ss,buttonPrimary:ws,statsBar:Is,statTile:Ts,statusReleased:Bs,statusOverdue:Vs,statusOnTrack:Cs,statusUnknown:Ps,errorMessage:Os,emptyState:Ls,boardGrid:xs,boardColumn:Hs,columnHeader:Ms,issueList:As,issueCard:Ks,issueHeader:Ds,issueMeta:js,riskRow:Us,issueKey:Xs,issueSummary:Js,statusBadge:Fs,blockerBadge:Gs,overdueBadge:Ys},J="Release Monitor",zs="Track a Jira fixVersion by completion, blockers, overdue work, and release date risk.",$s="Enter a Jira project key and fixVersion to monitor a release.",Ws="Loading release monitor data…",qs="No Jira issues were returned for this fixVersion.",Qs="Unassigned",Zs="No due date",et=100,L=0,st=[{key:"new",label:"To Do",accent:"#64748b"},{key:"indeterminate",label:"In Progress",accent:"#3b82f6"},{key:"done",label:"Done",accent:"#22c55e"}],tt={"on-track":"ON TRACK",overdue:"OVERDUE",released:"RELEASED",unknown:"UNKNOWN"};function Xe(){const e=us(),s=n.useMemo(()=>lt(e.issues),[e.issues]),a=!!(e.projectKey.trim()&&e.fixVersion.trim()),r=e.issues.length>L;return React.createElement("section",{className:t.releaseMonitorView,"aria-label":J},React.createElement("header",{className:t.pageHeader},React.createElement("div",null,React.createElement("h1",{className:t.pageTitle},J),React.createElement("p",{className:t.pageSubtitle},zs)),ot(e.releaseStatus)),at(e),nt(e),e.errorMessage&&React.createElement("p",{className:t.errorMessage,role:"alert"},"⚠ ",e.errorMessage),e.isLoading&&React.createElement("div",{className:t.emptyState},Ws),!e.isLoading&&!a&&React.createElement("div",{className:t.emptyState},$s),!e.isLoading&&a&&!r&&React.createElement("div",{className:t.emptyState},qs),!e.isLoading&&r&&it(s,e.issues.length))}function at(e){return React.createElement("div",{className:t.controlsPanel},React.createElement("label",{className:t.fieldLabel},"Project key",React.createElement("input",{className:t.controlInput,"aria-label":"Project key",placeholder:"Project key (e.g. TBX)",value:e.projectKey,onChange:s=>e.setProjectKey(s.target.value)})),React.createElement("label",{className:t.fieldLabel},"FixVersion",React.createElement("input",{className:t.controlInput,"aria-label":"FixVersion",placeholder:"FixVersion name (e.g. 0.6.1)",value:e.fixVersion,onChange:s=>e.setFixVersion(s.target.value)})),e.versions.length>L&&rt(e),React.createElement("div",{className:t.buttonRow},React.createElement("button",{type:"button",className:t.button,disabled:e.isLoading,onClick:()=>{e.loadVersions()}},"Auto-fetch fixVersions for project"),React.createElement("button",{type:"button",className:t.buttonPrimary,disabled:e.isLoading,onClick:()=>{e.loadIssues()}},e.isLoading?"Loading…":"Refresh")))}function rt(e){return React.createElement("label",{className:t.fieldLabel},"Available fixVersions",React.createElement("select",{className:t.controlInput,"aria-label":"Available fixVersions",value:e.fixVersion,onChange:s=>e.setFixVersion(s.target.value)},React.createElement("option",{value:""},"Select a fixVersion…"),e.versions.map(s=>React.createElement("option",{key:s.id,value:s.name},s.name," — ",s.releaseDate??"No release date"," — ",s.released?"released":"unreleased"))))}function nt(e){return React.createElement("div",{className:t.statsBar,"aria-label":"Release stats"},P("Total issues",e.stats.total),P("Done",`${e.stats.done} (${e.stats.completionPct}%)`),P("Blockers",e.stats.blockers),P("Overdue",e.stats.overdue))}function P(e,s){return React.createElement("div",{className:t.statTile},React.createElement("strong",null,s),React.createElement("span",null,e))}function ot(e){return React.createElement("span",{className:mt(e)},tt[e])}function it(e,s){return React.createElement("div",{className:t.boardGrid,"aria-label":"Release status groups"},e.map(a=>React.createElement("section",{key:a.key,className:t.boardColumn,style:{"--column-accent":a.accent},"aria-label":a.label},React.createElement("header",{className:t.columnHeader},React.createElement("h2",null,a.label),React.createElement("span",null,a.issues.length," · ",dt(a.issues.length,s),"%")),React.createElement("div",{className:t.issueList},a.issues.map(r=>ct(r))))))}function ct(e){return React.createElement("article",{key:e.key,className:t.issueCard},React.createElement("div",{className:t.issueHeader},React.createElement("span",{className:t.issueKey},e.key),React.createElement("span",{className:t.statusBadge},e.statusName)),React.createElement("h3",{className:t.issueSummary},e.summary),React.createElement("div",{className:t.issueMeta},React.createElement("span",null,"🧑 ",e.assigneeName??Qs),React.createElement("span",null,e.priorityName),React.createElement("span",null,e.duedate??Zs)),(e.isBlocker||e.isOverdue)&&React.createElement("div",{className:t.riskRow},e.isBlocker&&React.createElement("span",{className:t.blockerBadge},"Blocker"),e.isOverdue&&React.createElement("span",{className:t.overdueBadge},"Overdue")))}function lt(e){return st.map(s=>({...s,issues:e.filter(a=>ut(a.statusCategoryKey)===s.key)}))}function ut(e){return e==="unknown"?"new":e}function dt(e,s){return s===L?L:Math.round(e/s*et)}function mt(e){return e==="released"?t.statusReleased:e==="overdue"?t.statusOverdue:e==="on-track"?t.statusOnTrack:t.statusUnknown}Xe.__docgenInfo={description:"Renders the simplified Release Monitor and delegates Jira state to its hook.",methods:[],displayName:"ReleaseMonitorView"};const Et={title:"Components/ReleaseMonitorView",component:Xe,parameters:{layout:"fullscreen"}},i=e=>k.get("/api/versions",()=>b.json({versions:e})),c=(e,s,a)=>k.get("/api/issues",()=>b.json({issues:e,stats:s,releaseStatus:a})),pt=()=>k.get("/api/issues",()=>b.json({message:"Failed to connect to Jira API. Check credentials and try again."},{status:500})),yt=()=>k.get("/api/versions",()=>b.json({message:"Project not found or access denied."},{status:404})),d=[{id:"1",name:"0.6.1",releaseDate:"2024-01-20",released:!1},{id:"2",name:"0.6.0",releaseDate:"2024-01-10",released:!0},{id:"3",name:"0.5.9",releaseDate:"2023-12-15",released:!0}],H=[{key:"TBX-123",summary:"Fix critical bug in auth flow",assigneeName:"Alice Johnson",priorityName:"Highest",statusName:"In Progress",statusCategoryKey:"indeterminate",duedate:"2024-01-15",isBlocker:!0,isOverdue:!1},{key:"TBX-124",summary:"Update API documentation",assigneeName:null,priorityName:"Low",statusName:"To Do",statusCategoryKey:"new",duedate:null,isBlocker:!1,isOverdue:!1},{key:"TBX-125",summary:"Prepare release notes",assigneeName:"Bob Smith",priorityName:"Medium",statusName:"Done",statusCategoryKey:"done",duedate:"2024-01-10",isBlocker:!1,isOverdue:!0}],M={total:10,done:6,completionPct:60,blockers:1,overdue:2},ft=[{key:"TBX-200",summary:"Fix critical security vulnerability in session handling",assigneeName:"Carol White",priorityName:"Highest",statusName:"In Progress",statusCategoryKey:"indeterminate",duedate:"2024-01-05",isBlocker:!0,isOverdue:!0},{key:"TBX-201",summary:"Resolve data migration rollback issue",assigneeName:"David Lee",priorityName:"High",statusName:"In Progress",statusCategoryKey:"indeterminate",duedate:"2024-01-08",isBlocker:!0,isOverdue:!0},{key:"TBX-202",summary:"Update third-party payment SDK to v3.2",assigneeName:"Emma Davis",priorityName:"High",statusName:"In Review",statusCategoryKey:"indeterminate",duedate:"2024-01-18",isBlocker:!0,isOverdue:!1},{key:"TBX-203",summary:"Write integration tests for checkout flow",assigneeName:null,priorityName:"Medium",statusName:"To Do",statusCategoryKey:"new",duedate:"2024-01-12",isBlocker:!1,isOverdue:!0},{key:"TBX-204",summary:"Refactor order summary component",assigneeName:"Frank Moore",priorityName:"Low",statusName:"Done",statusCategoryKey:"done",duedate:"2024-01-09",isBlocker:!1,isOverdue:!1},{key:"TBX-205",summary:"Add dark mode support to dashboard",assigneeName:"Grace Kim",priorityName:"Medium",statusName:"To Do",statusCategoryKey:"new",duedate:null,isBlocker:!1,isOverdue:!1}],gt={total:15,done:4,completionPct:27,blockers:3,overdue:4},A={total:0,done:0,completionPct:0,blockers:0,overdue:0},N={parameters:{msw:{handlers:[i(d),c(H,M,"on-track")]}}},E={parameters:{msw:{handlers:[i([]),c([],A,"unknown")]}}},h={parameters:{msw:{handlers:[k.get("/api/versions",async()=>(await new Promise(e=>setTimeout(e,6e4)),b.json({versions:d}))),k.get("/api/issues",async()=>(await new Promise(e=>setTimeout(e,6e4)),b.json({issues:H,stats:M,releaseStatus:"on-track"})))]}}},R={parameters:{msw:{handlers:[i(d),c([],A,"on-track")]}}},v={parameters:{msw:{handlers:[i(d),pt()]}}},S={parameters:{msw:{handlers:[i([]),c(H,M,"on-track")]}}},w={parameters:{msw:{handlers:[yt(),c([],A,"unknown")]}}},I={parameters:{msw:{handlers:[i(d),c(ft,gt,"at-risk")]}}},T={parameters:{msw:{handlers:[i(d),c([{key:"TBX-300",summary:"Implement user profile page",assigneeName:"Hannah Scott",priorityName:"High",statusName:"Done",statusCategoryKey:"done",duedate:"2024-01-18",isBlocker:!1,isOverdue:!1},{key:"TBX-301",summary:"Add export to CSV feature",assigneeName:"Ivan Turner",priorityName:"Medium",statusName:"Done",statusCategoryKey:"done",duedate:"2024-01-16",isBlocker:!1,isOverdue:!1},{key:"TBX-302",summary:"Fix timezone offset on reporting dashboard",assigneeName:"Julia Chen",priorityName:"High",statusName:"Done",statusCategoryKey:"done",duedate:"2024-01-14",isBlocker:!1,isOverdue:!1}],{total:8,done:8,completionPct:100,blockers:0,overdue:0},"complete")]}}},B={parameters:{msw:{handlers:[i(d),c([{key:"TBX-999",summary:"P0: Database connection pool exhaustion under load",assigneeName:"Marcus Reed",priorityName:"Highest",statusName:"In Progress",statusCategoryKey:"indeterminate",duedate:"2024-01-01",isBlocker:!0,isOverdue:!0}],{total:12,done:11,completionPct:92,blockers:1,overdue:1},"blocked")]}}};var F,G,Y,z,$;N.parameters={...N.parameters,docs:{...(F=N.parameters)==null?void 0:F.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [makeVersionsHandler(defaultVersions), makeIssuesHandler(defaultIssues, defaultStats, 'on-track')]
    }
  }
}`,...(Y=(G=N.parameters)==null?void 0:G.docs)==null?void 0:Y.source},description:{story:"Default happy-path story — project TBX, version 0.6.1 loaded with real issues.",...($=(z=N.parameters)==null?void 0:z.docs)==null?void 0:$.description}}};var W,q,Q,Z,ee;E.parameters={...E.parameters,docs:{...(W=E.parameters)==null?void 0:W.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [makeVersionsHandler([]), makeIssuesHandler([], noIssuesStats, 'unknown')]
    }
  }
}`,...(Q=(q=E.parameters)==null?void 0:q.docs)==null?void 0:Q.source},description:{story:`Empty state — user hasn't entered a project key or fix version yet.\r
API endpoints return empty to simulate a cold start.`,...(ee=(Z=E.parameters)==null?void 0:Z.docs)==null?void 0:ee.description}}};var se,te,ae,re,ne;h.parameters={...h.parameters,docs:{...(se=h.parameters)==null?void 0:se.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/versions', async () => {
        await new Promise(resolve => setTimeout(resolve, 60_000));
        return HttpResponse.json({
          versions: defaultVersions
        });
      }), http.get('/api/issues', async () => {
        await new Promise(resolve => setTimeout(resolve, 60_000));
        return HttpResponse.json({
          issues: defaultIssues,
          stats: defaultStats,
          releaseStatus: 'on-track'
        });
      })]
    }
  }
}`,...(ae=(te=h.parameters)==null?void 0:te.docs)==null?void 0:ae.source},description:{story:"Loading state — simulates slow network by delaying MSW responses.",...(ne=(re=h.parameters)==null?void 0:re.docs)==null?void 0:ne.description}}};var oe,ie,ce,le,ue;R.parameters={...R.parameters,docs:{...(oe=R.parameters)==null?void 0:oe.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [makeVersionsHandler(defaultVersions), makeIssuesHandler([], noIssuesStats, 'on-track')]
    }
  }
}`,...(ce=(ie=R.parameters)==null?void 0:ie.docs)==null?void 0:ce.source},description:{story:`No issues returned — project key and fix version are valid but Jira returns\r
an empty list (e.g. all tickets filtered out or none created yet).`,...(ue=(le=R.parameters)==null?void 0:le.docs)==null?void 0:ue.description}}};var de,me,pe,ye,fe;v.parameters={...v.parameters,docs:{...(de=v.parameters)==null?void 0:de.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [makeVersionsHandler(defaultVersions), makeErrorHandler()]
    }
  }
}`,...(pe=(me=v.parameters)==null?void 0:me.docs)==null?void 0:pe.source},description:{story:"Error state — API call fails with a 500 and an error message is shown.",...(fe=(ye=v.parameters)==null?void 0:ye.docs)==null?void 0:fe.description}}};var ge,ke,be,_e,Ne;S.parameters={...S.parameters,docs:{...(ge=S.parameters)==null?void 0:ge.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [makeVersionsHandler([]), makeIssuesHandler(defaultIssues, defaultStats, 'on-track')]
    }
  }
}`,...(be=(ke=S.parameters)==null?void 0:ke.docs)==null?void 0:be.source},description:{story:`No versions available — auto-fetch for the project returns an empty version list.\r
User must type a version manually or the project has no fix versions configured.`,...(Ne=(_e=S.parameters)==null?void 0:_e.docs)==null?void 0:Ne.description}}};var Ee,he,Re,ve,Se;w.parameters={...w.parameters,docs:{...(Ee=w.parameters)==null?void 0:Ee.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [makeVersionsErrorHandler(), makeIssuesHandler([], noIssuesStats, 'unknown')]
    }
  }
}`,...(Re=(he=w.parameters)==null?void 0:he.docs)==null?void 0:Re.source},description:{story:`No versions error — Jira returns an error when fetching versions for the project\r
(e.g. the project key is incorrect or the user lacks permissions).`,...(Se=(ve=w.parameters)==null?void 0:ve.docs)==null?void 0:Se.description}}};var we,Ie,Te,Be,Ve;I.parameters={...I.parameters,docs:{...(we=I.parameters)==null?void 0:we.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [makeVersionsHandler(defaultVersions), makeIssuesHandler(mixedRiskIssues, mixedRiskStats, 'at-risk')]
    }
  }
}`,...(Te=(Ie=I.parameters)==null?void 0:Ie.docs)==null?void 0:Te.source},description:{story:`Mixed risk states — several issues are blockers, several are overdue,\r
and some are both. Overall status shows at-risk.`,...(Ve=(Be=I.parameters)==null?void 0:Be.docs)==null?void 0:Ve.description}}};var Ce,Pe,Oe,Le,xe;T.parameters={...T.parameters,docs:{...(Ce=T.parameters)==null?void 0:Ce.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [makeVersionsHandler(defaultVersions), makeIssuesHandler([{
        key: 'TBX-300',
        summary: 'Implement user profile page',
        assigneeName: 'Hannah Scott',
        priorityName: 'High',
        statusName: 'Done',
        statusCategoryKey: 'done',
        duedate: '2024-01-18',
        isBlocker: false,
        isOverdue: false
      }, {
        key: 'TBX-301',
        summary: 'Add export to CSV feature',
        assigneeName: 'Ivan Turner',
        priorityName: 'Medium',
        statusName: 'Done',
        statusCategoryKey: 'done',
        duedate: '2024-01-16',
        isBlocker: false,
        isOverdue: false
      }, {
        key: 'TBX-302',
        summary: 'Fix timezone offset on reporting dashboard',
        assigneeName: 'Julia Chen',
        priorityName: 'High',
        statusName: 'Done',
        statusCategoryKey: 'done',
        duedate: '2024-01-14',
        isBlocker: false,
        isOverdue: false
      }], {
        total: 8,
        done: 8,
        completionPct: 100,
        blockers: 0,
        overdue: 0
      }, 'complete')]
    }
  }
}`,...(Oe=(Pe=T.parameters)==null?void 0:Pe.docs)==null?void 0:Oe.source},description:{story:"Release complete — all issues done, completion at 100%, no blockers or overdue.",...(xe=(Le=T.parameters)==null?void 0:Le.docs)==null?void 0:xe.description}}};var He,Me,Ae,Ke,De;B.parameters={...B.parameters,docs:{...(He=B.parameters)==null?void 0:He.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [makeVersionsHandler(defaultVersions), makeIssuesHandler([{
        key: 'TBX-999',
        summary: 'P0: Database connection pool exhaustion under load',
        assigneeName: 'Marcus Reed',
        priorityName: 'Highest',
        statusName: 'In Progress',
        statusCategoryKey: 'indeterminate',
        duedate: '2024-01-01',
        isBlocker: true,
        isOverdue: true
      }], {
        total: 12,
        done: 11,
        completionPct: 92,
        blockers: 1,
        overdue: 1
      }, 'blocked')]
    }
  }
}`,...(Ae=(Me=B.parameters)==null?void 0:Me.docs)==null?void 0:Ae.source},description:{story:`Single blocker — only one issue exists and it is a critical blocker that is\r
also overdue, putting the release in a critical state.`,...(De=(Ke=B.parameters)==null?void 0:Ke.docs)==null?void 0:De.description}}};const ht=["Default","EmptyStateNoInputs","LoadingState","NoIssuesReturned","ErrorState","NoVersionsAvailable","VersionsFetchError","MixedRiskStates","ReleaseComplete","SingleCriticalBlocker"];export{N as Default,E as EmptyStateNoInputs,v as ErrorState,h as LoadingState,I as MixedRiskStates,R as NoIssuesReturned,S as NoVersionsAvailable,T as ReleaseComplete,B as SingleCriticalBlocker,w as VersionsFetchError,ht as __namedExportsOrder,Et as default};
