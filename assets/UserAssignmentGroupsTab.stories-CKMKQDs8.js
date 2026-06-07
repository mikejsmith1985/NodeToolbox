import{h as S}from"./index-B5IrvpLZ.js";import{r as p}from"./index-Bc2G9s8g.js";import{s as re,S as ne}from"./SnowLookupField-DF7OwMMZ.js";import{H as _}from"./cookieStore-CKwAPFhE.js";import"./connectionStore-BunEloD3.js";import"./react-Li0Ki8N_.js";const oe="/api/now/table/sys_user_grmember",ie="sys_id,group",I=200,pe="Failed to load assignment groups.";function N(e){return typeof e=="string"?e:(e==null?void 0:e.value)??""}function ce(e){return typeof e=="string"?e:(e==null?void 0:e.display_value)??(e==null?void 0:e.value)??""}function le(e,t){const a=encodeURIComponent(`user=${e}`);return`${oe}?sysparm_query=${a}&sysparm_fields=${ie}&sysparm_display_value=all&sysparm_limit=${I}&sysparm_offset=${t}&sysparm_exclude_reference_link=true`}function me(e){const t=new Map;return e.forEach(a=>{const r=N(a.group);r&&t.set(r,{membershipSysId:N(a.sys_id),groupSysId:r,groupDisplayName:ce(a.group)||"Unknown Group"})}),Array.from(t.values()).sort((a,r)=>a.groupDisplayName.localeCompare(r.groupDisplayName))}async function ue(e){const t=[];let a=0,r=!0;for(;r;){const i=le(e,a),o=(await re(i)).result??[];t.push(...o),o.length<I?r=!1:a+=I}return t}function de(){const[e,t]=p.useState([]),[a,r]=p.useState(!1),[i,n]=p.useState(null),o=p.useCallback(()=>{t([]),n(null)},[]),R=p.useCallback(async E=>{if(!E.sysId){t([]),n("Select a user before running assignment-group lookup.");return}r(!0),n(null);try{const c=await ue(E.sysId),m=me(c);t(m)}catch(c){const m=c instanceof Error?c.message:pe;t([]),n(m)}finally{r(!1)}},[]);return{assignmentGroupMemberships:e,isLoadingAssignmentGroups:a,lookupErrorMessage:i,lookupAssignmentGroupsForUser:R,clearAssignmentGroupResults:o}}const ge="_tabPanel_11h30_5",ye="_tabHeader_11h30_7",he="_tabTitle_11h30_9",be="_tabSubtitle_11h30_11",Se="_section_11h30_13",_e="_lookupSection_11h30_15",Ee="_sectionHeader_11h30_17",Re="_sectionTitle_11h30_19",Ie="_sectionBody_11h30_21",Te="_buttonRow_11h30_23",Ne="_primaryButton_11h30_25",we="_loadingText_11h30_45",fe="_errorText_11h30_47",ke="_mutedText_11h30_49",Ae="_dataTable_11h30_51",s={tabPanel:ge,tabHeader:ye,tabTitle:he,tabSubtitle:be,section:Se,lookupSection:_e,sectionHeader:Ee,sectionTitle:Re,sectionBody:Ie,buttonRow:Te,primaryButton:Ne,loadingText:we,errorText:fe,mutedText:ke,dataTable:Ae},De="User Assignment Groups",ve="Search for a user, then list every assignment group tied to that person in ServiceNow.",Ge="User Lookup",Le="Assignment Group Results",Me="Find Assignment Groups",Ue="No assignment groups were found for this user.",xe={sysId:"",displayName:""};function se(){const[e,t]=p.useState(xe),[a,r]=p.useState(!1),{assignmentGroupMemberships:i,isLoadingAssignmentGroups:n,lookupErrorMessage:o,lookupAssignmentGroupsForUser:R,clearAssignmentGroupResults:E}=de();function c(l){t(l),r(!1),E()}async function m(){r(!0),await R(e)}const te=!e.sysId||n,ae=a&&!n&&!o&&i.length===0;return React.createElement("div",{className:s.tabPanel},React.createElement("header",{className:s.tabHeader},React.createElement("h2",{className:s.tabTitle},De),React.createElement("p",{className:s.tabSubtitle},ve)),React.createElement("section",{className:`${s.section} ${s.lookupSection}`},React.createElement("div",{className:s.sectionHeader},React.createElement("h3",{className:s.sectionTitle},Ge)),React.createElement("div",{className:s.sectionBody},React.createElement(ne,{isDisabled:n,label:"User",onChange:c,tableName:"sys_user",value:e}),React.createElement("div",{className:s.buttonRow},React.createElement("button",{className:s.primaryButton,disabled:te,onClick:()=>void m(),type:"button"},Me)))),React.createElement("section",{className:s.section},React.createElement("div",{className:s.sectionHeader},React.createElement("h3",{className:s.sectionTitle},Le)),React.createElement("div",{className:s.sectionBody},n?React.createElement("p",{className:s.loadingText},"Loading assignment groups..."):null,o?React.createElement("p",{className:s.errorText,role:"alert"},o):null,ae?React.createElement("p",{className:s.mutedText},Ue):null,i.length>0?React.createElement("table",{className:s.dataTable},React.createElement("thead",null,React.createElement("tr",null,React.createElement("th",{scope:"col"},"Assignment Group"),React.createElement("th",{scope:"col"},"Membership Sys ID"))),React.createElement("tbody",null,i.map(l=>React.createElement("tr",{key:l.membershipSysId||l.groupSysId},React.createElement("td",null,l.groupDisplayName),React.createElement("td",null,l.membershipSysId||"N/A"))))):null)))}se.__docgenInfo={description:"Renders a reverse-lookup workspace for discovering all ServiceNow assignment groups linked to one person.",methods:[],displayName:"UserAssignmentGroupsTab"};const T=[S.get("/api/assignment-groups",()=>_.json({assignmentGroupMemberships:[{groupSysId:"abc123def456",groupDisplayName:"IT Service Desk",membershipSysId:"xyz789"},{groupSysId:"ghi789jkl012",groupDisplayName:"Network Engineering",membershipSysId:"uvw456"}]}))],He=[S.get("/api/assignment-groups",()=>_.json({assignmentGroupMemberships:[]}))],Be=[S.get("/api/assignment-groups",async()=>(await new Promise(()=>{}),_.json({assignmentGroupMemberships:[]})))],Pe=[S.get("/api/assignment-groups",()=>_.json({message:"Failed to retrieve assignment groups for the selected user."},{status:500}))],Qe={title:"Components/UserAssignmentGroupsTab",component:se,parameters:{layout:"padded",msw:{handlers:T}}},u={parameters:{msw:{handlers:T}}},d={parameters:{msw:{handlers:T}}},g={parameters:{msw:{handlers:Be}}},y={parameters:{msw:{handlers:Pe}}},h={parameters:{msw:{handlers:He}}},b={parameters:{msw:{handlers:[S.get("/api/assignment-groups",()=>_.json({assignmentGroupMemberships:[{groupSysId:"abc123def456",groupDisplayName:"IT Service Desk",membershipSysId:"xyz789"},{groupSysId:"ghi789jkl012",groupDisplayName:"Network Engineering",membershipSysId:"uvw456"},{groupSysId:"mno345pqr678",groupDisplayName:"Security Operations",membershipSysId:"rst123"},{groupSysId:"stu901vwx234",groupDisplayName:"Desktop Support",membershipSysId:"yza567"},{groupSysId:"bcd890efg123",groupDisplayName:"Cloud Infrastructure",membershipSysId:"hij234"}]}))]}}};var w,f,k,A,D;u.parameters={...u.parameters,docs:{...(w=u.parameters)==null?void 0:w.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers
    }
  }
}`,...(k=(f=u.parameters)==null?void 0:f.docs)==null?void 0:k.source},description:{story:`Default happy path: a user has been selected and assignment groups\r
have been successfully fetched and are displayed in the results table.`,...(D=(A=u.parameters)==null?void 0:A.docs)==null?void 0:D.description}}};var v,G,L,M,U;d.parameters={...d.parameters,docs:{...(v=d.parameters)==null?void 0:v.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers
    }
  }
}`,...(L=(G=d.parameters)==null?void 0:G.docs)==null?void 0:L.source},description:{story:`Empty user selection: no user has been selected yet, so the lookup\r
button should be disabled. This is the initial state of the tab.`,...(U=(M=d.parameters)==null?void 0:M.docs)==null?void 0:U.description}}};var x,H,B,P,O;g.parameters={...g.parameters,docs:{...(x=g.parameters)==null?void 0:x.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: loadingHandlers
    }
  }
}`,...(B=(H=g.parameters)==null?void 0:H.docs)==null?void 0:B.source},description:{story:`Loading state: the lookup has been triggered and the API call is\r
in-flight. The lookup button is disabled and a loading indicator\r
is shown to the user.`,...(O=(P=g.parameters)==null?void 0:P.docs)==null?void 0:O.description}}};var C,j,$,z,K;y.parameters={...y.parameters,docs:{...(C=y.parameters)==null?void 0:C.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: errorHandlers
    }
  }
}`,...($=(j=y.parameters)==null?void 0:j.docs)==null?void 0:$.source},description:{story:`Error state: the API call failed (e.g., 500 server error). An\r
error message is displayed to the user explaining what went wrong.`,...(K=(z=y.parameters)==null?void 0:z.docs)==null?void 0:K.description}}};var Q,Y,q,V,W;h.parameters={...h.parameters,docs:{...(Q=h.parameters)==null?void 0:Q.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: emptyHandlers
    }
  }
}`,...(q=(Y=h.parameters)==null?void 0:Y.docs)==null?void 0:q.source},description:{story:`Empty results: the selected user exists and the lookup succeeded,\r
but they are not a member of any assignment groups. A friendly\r
empty-state message is shown rather than an empty table.`,...(W=(V=h.parameters)==null?void 0:V.docs)==null?void 0:W.description}}};var J,X,Z,F,ee;b.parameters={...b.parameters,docs:{...(J=b.parameters)==null?void 0:J.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/assignment-groups', () => {
        return HttpResponse.json({
          assignmentGroupMemberships: [{
            groupSysId: 'abc123def456',
            groupDisplayName: 'IT Service Desk',
            membershipSysId: 'xyz789'
          }, {
            groupSysId: 'ghi789jkl012',
            groupDisplayName: 'Network Engineering',
            membershipSysId: 'uvw456'
          }, {
            groupSysId: 'mno345pqr678',
            groupDisplayName: 'Security Operations',
            membershipSysId: 'rst123'
          }, {
            groupSysId: 'stu901vwx234',
            groupDisplayName: 'Desktop Support',
            membershipSysId: 'yza567'
          }, {
            groupSysId: 'bcd890efg123',
            groupDisplayName: 'Cloud Infrastructure',
            membershipSysId: 'hij234'
          }]
        });
      })]
    }
  }
}`,...(Z=(X=b.parameters)==null?void 0:X.docs)==null?void 0:Z.source},description:{story:`Results display: a fully populated results table showing multiple\r
assignment group memberships with their group names and membership\r
sys IDs rendered in a readable table layout.`,...(ee=(F=b.parameters)==null?void 0:F.docs)==null?void 0:ee.description}}};const Ye=["Default","EmptyUserSelection","LoadingState","ErrorState","EmptyResults","ResultsDisplay"];export{u as Default,h as EmptyResults,d as EmptyUserSelection,y as ErrorState,g as LoadingState,b as ResultsDisplay,Ye as __namedExportsOrder,Qe as default};
