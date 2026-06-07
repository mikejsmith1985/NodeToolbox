import{h as e}from"./index-B5IrvpLZ.js";import{r as a}from"./index-Bc2G9s8g.js";import{f as ue,a as me,b as le,u as de,r as ge}from"./schedulerApi-DP4jKkp2.js";import{H as t}from"./cookieStore-CKwAPFhE.js";import{d as i}from"./delay-F0IbJbgL.js";import"./isObject-DVTTJpIa.js";const he="_panel_icrk0_5",ye="_syncStatus_icrk0_17",fe="_statusDot_icrk0_29",Re="_statusDotActive_icrk0_41",je="_statusDotIdle_icrk0_49",ve="_countdownDisplay_icrk0_57",Ee="_syncControls_icrk0_75",we="_primaryBtn_icrk0_85",Se="_secondaryBtn_icrk0_105",Me="_errorText_icrk0_125",He="_syncLogContainer_icrk0_137",be="_syncLogHeader_icrk0_149",_e="_syncLog_icrk0_137",Ae="_syncLogEntry_icrk0_183",Te="_emptyState_icrk0_197",n={panel:he,syncStatus:ye,statusDot:fe,statusDotActive:Re,statusDotIdle:je,countdownDisplay:ve,syncControls:Ee,primaryBtn:we,secondaryBtn:Se,errorText:Me,syncLogContainer:He,syncLogHeader:be,syncLog:_e,syncLogEntry:Ae,emptyState:Te};function ae(){const[p,ie]=a.useState(null),[s,pe]=a.useState(null),[_,ce]=a.useState([]),[A,l]=a.useState(!1),[T,d]=a.useState(null),c=a.useCallback(async()=>{d(null);try{const[r,o,M]=await Promise.all([ue(),me(),le()]);ie(r.repoMonitor),pe(o),ce(M.repoMonitor.events)}catch(r){const o=r instanceof Error?r.message:String(r);d(o)}},[]);a.useEffect(()=>{const r=setTimeout(()=>{c()},0);return()=>clearTimeout(r)},[c]),a.useEffect(()=>{const r=setInterval(()=>{c()},15e3);return()=>clearInterval(r)},[c]);const u=(s==null?void 0:s.repoMonitor.enabled)??!1;return React.createElement("div",{className:n.panel},React.createElement("div",{className:n.syncStatus},React.createElement("span",{className:`${n.statusDot} ${u?n.statusDotActive:n.statusDotIdle}`,"aria-label":u?"Monitoring":"Stopped"}),React.createElement("span",null,u?"Monitor Active":"Monitor Stopped"),(s==null?void 0:s.repoMonitor.nextRunAt)&&React.createElement("span",{className:n.countdownDisplay},"Next run: ",new Date(s.repoMonitor.nextRunAt).toLocaleTimeString())),React.createElement("div",{className:n.syncControls},React.createElement("button",{className:n.primaryBtn,disabled:A||p===null,onClick:()=>{if(p===null)return;const r=!u;l(!0),de({repoMonitor:{...p,enabled:r}}).then(()=>c()).catch(o=>{const M=o instanceof Error?o.message:String(o);d(M)}).finally(()=>{l(!1)})}},u?"⏹ Stop Monitor":"▶ Start Monitor"),React.createElement("button",{className:n.secondaryBtn,disabled:A,onClick:()=>{l(!0),ge().then(()=>c()).catch(r=>{const o=r instanceof Error?r.message:String(r);d(o)}).finally(()=>{l(!1)})}},"Check Now")),T&&React.createElement("p",{className:n.errorText},T),React.createElement("div",{className:n.syncLogContainer},React.createElement("div",{className:n.syncLogHeader},React.createElement("span",null,"Legacy Monitor Status")),React.createElement("div",{className:n.syncLog},React.createElement("div",{className:n.syncLogEntry},"Configured repos: ",(s==null?void 0:s.repoMonitor.repos.length)??0),React.createElement("div",{className:n.syncLogEntry},"Event count: ",(s==null?void 0:s.repoMonitor.eventCount)??0),React.createElement("div",{className:n.syncLogEntry},"Last run: ",s!=null&&s.repoMonitor.lastRunAt?new Date(s.repoMonitor.lastRunAt).toLocaleString():"Never"),React.createElement("div",{className:n.syncLogEntry},"Branch pattern: ",(p==null?void 0:p.branchPattern)??"feature/[A-Z]+-\\d+"))),React.createElement("div",{className:n.syncLogContainer},React.createElement("div",{className:n.syncLogHeader},React.createElement("span",null,"Monitor Events")),React.createElement("div",{className:n.syncLog},_.length===0&&React.createElement("span",{className:n.emptyState},"No monitor log entries."),_.map((r,o)=>React.createElement("div",{key:`${r.timestamp}-${o}`,className:n.syncLogEntry},"[",new Date(r.timestamp).toLocaleTimeString(),"] ",r.repo," — ",r.jiraKey||"NO-KEY"," — ",r.message)))))}ae.__docgenInfo={description:"Renders the Repo Monitor tab backed by the legacy server scheduler endpoints.",methods:[],displayName:"RepoMonitorPanel"};const Be={title:"Components/RepoMonitorPanel",component:ae,parameters:{layout:"padded"}},H={repoMonitor:{enabled:!0,nextRunAt:"2024-01-15T14:30:00Z",repos:["repo-1","repo-2","repo-3"],eventCount:42,lastRunAt:"2024-01-15T14:15:00Z"}},m={branchPattern:"feature/[A-Z]+-\\d+"},b=[{timestamp:"2024-01-15T14:15:23Z",repo:"my-repo",jiraKey:"PROJ-123",message:"Branch feature/PROJ-123-fix-bug detected"},{timestamp:"2024-01-15T14:10:12Z",repo:"another-repo",jiraKey:null,message:"Branch feature/invalid pattern skipped"},{timestamp:"2024-01-15T14:05:47Z",repo:"my-repo",jiraKey:"PROJ-456",message:"Branch feature/PROJ-456-add-login detected"},{timestamp:"2024-01-15T14:00:33Z",repo:"backend-service",jiraKey:"CORE-789",message:"Branch feature/CORE-789-refactor-auth detected"}],g={parameters:{msw:{handlers:[e.get("/api/monitor/status",()=>t.json(H)),e.get("/api/monitor/config",()=>t.json(m)),e.get("/api/monitor/events",()=>t.json(b)),e.post("/api/monitor/start",()=>t.json({success:!0})),e.post("/api/monitor/stop",()=>t.json({success:!0}))]}}},h={parameters:{msw:{handlers:[e.get("/api/monitor/status",async()=>(await i("infinite"),t.json(H))),e.get("/api/monitor/config",async()=>(await i("infinite"),t.json(m))),e.get("/api/monitor/events",async()=>(await i("infinite"),t.json(b)))]}}},y={parameters:{msw:{handlers:[e.get("/api/monitor/status",()=>t.json({error:"Internal Server Error",message:"Failed to retrieve monitor status"},{status:500})),e.get("/api/monitor/config",()=>t.json({error:"Internal Server Error",message:"Failed to retrieve monitor configuration"},{status:500})),e.get("/api/monitor/events",()=>t.json({error:"Internal Server Error",message:"Failed to retrieve monitor events"},{status:500}))]}}},f={parameters:{msw:{handlers:[e.get("/api/monitor/status",()=>t.json({repoMonitor:{enabled:!0,nextRunAt:"2024-01-15T14:30:00Z",repos:["repo-1","repo-2"],eventCount:0,lastRunAt:"2024-01-15T14:15:00Z"}})),e.get("/api/monitor/config",()=>t.json(m)),e.get("/api/monitor/events",()=>t.json([])),e.post("/api/monitor/start",()=>t.json({success:!0})),e.post("/api/monitor/stop",()=>t.json({success:!0}))]}}},R={parameters:{msw:{handlers:[e.get("/api/monitor/status",()=>t.json({repoMonitor:{enabled:!1,nextRunAt:null,repos:[],eventCount:0,lastRunAt:"2024-01-14T09:00:00Z"}})),e.get("/api/monitor/config",()=>t.json(m)),e.get("/api/monitor/events",()=>t.json([])),e.post("/api/monitor/start",()=>t.json({success:!0})),e.post("/api/monitor/stop",()=>t.json({success:!0}))]}}},j={parameters:{msw:{handlers:[e.get("/api/monitor/status",()=>t.json({repoMonitor:{enabled:!1,nextRunAt:void 0,repos:["repo-1"],eventCount:5,lastRunAt:"2024-01-13T16:45:00Z"}})),e.get("/api/monitor/config",()=>t.json({branchPattern:"feature/[A-Z]+-\\d+"})),e.get("/api/monitor/events",()=>t.json([{timestamp:"2024-01-13T16:45:12Z",repo:"repo-1",jiraKey:"TEAM-101",message:"Branch feature/TEAM-101-dashboard-redesign detected"}])),e.post("/api/monitor/start",()=>t.json({success:!0})),e.post("/api/monitor/stop",()=>t.json({success:!0}))]}}},v={parameters:{msw:{handlers:[e.get("/api/monitor/status",async()=>(await i(3e3),t.json(H))),e.get("/api/monitor/config",async()=>(await i(3e3),t.json(m))),e.get("/api/monitor/events",async()=>(await i(3e3),t.json(b))),e.post("/api/monitor/start",async()=>(await i(5e3),t.json({success:!0}))),e.post("/api/monitor/stop",async()=>(await i(5e3),t.json({success:!0})))]}}},E={parameters:{msw:{handlers:[e.get("/api/monitor/status",()=>t.error()),e.get("/api/monitor/config",()=>t.error()),e.get("/api/monitor/events",()=>t.error())]}}},w={parameters:{msw:{handlers:[e.get("/api/monitor/status",()=>t.json({error:"Unauthorized",message:"Session expired. Please log in again."},{status:401})),e.get("/api/monitor/config",()=>t.json({error:"Unauthorized",message:"Session expired. Please log in again."},{status:401})),e.get("/api/monitor/events",()=>t.json({error:"Unauthorized",message:"Session expired. Please log in again."},{status:401}))]}}},S={parameters:{msw:{handlers:[e.get("/api/monitor/status",()=>t.json({repoMonitor:{enabled:!0,nextRunAt:"2024-01-15T15:00:00Z",repos:["frontend-app","backend-api","data-pipeline","auth-service","notification-service","analytics-engine","mobile-app","admin-portal","reporting-service","integration-hub"],eventCount:1247,lastRunAt:"2024-01-15T14:45:00Z"}})),e.get("/api/monitor/config",()=>t.json({branchPattern:"(feature|bugfix|hotfix)/[A-Z]+-\\d+"})),e.get("/api/monitor/events",()=>t.json([{timestamp:"2024-01-15T14:45:55Z",repo:"frontend-app",jiraKey:"UI-2045",message:"Branch feature/UI-2045-dark-mode-toggle detected"},{timestamp:"2024-01-15T14:45:33Z",repo:"backend-api",jiraKey:"API-998",message:"Branch feature/API-998-rate-limiting detected"},{timestamp:"2024-01-15T14:44:12Z",repo:"auth-service",jiraKey:"SEC-301",message:"Branch hotfix/SEC-301-jwt-expiry-fix detected"},{timestamp:"2024-01-15T14:43:47Z",repo:"data-pipeline",jiraKey:null,message:"Branch wip/experiment-new-ingestion skipped"},{timestamp:"2024-01-15T14:42:19Z",repo:"mobile-app",jiraKey:"MOB-567",message:"Branch feature/MOB-567-biometric-auth detected"}])),e.post("/api/monitor/start",()=>t.json({success:!0})),e.post("/api/monitor/stop",()=>t.json({success:!0}))]}}};var x,C,Z;g.parameters={...g.parameters,docs:{...(x=g.parameters)==null?void 0:x.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/monitor/status', () => {
        return HttpResponse.json(monitorStatus);
      }), http.get('/api/monitor/config', () => {
        return HttpResponse.json(monitorConfig);
      }), http.get('/api/monitor/events', () => {
        return HttpResponse.json(monitorEvents);
      }), http.post('/api/monitor/start', () => {
        return HttpResponse.json({
          success: true
        });
      }), http.post('/api/monitor/stop', () => {
        return HttpResponse.json({
          success: true
        });
      })]
    }
  }
}`,...(Z=(C=g.parameters)==null?void 0:C.docs)==null?void 0:Z.source}}};var k,N,L;h.parameters={...h.parameters,docs:{...(k=h.parameters)==null?void 0:k.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/monitor/status', async () => {
        await delay('infinite');
        return HttpResponse.json(monitorStatus);
      }), http.get('/api/monitor/config', async () => {
        await delay('infinite');
        return HttpResponse.json(monitorConfig);
      }), http.get('/api/monitor/events', async () => {
        await delay('infinite');
        return HttpResponse.json(monitorEvents);
      })]
    }
  }
}`,...(L=(N=h.parameters)==null?void 0:N.docs)==null?void 0:L.source}}};var B,P,I;y.parameters={...y.parameters,docs:{...(B=y.parameters)==null?void 0:B.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/monitor/status', () => {
        return HttpResponse.json({
          error: 'Internal Server Error',
          message: 'Failed to retrieve monitor status'
        }, {
          status: 500
        });
      }), http.get('/api/monitor/config', () => {
        return HttpResponse.json({
          error: 'Internal Server Error',
          message: 'Failed to retrieve monitor configuration'
        }, {
          status: 500
        });
      }), http.get('/api/monitor/events', () => {
        return HttpResponse.json({
          error: 'Internal Server Error',
          message: 'Failed to retrieve monitor events'
        }, {
          status: 500
        });
      })]
    }
  }
}`,...(I=(P=y.parameters)==null?void 0:P.docs)==null?void 0:I.source}}};var D,K,O;f.parameters={...f.parameters,docs:{...(D=f.parameters)==null?void 0:D.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/monitor/status', () => {
        return HttpResponse.json({
          repoMonitor: {
            enabled: true,
            nextRunAt: '2024-01-15T14:30:00Z',
            repos: ['repo-1', 'repo-2'],
            eventCount: 0,
            lastRunAt: '2024-01-15T14:15:00Z'
          }
        });
      }), http.get('/api/monitor/config', () => {
        return HttpResponse.json(monitorConfig);
      }), http.get('/api/monitor/events', () => {
        return HttpResponse.json([]);
      }), http.post('/api/monitor/start', () => {
        return HttpResponse.json({
          success: true
        });
      }), http.post('/api/monitor/stop', () => {
        return HttpResponse.json({
          success: true
        });
      })]
    }
  }
}`,...(O=(K=f.parameters)==null?void 0:K.docs)==null?void 0:O.source}}};var U,z,F;R.parameters={...R.parameters,docs:{...(U=R.parameters)==null?void 0:U.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/monitor/status', () => {
        return HttpResponse.json({
          repoMonitor: {
            enabled: false,
            nextRunAt: null,
            repos: [],
            eventCount: 0,
            lastRunAt: '2024-01-14T09:00:00Z'
          }
        });
      }), http.get('/api/monitor/config', () => {
        return HttpResponse.json(monitorConfig);
      }), http.get('/api/monitor/events', () => {
        return HttpResponse.json([]);
      }), http.post('/api/monitor/start', () => {
        return HttpResponse.json({
          success: true
        });
      }), http.post('/api/monitor/stop', () => {
        return HttpResponse.json({
          success: true
        });
      })]
    }
  }
}`,...(F=(z=R.parameters)==null?void 0:z.docs)==null?void 0:F.source}}};var J,$,V;j.parameters={...j.parameters,docs:{...(J=j.parameters)==null?void 0:J.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/monitor/status', () => {
        return HttpResponse.json({
          repoMonitor: {
            enabled: false,
            nextRunAt: undefined,
            repos: ['repo-1'],
            eventCount: 5,
            lastRunAt: '2024-01-13T16:45:00Z'
          }
        });
      }), http.get('/api/monitor/config', () => {
        return HttpResponse.json({
          branchPattern: 'feature/[A-Z]+-\\\\d+'
        });
      }), http.get('/api/monitor/events', () => {
        return HttpResponse.json([{
          timestamp: '2024-01-13T16:45:12Z',
          repo: 'repo-1',
          jiraKey: 'TEAM-101',
          message: 'Branch feature/TEAM-101-dashboard-redesign detected'
        }]);
      }), http.post('/api/monitor/start', () => {
        return HttpResponse.json({
          success: true
        });
      }), http.post('/api/monitor/stop', () => {
        return HttpResponse.json({
          success: true
        });
      })]
    }
  }
}`,...(V=($=j.parameters)==null?void 0:$.docs)==null?void 0:V.source}}};var Y,q,G;v.parameters={...v.parameters,docs:{...(Y=v.parameters)==null?void 0:Y.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/monitor/status', async () => {
        await delay(3000);
        return HttpResponse.json(monitorStatus);
      }), http.get('/api/monitor/config', async () => {
        await delay(3000);
        return HttpResponse.json(monitorConfig);
      }), http.get('/api/monitor/events', async () => {
        await delay(3000);
        return HttpResponse.json(monitorEvents);
      }), http.post('/api/monitor/start', async () => {
        await delay(5000);
        return HttpResponse.json({
          success: true
        });
      }), http.post('/api/monitor/stop', async () => {
        await delay(5000);
        return HttpResponse.json({
          success: true
        });
      })]
    }
  }
}`,...(G=(q=v.parameters)==null?void 0:q.docs)==null?void 0:G.source}}};var Q,W,X;E.parameters={...E.parameters,docs:{...(Q=E.parameters)==null?void 0:Q.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/monitor/status', () => {
        return HttpResponse.error();
      }), http.get('/api/monitor/config', () => {
        return HttpResponse.error();
      }), http.get('/api/monitor/events', () => {
        return HttpResponse.error();
      })]
    }
  }
}`,...(X=(W=E.parameters)==null?void 0:W.docs)==null?void 0:X.source}}};var ee,te,ne;w.parameters={...w.parameters,docs:{...(ee=w.parameters)==null?void 0:ee.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/monitor/status', () => {
        return HttpResponse.json({
          error: 'Unauthorized',
          message: 'Session expired. Please log in again.'
        }, {
          status: 401
        });
      }), http.get('/api/monitor/config', () => {
        return HttpResponse.json({
          error: 'Unauthorized',
          message: 'Session expired. Please log in again.'
        }, {
          status: 401
        });
      }), http.get('/api/monitor/events', () => {
        return HttpResponse.json({
          error: 'Unauthorized',
          message: 'Session expired. Please log in again.'
        }, {
          status: 401
        });
      })]
    }
  }
}`,...(ne=(te=w.parameters)==null?void 0:te.docs)==null?void 0:ne.source}}};var re,se,oe;S.parameters={...S.parameters,docs:{...(re=S.parameters)==null?void 0:re.docs,source:{originalSource:`{
  parameters: {
    msw: {
      handlers: [http.get('/api/monitor/status', () => {
        return HttpResponse.json({
          repoMonitor: {
            enabled: true,
            nextRunAt: '2024-01-15T15:00:00Z',
            repos: ['frontend-app', 'backend-api', 'data-pipeline', 'auth-service', 'notification-service', 'analytics-engine', 'mobile-app', 'admin-portal', 'reporting-service', 'integration-hub'],
            eventCount: 1247,
            lastRunAt: '2024-01-15T14:45:00Z'
          }
        });
      }), http.get('/api/monitor/config', () => {
        return HttpResponse.json({
          branchPattern: '(feature|bugfix|hotfix)/[A-Z]+-\\\\d+'
        });
      }), http.get('/api/monitor/events', () => {
        return HttpResponse.json([{
          timestamp: '2024-01-15T14:45:55Z',
          repo: 'frontend-app',
          jiraKey: 'UI-2045',
          message: 'Branch feature/UI-2045-dark-mode-toggle detected'
        }, {
          timestamp: '2024-01-15T14:45:33Z',
          repo: 'backend-api',
          jiraKey: 'API-998',
          message: 'Branch feature/API-998-rate-limiting detected'
        }, {
          timestamp: '2024-01-15T14:44:12Z',
          repo: 'auth-service',
          jiraKey: 'SEC-301',
          message: 'Branch hotfix/SEC-301-jwt-expiry-fix detected'
        }, {
          timestamp: '2024-01-15T14:43:47Z',
          repo: 'data-pipeline',
          jiraKey: null,
          message: 'Branch wip/experiment-new-ingestion skipped'
        }, {
          timestamp: '2024-01-15T14:42:19Z',
          repo: 'mobile-app',
          jiraKey: 'MOB-567',
          message: 'Branch feature/MOB-567-biometric-auth detected'
        }]);
      }), http.post('/api/monitor/start', () => {
        return HttpResponse.json({
          success: true
        });
      }), http.post('/api/monitor/stop', () => {
        return HttpResponse.json({
          success: true
        });
      })]
    }
  }
}`,...(oe=(se=S.parameters)==null?void 0:se.docs)==null?void 0:oe.source}}};const Pe=["Default","InitialLoad","APIError","EmptyEvents","MonitorDisabled","NoNextRunAt","SlowAPIInProgress","NetworkError","Unauthorized","LargeDataset"];export{y as APIError,g as Default,f as EmptyEvents,h as InitialLoad,S as LargeDataset,R as MonitorDisabled,E as NetworkError,j as NoNextRunAt,v as SlowAPIInProgress,w as Unauthorized,Pe as __namedExportsOrder,Be as default};
