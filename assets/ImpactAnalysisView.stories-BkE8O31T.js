import{h as u}from"./index-B5IrvpLZ.js";import{r as d}from"./index-Bc2G9s8g.js";import{j as Te}from"./jiraApi-Zc4wcNPg.js";import{H as m}from"./cookieStore-CKwAPFhE.js";const ve="UNKNOWN",Ce="Unknown",Oe="Untitled Jira issue",Ue="block";function Fe(e){return(e==null?void 0:e.trim().toLowerCase().replace(/\s+/g," "))||"relates to"}function be(e){var r,a,i,o;const s={inward:[],outward:[]};for(const n of e??[]){const l=D("outward",n.outwardIssue,((r=n.type)==null?void 0:r.outward)??((a=n.type)==null?void 0:a.name)),c=D("inward",n.inwardIssue,((i=n.type)==null?void 0:i.inward)??((o=n.type)==null?void 0:o.name));l!==null&&s.outward.push(l),c!==null&&s.inward.push(c)}return s}function He(e,s,r){const a=[...e,...s],i=[...a.map(n=>n.related),...r],o=i.filter(n=>n.statusCategoryKey==="done").length;return{totalRelated:i.length,blockerCount:a.filter(n=>n.isBlocker).length,openCount:i.length-o,doneCount:o}}function Ae(e){var s,r,a,i,o,n,l,c,p;return{key:((s=e==null?void 0:e.key)==null?void 0:s.trim())||ve,summary:((a=(r=e==null?void 0:e.fields)==null?void 0:r.summary)==null?void 0:a.trim())||Oe,statusName:((n=(o=(i=e==null?void 0:e.fields)==null?void 0:i.status)==null?void 0:o.name)==null?void 0:n.trim())||Ce,statusCategoryKey:ze((p=(c=(l=e==null?void 0:e.fields)==null?void 0:l.status)==null?void 0:c.statusCategory)==null?void 0:p.key)}}function D(e,s,r){if(!s)return null;const a=Fe(r);return{direction:e,linkType:a,related:Ae(s),isBlocker:a.includes(Ue)}}function ze(e){return e==="new"||e==="indeterminate"||e==="done"?e:"unknown"}const De="summary,status,assignee,issuetype,priority,issuelinks",xe="summary,status",Ke=100,je="Failed to load Impact Analysis",Ve="epic",Ge="400",C="tbxImpactAnalysisKey";function $e(e){return`/rest/api/2/issue/${encodeURIComponent(e.trim().toUpperCase())}?fields=${De}`}function Be(e,s){const r=e.trim().toUpperCase(),a=s==="parent"?`parent=${r}`:`"Epic Link" = ${r}`;return`/rest/api/2/search?jql=${encodeURIComponent(a)}&fields=${xe}&maxResults=${Ke}`}function Je(e){var a,i,o,n,l,c,p,y,h;const s=e.fields??{},r=((i=(a=s.issuetype)==null?void 0:a.name)==null?void 0:i.trim())||"Unknown";return{key:e.key,summary:((o=s.summary)==null?void 0:o.trim())||"Untitled Jira issue",statusName:((l=(n=s.status)==null?void 0:n.name)==null?void 0:l.trim())||"Unknown",typeName:r,priorityName:((p=(c=s.priority)==null?void 0:c.name)==null?void 0:p.trim())||"None",assigneeName:((h=(y=s.assignee)==null?void 0:y.displayName)==null?void 0:h.trim())||null,isEpic:r.toLowerCase()===Ve}}function We(){const[e,s]=d.useState(()=>Qe()),[r,a]=d.useState(!1),[i,o]=d.useState(null),[n,l]=d.useState(null),[c,p]=d.useState([]),[y,h]=d.useState([]),[P,M]=d.useState([]);d.useEffect(()=>{e.trim()||window.localStorage.removeItem(C)},[e]);const we=d.useMemo(()=>He(c,y,P),[P,c,y]),Pe=d.useCallback(async()=>{var b;const g=e.trim().toUpperCase();if(!g){K(l,p,h,M),o("Enter an issue key before searching.");return}a(!0),o(null);try{const I=await Te($e(g)),H=Je(I),z=be((b=I.fields)==null?void 0:b.issuelinks),Me=H.isEpic?await Ye(g):[];window.localStorage.setItem(C,g),s(g),l(H),p(z.inward),h(z.outward),M(Me)}catch(I){K(l,p,h,M),o(I instanceof Error?I.message:je)}finally{a(!1)}},[e]);return{issueKey:e,setIssueKey:s,isLoading:r,errorMessage:i,root:n,inward:c,outward:y,children:P,stats:we,search:Pe}}async function Ye(e){try{return await x(e,"parent")}catch(s){if(!qe(s))throw s;return x(e,"Epic Link")}}async function x(e,s){return((await Te(Be(e,s))).issues??[]).map(a=>Ae(a))}function K(e,s,r,a){e(null),s([]),r([]),a([])}function qe(e){return e instanceof Error&&e.message.includes(Ge)}function Qe(){return window.localStorage.getItem(C)??""}const Xe="_impactAnalysisView_o4e3z_5",Ze="_pageHeader_o4e3z_25",es="_pageTitle_o4e3z_33",ss="_pageSubtitle_o4e3z_45",ts="_controlsPanel_o4e3z_57",as="_fieldLabel_o4e3z_79",rs="_textInput_o4e3z_95",ns="_buttonPrimary_o4e3z_119",os="_errorMessage_o4e3z_151",is="_emptyState_o4e3z_163",ls="_resultsStack_o4e3z_181",cs="_rootCard_o4e3z_193",us="_groupCard_o4e3z_195",ms="_statsFooter_o4e3z_197",ds="_rootHeader_o4e3z_211",ps="_issueKey_o4e3z_227",ys="_issueSummary_o4e3z_239",hs="_metaGrid_o4e3z_253",gs="_statTile_o4e3z_269",Is="_mutedText_o4e3z_285",Rs="_groupTitle_o4e3z_305",Es="_relatedList_o4e3z_317",ks="_relatedItem_o4e3z_335",_s="_statusPill_o4e3z_357",t={impactAnalysisView:Xe,pageHeader:Ze,pageTitle:es,pageSubtitle:ss,controlsPanel:ts,fieldLabel:as,textInput:rs,buttonPrimary:ns,errorMessage:os,emptyState:is,resultsStack:ls,rootCard:cs,groupCard:us,statsFooter:ms,rootHeader:ds,issueKey:ps,issueSummary:ys,metaGrid:hs,statTile:gs,mutedText:Is,groupTitle:Rs,relatedList:Es,relatedItem:ks,statusPill:_s},j="Impact Analysis",fs="Inspect a Jira issue blast radius across links, blockers, and Epic children.",Ls="PROJ-123",Ns="Enter an issue key to analyze its blast radius.",Ts="Loading Impact Analysis…",As="Unassigned",Ss="No links found.",ws="No Epic children found.",Ps="Enter";function Se(){const e=We(),s=e.root!==null,r=!e.isLoading&&!s&&e.errorMessage===null;function a(){e.search()}function i(o){o.key===Ps&&a()}return React.createElement("section",{className:t.impactAnalysisView,"aria-label":j},React.createElement("header",{className:t.pageHeader},React.createElement("h1",{className:t.pageTitle},j),React.createElement("p",{className:t.pageSubtitle},fs)),React.createElement("div",{className:t.controlsPanel},React.createElement("label",{className:t.fieldLabel},"Issue key",React.createElement("input",{className:t.textInput,"aria-label":"Issue key",placeholder:Ls,value:e.issueKey,onChange:o=>e.setIssueKey(o.target.value),onKeyDown:i})),React.createElement("button",{type:"button",className:t.buttonPrimary,disabled:e.isLoading,onClick:a},e.isLoading?"Loading…":"Search")),e.errorMessage&&React.createElement("p",{className:t.errorMessage,role:"alert"},"⚠ ",e.errorMessage),e.isLoading&&React.createElement("div",{className:t.emptyState},Ts),r&&React.createElement("div",{className:t.emptyState},Ns),!e.isLoading&&s&&Ms(e.root,e))}function Ms(e,s){return e===null?null:React.createElement("div",{className:t.resultsStack},vs(e),V("Outward links",s.outward),V("Inward links",s.inward),e.isEpic&&Os(s.children),React.createElement("footer",{className:t.statsFooter,"aria-label":"Impact stats"},T("Total related",s.stats.totalRelated),T("Blockers",s.stats.blockerCount),T("Open",s.stats.openCount),T("Done",s.stats.doneCount)))}function vs(e){return React.createElement("article",{className:t.rootCard,"aria-label":"Root issue"},React.createElement("div",{className:t.rootHeader},React.createElement("span",{className:t.issueKey},e.key),React.createElement("span",{className:t.statusPill},e.statusName)),React.createElement("h2",{className:t.issueSummary},e.summary),React.createElement("dl",{className:t.metaGrid},v("Type",e.typeName),v("Priority",e.priorityName),v("Assignee",e.assigneeName??As)))}function V(e,s){return React.createElement("section",{className:t.groupCard,"aria-label":e},React.createElement("h2",{className:t.groupTitle},e),s.length===0?React.createElement("p",{className:t.mutedText},Ss):React.createElement("ul",{className:t.relatedList},s.map(Cs)))}function Cs(e){return React.createElement("li",{key:`${e.direction}-${e.linkType}-${e.related.key}`,className:t.relatedItem},React.createElement("span",null,e.linkType,": ",e.related.key," - ",e.related.summary," "),React.createElement("span",{className:t.statusPill},"[",e.related.statusName,"]"))}function Os(e){return React.createElement("section",{className:t.groupCard,"aria-label":"Children"},React.createElement("h2",{className:t.groupTitle},"Children"),e.length===0?React.createElement("p",{className:t.mutedText},ws):React.createElement("ul",{className:t.relatedList},e.map(Us)))}function Us(e){return React.createElement("li",{key:e.key,className:t.relatedItem},React.createElement("span",null,e.key," - ",e.summary),React.createElement("span",{className:t.statusPill},e.statusName))}function T(e,s){return React.createElement("div",{className:t.statTile},React.createElement("strong",null,s),React.createElement("span",null,e))}function v(e,s){return React.createElement("div",null,React.createElement("dt",null,e),React.createElement("dd",null,s))}Se.__docgenInfo={description:"Renders the Impact Analysis view and delegates Jira state to `useImpactAnalysisState`.",methods:[],displayName:"ImpactAnalysisView"};const xs={title:"Components/ImpactAnalysisView",component:Se,parameters:{layout:"fullscreen"}},A={id:"10042",key:"PLATFORM-42",fields:{summary:"Migrate authentication service to OAuth 2.0",issuetype:{name:"Epic",iconUrl:"/icons/epic.svg"},status:{name:"In Progress",statusCategory:{colorName:"yellow"}},priority:{name:"High",iconUrl:"/icons/priority-high.svg"},assignee:{displayName:"Sophia Reynolds",avatarUrls:{"48x48":"https://i.pravatar.cc/48?u=sophia"}},description:"Full migration of legacy session-based auth to OAuth 2.0 / OIDC across all services."}},O=[{id:"10101",key:"PLATFORM-101",fields:{summary:"Update user-service token validation middleware",issuetype:{name:"Story",iconUrl:"/icons/story.svg"},status:{name:"To Do",statusCategory:{colorName:"blue-gray"}},priority:{name:"High",iconUrl:"/icons/priority-high.svg"},assignee:{displayName:"Marcus Chen",avatarUrls:{"48x48":"https://i.pravatar.cc/48?u=marcus"}}}},{id:"10102",key:"PLATFORM-102",fields:{summary:"Deprecate legacy /auth/session endpoint",issuetype:{name:"Task",iconUrl:"/icons/task.svg"},status:{name:"In Progress",statusCategory:{colorName:"yellow"}},priority:{name:"Medium",iconUrl:"/icons/priority-medium.svg"},assignee:{displayName:"Priya Nair",avatarUrls:{"48x48":"https://i.pravatar.cc/48?u=priya"}}}},{id:"10103",key:"INFRA-88",fields:{summary:"Provision OAuth 2.0 server infrastructure on AWS",issuetype:{name:"Task",iconUrl:"/icons/task.svg"},status:{name:"Done",statusCategory:{colorName:"green"}},priority:{name:"High",iconUrl:"/icons/priority-high.svg"},assignee:{displayName:"Liam Okafor",avatarUrls:{"48x48":"https://i.pravatar.cc/48?u=liam"}}}}],U=[{id:"10201",key:"PLATFORM-201",fields:{summary:"Implement OAuth 2.0 authorization code flow",issuetype:{name:"Story",iconUrl:"/icons/story.svg"},status:{name:"In Progress",statusCategory:{colorName:"yellow"}},priority:{name:"High",iconUrl:"/icons/priority-high.svg"},assignee:{displayName:"Elena Vasquez",avatarUrls:{"48x48":"https://i.pravatar.cc/48?u=elena"}}}},{id:"10202",key:"PLATFORM-202",fields:{summary:"Add PKCE support for public clients",issuetype:{name:"Story",iconUrl:"/icons/story.svg"},status:{name:"To Do",statusCategory:{colorName:"blue-gray"}},priority:{name:"Medium",iconUrl:"/icons/priority-medium.svg"},assignee:null}},{id:"10203",key:"PLATFORM-203",fields:{summary:"Write integration tests for token refresh flow",issuetype:{name:"Task",iconUrl:"/icons/task.svg"},status:{name:"To Do",statusCategory:{colorName:"blue-gray"}},priority:{name:"Low",iconUrl:"/icons/priority-low.svg"},assignee:{displayName:"Marcus Chen",avatarUrls:{"48x48":"https://i.pravatar.cc/48?u=marcus"}}}}],Fs={id:"10300",key:"PLATFORM-300",fields:{summary:"Add refresh-token rotation to auth flow",issuetype:{name:"Story",iconUrl:"/icons/story.svg"},status:{name:"In Progress",statusCategory:{colorName:"yellow"}},priority:{name:"High",iconUrl:"/icons/priority-high.svg"},assignee:{displayName:"Sophia Reynolds",avatarUrls:{"48x48":"https://i.pravatar.cc/48?u=sophia"}},description:"Implement secure refresh-token rotation to mitigate token theft risk."}},S=(e,s)=>u.get(`/api/issue/${e}`,()=>m.json(s)),w=(e,s)=>u.get(`/api/issue/${e}/links`,()=>m.json(s)),F=(e,s)=>u.get(`/api/issue/${e}/children`,()=>m.json(s)),R={parameters:{msw:{handlers:[S("PLATFORM-42",A),w("PLATFORM-42",{issues:O}),F("PLATFORM-42",{issues:U})]}}},E={parameters:{msw:{handlers:[u.get("/api/issue/*",()=>m.json(null,{status:204}))]}}},k={parameters:{msw:{handlers:[u.get("/api/issue/PLATFORM-42",async()=>(await new Promise(e=>setTimeout(e,6e4)),m.json(A))),u.get("/api/issue/PLATFORM-42/links",async()=>(await new Promise(e=>setTimeout(e,6e4)),m.json({issues:O}))),u.get("/api/issue/PLATFORM-42/children",async()=>(await new Promise(e=>setTimeout(e,6e4)),m.json({issues:U})))]}}},_={parameters:{msw:{handlers:[u.get("/api/issue/INVALID-999",()=>m.json({errorMessages:["Issue does not exist or you do not have permission to see it."],errors:{}},{status:404})),u.get("/api/issue/INVALID-999/links",()=>m.json({errorMessages:["Issue not found."],errors:{}},{status:404})),u.get("/api/issue/INVALID-999/children",()=>m.json({errorMessages:["Issue not found."],errors:{}},{status:404}))]}}},f={parameters:{msw:{handlers:[S("PLATFORM-42",A),w("PLATFORM-42",{issues:[]}),F("PLATFORM-42",{issues:U})]}}},L={parameters:{msw:{handlers:[S("PLATFORM-42",A),w("PLATFORM-42",{issues:O}),F("PLATFORM-42",{issues:[]})]}}},N={parameters:{msw:{handlers:[S("PLATFORM-300",Fs),w("PLATFORM-300",{issues:[{id:"10401",key:"PLATFORM-401",fields:{summary:"QA: Verify refresh-token behaviour after expiry",issuetype:{name:"Task",iconUrl:"/icons/task.svg"},status:{name:"To Do",statusCategory:{colorName:"blue-gray"}},priority:{name:"Medium",iconUrl:"/icons/priority-medium.svg"},assignee:{displayName:"Priya Nair",avatarUrls:{"48x48":"https://i.pravatar.cc/48?u=priya"}}}}]}),u.get("/api/issue/PLATFORM-300/children",()=>m.json({issues:[]}))]}}};var G,$,B,J,W;R.parameters={...R.parameters,docs:{...(G=R.parameters)==null?void 0:G.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [makeIssueHandler('PLATFORM-42', epicIssue), makeLinksHandler('PLATFORM-42', {
        issues: linkedIssues
      }), makeChildrenHandler('PLATFORM-42', {
        issues: epicChildren
      })]
    }
  }
}`,...(B=($=R.parameters)==null?void 0:$.docs)==null?void 0:B.source},description:{story:"Default / happy path – an Epic with linked issues and child stories.",...(W=(J=R.parameters)==null?void 0:J.docs)==null?void 0:W.description}}};var Y,q,Q,X,Z;E.parameters={...E.parameters,docs:{...(Y=E.parameters)==null?void 0:Y.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [
      // No routes needed – the UI should not make any calls before input
      http.get('/api/issue/*', () => HttpResponse.json(null, {
        status: 204
      }))]
    }
  }
}`,...(Q=(q=E.parameters)==null?void 0:q.docs)==null?void 0:Q.source},description:{story:`Empty state – no issue key has been entered yet.\r
Simulates the initial blank slate of the view.`,...(Z=(X=E.parameters)==null?void 0:X.docs)==null?void 0:Z.description}}};var ee,se,te,ae,re;k.parameters={...k.parameters,docs:{...(ee=k.parameters)==null?void 0:ee.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/issue/PLATFORM-42', async () => {
        await new Promise(resolve => setTimeout(resolve, 60_000));
        return HttpResponse.json(epicIssue);
      }), http.get('/api/issue/PLATFORM-42/links', async () => {
        await new Promise(resolve => setTimeout(resolve, 60_000));
        return HttpResponse.json({
          issues: linkedIssues
        });
      }), http.get('/api/issue/PLATFORM-42/children', async () => {
        await new Promise(resolve => setTimeout(resolve, 60_000));
        return HttpResponse.json({
          issues: epicChildren
        });
      })]
    }
  }
}`,...(te=(se=k.parameters)==null?void 0:se.docs)==null?void 0:te.source},description:{story:`Loading state – the API call is intentionally delayed so the spinner /\r
skeleton is visible.`,...(re=(ae=k.parameters)==null?void 0:ae.docs)==null?void 0:re.description}}};var ne,oe,ie,le,ce;_.parameters={..._.parameters,docs:{...(ne=_.parameters)==null?void 0:ne.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/issue/INVALID-999', () => HttpResponse.json({
        errorMessages: ['Issue does not exist or you do not have permission to see it.'],
        errors: {}
      }, {
        status: 404
      })), http.get('/api/issue/INVALID-999/links', () => HttpResponse.json({
        errorMessages: ['Issue not found.'],
        errors: {}
      }, {
        status: 404
      })), http.get('/api/issue/INVALID-999/children', () => HttpResponse.json({
        errorMessages: ['Issue not found.'],
        errors: {}
      }, {
        status: 404
      }))]
    }
  }
}`,...(ie=(oe=_.parameters)==null?void 0:oe.docs)==null?void 0:ie.source},description:{story:`Error state – the user entered an invalid / non-existent issue key and the\r
API responds with 404.`,...(ce=(le=_.parameters)==null?void 0:le.docs)==null?void 0:ce.description}}};var ue,me,de,pe,ye;f.parameters={...f.parameters,docs:{...(ue=f.parameters)==null?void 0:ue.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [makeIssueHandler('PLATFORM-42', epicIssue), makeLinksHandler('PLATFORM-42', {
        issues: []
      }), makeChildrenHandler('PLATFORM-42', {
        issues: epicChildren
      })]
    }
  }
}`,...(de=(me=f.parameters)==null?void 0:me.docs)==null?void 0:de.source},description:{story:"No links found – the issue exists but has zero linked issues.",...(ye=(pe=f.parameters)==null?void 0:pe.docs)==null?void 0:ye.description}}};var he,ge,Ie,Re,Ee;L.parameters={...L.parameters,docs:{...(he=L.parameters)==null?void 0:he.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [makeIssueHandler('PLATFORM-42', epicIssue), makeLinksHandler('PLATFORM-42', {
        issues: linkedIssues
      }), makeChildrenHandler('PLATFORM-42', {
        issues: []
      })]
    }
  }
}`,...(Ie=(ge=L.parameters)==null?void 0:ge.docs)==null?void 0:Ie.source},description:{story:`No epic children found – the Epic exists and has links, but no child stories\r
or tasks have been created under it yet.`,...(Ee=(Re=L.parameters)==null?void 0:Re.docs)==null?void 0:Ee.description}}};var ke,_e,fe,Le,Ne;N.parameters={...N.parameters,docs:{...(ke=N.parameters)==null?void 0:ke.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [makeIssueHandler('PLATFORM-300', storyIssue), makeLinksHandler('PLATFORM-300', {
        issues: [{
          id: '10401',
          key: 'PLATFORM-401',
          fields: {
            summary: 'QA: Verify refresh-token behaviour after expiry',
            issuetype: {
              name: 'Task',
              iconUrl: '/icons/task.svg'
            },
            status: {
              name: 'To Do',
              statusCategory: {
                colorName: 'blue-gray'
              }
            },
            priority: {
              name: 'Medium',
              iconUrl: '/icons/priority-medium.svg'
            },
            assignee: {
              displayName: 'Priya Nair',
              avatarUrls: {
                '48x48': 'https://i.pravatar.cc/48?u=priya'
              }
            }
          }
        }]
      }),
      // Stories have no children; API should return empty or 404
      http.get('/api/issue/PLATFORM-300/children', () => HttpResponse.json({
        issues: []
      }))]
    }
  }
}`,...(fe=(_e=N.parameters)==null?void 0:_e.docs)==null?void 0:fe.source},description:{story:`Issue is not an Epic – a Story-type issue is analysed; the epic-children\r
section should be hidden or show an appropriate message.`,...(Ne=(Le=N.parameters)==null?void 0:Le.docs)==null?void 0:Ne.description}}};const Ks=["Default","EmptyStateNoIssueEntered","LoadingStateDuringSearch","ErrorStateInvalidIssueKey","NoLinksFound","NoEpicChildrenFound","IssueIsNotEpic"];export{R as Default,E as EmptyStateNoIssueEntered,_ as ErrorStateInvalidIssueKey,N as IssueIsNotEpic,k as LoadingStateDuringSearch,L as NoEpicChildrenFound,f as NoLinksFound,Ks as __namedExportsOrder,xs as default};
