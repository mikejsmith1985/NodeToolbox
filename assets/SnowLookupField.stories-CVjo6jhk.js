import{h as e}from"./index-B5IrvpLZ.js";import{S as ae}from"./SnowLookupField-DF7OwMMZ.js";import{H as s}from"./cookieStore-CKwAPFhE.js";import{d as re}from"./delay-F0IbJbgL.js";import"./index-Bc2G9s8g.js";import"./connectionStore-BunEloD3.js";import"./react-Li0Ki8N_.js";import"./isObject-DVTTJpIa.js";const a="/api/now/table",w=(t=4)=>[{sys_id:"d0a7f2a0c313010000e5faca7c0c9c55",name:"John Smith"},{sys_id:"a1b2c3d4e5f6010000abcdef12345678",name:"Jane Doe"},{sys_id:"b2c3d4e5f6a7010000bcdef123456789",name:"Michael Chen"},{sys_id:"c3d4e5f6a7b8010000cdef1234567890",name:"Sarah Johnson"},{sys_id:"d4e5f6a7b8c9010000def12345678901",name:"Carlos Rivera"},{sys_id:"e5f6a7b8c9d0010000ef1234567890ab",name:"Priya Patel"},{sys_id:"f6a7b8c9d0e1010000f12345678901bc",name:"Ahmed Al-Rashid"},{sys_id:"a7b8c9d0e1f2010000123456789012cd",name:"Emily Nakamura"}].slice(0,t),ne=()=>[{sys_id:"grp001aabbcc334455667788990011aa",name:"Network Operations"},{sys_id:"grp002aabbcc334455667788990011bb",name:"Desktop Support"},{sys_id:"grp003aabbcc334455667788990011cc",name:"Cloud Infrastructure"}],te=()=>[{sys_id:"ci0001aabbcc334455667788990011aa",name:"web-prod-01"},{sys_id:"ci0002aabbcc334455667788990011bb",name:"web-prod-02"},{sys_id:"ci0003aabbcc334455667788990011cc",name:"db-primary-01"}],n=e.get(`${a}/sys_user`,()=>s.json({result:w()})),oe=e.get(`${a}/sys_user`,()=>s.json({result:[]})),le=e.get(`${a}/sys_user`,()=>s.error()),ie=e.get(`${a}/sys_user`,()=>s.json({result:w(8)})),de=e.get(`${a}/sys_user_group`,()=>s.json({result:ne()})),ce=e.get(`${a}/cmdb_ci`,()=>s.json({result:te()})),me=e.get(`${a}/sys_user`,async()=>(await re(800),s.json({result:w()}))),r={sysId:"",displayName:""},f={sysId:"d0a7f2a0c313010000e5faca7c0c9c55",displayName:"John Smith"},_e={title:"Components/SnowLookupField",component:ae,args:{label:"Assigned User",tableName:"sys_user",value:f,onChange:t=>console.log("onChange",t),isDisabled:!1},argTypes:{tableName:{control:"select",options:["sys_user","sys_user_group","cmdb_ci"]},isDisabled:{control:"boolean"},onChange:{action:"onChange"}}},o={name:"Default (selected user)",args:{label:"Assigned User",tableName:"sys_user",value:f},parameters:{msw:{handlers:[n]}}},l={name:"No Selection (empty state)",args:{label:"Assigned User",tableName:"sys_user",value:r},parameters:{msw:{handlers:[n]}}},i={name:"Empty Search Results",args:{label:"Assigned User",tableName:"sys_user",value:r},parameters:{docs:{description:{story:'When the API returns no results for the typed query, the dropdown shows a "No results found" message.'}},msw:{handlers:[oe]}}},d={name:"API Fetch Failure (graceful)",args:{label:"Assigned User",tableName:"sys_user",value:r},parameters:{docs:{description:{story:"When the lookup API fails, the component shows a brief error notice and still allows the user to type manually without crashing."}},msw:{handlers:[le]}}},c={name:"Dropdown Overflow (6+ results)",args:{label:"Assigned User",tableName:"sys_user",value:r},parameters:{docs:{description:{story:'When 6 or more suggestions are returned the dropdown shows a "Scroll for more results" hint at the bottom to indicate there are additional options.'}},msw:{handlers:[ie]}}},m={name:"External Value Sync (clone scenario)",args:{label:"Assigned User",tableName:"sys_user",value:{sysId:"a1b2c3d4e5f6010000abcdef12345678",displayName:""}},parameters:{docs:{description:{story:"When the parent provides a sysId without a displayName (e.g. after cloning a change record), the component resolves the display name via an API call and populates the input."}},msw:{handlers:[e.get(`${a}/sys_user`,()=>s.json({result:w()}))]}}},p={name:"Clearing Selection (edit after confirm)",args:{label:"Assigned User",tableName:"sys_user",value:f},parameters:{docs:{description:{story:"Once a user edits the text input after a selection is confirmed, the sysId is reset to an empty string and the checkmark badge disappears, signalling an unresolved state."}},msw:{handlers:[n]}},play:async({canvasElement:t})=>{}},u={name:"Outside Click (auto-close dropdown)",args:{label:"Assigned User",tableName:"sys_user",value:r},parameters:{docs:{description:{story:"Type into the field to open the suggestions dropdown, then click anywhere outside the component — the dropdown closes automatically without a selection being made."}},msw:{handlers:[n]}}},y={name:"Disabled Field",args:{label:"Assigned User",tableName:"sys_user",value:f,isDisabled:!0},parameters:{docs:{description:{story:"When isDisabled is true the input is read-only, no API calls are made, and no dropdown opens on interaction."}},msw:{handlers:[n]}}},h={name:"Group Lookup (sys_user_group)",args:{label:"Assignment Group",tableName:"sys_user_group",value:{sysId:"grp001aabbcc334455667788990011aa",displayName:"Network Operations"}},parameters:{docs:{description:{story:"Querying the sys_user_group table to assign a group."}},msw:{handlers:[de]}}},g={name:"CI Lookup (cmdb_ci)",args:{label:"Affected CI",tableName:"cmdb_ci",value:{sysId:"ci0001aabbcc334455667788990011aa",displayName:"web-prod-01"}},parameters:{docs:{description:{story:"Querying the cmdb_ci table to link a configuration item."}},msw:{handlers:[ce]}}},b={name:"Slow Network (loading state)",args:{label:"Assigned User",tableName:"sys_user",value:r},parameters:{docs:{description:{story:"Simulates a slow API response (800 ms delay). The component should show a loading indicator while the request is in flight."}},msw:{handlers:[me]}}};var _,S,N;o.parameters={...o.parameters,docs:{...(_=o.parameters)==null?void 0:_.docs,source:{originalSource:`{
  name: 'Default (selected user)',
  args: {
    label: 'Assigned User',
    tableName: 'sys_user',
    value: johnSmith
  },
  parameters: {
    msw: {
      handlers: [happyUserHandler]
    }
  }
}`,...(N=(S=o.parameters)==null?void 0:S.docs)==null?void 0:N.source}}};var v,A,k;l.parameters={...l.parameters,docs:{...(v=l.parameters)==null?void 0:v.docs,source:{originalSource:`{
  name: 'No Selection (empty state)',
  args: {
    label: 'Assigned User',
    tableName: 'sys_user',
    value: emptyRef
  },
  parameters: {
    msw: {
      handlers: [happyUserHandler]
    }
  }
}`,...(k=(A=l.parameters)==null?void 0:A.docs)==null?void 0:k.source}}};var U,I,C;i.parameters={...i.parameters,docs:{...(U=i.parameters)==null?void 0:U.docs,source:{originalSource:`{
  name: 'Empty Search Results',
  args: {
    label: 'Assigned User',
    tableName: 'sys_user',
    value: emptyRef
  },
  parameters: {
    docs: {
      description: {
        story: 'When the API returns no results for the typed query, the dropdown shows a "No results found" message.'
      }
    },
    msw: {
      handlers: [emptyResultsHandler]
    }
  }
}`,...(C=(I=i.parameters)==null?void 0:I.docs)==null?void 0:C.source}}};var D,H,R;d.parameters={...d.parameters,docs:{...(D=d.parameters)==null?void 0:D.docs,source:{originalSource:`{
  name: 'API Fetch Failure (graceful)',
  args: {
    label: 'Assigned User',
    tableName: 'sys_user',
    value: emptyRef
  },
  parameters: {
    docs: {
      description: {
        story: 'When the lookup API fails, the component shows a brief error notice and still allows the user to type manually without crashing.'
      }
    },
    msw: {
      handlers: [networkErrorHandler]
    }
  }
}`,...(R=(H=d.parameters)==null?void 0:H.docs)==null?void 0:R.source}}};var E,O,P;c.parameters={...c.parameters,docs:{...(E=c.parameters)==null?void 0:E.docs,source:{originalSource:`{
  name: 'Dropdown Overflow (6+ results)',
  args: {
    label: 'Assigned User',
    tableName: 'sys_user',
    value: emptyRef
  },
  parameters: {
    docs: {
      description: {
        story: 'When 6 or more suggestions are returned the dropdown shows a "Scroll for more results" hint at the bottom to indicate there are additional options.'
      }
    },
    msw: {
      handlers: [manyResultsHandler]
    }
  }
}`,...(P=(O=c.parameters)==null?void 0:O.docs)==null?void 0:P.source}}};var j,F,L;m.parameters={...m.parameters,docs:{...(j=m.parameters)==null?void 0:j.docs,source:{originalSource:`{
  name: 'External Value Sync (clone scenario)',
  args: {
    label: 'Assigned User',
    tableName: 'sys_user',
    // sysId is known (e.g. cloned from another record) but display name is
    // not yet resolved — component should fetch and resolve it.
    value: {
      sysId: 'a1b2c3d4e5f6010000abcdef12345678',
      displayName: ''
    }
  },
  parameters: {
    docs: {
      description: {
        story: 'When the parent provides a sysId without a displayName (e.g. after cloning a change record), the component resolves the display name via an API call and populates the input.'
      }
    },
    msw: {
      handlers: [http.get(\`\${BASE_URL}/sys_user\`, () => HttpResponse.json({
        result: makeUserSuggestions()
      }))]
    }
  }
}`,...(L=(F=m.parameters)==null?void 0:F.docs)==null?void 0:L.source}}};var W,$,x;p.parameters={...p.parameters,docs:{...(W=p.parameters)==null?void 0:W.docs,source:{originalSource:`{
  name: 'Clearing Selection (edit after confirm)',
  args: {
    label: 'Assigned User',
    tableName: 'sys_user',
    // Starts with a confirmed selection; user can then clear / retype
    value: johnSmith
  },
  parameters: {
    docs: {
      description: {
        story: 'Once a user edits the text input after a selection is confirmed, the sysId is reset to an empty string and the checkmark badge disappears, signalling an unresolved state.'
      }
    },
    msw: {
      handlers: [happyUserHandler]
    }
  },
  play: async ({
    canvasElement
  }) => {
    // Demonstrates the starting state visually; actual clearing is performed
    // interactively by the user modifying the input in the rendered story.
  }
}`,...(x=($=p.parameters)==null?void 0:$.docs)==null?void 0:x.source}}};var G,T,q;u.parameters={...u.parameters,docs:{...(G=u.parameters)==null?void 0:G.docs,source:{originalSource:`{
  name: 'Outside Click (auto-close dropdown)',
  args: {
    label: 'Assigned User',
    tableName: 'sys_user',
    value: emptyRef
  },
  parameters: {
    docs: {
      description: {
        story: 'Type into the field to open the suggestions dropdown, then click anywhere outside the component — the dropdown closes automatically without a selection being made.'
      }
    },
    msw: {
      handlers: [happyUserHandler]
    }
  }
}`,...(q=(T=u.parameters)==null?void 0:T.docs)==null?void 0:q.source}}};var J,Q,V;y.parameters={...y.parameters,docs:{...(J=y.parameters)==null?void 0:J.docs,source:{originalSource:`{
  name: 'Disabled Field',
  args: {
    label: 'Assigned User',
    tableName: 'sys_user',
    value: johnSmith,
    isDisabled: true
  },
  parameters: {
    docs: {
      description: {
        story: 'When isDisabled is true the input is read-only, no API calls are made, and no dropdown opens on interaction.'
      }
    },
    msw: {
      handlers: [happyUserHandler]
    }
  }
}`,...(V=(Q=y.parameters)==null?void 0:Q.docs)==null?void 0:V.source}}};var B,M,z;h.parameters={...h.parameters,docs:{...(B=h.parameters)==null?void 0:B.docs,source:{originalSource:`{
  name: 'Group Lookup (sys_user_group)',
  args: {
    label: 'Assignment Group',
    tableName: 'sys_user_group',
    value: {
      sysId: 'grp001aabbcc334455667788990011aa',
      displayName: 'Network Operations'
    }
  },
  parameters: {
    docs: {
      description: {
        story: 'Querying the sys_user_group table to assign a group.'
      }
    },
    msw: {
      handlers: [groupHandler]
    }
  }
}`,...(z=(M=h.parameters)==null?void 0:M.docs)==null?void 0:z.source}}};var K,X,Y;g.parameters={...g.parameters,docs:{...(K=g.parameters)==null?void 0:K.docs,source:{originalSource:`{
  name: 'CI Lookup (cmdb_ci)',
  args: {
    label: 'Affected CI',
    tableName: 'cmdb_ci',
    value: {
      sysId: 'ci0001aabbcc334455667788990011aa',
      displayName: 'web-prod-01'
    }
  },
  parameters: {
    docs: {
      description: {
        story: 'Querying the cmdb_ci table to link a configuration item.'
      }
    },
    msw: {
      handlers: [ciHandler]
    }
  }
}`,...(Y=(X=g.parameters)==null?void 0:X.docs)==null?void 0:Y.source}}};var Z,ee,se;b.parameters={...b.parameters,docs:{...(Z=b.parameters)==null?void 0:Z.docs,source:{originalSource:`{
  name: 'Slow Network (loading state)',
  args: {
    label: 'Assigned User',
    tableName: 'sys_user',
    value: emptyRef
  },
  parameters: {
    docs: {
      description: {
        story: 'Simulates a slow API response (800 ms delay). The component should show a loading indicator while the request is in flight.'
      }
    },
    msw: {
      handlers: [slowUserHandler]
    }
  }
}`,...(se=(ee=b.parameters)==null?void 0:ee.docs)==null?void 0:se.source}}};const Se=["Default","NoSelection","EmptySearchResults","ApiFetchFailure","DropdownOverflow","ExternalValueSync","ClearingSelection","OutsideClick","Disabled","GroupLookup","CiLookup","SlowNetwork"];export{d as ApiFetchFailure,g as CiLookup,p as ClearingSelection,o as Default,y as Disabled,c as DropdownOverflow,i as EmptySearchResults,m as ExternalValueSync,h as GroupLookup,l as NoSelection,u as OutsideClick,b as SlowNetwork,Se as __namedExportsOrder,_e as default};
