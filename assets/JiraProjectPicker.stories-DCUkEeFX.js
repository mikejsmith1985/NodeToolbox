import{h as o}from"./index-B5IrvpLZ.js";import{r as c}from"./index-Bc2G9s8g.js";import{j as te}from"./jiraApi-Zc4wcNPg.js";import{s as t}from"./JiraPicker.module-DUm0jMy4.js";import{d as n}from"./delay-F0IbJbgL.js";import{H as s}from"./cookieStore-CKwAPFhE.js";import"./isObject-DVTTJpIa.js";const oe="/rest/api/2/project",ne="Select a project",se="Loading projects…",ce="Could not load Jira projects. You can still enter the project key manually.",le="Current project";function ie(e){return`${le} (${e})`}function Y({id:e,label:l,value:a,onChange:S,placeholder:B}){const[P,f]=c.useState([]),[U,W]=c.useState(!0),[X,E]=c.useState(!1);c.useEffect(()=>{let r=!0;async function Q(){try{const Z=await te(oe);if(!r)return;const ee=[...Z].sort((re,ae)=>re.name.localeCompare(ae.name));f(ee),E(!1)}catch{if(!r)return;f([]),E(!0)}finally{r&&W(!1)}}return Q(),()=>{r=!1}},[]);const z=c.useMemo(()=>a.length>0&&!P.some(r=>r.key===a),[P,a]);return X?React.createElement("div",{className:t.fieldGroup},React.createElement("label",{className:t.label,htmlFor:e},l),React.createElement("input",{className:t.fallbackInput,id:e,onChange:r=>S(r.target.value),type:"text",value:a}),React.createElement("p",{className:t.errorHint},ce)):U?React.createElement("div",{className:t.fieldGroup},React.createElement("label",{className:t.label,htmlFor:e},l),React.createElement("select",{className:t.select,defaultValue:"",disabled:!0,id:e},React.createElement("option",{value:""},se))):React.createElement("div",{className:t.fieldGroup},React.createElement("label",{className:t.label,htmlFor:e},l),React.createElement("select",{className:t.select,id:e,onChange:r=>S(r.target.value),value:a},React.createElement("option",{disabled:!0,value:""},"— ",B??ne," —"),z&&React.createElement("option",{value:a},ie(a)),P.map(r=>React.createElement("option",{key:r.key,value:r.key},r.name," (",r.key,")"))))}Y.__docgenInfo={description:"Loads Jira projects and lets settings panels store the selected Jira project key.",methods:[],displayName:"JiraProjectPicker",props:{id:{required:!0,tsType:{name:"string"},description:""},label:{required:!0,tsType:{name:"string"},description:""},value:{required:!0,tsType:{name:"string"},description:""},onChange:{required:!0,tsType:{name:"signature",type:"function",raw:"(projectKey: string) => void",signature:{arguments:[{type:{name:"string"},name:"projectKey"}],return:{name:"void"}}},description:""},placeholder:{required:!1,tsType:{name:"string"},description:""}}};const he={title:"Components/JiraProjectPicker",component:Y,parameters:{layout:"centered"},tags:["autodocs"]},h=[{key:"PROJ",name:"Project Alpha"},{key:"MKTG",name:"Marketing Campaign"},{key:"INFRA",name:"Infrastructure Overhaul"},{key:"MOBILE",name:"Mobile App v2"},{key:"DATA",name:"Data Pipeline"},{key:"SEC",name:"Security Hardening"}],i={args:{id:"jira-project-picker-1",label:"Select Jira Project",value:"PROJ",onChange:e=>console.log("Selected:",e),placeholder:"Choose your project"},parameters:{msw:{handlers:[o.get("/api/jira/projects",async()=>(await n(300),s.json(h)))]}}},p={args:{id:"jira-project-picker-default-placeholder",label:"Jira Project",value:"",onChange:e=>console.log("Selected:",e)},parameters:{msw:{handlers:[o.get("/api/jira/projects",async()=>(await n(300),s.json(h)))]}}},j={args:{id:"jira-project-picker-loading",label:"Select Jira Project",value:"",onChange:e=>console.log("Selected:",e),placeholder:"Choose your project"},parameters:{msw:{handlers:[o.get("/api/jira/projects",async()=>(await n("infinite"),s.json([])))]}}},m={args:{id:"jira-project-picker-error",label:"Select Jira Project",value:"PROJ",onChange:e=>console.log("Selected:",e),placeholder:"Choose your project"},parameters:{msw:{handlers:[o.get("/api/jira/projects",async()=>(await n(200),new s(JSON.stringify({message:"Internal Server Error"}),{status:500})))]}}},d={args:{id:"jira-project-picker-stale",label:"Select Jira Project",value:"LEGACY",onChange:e=>console.log("Selected:",e),placeholder:"Choose your project"},parameters:{msw:{handlers:[o.get("/api/jira/projects",async()=>(await n(300),s.json(h)))]}}},u={args:{id:"jira-project-picker-empty",label:"Select Jira Project",value:"",onChange:e=>console.log("Selected:",e),placeholder:"Choose your project"},parameters:{msw:{handlers:[o.get("/api/jira/projects",async()=>(await n(300),s.json(h)))]}}},g={args:{id:"jira-project-picker-empty-list",label:"Select Jira Project",value:"",onChange:e=>console.log("Selected:",e),placeholder:"No projects available"},parameters:{msw:{handlers:[o.get("/api/jira/projects",async()=>(await n(300),s.json([])))]}}},y={args:{id:"jira-project-picker-large",label:"Select Jira Project",value:"TEAM-42",onChange:e=>console.log("Selected:",e),placeholder:"Choose your project"},parameters:{msw:{handlers:[o.get("/api/jira/projects",async()=>{await n(300);const e=Array.from({length:60},(l,a)=>({key:`TEAM-${a+1}`,name:`Team Project ${a+1}`}));return s.json(e)})]}}};var k,C,R;i.parameters={...i.parameters,docs:{...(k=i.parameters)==null?void 0:k.docs,source:{originalSource:`{
  args: {
    id: 'jira-project-picker-1',
    label: 'Select Jira Project',
    value: 'PROJ',
    onChange: (projectKey: string) => console.log('Selected:', projectKey),
    placeholder: 'Choose your project'
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/projects', async () => {
        await delay(300);
        return HttpResponse.json(mockProjects);
      })]
    }
  }
}`,...(R=(C=i.parameters)==null?void 0:C.docs)==null?void 0:R.source}}};var w,b,v;p.parameters={...p.parameters,docs:{...(w=p.parameters)==null?void 0:w.docs,source:{originalSource:`{
  args: {
    id: 'jira-project-picker-default-placeholder',
    label: 'Jira Project',
    value: '',
    onChange: (projectKey: string) => console.log('Selected:', projectKey)
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/projects', async () => {
        await delay(300);
        return HttpResponse.json(mockProjects);
      })]
    }
  }
}`,...(v=(b=p.parameters)==null?void 0:b.docs)==null?void 0:v.source}}};var L,J,A;j.parameters={...j.parameters,docs:{...(L=j.parameters)==null?void 0:L.docs,source:{originalSource:`{
  args: {
    id: 'jira-project-picker-loading',
    label: 'Select Jira Project',
    value: '',
    onChange: (projectKey: string) => console.log('Selected:', projectKey),
    placeholder: 'Choose your project'
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/projects', async () => {
        // Never resolves — keeps component in loading state indefinitely
        await delay('infinite');
        return HttpResponse.json([]);
      })]
    }
  }
}`,...(A=(J=j.parameters)==null?void 0:J.docs)==null?void 0:A.source}}};var N,T,K;m.parameters={...m.parameters,docs:{...(N=m.parameters)==null?void 0:N.docs,source:{originalSource:`{
  args: {
    id: 'jira-project-picker-error',
    label: 'Select Jira Project',
    value: 'PROJ',
    onChange: (projectKey: string) => console.log('Selected:', projectKey),
    placeholder: 'Choose your project'
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/projects', async () => {
        await delay(200);
        return new HttpResponse(JSON.stringify({
          message: 'Internal Server Error'
        }), {
          status: 500
        });
      })]
    }
  }
}`,...(K=(T=m.parameters)==null?void 0:T.docs)==null?void 0:K.source}}};var H,O,_;d.parameters={...d.parameters,docs:{...(H=d.parameters)==null?void 0:H.docs,source:{originalSource:`{
  args: {
    id: 'jira-project-picker-stale',
    label: 'Select Jira Project',
    value: 'LEGACY',
    onChange: (projectKey: string) => console.log('Selected:', projectKey),
    placeholder: 'Choose your project'
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/projects', async () => {
        await delay(300);
        // LEGACY is intentionally absent from the returned list
        return HttpResponse.json(mockProjects);
      })]
    }
  }
}`,...(_=(O=d.parameters)==null?void 0:O.docs)==null?void 0:_.source}}};var I,M,D;u.parameters={...u.parameters,docs:{...(I=u.parameters)==null?void 0:I.docs,source:{originalSource:`{
  args: {
    id: 'jira-project-picker-empty',
    label: 'Select Jira Project',
    value: '',
    onChange: (projectKey: string) => console.log('Selected:', projectKey),
    placeholder: 'Choose your project'
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/projects', async () => {
        await delay(300);
        return HttpResponse.json(mockProjects);
      })]
    }
  }
}`,...(D=(M=u.parameters)==null?void 0:M.docs)==null?void 0:D.source}}};var G,F,$;g.parameters={...g.parameters,docs:{...(G=g.parameters)==null?void 0:G.docs,source:{originalSource:`{
  args: {
    id: 'jira-project-picker-empty-list',
    label: 'Select Jira Project',
    value: '',
    onChange: (projectKey: string) => console.log('Selected:', projectKey),
    placeholder: 'No projects available'
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/projects', async () => {
        await delay(300);
        return HttpResponse.json([]);
      })]
    }
  }
}`,...($=(F=g.parameters)==null?void 0:F.docs)==null?void 0:$.source}}};var q,V,x;y.parameters={...y.parameters,docs:{...(q=y.parameters)==null?void 0:q.docs,source:{originalSource:`{
  args: {
    id: 'jira-project-picker-large',
    label: 'Select Jira Project',
    value: 'TEAM-42',
    onChange: (projectKey: string) => console.log('Selected:', projectKey),
    placeholder: 'Choose your project'
  },
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/projects', async () => {
        await delay(300);
        const largeList = Array.from({
          length: 60
        }, (_, i) => ({
          key: \`TEAM-\${i + 1}\`,
          name: \`Team Project \${i + 1}\`
        }));
        return HttpResponse.json(largeList);
      })]
    }
  }
}`,...(x=(V=y.parameters)==null?void 0:V.docs)==null?void 0:x.source}}};const Pe=["Default","WithDefaultPlaceholder","Loading","ErrorFallback","StaleValue","NoSelection","EmptyProjectList","LargeProjectList"];export{i as Default,g as EmptyProjectList,m as ErrorFallback,y as LargeProjectList,j as Loading,u as NoSelection,d as StaleValue,p as WithDefaultPlaceholder,Pe as __namedExportsOrder,he as default};
