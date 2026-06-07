import{r as V,R as n}from"./index-Bc2G9s8g.js";const X="_pairWrapper_13yms_9",ee="_jiraRow_13yms_39",ne="_healthBadge_13yms_73",ae="_healthGreen_13yms_99",se="_healthYellow_13yms_109",te="_healthRed_13yms_119",re="_chevron_13yms_135",ie="_chevronOpen_13yms_149",oe="_issueTypeIcon_13yms_157",le="_jiraKey_13yms_169",me="_summary_13yms_183",ce="_statusBadge_13yms_199",pe="_priorityBadge_13yms_219",ue="_snowPanel_13yms_235",de="_snowLabel_13yms_255",he="_snowNumber_13yms_273",ye="_snowSummary_13yms_285",ge="_snowStateBadge_13yms_301",we="_matchSummary_13yms_325",e={pairWrapper:X,jiraRow:ee,healthBadge:ne,healthGreen:ae,healthYellow:se,healthRed:te,chevron:re,chevronOpen:ie,issueTypeIcon:oe,jiraKey:le,summary:me,statusBadge:ce,priorityBadge:pe,snowPanel:ue,snowLabel:de,snowNumber:he,snowSummary:ye,snowStateBadge:ge,matchSummary:we},_e={green:"✓ In Sync",yellow:"⚠ Partial",red:"✗ Out of Sync"},be={green:e.healthGreen,yellow:e.healthYellow,red:e.healthRed};function Pe(h){return h.toLowerCase()}function J({pair:h}){var P;const[r,g]=V.useState(!1),{jiraIssue:a,snowProblem:s,healthStatus:y,matchingFieldCount:K,totalMappedFieldCount:w}=h,_=_e[y],z=`${e.healthBadge} ${be[y]}`,Y=`${e.chevron} ${r?e.chevronOpen:""}`;function Z(){g(t=>!t)}function q(t){(t.key==="Enter"||t.key===" ")&&(t.preventDefault(),g(Q=>!Q))}const b=`${K} of ${w} mapped field${w!==1?"s":""} match`;return n.createElement("div",{className:e.pairWrapper,"data-health":y,"data-testid":"linked-issue-pair"},n.createElement("div",{className:e.jiraRow,role:"button",tabIndex:0,"aria-expanded":r,"aria-label":`Linked pair: ${a.key} ↔ ${s.number}. Health: ${_}`,onClick:Z,onKeyDown:q},n.createElement("span",{className:Y},"▶"),n.createElement("img",{className:e.issueTypeIcon,src:a.fields.issuetype.iconUrl,alt:a.fields.issuetype.name}),n.createElement("span",{className:e.jiraKey},a.key),n.createElement("span",{className:e.summary,title:a.fields.summary},a.fields.summary),n.createElement("span",{className:e.statusBadge,"data-status":Pe(a.fields.status.name)},a.fields.status.name),n.createElement("span",{className:e.priorityBadge},((P=a.fields.priority)==null?void 0:P.name)??"—"),n.createElement("span",{className:z,title:b},_)),r&&n.createElement("div",{className:e.snowPanel,role:"region","aria-label":`ServiceNow details for ${s.number}`},n.createElement("span",{className:e.snowLabel},"ServiceNow"),n.createElement("span",{className:e.snowNumber},s.number),n.createElement("span",{className:e.snowSummary,title:s.short_description},s.short_description),n.createElement("span",{className:e.snowStateBadge},s.state),n.createElement("span",{className:e.matchSummary},b)))}J.__docgenInfo={description:`Displays a Jira issue and its linked SNow Problem as a collapsible nested card.\r
\r
The left border color signals health at a glance even when the SNow panel is\r
collapsed — users can scan the list quickly without expanding each pair.`,methods:[],displayName:"LinkedIssuePair",props:{pair:{required:!0,tsType:{name:"LinkedIssuePairType"},description:"The matched Jira + SNow pair with computed health status."}}};const Fe={title:"Components/LinkedIssuePair",component:J,parameters:{layout:"padded"},tags:["autodocs"]},i={args:{pair:{jiraIssue:{key:"PROJ-1234",fields:{summary:"Fix critical login bug in auth service",issuetype:{name:"Bug",iconUrl:"https://example.com/bug-icon.png"},status:{name:"In Progress"},priority:{name:"High"}}},snowProblem:{number:"PRB0012345",short_description:"Users unable to log in to production system",state:"In Work"},healthStatus:"yellow",matchingFieldCount:2,totalMappedFieldCount:3}}},o={name:"Health: Green (All Fields Match)",args:{pair:{jiraIssue:{key:"INFRA-987",fields:{summary:"Database connection pool exhaustion under peak load",issuetype:{name:"Bug",iconUrl:"https://example.com/bug-icon.png"},status:{name:"Open"},priority:{name:"Critical"}}},snowProblem:{number:"PRB0009871",short_description:"DB connection pool exhausted causing timeouts",state:"Open"},healthStatus:"green",matchingFieldCount:4,totalMappedFieldCount:4}}},l={name:"Health: Yellow (Some Fields Match)",args:{pair:{jiraIssue:{key:"PROJ-1234",fields:{summary:"Fix critical login bug in auth service",issuetype:{name:"Bug",iconUrl:"https://example.com/bug-icon.png"},status:{name:"In Progress"},priority:{name:"High"}}},snowProblem:{number:"PRB0012345",short_description:"Users unable to log in to production system",state:"In Work"},healthStatus:"yellow",matchingFieldCount:2,totalMappedFieldCount:3}}},m={name:"Health: Red (No Fields Match)",args:{pair:{jiraIssue:{key:"SEC-456",fields:{summary:"SSL certificate renewal failure on api.example.com",issuetype:{name:"Incident",iconUrl:"https://example.com/incident-icon.png"},status:{name:"Closed"},priority:{name:"Medium"}}},snowProblem:{number:"PRB0045601",short_description:"Certificate expiry causing API gateway errors",state:"Resolved"},healthStatus:"red",matchingFieldCount:0,totalMappedFieldCount:5}}},c={name:"Single Mapped Field (Pluralization)",args:{pair:{jiraIssue:{key:"OPS-772",fields:{summary:"Memory leak in background job scheduler",issuetype:{name:"Bug",iconUrl:"https://example.com/bug-icon.png"},status:{name:"To Do"},priority:{name:"Low"}}},snowProblem:{number:"PRB0007720",short_description:"Scheduler process consuming excessive memory",state:"New"},healthStatus:"green",matchingFieldCount:1,totalMappedFieldCount:1}}},p={name:"Multiple Mapped Fields (Pluralization)",args:{pair:{jiraIssue:{key:"PLAT-3310",fields:{summary:"Kubernetes pod restart loop in payments namespace",issuetype:{name:"Task",iconUrl:"https://example.com/task-icon.png"},status:{name:"In Review"},priority:{name:"High"}}},snowProblem:{number:"PRB0033100",short_description:"Payment service pods crashing and restarting repeatedly",state:"In Work"},healthStatus:"yellow",matchingFieldCount:3,totalMappedFieldCount:6}}},u={name:"Priority Field Missing (Defaults to —)",args:{pair:{jiraIssue:{key:"DATA-88",fields:{summary:"ETL pipeline fails silently when source schema changes",issuetype:{name:"Story",iconUrl:"https://example.com/story-icon.png"},status:{name:"Backlog"}}},snowProblem:{number:"PRB0000880",short_description:"Data pipeline drops records without alerting on-call team",state:"New"},healthStatus:"red",matchingFieldCount:0,totalMappedFieldCount:2}}},d={name:"Zero Total Mapped Fields",args:{pair:{jiraIssue:{key:"MISC-001",fields:{summary:"Investigate intermittent 502 errors on checkout page",issuetype:{name:"Bug",iconUrl:"https://example.com/bug-icon.png"},status:{name:"Open"},priority:{name:"Medium"}}},snowProblem:{number:"PRB0000010",short_description:"Checkout service returning sporadic 502 Bad Gateway",state:"Open"},healthStatus:"red",matchingFieldCount:0,totalMappedFieldCount:0}}};var S,F,k;i.parameters={...i.parameters,docs:{...(S=i.parameters)==null?void 0:S.docs,source:{originalSource:`{
  args: {
    pair: {
      jiraIssue: {
        key: 'PROJ-1234',
        fields: {
          summary: 'Fix critical login bug in auth service',
          issuetype: {
            name: 'Bug',
            iconUrl: 'https://example.com/bug-icon.png'
          },
          status: {
            name: 'In Progress'
          },
          priority: {
            name: 'High'
          }
        }
      },
      snowProblem: {
        number: 'PRB0012345',
        short_description: 'Users unable to log in to production system',
        state: 'In Work'
      },
      healthStatus: 'yellow',
      matchingFieldCount: 2,
      totalMappedFieldCount: 3
    } satisfies LinkedIssuePairType
  }
}`,...(k=(F=i.parameters)==null?void 0:F.docs)==null?void 0:k.source}}};var I,f,M;o.parameters={...o.parameters,docs:{...(I=o.parameters)==null?void 0:I.docs,source:{originalSource:`{
  name: 'Health: Green (All Fields Match)',
  args: {
    pair: {
      jiraIssue: {
        key: 'INFRA-987',
        fields: {
          summary: 'Database connection pool exhaustion under peak load',
          issuetype: {
            name: 'Bug',
            iconUrl: 'https://example.com/bug-icon.png'
          },
          status: {
            name: 'Open'
          },
          priority: {
            name: 'Critical'
          }
        }
      },
      snowProblem: {
        number: 'PRB0009871',
        short_description: 'DB connection pool exhausted causing timeouts',
        state: 'Open'
      },
      healthStatus: 'green',
      matchingFieldCount: 4,
      totalMappedFieldCount: 4
    } satisfies LinkedIssuePairType
  }
}`,...(M=(f=o.parameters)==null?void 0:f.docs)==null?void 0:M.source}}};var C,B,R;l.parameters={...l.parameters,docs:{...(C=l.parameters)==null?void 0:C.docs,source:{originalSource:`{
  name: 'Health: Yellow (Some Fields Match)',
  args: {
    pair: {
      jiraIssue: {
        key: 'PROJ-1234',
        fields: {
          summary: 'Fix critical login bug in auth service',
          issuetype: {
            name: 'Bug',
            iconUrl: 'https://example.com/bug-icon.png'
          },
          status: {
            name: 'In Progress'
          },
          priority: {
            name: 'High'
          }
        }
      },
      snowProblem: {
        number: 'PRB0012345',
        short_description: 'Users unable to log in to production system',
        state: 'In Work'
      },
      healthStatus: 'yellow',
      matchingFieldCount: 2,
      totalMappedFieldCount: 3
    } satisfies LinkedIssuePairType
  }
}`,...(R=(B=l.parameters)==null?void 0:B.docs)==null?void 0:R.source}}};var x,N,L;m.parameters={...m.parameters,docs:{...(x=m.parameters)==null?void 0:x.docs,source:{originalSource:`{
  name: 'Health: Red (No Fields Match)',
  args: {
    pair: {
      jiraIssue: {
        key: 'SEC-456',
        fields: {
          summary: 'SSL certificate renewal failure on api.example.com',
          issuetype: {
            name: 'Incident',
            iconUrl: 'https://example.com/incident-icon.png'
          },
          status: {
            name: 'Closed'
          },
          priority: {
            name: 'Medium'
          }
        }
      },
      snowProblem: {
        number: 'PRB0045601',
        short_description: 'Certificate expiry causing API gateway errors',
        state: 'Resolved'
      },
      healthStatus: 'red',
      matchingFieldCount: 0,
      totalMappedFieldCount: 5
    } satisfies LinkedIssuePairType
  }
}`,...(L=(N=m.parameters)==null?void 0:N.docs)==null?void 0:L.source}}};var v,T,E;c.parameters={...c.parameters,docs:{...(v=c.parameters)==null?void 0:v.docs,source:{originalSource:`{
  name: 'Single Mapped Field (Pluralization)',
  args: {
    pair: {
      jiraIssue: {
        key: 'OPS-772',
        fields: {
          summary: 'Memory leak in background job scheduler',
          issuetype: {
            name: 'Bug',
            iconUrl: 'https://example.com/bug-icon.png'
          },
          status: {
            name: 'To Do'
          },
          priority: {
            name: 'Low'
          }
        }
      },
      snowProblem: {
        number: 'PRB0007720',
        short_description: 'Scheduler process consuming excessive memory',
        state: 'New'
      },
      healthStatus: 'green',
      matchingFieldCount: 1,
      totalMappedFieldCount: 1
    } satisfies LinkedIssuePairType
  }
}`,...(E=(T=c.parameters)==null?void 0:T.docs)==null?void 0:E.source}}};var j,A,U;p.parameters={...p.parameters,docs:{...(j=p.parameters)==null?void 0:j.docs,source:{originalSource:`{
  name: 'Multiple Mapped Fields (Pluralization)',
  args: {
    pair: {
      jiraIssue: {
        key: 'PLAT-3310',
        fields: {
          summary: 'Kubernetes pod restart loop in payments namespace',
          issuetype: {
            name: 'Task',
            iconUrl: 'https://example.com/task-icon.png'
          },
          status: {
            name: 'In Review'
          },
          priority: {
            name: 'High'
          }
        }
      },
      snowProblem: {
        number: 'PRB0033100',
        short_description: 'Payment service pods crashing and restarting repeatedly',
        state: 'In Work'
      },
      healthStatus: 'yellow',
      matchingFieldCount: 3,
      totalMappedFieldCount: 6
    } satisfies LinkedIssuePairType
  }
}`,...(U=(A=p.parameters)==null?void 0:A.docs)==null?void 0:U.source}}};var D,O,H;u.parameters={...u.parameters,docs:{...(D=u.parameters)==null?void 0:D.docs,source:{originalSource:`{
  name: 'Priority Field Missing (Defaults to —)',
  args: {
    pair: {
      jiraIssue: {
        key: 'DATA-88',
        fields: {
          summary: 'ETL pipeline fails silently when source schema changes',
          issuetype: {
            name: 'Story',
            iconUrl: 'https://example.com/story-icon.png'
          },
          status: {
            name: 'Backlog'
          }
          // priority intentionally omitted
        }
      },
      snowProblem: {
        number: 'PRB0000880',
        short_description: 'Data pipeline drops records without alerting on-call team',
        state: 'New'
      },
      healthStatus: 'red',
      matchingFieldCount: 0,
      totalMappedFieldCount: 2
    } satisfies LinkedIssuePairType
  }
}`,...(H=(O=u.parameters)==null?void 0:O.docs)==null?void 0:H.source}}};var $,G,W;d.parameters={...d.parameters,docs:{...($=d.parameters)==null?void 0:$.docs,source:{originalSource:`{
  name: 'Zero Total Mapped Fields',
  args: {
    pair: {
      jiraIssue: {
        key: 'MISC-001',
        fields: {
          summary: 'Investigate intermittent 502 errors on checkout page',
          issuetype: {
            name: 'Bug',
            iconUrl: 'https://example.com/bug-icon.png'
          },
          status: {
            name: 'Open'
          },
          priority: {
            name: 'Medium'
          }
        }
      },
      snowProblem: {
        number: 'PRB0000010',
        short_description: 'Checkout service returning sporadic 502 Bad Gateway',
        state: 'Open'
      },
      healthStatus: 'red',
      matchingFieldCount: 0,
      totalMappedFieldCount: 0
    } satisfies LinkedIssuePairType
  }
}`,...(W=(G=d.parameters)==null?void 0:G.docs)==null?void 0:W.source}}};const ke=["Default","AllFieldsMatch","SomeFieldsMatch","NoFieldsMatch","SingleMappedField","MultipleMappedFields","MissingPriority","ZeroMappedFields"];export{o as AllFieldsMatch,i as Default,u as MissingPriority,p as MultipleMappedFields,m as NoFieldsMatch,c as SingleMappedField,l as SomeFieldsMatch,d as ZeroMappedFields,ke as __namedExportsOrder,Fe as default};
