import{h as r}from"./index-B5IrvpLZ.js";import{r as l}from"./index-Bc2G9s8g.js";import{j as me}from"./jiraApi-Zc4wcNPg.js";import{s as a}from"./JiraPicker.module-DUm0jMy4.js";import{d as n}from"./delay-F0IbJbgL.js";import{H as t}from"./cookieStore-CKwAPFhE.js";import"./isObject-DVTTJpIa.js";const pe="/rest/api/2/field",ue="customfield_",fe="Select a field",ge="Loading fields…",he="Could not load Jira fields. You can still enter the field ID manually.",_e="Current field";function je(s){return`${_e} (${s})`}function ae({id:s,label:y,value:i,onChange:C,placeholder:re}){const[F,S]=l.useState([]),[ne,te]=l.useState(!0),[se,E]=l.useState(!1);l.useEffect(()=>{let e=!0;async function le(){try{const oe=await me(pe);if(!e)return;const de=oe.filter(w=>w.id.startsWith(ue)).sort((w,ce)=>w.name.localeCompare(ce.name));S(de),E(!1)}catch{if(!e)return;S([]),E(!0)}finally{e&&te(!1)}}return le(),()=>{e=!1}},[]);const ie=l.useMemo(()=>i.length>0&&!F.some(e=>e.id===i),[F,i]);return se?React.createElement("div",{className:a.fieldGroup},React.createElement("label",{className:a.label,htmlFor:s},y),React.createElement("input",{className:a.fallbackInput,id:s,onChange:e=>C(e.target.value),type:"text",value:i}),React.createElement("p",{className:a.errorHint},he)):ne?React.createElement("div",{className:a.fieldGroup},React.createElement("label",{className:a.label,htmlFor:s},y),React.createElement("select",{className:a.select,defaultValue:"",disabled:!0,id:s},React.createElement("option",{value:""},ge))):React.createElement("div",{className:a.fieldGroup},React.createElement("label",{className:a.label,htmlFor:s},y),React.createElement("select",{className:a.select,id:s,onChange:e=>C(e.target.value),value:i},React.createElement("option",{disabled:!0,value:""},"— ",re??fe," —"),ie&&React.createElement("option",{value:i},je(i)),F.map(e=>React.createElement("option",{key:e.id,value:e.id},e.name," (",e.id,")"))))}ae.__docgenInfo={description:"Loads Jira custom fields and lets settings panels store the selected Jira field ID.",methods:[],displayName:"JiraFieldPicker",props:{id:{required:!0,tsType:{name:"string"},description:""},label:{required:!0,tsType:{name:"string"},description:""},value:{required:!0,tsType:{name:"string"},description:""},onChange:{required:!0,tsType:{name:"signature",type:"function",raw:"(fieldId: string) => void",signature:{arguments:[{type:{name:"string"},name:"fieldId"}],return:{name:"void"}}},description:""},placeholder:{required:!1,tsType:{name:"string"},description:""}}};const o=[{id:"customfield_10001",name:"Epic Link"},{id:"customfield_10002",name:"Story Points"},{id:"customfield_10003",name:"Sprint"},{id:"customfield_10004",name:"Team"},{id:"customfield_10005",name:"Fix Version"}],ke={title:"Components/JiraFieldPicker",component:ae,parameters:{layout:"centered"},argTypes:{onChange:{action:"onChange"}}},d={args:{id:"jira-field-picker-1",label:"Select Custom Field",value:"customfield_10001",placeholder:"Choose a field..."},parameters:{msw:{handlers:[r.get("/api/jira/fields",async()=>(await n(300),t.json(o)))]}}},c={args:{id:"jira-field-picker-no-placeholder",label:"Jira Field",value:"customfield_10002"},parameters:{msw:{handlers:[r.get("/api/jira/fields",async()=>(await n(200),t.json(o)))]}}},m={args:{id:"jira-field-picker-unset",label:"Map to Jira Field",value:"",placeholder:"Choose a field..."},parameters:{msw:{handlers:[r.get("/api/jira/fields",async()=>(await n(200),t.json(o)))]}}},p={args:{id:"jira-field-picker-loading",label:"Select Custom Field",value:"",placeholder:"Choose a field..."},parameters:{msw:{handlers:[r.get("/api/jira/fields",async()=>(await n("infinite"),t.json([])))]}}},u={args:{id:"jira-field-picker-error",label:"Select Custom Field",value:"customfield_10001",placeholder:"Choose a field..."},parameters:{msw:{handlers:[r.get("/api/jira/fields",async()=>(await n(300),t.json({error:"Unable to connect to Jira. Check your credentials."},{status:500})))]}}},f={args:{id:"jira-field-picker-network-error",label:"Select Custom Field",value:"customfield_10001",placeholder:"Choose a field..."},parameters:{msw:{handlers:[r.get("/api/jira/fields",async()=>(await n(400),t.error()))]}}},g={args:{id:"jira-field-picker-stale",label:"Select Custom Field",value:"customfield_99999",placeholder:"Choose a field..."},parameters:{msw:{handlers:[r.get("/api/jira/fields",async()=>(await n(300),t.json(o)))]}}},h={args:{id:"jira-field-picker-stale-error",label:"Legacy Field Mapping",value:"customfield_20042",placeholder:"Choose a field..."},parameters:{msw:{handlers:[r.get("/api/jira/fields",async()=>(await n(350),t.json({error:"Jira API rate limit exceeded."},{status:429})))]}}},_={args:{id:"jira-field-picker-large",label:"Select Custom Field",value:"customfield_10015",placeholder:"Choose a field..."},parameters:{msw:{handlers:[r.get("/api/jira/fields",async()=>(await n(400),t.json([{id:"customfield_10001",name:"Epic Link"},{id:"customfield_10002",name:"Story Points"},{id:"customfield_10003",name:"Sprint"},{id:"customfield_10004",name:"Team"},{id:"customfield_10005",name:"Fix Version"},{id:"customfield_10006",name:"Priority"},{id:"customfield_10007",name:"Component"},{id:"customfield_10008",name:"Labels"},{id:"customfield_10009",name:"Affects Version"},{id:"customfield_10010",name:"Environment"},{id:"customfield_10011",name:"Due Date"},{id:"customfield_10012",name:"Severity"},{id:"customfield_10013",name:"Assignee"},{id:"customfield_10014",name:"Reporter"},{id:"customfield_10015",name:"Development Team"},{id:"customfield_10016",name:"Acceptance Criteria"},{id:"customfield_10017",name:"Release Date"},{id:"customfield_10018",name:"Epic Name"},{id:"customfield_10019",name:"Flagged"},{id:"customfield_10020",name:"Rank"}])))]}}},j={args:{id:"jira-field-picker-slow",label:"Select Custom Field",value:"customfield_10003",placeholder:"Choose a field..."},parameters:{msw:{handlers:[r.get("/api/jira/fields",async()=>(await n(3e3),t.json(o)))]}}};var R,k,b;d.parameters={...d.parameters,docs:{...(R=d.parameters)==null?void 0:R.docs,source:{originalSource:`{
  args: {
    id: 'jira-field-picker-1',
    label: 'Select Custom Field',
    value: 'customfield_10001',
    placeholder: 'Choose a field...'
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/fields', async () => {
        await delay(300);
        return HttpResponse.json(defaultFields);
      })]
    }
  }
}`,...(b=(k=d.parameters)==null?void 0:k.docs)==null?void 0:b.source}}};var v,L,N;c.parameters={...c.parameters,docs:{...(v=c.parameters)==null?void 0:v.docs,source:{originalSource:`{
  args: {
    id: 'jira-field-picker-no-placeholder',
    label: 'Jira Field',
    value: 'customfield_10002'
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/fields', async () => {
        await delay(200);
        return HttpResponse.json(defaultFields);
      })]
    }
  }
}`,...(N=(L=c.parameters)==null?void 0:L.docs)==null?void 0:N.source}}};var T,D,I;m.parameters={...m.parameters,docs:{...(T=m.parameters)==null?void 0:T.docs,source:{originalSource:`{
  args: {
    id: 'jira-field-picker-unset',
    label: 'Map to Jira Field',
    value: '',
    placeholder: 'Choose a field...'
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/fields', async () => {
        await delay(200);
        return HttpResponse.json(defaultFields);
      })]
    }
  }
}`,...(I=(D=m.parameters)==null?void 0:D.docs)==null?void 0:I.source}}};var P,A,H;p.parameters={...p.parameters,docs:{...(P=p.parameters)==null?void 0:P.docs,source:{originalSource:`{
  args: {
    id: 'jira-field-picker-loading',
    label: 'Select Custom Field',
    value: '',
    placeholder: 'Choose a field...'
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/fields', async () => {
        // Never resolves — keeps the component in loading state indefinitely
        await delay('infinite');
        return HttpResponse.json([]);
      })]
    }
  }
}`,...(H=(A=p.parameters)==null?void 0:A.docs)==null?void 0:H.source}}};var J,V,x;u.parameters={...u.parameters,docs:{...(J=u.parameters)==null?void 0:J.docs,source:{originalSource:`{
  args: {
    id: 'jira-field-picker-error',
    label: 'Select Custom Field',
    value: 'customfield_10001',
    placeholder: 'Choose a field...'
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/fields', async () => {
        await delay(300);
        return HttpResponse.json({
          error: 'Unable to connect to Jira. Check your credentials.'
        }, {
          status: 500
        });
      })]
    }
  }
}`,...(x=(V=u.parameters)==null?void 0:V.docs)==null?void 0:x.source}}};var O,U,M;f.parameters={...f.parameters,docs:{...(O=f.parameters)==null?void 0:O.docs,source:{originalSource:`{
  args: {
    id: 'jira-field-picker-network-error',
    label: 'Select Custom Field',
    value: 'customfield_10001',
    placeholder: 'Choose a field...'
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/fields', async () => {
        await delay(400);
        return HttpResponse.error();
      })]
    }
  }
}`,...(M=(U=f.parameters)==null?void 0:U.docs)==null?void 0:M.source}}};var q,G,W;g.parameters={...g.parameters,docs:{...(q=g.parameters)==null?void 0:q.docs,source:{originalSource:`{
  args: {
    id: 'jira-field-picker-stale',
    label: 'Select Custom Field',
    value: 'customfield_99999',
    placeholder: 'Choose a field...'
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/fields', async () => {
        await delay(300);
        // Response does NOT include customfield_99999
        return HttpResponse.json(defaultFields);
      })]
    }
  }
}`,...(W=(G=g.parameters)==null?void 0:G.docs)==null?void 0:W.source}}};var X,B,$;h.parameters={...h.parameters,docs:{...(X=h.parameters)==null?void 0:X.docs,source:{originalSource:`{
  args: {
    id: 'jira-field-picker-stale-error',
    label: 'Legacy Field Mapping',
    value: 'customfield_20042',
    placeholder: 'Choose a field...'
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/fields', async () => {
        await delay(350);
        return HttpResponse.json({
          error: 'Jira API rate limit exceeded.'
        }, {
          status: 429
        });
      })]
    }
  }
}`,...($=(B=h.parameters)==null?void 0:B.docs)==null?void 0:$.source}}};var Y,z,K;_.parameters={..._.parameters,docs:{...(Y=_.parameters)==null?void 0:Y.docs,source:{originalSource:`{
  args: {
    id: 'jira-field-picker-large',
    label: 'Select Custom Field',
    value: 'customfield_10015',
    placeholder: 'Choose a field...'
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/fields', async () => {
        await delay(400);
        return HttpResponse.json([{
          id: 'customfield_10001',
          name: 'Epic Link'
        }, {
          id: 'customfield_10002',
          name: 'Story Points'
        }, {
          id: 'customfield_10003',
          name: 'Sprint'
        }, {
          id: 'customfield_10004',
          name: 'Team'
        }, {
          id: 'customfield_10005',
          name: 'Fix Version'
        }, {
          id: 'customfield_10006',
          name: 'Priority'
        }, {
          id: 'customfield_10007',
          name: 'Component'
        }, {
          id: 'customfield_10008',
          name: 'Labels'
        }, {
          id: 'customfield_10009',
          name: 'Affects Version'
        }, {
          id: 'customfield_10010',
          name: 'Environment'
        }, {
          id: 'customfield_10011',
          name: 'Due Date'
        }, {
          id: 'customfield_10012',
          name: 'Severity'
        }, {
          id: 'customfield_10013',
          name: 'Assignee'
        }, {
          id: 'customfield_10014',
          name: 'Reporter'
        }, {
          id: 'customfield_10015',
          name: 'Development Team'
        }, {
          id: 'customfield_10016',
          name: 'Acceptance Criteria'
        }, {
          id: 'customfield_10017',
          name: 'Release Date'
        }, {
          id: 'customfield_10018',
          name: 'Epic Name'
        }, {
          id: 'customfield_10019',
          name: 'Flagged'
        }, {
          id: 'customfield_10020',
          name: 'Rank'
        }]);
      })]
    }
  }
}`,...(K=(z=_.parameters)==null?void 0:z.docs)==null?void 0:K.source}}};var Q,Z,ee;j.parameters={...j.parameters,docs:{...(Q=j.parameters)==null?void 0:Q.docs,source:{originalSource:`{
  args: {
    id: 'jira-field-picker-slow',
    label: 'Select Custom Field',
    value: 'customfield_10003',
    placeholder: 'Choose a field...'
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/fields', async () => {
        await delay(3000);
        return HttpResponse.json(defaultFields);
      })]
    }
  }
}`,...(ee=(Z=j.parameters)==null?void 0:Z.docs)==null?void 0:ee.source}}};const be=["Default","NoPlaceholder","UnsetValue","Loading","ErrorState","NetworkError","StaleValue","StaleValueWithError","LargeFieldList","SlowNetwork"];export{d as Default,u as ErrorState,_ as LargeFieldList,p as Loading,f as NetworkError,c as NoPlaceholder,j as SlowNetwork,g as StaleValue,h as StaleValueWithError,m as UnsetValue,be as __namedExportsOrder,ke as default};
