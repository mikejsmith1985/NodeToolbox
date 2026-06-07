import{h as s}from"./index-B5IrvpLZ.js";import{I as ws}from"./index-Br-SR0sR.js";import{H as e}from"./cookieStore-CKwAPFhE.js";import{d as js}from"./delay-F0IbJbgL.js";import"./index-Bc2G9s8g.js";import"./jiraApi-Zc4wcNPg.js";import"./richTextPlainText-DksmSAmy.js";import"./isObject-DVTTJpIa.js";const a={key:"JIRA-123",fields:{summary:"Fix login page styling issues",description:"The login page has misaligned form fields and buttons that don't work properly on mobile devices. This needs investigation and fixes across all supported browsers.",status:{name:"In Progress"},priority:{name:"High"},assignee:{displayName:"John Doe"},created:"2024-01-15T10:30:00.000Z",updated:"2024-01-20T14:45:00.000Z",customfield_10016:5}},r=[{id:"11",name:"To Do"},{id:"21",name:"In Progress"},{id:"31",name:"In Review"},{id:"41",name:"Done"}],n=[s.get("/api/jira/issues/:issueKey/transitions",()=>e.json({transitions:r})),s.post("/api/jira/issues/:issueKey/transitions",()=>e.json({},{status:204})),s.post("/api/jira/issues/:issueKey/comment",()=>e.json({id:"10001",body:"Comment posted successfully",author:{displayName:"John Doe"},created:new Date().toISOString()})),s.put("/api/jira/issues/:issueKey/storypoints",()=>e.json({},{status:204}))],Cs={title:"Components/IssueDetailPanel",component:ws,parameters:{layout:"centered",msw:{handlers:n}},args:{issue:a,onIssueUpdated:()=>console.log("onIssueUpdated called"),isEmbedded:!1},argTypes:{onIssueUpdated:{action:"issueUpdated"}}},t={name:"Default (Happy Path)",parameters:{msw:{handlers:n}}},i={name:"Embedded Mode",args:{isEmbedded:!0},parameters:{msw:{handlers:n}}},o={name:"No Available Transitions",parameters:{msw:{handlers:[s.get("/api/jira/issues/:issueKey/transitions",()=>e.json({transitions:[]})),...n.slice(1)]}}},p={name:"Transitions Loading",parameters:{msw:{handlers:[s.get("/api/jira/issues/:issueKey/transitions",async()=>(await js("infinite"),e.json({transitions:r}))),...n.slice(1)]}}},d={name:"Transition Load Error",parameters:{msw:{handlers:[s.get("/api/jira/issues/:issueKey/transitions",()=>e.json({message:"Internal Server Error"},{status:500})),...n.slice(1)]}}},m={name:"Failed Transition Apply",parameters:{msw:{handlers:[s.get("/api/jira/issues/:issueKey/transitions",()=>e.json({transitions:r})),s.post("/api/jira/issues/:issueKey/transitions",()=>e.json({message:"Transition not allowed for current user"},{status:403})),...n.slice(2)]}}},u={name:"Empty Comment Submission",parameters:{msw:{handlers:n}}},l={name:"Failed Comment Post",parameters:{msw:{handlers:[s.get("/api/jira/issues/:issueKey/transitions",()=>e.json({transitions:r})),s.post("/api/jira/issues/:issueKey/transitions",()=>e.json({},{status:204})),s.post("/api/jira/issues/:issueKey/comment",()=>e.json({message:"You do not have permission to comment on this issue"},{status:403})),s.put("/api/jira/issues/:issueKey/storypoints",()=>e.json({},{status:204}))]}}},c={name:"Invalid Story Points Input",args:{issue:{...a,fields:{...a.fields,customfield_10016:null}}},parameters:{msw:{handlers:n}}},h={name:"Failed Story Points Save",parameters:{msw:{handlers:[s.get("/api/jira/issues/:issueKey/transitions",()=>e.json({transitions:r})),s.post("/api/jira/issues/:issueKey/transitions",()=>e.json({},{status:204})),s.post("/api/jira/issues/:issueKey/comment",()=>e.json({id:"10001",body:"Comment posted successfully",author:{displayName:"John Doe"},created:new Date().toISOString()})),s.put("/api/jira/issues/:issueKey/storypoints",()=>e.json({message:"Field customfield_10016 is not editable"},{status:400}))]}}},y={name:"Unassigned Issue",args:{issue:{...a,fields:{...a.fields,assignee:null}}},parameters:{msw:{handlers:n}}},g={name:"Missing Priority Field",args:{issue:{...a,fields:{...a.fields,priority:void 0}}},parameters:{msw:{handlers:n}}},f={name:"Long Description (Truncated)",args:{issue:{...a,fields:{...a.fields,description:"The login page has several critical issues that must be resolved before the upcoming release. Form fields are misaligned on screens smaller than 768px, causing a poor user experience. The submit button overlaps the 'Forgot password' link on iOS Safari 16. Additionally, the password visibility toggle does not function correctly in Firefox 120 or earlier. Error messages from the backend are not surfaced to the user, leaving them confused after a failed login attempt. We also need to ensure WCAG 2.1 AA compliance for all form elements including proper label associations and contrast ratios."}}},parameters:{msw:{handlers:n}}},b={name:"No Description",args:{issue:{...a,fields:{...a.fields,description:void 0}}},parameters:{msw:{handlers:n}}},w={name:"Panel — User Can Close",args:{isEmbedded:!1,onIssueUpdated:()=>console.log("onIssueUpdated called")},parameters:{msw:{handlers:n}}},j={name:"Bug Issue — Low Priority",args:{issue:{key:"JIRA-456",fields:{summary:"Dashboard chart fails to render on Safari 17",description:"Users on Safari 17 report a blank chart area on the main dashboard. The console shows a TypeError related to ResizeObserver. Reproduced on macOS Sonoma 14.2 and iOS 17.",status:{name:"Open"},priority:{name:"Low"},assignee:{displayName:"Sarah Kim"},created:"2024-02-03T08:00:00.000Z",updated:"2024-02-05T16:20:00.000Z",customfield_10016:3}}},parameters:{msw:{handlers:n}}},S={name:"Critical Priority — Done",args:{issue:{key:"JIRA-789",fields:{summary:"Security vulnerability in session token generation",description:"A weak PRNG was used for session token generation, making tokens predictable. Patched in v2.3.1 by switching to crypto.randomBytes(32).",status:{name:"Done"},priority:{name:"Critical"},assignee:{displayName:"Alex Petrov"},created:"2024-01-02T09:15:00.000Z",updated:"2024-01-10T11:00:00.000Z",customfield_10016:13}}},parameters:{msw:{handlers:n}}};var P,I,T;t.parameters={...t.parameters,docs:{...(P=t.parameters)==null?void 0:P.docs,source:{originalSource:`{
  name: 'Default (Happy Path)',
  parameters: {
    msw: {
      handlers: happyPathHandlers
    }
  }
}`,...(T=(I=t.parameters)==null?void 0:I.docs)==null?void 0:T.source}}};var v,H,K;i.parameters={...i.parameters,docs:{...(v=i.parameters)==null?void 0:v.docs,source:{originalSource:`{
  name: 'Embedded Mode',
  args: {
    isEmbedded: true
  },
  parameters: {
    msw: {
      handlers: happyPathHandlers
    }
  }
}`,...(K=(H=i.parameters)==null?void 0:H.docs)==null?void 0:K.source}}};var D,C,R;o.parameters={...o.parameters,docs:{...(D=o.parameters)==null?void 0:D.docs,source:{originalSource:`{
  name: 'No Available Transitions',
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/issues/:issueKey/transitions', () => {
        return HttpResponse.json({
          transitions: []
        });
      }), ...happyPathHandlers.slice(1)]
    }
  }
}`,...(R=(C=o.parameters)==null?void 0:C.docs)==null?void 0:R.source}}};var k,E,A;p.parameters={...p.parameters,docs:{...(k=p.parameters)==null?void 0:k.docs,source:{originalSource:`{
  name: 'Transitions Loading',
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/issues/:issueKey/transitions', async () => {
        await delay('infinite');
        return HttpResponse.json({
          transitions
        });
      }), ...happyPathHandlers.slice(1)]
    }
  }
}`,...(A=(E=p.parameters)==null?void 0:E.docs)==null?void 0:A.source}}};var F,N,U;d.parameters={...d.parameters,docs:{...(F=d.parameters)==null?void 0:F.docs,source:{originalSource:`{
  name: 'Transition Load Error',
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/issues/:issueKey/transitions', () => {
        return HttpResponse.json({
          message: 'Internal Server Error'
        }, {
          status: 500
        });
      }), ...happyPathHandlers.slice(1)]
    }
  }
}`,...(U=(N=d.parameters)==null?void 0:N.docs)==null?void 0:U.source}}};var L,O,x;m.parameters={...m.parameters,docs:{...(L=m.parameters)==null?void 0:L.docs,source:{originalSource:`{
  name: 'Failed Transition Apply',
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/issues/:issueKey/transitions', () => {
        return HttpResponse.json({
          transitions
        });
      }), http.post('/api/jira/issues/:issueKey/transitions', () => {
        return HttpResponse.json({
          message: 'Transition not allowed for current user'
        }, {
          status: 403
        });
      }), ...happyPathHandlers.slice(2)]
    }
  }
}`,...(x=(O=m.parameters)==null?void 0:O.docs)==null?void 0:x.source}}};var _,Z,J;u.parameters={...u.parameters,docs:{...(_=u.parameters)==null?void 0:_.docs,source:{originalSource:`{
  name: 'Empty Comment Submission',
  parameters: {
    msw: {
      handlers: happyPathHandlers
    }
  }
  // The story itself is the same UI; the empty-comment guard is internal state.
  // Storybook users can observe the validation feedback by trying to submit.
}`,...(J=(Z=u.parameters)==null?void 0:Z.docs)==null?void 0:J.source}}};var B,M,G;l.parameters={...l.parameters,docs:{...(B=l.parameters)==null?void 0:B.docs,source:{originalSource:`{
  name: 'Failed Comment Post',
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/issues/:issueKey/transitions', () => {
        return HttpResponse.json({
          transitions
        });
      }), http.post('/api/jira/issues/:issueKey/transitions', () => {
        return HttpResponse.json({}, {
          status: 204
        });
      }), http.post('/api/jira/issues/:issueKey/comment', () => {
        return HttpResponse.json({
          message: 'You do not have permission to comment on this issue'
        }, {
          status: 403
        });
      }), http.put('/api/jira/issues/:issueKey/storypoints', () => {
        return HttpResponse.json({}, {
          status: 204
        });
      })]
    }
  }
}`,...(G=(M=l.parameters)==null?void 0:M.docs)==null?void 0:G.source}}};var W,z,Y;c.parameters={...c.parameters,docs:{...(W=c.parameters)==null?void 0:W.docs,source:{originalSource:`{
  name: 'Invalid Story Points Input',
  args: {
    issue: {
      ...baseIssue,
      fields: {
        ...baseIssue.fields,
        customfield_10016: null
      }
    }
  },
  parameters: {
    msw: {
      handlers: happyPathHandlers
    }
  }
}`,...(Y=(z=c.parameters)==null?void 0:z.docs)==null?void 0:Y.source}}};var q,Q,V;h.parameters={...h.parameters,docs:{...(q=h.parameters)==null?void 0:q.docs,source:{originalSource:`{
  name: 'Failed Story Points Save',
  parameters: {
    msw: {
      handlers: [http.get('/api/jira/issues/:issueKey/transitions', () => {
        return HttpResponse.json({
          transitions
        });
      }), http.post('/api/jira/issues/:issueKey/transitions', () => {
        return HttpResponse.json({}, {
          status: 204
        });
      }), http.post('/api/jira/issues/:issueKey/comment', () => {
        return HttpResponse.json({
          id: '10001',
          body: 'Comment posted successfully',
          author: {
            displayName: 'John Doe'
          },
          created: new Date().toISOString()
        });
      }), http.put('/api/jira/issues/:issueKey/storypoints', () => {
        return HttpResponse.json({
          message: 'Field customfield_10016 is not editable'
        }, {
          status: 400
        });
      })]
    }
  }
}`,...(V=(Q=h.parameters)==null?void 0:Q.docs)==null?void 0:V.source}}};var X,$,ss;y.parameters={...y.parameters,docs:{...(X=y.parameters)==null?void 0:X.docs,source:{originalSource:`{
  name: 'Unassigned Issue',
  args: {
    issue: {
      ...baseIssue,
      fields: {
        ...baseIssue.fields,
        assignee: null
      }
    }
  },
  parameters: {
    msw: {
      handlers: happyPathHandlers
    }
  }
}`,...(ss=($=y.parameters)==null?void 0:$.docs)==null?void 0:ss.source}}};var es,ns,as;g.parameters={...g.parameters,docs:{...(es=g.parameters)==null?void 0:es.docs,source:{originalSource:`{
  name: 'Missing Priority Field',
  args: {
    issue: {
      ...baseIssue,
      fields: {
        ...baseIssue.fields,
        priority: undefined
      }
    }
  },
  parameters: {
    msw: {
      handlers: happyPathHandlers
    }
  }
}`,...(as=(ns=g.parameters)==null?void 0:ns.docs)==null?void 0:as.source}}};var rs,ts,is;f.parameters={...f.parameters,docs:{...(rs=f.parameters)==null?void 0:rs.docs,source:{originalSource:`{
  name: 'Long Description (Truncated)',
  args: {
    issue: {
      ...baseIssue,
      fields: {
        ...baseIssue.fields,
        description: "The login page has several critical issues that must be resolved before the upcoming release. " + "Form fields are misaligned on screens smaller than 768px, causing a poor user experience. " + "The submit button overlaps the 'Forgot password' link on iOS Safari 16. " + "Additionally, the password visibility toggle does not function correctly in Firefox 120 or earlier. " + "Error messages from the backend are not surfaced to the user, leaving them confused after a failed login attempt. " + "We also need to ensure WCAG 2.1 AA compliance for all form elements including proper label associations and contrast ratios."
      }
    }
  },
  parameters: {
    msw: {
      handlers: happyPathHandlers
    }
  }
}`,...(is=(ts=f.parameters)==null?void 0:ts.docs)==null?void 0:is.source}}};var os,ps,ds;b.parameters={...b.parameters,docs:{...(os=b.parameters)==null?void 0:os.docs,source:{originalSource:`{
  name: 'No Description',
  args: {
    issue: {
      ...baseIssue,
      fields: {
        ...baseIssue.fields,
        description: undefined
      }
    }
  },
  parameters: {
    msw: {
      handlers: happyPathHandlers
    }
  }
}`,...(ds=(ps=b.parameters)==null?void 0:ps.docs)==null?void 0:ds.source}}};var ms,us,ls;w.parameters={...w.parameters,docs:{...(ms=w.parameters)==null?void 0:ms.docs,source:{originalSource:`{
  name: 'Panel — User Can Close',
  args: {
    isEmbedded: false,
    onIssueUpdated: () => console.log('onIssueUpdated called')
  },
  parameters: {
    msw: {
      handlers: happyPathHandlers
    }
  }
}`,...(ls=(us=w.parameters)==null?void 0:us.docs)==null?void 0:ls.source}}};var cs,hs,ys;j.parameters={...j.parameters,docs:{...(cs=j.parameters)==null?void 0:cs.docs,source:{originalSource:`{
  name: 'Bug Issue — Low Priority',
  args: {
    issue: {
      key: 'JIRA-456',
      fields: {
        summary: 'Dashboard chart fails to render on Safari 17',
        description: 'Users on Safari 17 report a blank chart area on the main dashboard. The console shows a TypeError related to ResizeObserver. Reproduced on macOS Sonoma 14.2 and iOS 17.',
        status: {
          name: 'Open'
        },
        priority: {
          name: 'Low'
        },
        assignee: {
          displayName: 'Sarah Kim'
        },
        created: '2024-02-03T08:00:00.000Z',
        updated: '2024-02-05T16:20:00.000Z',
        customfield_10016: 3
      }
    }
  },
  parameters: {
    msw: {
      handlers: happyPathHandlers
    }
  }
}`,...(ys=(hs=j.parameters)==null?void 0:hs.docs)==null?void 0:ys.source}}};var gs,fs,bs;S.parameters={...S.parameters,docs:{...(gs=S.parameters)==null?void 0:gs.docs,source:{originalSource:`{
  name: 'Critical Priority — Done',
  args: {
    issue: {
      key: 'JIRA-789',
      fields: {
        summary: 'Security vulnerability in session token generation',
        description: 'A weak PRNG was used for session token generation, making tokens predictable. Patched in v2.3.1 by switching to crypto.randomBytes(32).',
        status: {
          name: 'Done'
        },
        priority: {
          name: 'Critical'
        },
        assignee: {
          displayName: 'Alex Petrov'
        },
        created: '2024-01-02T09:15:00.000Z',
        updated: '2024-01-10T11:00:00.000Z',
        customfield_10016: 13
      }
    }
  },
  parameters: {
    msw: {
      handlers: happyPathHandlers
    }
  }
}`,...(bs=(fs=S.parameters)==null?void 0:fs.docs)==null?void 0:bs.source}}};const Rs=["Default","Embedded","NoTransitions","TransitionsLoading","TransitionLoadError","FailedTransitionApply","EmptyCommentSubmission","FailedCommentPost","InvalidStoryPoints","FailedStoryPointsSave","UnassignedIssue","MissingPriority","LongDescription","NoDescription","PanelCloseable","BugIssue","CriticalDoneIssue"];export{j as BugIssue,S as CriticalDoneIssue,t as Default,i as Embedded,u as EmptyCommentSubmission,l as FailedCommentPost,h as FailedStoryPointsSave,m as FailedTransitionApply,c as InvalidStoryPoints,f as LongDescription,g as MissingPriority,b as NoDescription,o as NoTransitions,w as PanelCloseable,d as TransitionLoadError,p as TransitionsLoading,y as UnassignedIssue,Rs as __namedExportsOrder,Cs as default};
