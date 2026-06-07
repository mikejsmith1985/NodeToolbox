import{fn as y}from"./index-DeN4tkzB.js";import{r as U}from"./index-Bc2G9s8g.js";const V="_panel_2ht56_5",Y="_header_2ht56_31",Z="_selectedCount_2ht56_47",ee="_selectedKeys_2ht56_59",te="_textarea_2ht56_71",se="_actions_2ht56_107",ne="_submitButton_2ht56_119",re="_cancelButton_2ht56_151",oe="_errorMessage_2ht56_179",ae="_spinner_2ht56_195",e={panel:V,header:Y,selectedCount:Z,selectedKeys:ee,textarea:te,actions:se,submitButton:ne,cancelButton:re,errorMessage:oe,spinner:ae};function X({selectedCount:q,selectedKeys:s,isBulkPostingComment:t,bulkCommentError:C,onPostBulkComment:j,onCancelBulk:$}){const[p,z]=U.useState(""),G=p.trim().length===0;function Q(){const n=p.trim();n.length!==0&&j(n)}return React.createElement("div",{className:e.panel},React.createElement("div",{className:e.header},React.createElement("span",{className:e.selectedCount},q," issues selected"),s.length>0&&React.createElement("span",{className:e.selectedKeys},s.slice(0,5).join(", "),s.length>5?` +${s.length-5} more`:"")),React.createElement("textarea",{"aria-label":"Bulk comment text",className:e.textarea,disabled:t,onChange:n=>z(n.target.value),placeholder:"Type a comment to add to all selected issues…",value:p}),C&&React.createElement("div",{className:e.errorMessage},C),React.createElement("div",{className:e.actions},React.createElement("button",{className:e.submitButton,disabled:G||t,onClick:Q,type:"button"},t&&React.createElement("span",{"aria-hidden":"true",className:e.spinner}),t?"Posting…":"Post Comment"),React.createElement("button",{className:e.cancelButton,disabled:t,onClick:$,type:"button"},"Cancel")))}X.__docgenInfo={description:`Renders a sticky footer panel that lets the user type a comment and post it\r
to all currently bulk-selected Jira issues in a single action.`,methods:[],displayName:"BulkCommentPanel",props:{selectedCount:{required:!0,tsType:{name:"number"},description:""},selectedKeys:{required:!0,tsType:{name:"Array",elements:[{name:"string"}],raw:"string[]"},description:"The issue keys that will receive the comment."},isBulkPostingComment:{required:!0,tsType:{name:"boolean"},description:""},bulkCommentError:{required:!0,tsType:{name:"union",raw:"string | null",elements:[{name:"string"},{name:"null"}]},description:""},onPostBulkComment:{required:!0,tsType:{name:"signature",type:"function",raw:"(commentText: string) => void",signature:{arguments:[{type:{name:"string"},name:"commentText"}],return:{name:"void"}}},description:""},onCancelBulk:{required:!0,tsType:{name:"signature",type:"function",raw:"() => void",signature:{arguments:[],return:{name:"void"}}},description:""}}};const me={title:"Components/BulkCommentPanel",component:X,parameters:{layout:"centered"},argTypes:{selectedCount:{control:"number"},isBulkPostingComment:{control:"boolean"},bulkCommentError:{control:"text"}},args:{onPostBulkComment:y(),onCancelBulk:y()}},r={args:{selectedCount:12,selectedKeys:["PROJ-101","PROJ-102","PROJ-103","PROJ-104","PROJ-105","PROJ-106","PROJ-107"],isBulkPostingComment:!1,bulkCommentError:null}},o={name:"Empty Comment — Submit Disabled",args:{selectedCount:5,selectedKeys:["PROJ-201","PROJ-202","PROJ-203","PROJ-204","PROJ-205"],isBulkPostingComment:!1,bulkCommentError:null},parameters:{docs:{description:{story:"The Post Comment button is disabled when the textarea is empty or contains only whitespace."}}}},a={name:"Loading — Post In Flight",args:{selectedCount:12,selectedKeys:["PROJ-101","PROJ-102","PROJ-103","PROJ-104","PROJ-105","PROJ-106","PROJ-107"],isBulkPostingComment:!0,bulkCommentError:null},parameters:{docs:{description:{story:"All interactive elements are disabled and the submit button shows a loading indicator while isBulkPostingComment is true."}}}},l={name:"Error — Failed Comment Post",args:{selectedCount:8,selectedKeys:["PROJ-301","PROJ-302","PROJ-303","PROJ-304","PROJ-305","PROJ-306"],isBulkPostingComment:!1,bulkCommentError:"Failed to post comment to some issues. Please check your permissions and try again."},parameters:{docs:{description:{story:"An error message is displayed below the textarea when bulkCommentError is non-null."}}}},i={name:"No Selected Issues",args:{selectedCount:0,selectedKeys:[],isBulkPostingComment:!1,bulkCommentError:null},parameters:{docs:{description:{story:"Renders with an empty selectedKeys array and a selectedCount of 0."}}}},m={name:"Exactly Five Keys — No Overflow",args:{selectedCount:5,selectedKeys:["ALPHA-10","ALPHA-11","ALPHA-12","ALPHA-13","ALPHA-14"],isBulkPostingComment:!1,bulkCommentError:null},parameters:{docs:{description:{story:'When there are exactly 5 keys, all are shown with no "+X more" suffix.'}}}},c={name:'Many Selected Issues — "+X More" Suffix',args:{selectedCount:47,selectedKeys:["BACKEND-501","BACKEND-502","BACKEND-503","BACKEND-504","BACKEND-505","BACKEND-506","BACKEND-507","BACKEND-508","BACKEND-509","BACKEND-510"],isBulkPostingComment:!1,bulkCommentError:null},parameters:{docs:{description:{story:'When selectedKeys exceeds 5, the first 5 are displayed followed by a "+X more" label.'}}}},d={name:"Loading With Previous Error",args:{selectedCount:3,selectedKeys:["OPS-77","OPS-78","OPS-79"],isBulkPostingComment:!0,bulkCommentError:"Network timeout. Retrying…"},parameters:{docs:{description:{story:"Handles the scenario where a previous error is still displayed while a new post attempt is in flight."}}}},u={name:"Single Selected Issue",args:{selectedCount:1,selectedKeys:["HOTFIX-999"],isBulkPostingComment:!1,bulkCommentError:null},parameters:{docs:{description:{story:"Only one issue is selected for bulk commenting."}}}};var P,g,h;r.parameters={...r.parameters,docs:{...(P=r.parameters)==null?void 0:P.docs,source:{originalSource:`{
  args: {
    selectedCount: 12,
    selectedKeys: ['PROJ-101', 'PROJ-102', 'PROJ-103', 'PROJ-104', 'PROJ-105', 'PROJ-106', 'PROJ-107'],
    isBulkPostingComment: false,
    bulkCommentError: null
  }
}`,...(h=(g=r.parameters)==null?void 0:g.docs)==null?void 0:h.source}}};var E,R,b;o.parameters={...o.parameters,docs:{...(E=o.parameters)==null?void 0:E.docs,source:{originalSource:`{
  name: 'Empty Comment — Submit Disabled',
  args: {
    selectedCount: 5,
    selectedKeys: ['PROJ-201', 'PROJ-202', 'PROJ-203', 'PROJ-204', 'PROJ-205'],
    isBulkPostingComment: false,
    bulkCommentError: null
  },
  parameters: {
    docs: {
      description: {
        story: 'The Post Comment button is disabled when the textarea is empty or contains only whitespace.'
      }
    }
  }
}`,...(b=(R=o.parameters)==null?void 0:R.docs)==null?void 0:b.source}}};var O,k,B;a.parameters={...a.parameters,docs:{...(O=a.parameters)==null?void 0:O.docs,source:{originalSource:`{
  name: 'Loading — Post In Flight',
  args: {
    selectedCount: 12,
    selectedKeys: ['PROJ-101', 'PROJ-102', 'PROJ-103', 'PROJ-104', 'PROJ-105', 'PROJ-106', 'PROJ-107'],
    isBulkPostingComment: true,
    bulkCommentError: null
  },
  parameters: {
    docs: {
      description: {
        story: 'All interactive elements are disabled and the submit button shows a loading indicator while isBulkPostingComment is true.'
      }
    }
  }
}`,...(B=(k=a.parameters)==null?void 0:k.docs)==null?void 0:B.source}}};var J,f,K;l.parameters={...l.parameters,docs:{...(J=l.parameters)==null?void 0:J.docs,source:{originalSource:`{
  name: 'Error — Failed Comment Post',
  args: {
    selectedCount: 8,
    selectedKeys: ['PROJ-301', 'PROJ-302', 'PROJ-303', 'PROJ-304', 'PROJ-305', 'PROJ-306'],
    isBulkPostingComment: false,
    bulkCommentError: 'Failed to post comment to some issues. Please check your permissions and try again.'
  },
  parameters: {
    docs: {
      description: {
        story: 'An error message is displayed below the textarea when bulkCommentError is non-null.'
      }
    }
  }
}`,...(K=(f=l.parameters)==null?void 0:f.docs)==null?void 0:K.source}}};var A,S,N;i.parameters={...i.parameters,docs:{...(A=i.parameters)==null?void 0:A.docs,source:{originalSource:`{
  name: 'No Selected Issues',
  args: {
    selectedCount: 0,
    selectedKeys: [],
    isBulkPostingComment: false,
    bulkCommentError: null
  },
  parameters: {
    docs: {
      description: {
        story: 'Renders with an empty selectedKeys array and a selectedCount of 0.'
      }
    }
  }
}`,...(N=(S=i.parameters)==null?void 0:S.docs)==null?void 0:N.source}}};var w,_,x;m.parameters={...m.parameters,docs:{...(w=m.parameters)==null?void 0:w.docs,source:{originalSource:`{
  name: 'Exactly Five Keys — No Overflow',
  args: {
    selectedCount: 5,
    selectedKeys: ['ALPHA-10', 'ALPHA-11', 'ALPHA-12', 'ALPHA-13', 'ALPHA-14'],
    isBulkPostingComment: false,
    bulkCommentError: null
  },
  parameters: {
    docs: {
      description: {
        story: 'When there are exactly 5 keys, all are shown with no "+X more" suffix.'
      }
    }
  }
}`,...(x=(_=m.parameters)==null?void 0:_.docs)==null?void 0:x.source}}};var D,v,T;c.parameters={...c.parameters,docs:{...(D=c.parameters)==null?void 0:D.docs,source:{originalSource:`{
  name: 'Many Selected Issues — "+X More" Suffix',
  args: {
    selectedCount: 47,
    selectedKeys: ['BACKEND-501', 'BACKEND-502', 'BACKEND-503', 'BACKEND-504', 'BACKEND-505', 'BACKEND-506', 'BACKEND-507', 'BACKEND-508', 'BACKEND-509', 'BACKEND-510'],
    isBulkPostingComment: false,
    bulkCommentError: null
  },
  parameters: {
    docs: {
      description: {
        story: 'When selectedKeys exceeds 5, the first 5 are displayed followed by a "+X more" label.'
      }
    }
  }
}`,...(T=(v=c.parameters)==null?void 0:v.docs)==null?void 0:T.source}}};var L,I,H;d.parameters={...d.parameters,docs:{...(L=d.parameters)==null?void 0:L.docs,source:{originalSource:`{
  name: 'Loading With Previous Error',
  args: {
    selectedCount: 3,
    selectedKeys: ['OPS-77', 'OPS-78', 'OPS-79'],
    isBulkPostingComment: true,
    bulkCommentError: 'Network timeout. Retrying…'
  },
  parameters: {
    docs: {
      description: {
        story: 'Handles the scenario where a previous error is still displayed while a new post attempt is in flight.'
      }
    }
  }
}`,...(H=(I=d.parameters)==null?void 0:I.docs)==null?void 0:H.source}}};var F,M,W;u.parameters={...u.parameters,docs:{...(F=u.parameters)==null?void 0:F.docs,source:{originalSource:`{
  name: 'Single Selected Issue',
  args: {
    selectedCount: 1,
    selectedKeys: ['HOTFIX-999'],
    isBulkPostingComment: false,
    bulkCommentError: null
  },
  parameters: {
    docs: {
      description: {
        story: 'Only one issue is selected for bulk commenting.'
      }
    }
  }
}`,...(W=(M=u.parameters)==null?void 0:M.docs)==null?void 0:W.source}}};const ce=["Default","EmptyCommentDisabled","LoadingState","ErrorState","NoSelectedIssues","ExactlyFiveKeys","ManySelectedIssues","LoadingWithPreviousError","SingleSelectedIssue"];export{r as Default,o as EmptyCommentDisabled,l as ErrorState,m as ExactlyFiveKeys,a as LoadingState,d as LoadingWithPreviousError,c as ManySelectedIssues,i as NoSelectedIssues,u as SingleSelectedIssue,ce as __namedExportsOrder,me as default};
