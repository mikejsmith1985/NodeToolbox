import{h as c}from"./index-B5IrvpLZ.js";import{r as o}from"./index-Bc2G9s8g.js";import{j as N,a as Je}from"./jiraApi-Zc4wcNPg.js";import{u as Oe}from"./settingsStore-D1ohuLZB.js";import{H as d}from"./cookieStore-CKwAPFhE.js";import{d as l}from"./delay-F0IbJbgL.js";import"./react-Li0Ki8N_.js";import"./isObject-DVTTJpIa.js";const xe="• (no items)",ve=10,Ie=24*60*60*1e3,Fe="done";function L(e,a=xe){return e.length===0?a:e.map(s=>`• ${s.key} - ${s.fields.summary??""}`).join(`
`)}function Ue(e){const a=e.blockers.trim()?e.blockers:"None";return`*Yesterday*
${e.yesterday}

*Today*
${e.today}

*Blockers*
${a}`}function Ye(e,a){const s=Ke(a);return{yesterdayList:e.filter(m=>Be(m)===s),todayList:e.filter(m=>!We(m))}}function Ke(e){const a=new Date(`${e}T00:00:00.000Z`);return new Date(a.getTime()-Ie).toISOString().slice(0,ve)}function Be(e){return(e.fields.updated??"").slice(0,ve)}function We(e){var a,s;return((s=(a=e.fields.status)==null?void 0:a.statusCategory)==null?void 0:s.key)===Fe}const Se="tbxDsuDraft",$e="/rest/api/2/myself",Ge="• (nothing updated yesterday)",Ve="• (no active issues assigned)",Xe=10,P={yesterday:"",today:"",blockers:""};function qe(){try{const e=window.localStorage.getItem(Se);return e?Ze(JSON.parse(e)):P}catch{return P}}function ze(e){try{window.localStorage.setItem(Se,JSON.stringify(e))}catch{}}function Ze(e){if(!e||typeof e!="object")return P;const a=e;return{yesterday:typeof a.yesterday=="string"?a.yesterday:"",today:typeof a.today=="string"?a.today:"",blockers:typeof a.blockers=="string"?a.blockers:""}}function Qe(){return new Date().toISOString().slice(0,Xe)}function et(e){const a=e.trim(),s=a?`project = "${a}" AND assignee = currentUser() AND updated >= -7d`:"assignee = currentUser() AND updated >= -7d";return`/rest/api/2/search?jql=${encodeURIComponent(s)}&fields=summary,status,updated&maxResults=100`}function tt(e=""){const a=Oe(r=>r.dsuProjectKey),[s,m]=o.useState(qe),[Re,D]=o.useState(!1),[Te,C]=o.useState(null),[R,Pe]=o.useState(""),[De,w]=o.useState("idle"),[Ce,T]=o.useState(null),j=o.useRef(!1),u=o.useMemo(()=>Ue(s),[s]);o.useEffect(()=>{j.current&&ze(s)},[s]);const i=o.useCallback(r=>{j.current=!0,m(n=>r(n))},[]),je=o.useCallback(r=>i(n=>({...n,yesterday:r})),[i]),Ne=o.useCallback(r=>i(n=>({...n,today:r})),[i]),Le=o.useCallback(r=>i(n=>({...n,blockers:r})),[i]),ke=o.useCallback(async()=>{D(!0),C(null);try{await N($e);const r=await N(et(e||a)),n=Ye(r.issues??[],Qe());i(()=>({yesterday:L(n.yesterdayList,Ge),today:L(n.todayList,Ve),blockers:""}))}catch(r){const n=r instanceof Error?r.message:"Unknown Jira error";C(`Could not refresh DSU Daily activity. ${n}`)}finally{D(!1)}},[e,a,i]),Ae=o.useCallback(async()=>{try{return await navigator.clipboard.writeText(u),!0}catch{return!1}},[u]),Me=o.useCallback(async()=>{const r=R.trim().toUpperCase();if(!r){w("error"),T("Enter an issue key before posting.");return}w("posting"),T(null);try{await Je(`/rest/api/2/issue/${encodeURIComponent(r)}/comment`,{body:u}),w("success")}catch(n){const He=n instanceof Error?n.message:"Post failed";w("error"),T(He)}},[u,R]);return{draft:s,setYesterday:je,setToday:Ne,setBlockers:Le,isLoading:Re,errorMessage:Te,postKey:R,setPostKey:Pe,postStatus:De,postError:Ce,refresh:ke,copy:Ae,postComment:Me,formattedText:u}}const at="_dsuDailyView_j544v_5",st="_pageHeader_j544v_25",rt="_pageTitle_j544v_33",ot="_pageSubtitle_j544v_45",nt="_contentGrid_j544v_57",it="_editorColumn_j544v_71",ct="_previewColumn_j544v_73",dt="_fieldLabel_j544v_87",lt="_textarea_j544v_105",mt="_postInput_j544v_107",ut="_previewPanel_j544v_139",pt="_previewTitle_j544v_153",yt="_previewText_j544v_165",gt="_actionRow_j544v_185",ft="_postRow_j544v_187",Et="_button_j544v_209",_t="_buttonPrimary_j544v_229 _button_j544v_209",vt="_statusMessage_j544v_255",St="_emptyState_j544v_257",ht="_errorMessage_j544v_281",t={dsuDailyView:at,pageHeader:st,pageTitle:rt,pageSubtitle:ot,contentGrid:nt,editorColumn:it,previewColumn:ct,fieldLabel:dt,textarea:lt,postInput:mt,previewPanel:ut,previewTitle:pt,previewText:yt,actionRow:gt,postRow:ft,button:Et,buttonPrimary:_t,statusMessage:vt,emptyState:St,errorMessage:ht},k="DSU Daily",wt="Prepare yesterday, today, and blocker notes from your recent Jira activity.",bt="No DSU draft yet — click Refresh to load your Jira activity.";function he(){const e=tt(),a=!!(e.draft.yesterday||e.draft.today||e.draft.blockers);return React.createElement("section",{className:t.dsuDailyView,"aria-label":k},React.createElement("header",{className:t.pageHeader},React.createElement("h1",{className:t.pageTitle},k),React.createElement("p",{className:t.pageSubtitle},wt)),!a&&!e.isLoading&&!e.errorMessage&&React.createElement("p",{className:t.emptyState},bt),e.isLoading&&React.createElement("p",{className:t.statusMessage,"aria-live":"polite"},"Loading your activity…"),e.errorMessage&&React.createElement("p",{className:t.errorMessage,role:"alert"},e.errorMessage),React.createElement("div",{className:t.contentGrid},React.createElement("div",{className:t.editorColumn},React.createElement("label",{className:t.fieldLabel},"Yesterday",React.createElement("textarea",{className:t.textarea,"aria-label":"Yesterday",rows:5,value:e.draft.yesterday,onChange:s=>e.setYesterday(s.target.value)})),React.createElement("label",{className:t.fieldLabel},"Today",React.createElement("textarea",{className:t.textarea,"aria-label":"Today",rows:5,value:e.draft.today,onChange:s=>e.setToday(s.target.value)})),React.createElement("label",{className:t.fieldLabel},"Blockers",React.createElement("textarea",{className:t.textarea,"aria-label":"Blockers",rows:3,placeholder:"None",value:e.draft.blockers,onChange:s=>e.setBlockers(s.target.value)}))),React.createElement("aside",{className:t.previewColumn,"aria-label":"Standup preview"},React.createElement("div",{className:t.previewPanel},React.createElement("h2",{className:t.previewTitle},"Standup Preview"),React.createElement("pre",{className:t.previewText},e.formattedText)),React.createElement("div",{className:t.actionRow},React.createElement("button",{type:"button",className:t.button,disabled:e.isLoading,onClick:()=>{e.refresh()}},e.isLoading?"Loading…":"Refresh"),React.createElement("button",{type:"button",className:t.buttonPrimary,onClick:()=>{e.copy()}},"📋 Copy")),React.createElement("div",{className:t.postRow},React.createElement("input",{className:t.postInput,"aria-label":"Issue key for Jira comment",placeholder:"Issue key (e.g. PROJ-123)",value:e.postKey,onChange:s=>e.setPostKey(s.target.value)}),React.createElement("button",{type:"button",className:t.buttonPrimary,disabled:e.postStatus==="posting",onClick:()=>{e.postComment()}},e.postStatus==="posting"?"Posting…":"Post to Jira")),React.createElement(Rt,{status:e.postStatus,errorMessage:e.postError}))))}function Rt({status:e,errorMessage:a}){return e==="idle"?null:e==="posting"?React.createElement("p",{className:t.statusMessage},"Posting…"):e==="success"?React.createElement("p",{className:t.statusMessage},"Comment posted to Jira."):React.createElement("p",{className:t.errorMessage,role:"alert"},a??"Could not post comment.")}he.__docgenInfo={description:"",methods:[],displayName:"DsuDailyView"};const It={title:"Components/DsuDailyView",component:he,parameters:{layout:"centered"}},we={yesterday:`Completed PROJ-120: Fixed bug in auth module
Reviewed PR for PROJ-118`,today:`Working on PROJ-121: Add new dashboard feature
Attend team standup meeting`,blockers:"Waiting for design approval on PROJ-119"},be=`Yesterday:
Completed PROJ-120: Fixed bug in auth module
Reviewed PR for PROJ-118

Today:
Working on PROJ-121: Add new dashboard feature
Attend team standup meeting

Blockers:
Waiting for design approval on PROJ-119`,Tt="PROJ-456",b=c.get("/api/jira/activity",async()=>d.json({draft:we,formattedText:be})),Pt=c.get("/api/jira/activity",async()=>(await l("infinite"),d.json({}))),Dt=c.get("/api/jira/activity",async()=>(await l(300),d.json({message:"Failed to fetch Jira activity. Please try again."},{status:500}))),Ct=c.get("/api/jira/activity",async()=>d.json({draft:{yesterday:"",today:"",blockers:""},formattedText:""})),h=c.post("/api/jira/comment",async()=>(await l(600),d.json({postKey:Tt,status:"success"}))),jt=c.post("/api/jira/comment",async()=>(await l("infinite"),d.json({}))),Nt=c.post("/api/jira/comment",async()=>(await l(400),d.json({message:"Unable to post comment to PROJ-456. Check your Jira permissions and try again."},{status:403}))),p={parameters:{msw:{handlers:[b,h]}}},y={name:"Empty Draft — No Content Loaded",parameters:{msw:{handlers:[Ct,h]}}},g={name:"Loading — Fetching Jira Activity",parameters:{msw:{handlers:[Pt]}}},f={name:"Error — Jira Activity Fetch Failed",parameters:{msw:{handlers:[Dt,h]}}},E={name:"Posting — Submitting Comment to Jira",parameters:{msw:{handlers:[b,jt]}}},_={name:"Post Success — Comment Submitted",parameters:{msw:{handlers:[b,h]}}},v={name:"Post Error — Submission Failed",parameters:{msw:{handlers:[b,Nt]}}},S={name:"Edge Case — Editing Drafts While Activity Loads",parameters:{msw:{handlers:[c.get("/api/jira/activity",async()=>(await l(8e3),d.json({draft:we,formattedText:be}))),h]}}};var A,M,H,J,O;p.parameters={...p.parameters,docs:{...(A=p.parameters)==null?void 0:A.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [activitySuccessHandler, postSuccessHandler]
    }
  }
}`,...(H=(M=p.parameters)==null?void 0:M.docs)==null?void 0:H.source},description:{story:`Default / Happy Path\r
Activity is fetched successfully, form is populated, post is idle.`,...(O=(J=p.parameters)==null?void 0:J.docs)==null?void 0:O.description}}};var x,I,F,U,Y;y.parameters={...y.parameters,docs:{...(x=y.parameters)==null?void 0:x.docs,source:{originalSource:`{
  name: 'Empty Draft — No Content Loaded',
  parameters: {
    msw: {
      handlers: [activityEmptyHandler, postSuccessHandler]
    }
  }
}`,...(F=(I=y.parameters)==null?void 0:I.docs)==null?void 0:F.source},description:{story:`Empty Draft State\r
No prior Jira activity was found; all fields start blank.`,...(Y=(U=y.parameters)==null?void 0:U.docs)==null?void 0:Y.description}}};var K,B,W,$,G;g.parameters={...g.parameters,docs:{...(K=g.parameters)==null?void 0:K.docs,source:{originalSource:`{
  name: 'Loading — Fetching Jira Activity',
  parameters: {
    msw: {
      handlers: [activityLoadingHandler]
    }
  }
}`,...(W=(B=g.parameters)==null?void 0:B.docs)==null?void 0:W.source},description:{story:`Loading State\r
Jira activity fetch is in-flight — skeleton / spinner should be visible.`,...(G=($=g.parameters)==null?void 0:$.docs)==null?void 0:G.description}}};var V,X,q,z,Z;f.parameters={...f.parameters,docs:{...(V=f.parameters)==null?void 0:V.docs,source:{originalSource:`{
  name: 'Error — Jira Activity Fetch Failed',
  parameters: {
    msw: {
      handlers: [activityErrorHandler, postSuccessHandler]
    }
  }
}`,...(q=(X=f.parameters)==null?void 0:X.docs)==null?void 0:q.source},description:{story:`Fetch Error State\r
The API returned a 500; the component should surface the error message.`,...(Z=(z=f.parameters)==null?void 0:z.docs)==null?void 0:Z.description}}};var Q,ee,te,ae,se;E.parameters={...E.parameters,docs:{...(Q=E.parameters)==null?void 0:Q.docs,source:{originalSource:`{
  name: 'Posting — Submitting Comment to Jira',
  parameters: {
    msw: {
      handlers: [activitySuccessHandler, postLoadingHandler]
    }
  }
}`,...(te=(ee=E.parameters)==null?void 0:ee.docs)==null?void 0:te.source},description:{story:`Posting State\r
User submitted the DSU; comment POST is in-flight.`,...(se=(ae=E.parameters)==null?void 0:ae.docs)==null?void 0:se.description}}};var re,oe,ne,ie,ce;_.parameters={..._.parameters,docs:{...(re=_.parameters)==null?void 0:re.docs,source:{originalSource:`{
  name: 'Post Success — Comment Submitted',
  parameters: {
    msw: {
      handlers: [activitySuccessHandler, postSuccessHandler]
    }
  }
}`,...(ne=(oe=_.parameters)==null?void 0:oe.docs)==null?void 0:ne.source},description:{story:`Post Success\r
Comment was posted successfully; confirmation UI should appear with the\r
Jira issue key (PROJ-456).`,...(ce=(ie=_.parameters)==null?void 0:ie.docs)==null?void 0:ce.description}}};var de,le,me,ue,pe;v.parameters={...v.parameters,docs:{...(de=v.parameters)==null?void 0:de.docs,source:{originalSource:`{
  name: 'Post Error — Submission Failed',
  parameters: {
    msw: {
      handlers: [activitySuccessHandler, postErrorHandler]
    }
  }
}`,...(me=(le=v.parameters)==null?void 0:le.docs)==null?void 0:me.source},description:{story:`Post Error\r
Comment submission failed (e.g. permission denied); error message rendered.`,...(pe=(ue=v.parameters)==null?void 0:ue.docs)==null?void 0:pe.description}}};var ye,ge,fe,Ee,_e;S.parameters={...S.parameters,docs:{...(ye=S.parameters)==null?void 0:ye.docs,source:{originalSource:`{
  name: 'Edge Case — Editing Drafts While Activity Loads',
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/activity', async () => {
        await delay(8000); // Very slow — gives time to type
        return HttpResponse.json({
          draft: MOCK_DRAFT,
          formattedText: MOCK_FORMATTED_TEXT
        });
      }), postSuccessHandler]
    }
  }
}`,...(fe=(ge=S.parameters)==null?void 0:ge.docs)==null?void 0:fe.source},description:{story:`Editing While Loading\r
Activity fetch is still pending but the user has already started typing\r
in the draft fields (tests that inputs remain interactive during load).`,...(_e=(Ee=S.parameters)==null?void 0:Ee.docs)==null?void 0:_e.description}}};const Ft=["Default","EmptyDraft","LoadingActivity","FetchError","PostingComment","PostSuccess","PostError","EditingWhileLoading"];export{p as Default,S as EditingWhileLoading,y as EmptyDraft,f as FetchError,g as LoadingActivity,v as PostError,_ as PostSuccess,E as PostingComment,Ft as __namedExportsOrder,It as default};
