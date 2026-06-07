import{h as n}from"./index-B5IrvpLZ.js";import{r as c}from"./index-Bc2G9s8g.js";import{j as Oe,b as He}from"./jiraApi-Zc4wcNPg.js";import{H as a}from"./cookieStore-CKwAPFhE.js";const Ie="statusCategory != Done AND sprint is EMPTY ORDER BY priority DESC, created DESC",Ne=100,Ke=["summary","status","priority","issuetype","assignee","customfield_10016","customfield_10028"].join(","),N="customfield_10028",K="customfield_10016",G=0,Q=100;function Je(e,s){return s.some(l=>{const t=l.fields[N],i=l.fields[K];return typeof t=="number"&&typeof i!="number"})?N:K}function Me(e){switch(e.toLowerCase()){case"highest":case"blocker":return"#e11d48";case"high":case"critical":return"#f97316";case"medium":return"#f59e0b";case"low":return"#22c55e";case"lowest":return"#6b7280";default:return"#6b7280"}}function Ye(e){const s=e.toLowerCase();return s==="story"?"📗":s==="bug"?"🐛":s==="task"?"✅":s==="epic"?"⚡":s==="subtask"||s==="sub-task"?"🔹":"📄"}function xe(e){const s=Number(e);return!Number.isFinite(s)||s<G?G:s>Q?Q:Math.round(s)}function Z(e,s){const p=e[s];return typeof p=="number"?p:0}function Fe(e){return e.trim()?`project = ${e.trim()} AND statusCategory != Done AND sprint is EMPTY ORDER BY priority DESC, created DESC`:Ie}function Ae(e){return`/rest/api/2/search?jql=${encodeURIComponent(Fe(e))}&maxResults=${Ne}&fields=${Ke}`}function De(e){var i,u,d;const s=e.fields??{},p=Z(s,N),l=Z(s,K),t=p||l;return{key:e.key,summary:s.summary??"",issueType:((i=s.issuetype)==null?void 0:i.name)??"",priority:((u=s.priority)==null?void 0:u.name)??"",assignee:((d=s.assignee)==null?void 0:d.displayName)??"",storyPoints:t}}function ze(){const[e,s]=c.useState(""),[p,l]=c.useState(""),[t,i]=c.useState([]),[u,d]=c.useState([]),[g,_]=c.useState({}),[J,M]=c.useState(!1),[Y,x]=c.useState(!1),[F,A]=c.useState(null),[D,b]=c.useState(null),[z,O]=c.useState([]),V=c.useCallback(async()=>{M(!0),A(null);try{const S=(await Oe(Ae(e))).issues??[];d(S),i(S.map(De)),_({}),O([]),b(null)}catch(m){const S=m instanceof Error?m.message:"Failed to load backlog";A(S),i([]),d([])}finally{M(!1)}},[e]),U=c.useCallback((m,S)=>{const y=xe(S);_(H=>({...H,[m]:y}))},[]),X=c.useCallback(async()=>{const m=Object.keys(g);if(m.length===0)return;x(!0),b(`Saving ${m.length} change${m.length===1?"":"s"}…`);const S=Je(t,u),y=[];await Promise.all(m.map(async h=>{try{await He(`/rest/api/2/issue/${encodeURIComponent(h)}`,{fields:{[S]:g[h]}})}catch{y.push(h)}}));const H=m.length-y.length;y.length>0?b(`⚠ Saved ${H}, failed: ${y.join(", ")}`):b("✅ All changes saved"),O(y),i(h=>h.map(E=>y.includes(E.key)||g[E.key]===void 0?E:{...E,storyPoints:g[E.key]})),_(h=>{const E={};for(const I of y)h[I]!==void 0&&(E[I]=h[I]);return E}),x(!1)},[g,t,u]),W=c.useCallback(()=>{_({}),O([]),b(null)},[]),q=c.useCallback(m=>{s(m)},[]);return c.useMemo(()=>({projectKey:e,searchText:p,backlog:t,pendingChanges:g,isLoading:J,isSaving:Y,loadError:F,saveStatusMessage:D,failedSaveKeys:z,setProjectKey:q,setSearchText:l,loadBacklog:V,setStoryPoints:U,saveChanges:X,resetPendingChanges:W}),[e,p,t,g,J,Y,F,D,z,q,l,V,U,X,W])}const Ve="_sprintPlanningView_d9vvy_5",Ue="_pageHeader_d9vvy_25",Xe="_pageTitle_d9vvy_33",We="_pageSubtitle_d9vvy_45",qe="_controlsRow_d9vvy_57",Ge="_controlInput_d9vvy_79",Qe="_button_d9vvy_101",Ze="_buttonPrimary_d9vvy_129 _button_d9vvy_101",et="_summaryBar_d9vvy_155",tt="_statusMessage_d9vvy_173",st="_errorMessage_d9vvy_185",nt="_tableScroll_d9vvy_195",at="_table_d9vvy_195",rt="_tableHeader_d9vvy_221",ot="_tableRow_d9vvy_247",it="_tableRowChanged_d9vvy_255 _tableRow_d9vvy_247",ct="_tableCell_d9vvy_265",pt="_cellMonospace_d9vvy_275 _tableCell_d9vvy_265",lt="_cellSummary_d9vvy_287 _tableCell_d9vvy_265",ut="_priorityBadge_d9vvy_303",mt="_pointsInput_d9vvy_317",gt="_emptyState_d9vvy_337",o={sprintPlanningView:Ve,pageHeader:Ue,pageTitle:Xe,pageSubtitle:We,controlsRow:qe,controlInput:Ge,button:Qe,buttonPrimary:Ze,summaryBar:et,statusMessage:tt,errorMessage:st,tableScroll:nt,table:at,tableHeader:rt,tableRow:ot,tableRowChanged:it,tableCell:ct,cellMonospace:pt,cellSummary:lt,priorityBadge:ut,pointsInput:mt,emptyState:gt},ee="Sprint Planning",dt="Pull the open backlog for any Jira project, point stories inline, and persist your edits in one click.",yt="Project key (e.g. TBX) — leave blank for cross-project default",ht="Filter loaded backlog by key or summary…",te=["","Key","Summary","Priority","Assignee","Points"];function Le(){const e=ze(),s=c.useMemo(()=>{const t=e.searchText.trim().toLowerCase();return t?e.backlog.filter(i=>i.key.toLowerCase().includes(t)||i.summary.toLowerCase().includes(t)):e.backlog},[e.backlog,e.searchText]),p=c.useMemo(()=>s.reduce((t,i)=>{const d=e.pendingChanges[i.key]??i.storyPoints;return t+d},0),[s,e.pendingChanges]),l=Object.keys(e.pendingChanges).length>0;return React.createElement("section",{className:o.sprintPlanningView,"aria-label":ee},React.createElement("header",{className:o.pageHeader},React.createElement("h1",{className:o.pageTitle},ee),React.createElement("p",{className:o.pageSubtitle},dt)),React.createElement("div",{className:o.controlsRow},React.createElement("input",{className:o.controlInput,"aria-label":"Jira project key",placeholder:yt,value:e.projectKey,onChange:t=>e.setProjectKey(t.target.value)}),React.createElement("button",{type:"button",className:o.buttonPrimary,disabled:e.isLoading,onClick:()=>{e.loadBacklog()}},e.isLoading?"Loading…":"↻ Load Backlog"),React.createElement("input",{className:o.controlInput,"aria-label":"Filter loaded backlog",placeholder:ht,value:e.searchText,onChange:t=>e.setSearchText(t.target.value)}),React.createElement("button",{type:"button",className:o.button,disabled:!l||e.isSaving,onClick:e.resetPendingChanges},"✕ Discard"),React.createElement("button",{type:"button",className:o.buttonPrimary,disabled:!l||e.isSaving,onClick:()=>{e.saveChanges()}},e.isSaving?"Saving…":"💾 Save Changes")),React.createElement("div",{className:o.summaryBar},React.createElement("span",null,s.length," issue",s.length===1?"":"s"," · ",p," pts"),l&&React.createElement("span",{"aria-label":"Pending changes count"},Object.keys(e.pendingChanges).length," pending edit",Object.keys(e.pendingChanges).length===1?"":"s")),e.loadError&&React.createElement("p",{className:o.errorMessage,role:"alert"},"⚠ ",e.loadError),e.saveStatusMessage&&React.createElement("p",{className:o.statusMessage,"aria-live":"polite"},e.saveStatusMessage),React.createElement("div",{className:o.tableScroll},React.createElement("table",{className:o.table},React.createElement("thead",null,React.createElement("tr",{className:o.tableHeader},te.map((t,i)=>React.createElement("th",{key:t||`column-${i}`},t)))),React.createElement("tbody",null,s.length===0?React.createElement("tr",null,React.createElement("td",{colSpan:te.length,className:o.emptyState},e.backlog.length===0?"Load a backlog to start planning.":"No issues match your filter.")):s.map(t=>{const i=e.pendingChanges[t.key],u=i??t.storyPoints,d=i!==void 0,g=Me(t.priority);return React.createElement("tr",{key:t.key,className:d?o.tableRowChanged:o.tableRow},React.createElement("td",{className:o.tableCell},Ye(t.issueType)),React.createElement("td",{className:o.cellMonospace},t.key),React.createElement("td",{className:o.cellSummary,title:t.summary},t.summary),React.createElement("td",{className:o.tableCell},React.createElement("span",{className:o.priorityBadge,style:{background:`${g}22`,color:g,border:`1px solid ${g}44`}},t.priority||"—")),React.createElement("td",{className:o.tableCell},t.assignee||"—"),React.createElement("td",{className:o.tableCell},React.createElement("input",{type:"number",min:0,max:100,className:o.pointsInput,"aria-label":`Story points for ${t.key}`,value:u,onChange:_=>e.setStoryPoints(t.key,_.target.value)})))})))))}Le.__docgenInfo={description:"",methods:[],displayName:"SprintPlanningView"};const r="TBX",j=[{key:"TBX-123",summary:"Fix login button layout issue",issueType:"Bug",priority:"High",assignee:"Alice Johnson",storyPoints:5},{key:"TBX-124",summary:"Add export to PDF feature",issueType:"Story",priority:"Medium",assignee:"Bob Smith",storyPoints:8},{key:"TBX-125",summary:"Improve dashboard load time",issueType:"Task",priority:"High",assignee:"Carol White",storyPoints:3},{key:"TBX-126",summary:"Fix broken pagination on reports page",issueType:"Bug",priority:"Critical",assignee:"David Lee",storyPoints:2},{key:"TBX-127",summary:"Add dark mode toggle to settings",issueType:"Story",priority:"Low",assignee:"Alice Johnson",storyPoints:5}],v={id:"sprint-42",name:"Sprint 42",startDate:"2024-03-04",endDate:"2024-03-18",goal:"Stabilize authentication flow and improve reporting"},vt=[n.get(`/api/projects/${r}/backlog`,()=>a.json({issues:j})),n.get(`/api/projects/${r}/sprint/active`,()=>a.json({sprint:v})),n.post(`/api/projects/${r}/sprint/plan`,()=>a.json({success:!0,message:"Sprint plan saved successfully."}))],bt={title:"Sprint/SprintPlanningView",component:Le,parameters:{layout:"fullscreen",msw:{handlers:vt}}},f={parameters:{msw:{handlers:[n.get(`/api/projects/${r}/backlog`,()=>a.json({issues:j})),n.get(`/api/projects/${r}/sprint/active`,()=>a.json({sprint:v})),n.post(`/api/projects/${r}/sprint/plan`,()=>a.json({success:!0,message:"Sprint plan saved successfully."}))]}}},R={name:"Empty Backlog",parameters:{msw:{handlers:[n.get(`/api/projects/${r}/backlog`,()=>a.json({issues:[]})),n.get(`/api/projects/${r}/sprint/active`,()=>a.json({sprint:v})),n.post(`/api/projects/${r}/sprint/plan`,()=>a.json({success:!0,message:"Sprint plan saved successfully."}))]}}},P={name:"No Issues Matching Search Filter",parameters:{msw:{handlers:[n.get(`/api/projects/${r}/backlog`,({request:e})=>{const p=new URL(e.url).searchParams.get("search")??"",l=p?j.filter(t=>t.summary.toLowerCase().includes(p.toLowerCase())):j;return a.json({issues:l,searchText:"xyzzy"})}),n.get(`/api/projects/${r}/sprint/active`,()=>a.json({sprint:v})),n.post(`/api/projects/${r}/sprint/plan`,()=>a.json({success:!0,message:"Sprint plan saved successfully."})),n.get(`/api/projects/${r}/backlog`,()=>a.json({issues:[],searchText:"xyzzy"}))]}}},C={name:"Load Error from API",parameters:{msw:{handlers:[n.get(`/api/projects/${r}/backlog`,()=>a.json({error:"Internal Server Error",message:"Failed to fetch backlog items."},{status:500})),n.get(`/api/projects/${r}/sprint/active`,()=>a.json({error:"Internal Server Error",message:"Failed to load active sprint."},{status:500})),n.post(`/api/projects/${r}/sprint/plan`,()=>a.json({success:!0}))]}}},k={name:"Save Error / Status Message",parameters:{msw:{handlers:[n.get(`/api/projects/${r}/backlog`,()=>a.json({issues:j})),n.get(`/api/projects/${r}/sprint/active`,()=>a.json({sprint:v})),n.post(`/api/projects/${r}/sprint/plan`,()=>a.json({success:!1,message:"Unable to save sprint plan. Some issues could not be updated. Please try again."},{status:422}))]}}},T={name:"Loading State (Pending API Response)",parameters:{msw:{handlers:[n.get(`/api/projects/${r}/backlog`,async()=>(await new Promise(e=>setTimeout(e,6e4)),a.json({issues:j}))),n.get(`/api/projects/${r}/sprint/active`,async()=>(await new Promise(e=>setTimeout(e,6e4)),a.json({sprint:v}))),n.post(`/api/projects/${r}/sprint/plan`,()=>a.json({success:!0}))]}}},w={name:"Saving State (Pending Changes Being Saved)",parameters:{msw:{handlers:[n.get(`/api/projects/${r}/backlog`,()=>a.json({issues:j})),n.get(`/api/projects/${r}/sprint/active`,()=>a.json({sprint:v})),n.post(`/api/projects/${r}/sprint/plan`,async()=>(await new Promise(e=>setTimeout(e,6e4)),a.json({success:!0,message:"Sprint plan saved successfully."})))]}}},$={name:"Pending Changes — Successful Save",parameters:{msw:{handlers:[n.get(`/api/projects/${r}/backlog`,()=>a.json({issues:j,pendingChanges:{"TBX-123":3,"TBX-126":1}})),n.get(`/api/projects/${r}/sprint/active`,()=>a.json({sprint:v})),n.post(`/api/projects/${r}/sprint/plan`,async()=>(await new Promise(e=>setTimeout(e,800)),a.json({success:!0,message:"Sprint plan saved. 2 issues updated."})))]}}},B={name:"Network Failure",parameters:{msw:{handlers:[n.get(`/api/projects/${r}/backlog`,()=>a.error()),n.get(`/api/projects/${r}/sprint/active`,()=>a.error()),n.post(`/api/projects/${r}/sprint/plan`,()=>a.error())]}}},L={name:"Large Backlog (Many Issues)",parameters:{msw:{handlers:[n.get(`/api/projects/${r}/backlog`,()=>{const e=["Alice Johnson","Bob Smith","Carol White","David Lee","Eve Martin"],s=["Bug","Story","Task","Epic"],p=["Critical","High","Medium","Low"],l=["Fix null pointer exception in checkout flow","Implement two-factor authentication","Refactor database connection pooling","Add unit tests for payment service","Upgrade React to latest version","Fix memory leak in background worker","Design new onboarding wizard UI","Migrate legacy REST endpoints to GraphQL","Fix date formatting bug in invoice PDF","Add accessibility labels to navigation menu","Improve error messages in form validation","Optimize image loading with lazy rendering","Write integration tests for auth module","Fix broken CSV export on analytics page","Add role-based access control to admin panel"],t=Array.from({length:30},(i,u)=>({key:`TBX-${200+u}`,summary:l[u%l.length],issueType:s[u%s.length],priority:p[u%p.length],assignee:e[u%e.length],storyPoints:[1,2,3,5,8,13][u%6]}));return a.json({issues:t})}),n.get(`/api/projects/${r}/sprint/active`,()=>a.json({sprint:v})),n.post(`/api/projects/${r}/sprint/plan`,()=>a.json({success:!0,message:"Sprint plan saved successfully."}))]}}};var se,ne,ae;f.parameters={...f.parameters,docs:{...(se=f.parameters)==null?void 0:se.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get(\`/api/projects/\${PROJECT_KEY}/backlog\`, () => {
        return HttpResponse.json({
          issues: defaultBacklog
        });
      }), http.get(\`/api/projects/\${PROJECT_KEY}/sprint/active\`, () => {
        return HttpResponse.json({
          sprint: defaultSprint
        });
      }), http.post(\`/api/projects/\${PROJECT_KEY}/sprint/plan\`, () => {
        return HttpResponse.json({
          success: true,
          message: 'Sprint plan saved successfully.'
        });
      })]
    }
  }
}`,...(ae=(ne=f.parameters)==null?void 0:ne.docs)==null?void 0:ae.source}}};var re,oe,ie;R.parameters={...R.parameters,docs:{...(re=R.parameters)==null?void 0:re.docs,source:{originalSource:`{
  name: 'Empty Backlog',
  parameters: {
    msw: {
      handlers: [http.get(\`/api/projects/\${PROJECT_KEY}/backlog\`, () => {
        return HttpResponse.json({
          issues: []
        });
      }), http.get(\`/api/projects/\${PROJECT_KEY}/sprint/active\`, () => {
        return HttpResponse.json({
          sprint: defaultSprint
        });
      }), http.post(\`/api/projects/\${PROJECT_KEY}/sprint/plan\`, () => {
        return HttpResponse.json({
          success: true,
          message: 'Sprint plan saved successfully.'
        });
      })]
    }
  }
}`,...(ie=(oe=R.parameters)==null?void 0:oe.docs)==null?void 0:ie.source}}};var ce,pe,le;P.parameters={...P.parameters,docs:{...(ce=P.parameters)==null?void 0:ce.docs,source:{originalSource:`{
  name: 'No Issues Matching Search Filter',
  parameters: {
    msw: {
      handlers: [http.get(\`/api/projects/\${PROJECT_KEY}/backlog\`, ({
        request
      }) => {
        const url = new URL(request.url);
        const search = url.searchParams.get('search') ?? '';
        const filtered = search ? defaultBacklog.filter(i => i.summary.toLowerCase().includes(search.toLowerCase())) : defaultBacklog;
        // Simulate a search term that matches nothing
        return HttpResponse.json({
          issues: filtered,
          searchText: 'xyzzy'
        });
      }), http.get(\`/api/projects/\${PROJECT_KEY}/sprint/active\`, () => {
        return HttpResponse.json({
          sprint: defaultSprint
        });
      }), http.post(\`/api/projects/\${PROJECT_KEY}/sprint/plan\`, () => {
        return HttpResponse.json({
          success: true,
          message: 'Sprint plan saved successfully.'
        });
      }),
      // Override backlog with empty to simulate no match for "xyzzy"
      http.get(\`/api/projects/\${PROJECT_KEY}/backlog\`, () => {
        return HttpResponse.json({
          issues: [],
          searchText: 'xyzzy'
        });
      })]
    }
  }
}`,...(le=(pe=P.parameters)==null?void 0:pe.docs)==null?void 0:le.source}}};var ue,me,ge;C.parameters={...C.parameters,docs:{...(ue=C.parameters)==null?void 0:ue.docs,source:{originalSource:`{
  name: 'Load Error from API',
  parameters: {
    msw: {
      handlers: [http.get(\`/api/projects/\${PROJECT_KEY}/backlog\`, () => {
        return HttpResponse.json({
          error: 'Internal Server Error',
          message: 'Failed to fetch backlog items.'
        }, {
          status: 500
        });
      }), http.get(\`/api/projects/\${PROJECT_KEY}/sprint/active\`, () => {
        return HttpResponse.json({
          error: 'Internal Server Error',
          message: 'Failed to load active sprint.'
        }, {
          status: 500
        });
      }), http.post(\`/api/projects/\${PROJECT_KEY}/sprint/plan\`, () => {
        return HttpResponse.json({
          success: true
        });
      })]
    }
  }
}`,...(ge=(me=C.parameters)==null?void 0:me.docs)==null?void 0:ge.source}}};var de,ye,he;k.parameters={...k.parameters,docs:{...(de=k.parameters)==null?void 0:de.docs,source:{originalSource:`{
  name: 'Save Error / Status Message',
  parameters: {
    msw: {
      handlers: [http.get(\`/api/projects/\${PROJECT_KEY}/backlog\`, () => {
        return HttpResponse.json({
          issues: defaultBacklog
        });
      }), http.get(\`/api/projects/\${PROJECT_KEY}/sprint/active\`, () => {
        return HttpResponse.json({
          sprint: defaultSprint
        });
      }), http.post(\`/api/projects/\${PROJECT_KEY}/sprint/plan\`, () => {
        return HttpResponse.json({
          success: false,
          message: 'Unable to save sprint plan. Some issues could not be updated. Please try again.'
        }, {
          status: 422
        });
      })]
    }
  }
}`,...(he=(ye=k.parameters)==null?void 0:ye.docs)==null?void 0:he.source}}};var ve,Se,Ee;T.parameters={...T.parameters,docs:{...(ve=T.parameters)==null?void 0:ve.docs,source:{originalSource:`{
  name: 'Loading State (Pending API Response)',
  parameters: {
    msw: {
      handlers: [http.get(\`/api/projects/\${PROJECT_KEY}/backlog\`, async () => {
        await new Promise(resolve => setTimeout(resolve, 60_000));
        return HttpResponse.json({
          issues: defaultBacklog
        });
      }), http.get(\`/api/projects/\${PROJECT_KEY}/sprint/active\`, async () => {
        await new Promise(resolve => setTimeout(resolve, 60_000));
        return HttpResponse.json({
          sprint: defaultSprint
        });
      }), http.post(\`/api/projects/\${PROJECT_KEY}/sprint/plan\`, () => {
        return HttpResponse.json({
          success: true
        });
      })]
    }
  }
}`,...(Ee=(Se=T.parameters)==null?void 0:Se.docs)==null?void 0:Ee.source}}};var je,_e,be;w.parameters={...w.parameters,docs:{...(je=w.parameters)==null?void 0:je.docs,source:{originalSource:`{
  name: 'Saving State (Pending Changes Being Saved)',
  parameters: {
    msw: {
      handlers: [http.get(\`/api/projects/\${PROJECT_KEY}/backlog\`, () => {
        return HttpResponse.json({
          issues: defaultBacklog
        });
      }), http.get(\`/api/projects/\${PROJECT_KEY}/sprint/active\`, () => {
        return HttpResponse.json({
          sprint: defaultSprint
        });
      }), http.post(\`/api/projects/\${PROJECT_KEY}/sprint/plan\`, async () => {
        await new Promise(resolve => setTimeout(resolve, 60_000));
        return HttpResponse.json({
          success: true,
          message: 'Sprint plan saved successfully.'
        });
      })]
    }
  }
}`,...(be=(_e=w.parameters)==null?void 0:_e.docs)==null?void 0:be.source}}};var fe,Re,Pe;$.parameters={...$.parameters,docs:{...(fe=$.parameters)==null?void 0:fe.docs,source:{originalSource:`{
  name: 'Pending Changes — Successful Save',
  parameters: {
    msw: {
      handlers: [http.get(\`/api/projects/\${PROJECT_KEY}/backlog\`, () => {
        return HttpResponse.json({
          issues: defaultBacklog,
          pendingChanges: {
            'TBX-123': 3,
            'TBX-126': 1
          }
        });
      }), http.get(\`/api/projects/\${PROJECT_KEY}/sprint/active\`, () => {
        return HttpResponse.json({
          sprint: defaultSprint
        });
      }), http.post(\`/api/projects/\${PROJECT_KEY}/sprint/plan\`, async () => {
        await new Promise(resolve => setTimeout(resolve, 800));
        return HttpResponse.json({
          success: true,
          message: 'Sprint plan saved. 2 issues updated.'
        });
      })]
    }
  }
}`,...(Pe=(Re=$.parameters)==null?void 0:Re.docs)==null?void 0:Pe.source}}};var Ce,ke,Te;B.parameters={...B.parameters,docs:{...(Ce=B.parameters)==null?void 0:Ce.docs,source:{originalSource:`{
  name: 'Network Failure',
  parameters: {
    msw: {
      handlers: [http.get(\`/api/projects/\${PROJECT_KEY}/backlog\`, () => {
        return HttpResponse.error();
      }), http.get(\`/api/projects/\${PROJECT_KEY}/sprint/active\`, () => {
        return HttpResponse.error();
      }), http.post(\`/api/projects/\${PROJECT_KEY}/sprint/plan\`, () => {
        return HttpResponse.error();
      })]
    }
  }
}`,...(Te=(ke=B.parameters)==null?void 0:ke.docs)==null?void 0:Te.source}}};var we,$e,Be;L.parameters={...L.parameters,docs:{...(we=L.parameters)==null?void 0:we.docs,source:{originalSource:`{
  name: 'Large Backlog (Many Issues)',
  parameters: {
    msw: {
      handlers: [http.get(\`/api/projects/\${PROJECT_KEY}/backlog\`, () => {
        const assignees = ['Alice Johnson', 'Bob Smith', 'Carol White', 'David Lee', 'Eve Martin'];
        const issueTypes = ['Bug', 'Story', 'Task', 'Epic'];
        const priorities = ['Critical', 'High', 'Medium', 'Low'];
        const summaries = ['Fix null pointer exception in checkout flow', 'Implement two-factor authentication', 'Refactor database connection pooling', 'Add unit tests for payment service', 'Upgrade React to latest version', 'Fix memory leak in background worker', 'Design new onboarding wizard UI', 'Migrate legacy REST endpoints to GraphQL', 'Fix date formatting bug in invoice PDF', 'Add accessibility labels to navigation menu', 'Improve error messages in form validation', 'Optimize image loading with lazy rendering', 'Write integration tests for auth module', 'Fix broken CSV export on analytics page', 'Add role-based access control to admin panel'];
        const issues = Array.from({
          length: 30
        }, (_, i) => ({
          key: \`TBX-\${200 + i}\`,
          summary: summaries[i % summaries.length],
          issueType: issueTypes[i % issueTypes.length],
          priority: priorities[i % priorities.length],
          assignee: assignees[i % assignees.length],
          storyPoints: [1, 2, 3, 5, 8, 13][i % 6]
        }));
        return HttpResponse.json({
          issues
        });
      }), http.get(\`/api/projects/\${PROJECT_KEY}/sprint/active\`, () => {
        return HttpResponse.json({
          sprint: defaultSprint
        });
      }), http.post(\`/api/projects/\${PROJECT_KEY}/sprint/plan\`, () => {
        return HttpResponse.json({
          success: true,
          message: 'Sprint plan saved successfully.'
        });
      })]
    }
  }
}`,...(Be=($e=L.parameters)==null?void 0:$e.docs)==null?void 0:Be.source}}};const ft=["Default","EmptyBacklog","NoSearchResults","LoadError","SaveError","LoadingState","SavingState","PendingChangesWithSave","NetworkFailure","LargeBacklog"];export{f as Default,R as EmptyBacklog,L as LargeBacklog,C as LoadError,T as LoadingState,B as NetworkFailure,P as NoSearchResults,$ as PendingChangesWithSave,k as SaveError,w as SavingState,ft as __namedExportsOrder,bt as default};
