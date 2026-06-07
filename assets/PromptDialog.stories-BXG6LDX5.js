import{fn as f}from"./index-DeN4tkzB.js";import{r as ae}from"./index-Bc2G9s8g.js";const se="_overlay_pawtf_5",re="_dialog_pawtf_25",te="_message_pawtf_49",ne="_form_pawtf_63",oe="_label_pawtf_75",ie="_input_pawtf_85",le="_buttonRow_pawtf_103",ce="_cancelButton_pawtf_115",ue="_confirmButton_pawtf_135",e={overlay:se,dialog:re,message:te,form:ne,label:oe,input:ie,buttonRow:le,cancelButton:ce,confirmButton:ue};function z({message:G,inputLabel:d,placeholder:H,initialValue:J="",onConfirm:Q,onCancel:X,isPassword:Z=!1}){const[m,$]=ae.useState(J),g=m.trim()!=="";function ee(p){p.preventDefault(),g&&Q(m)}return React.createElement("div",{className:e.overlay,role:"dialog","aria-modal":"true"},React.createElement("div",{className:e.dialog},React.createElement("p",{className:e.message},G),React.createElement("form",{className:e.form,onSubmit:ee},d&&React.createElement("label",{className:e.label},d),React.createElement("input",{autoFocus:!0,className:e.input,onChange:p=>$(p.target.value),placeholder:H,type:Z?"password":"text",value:m}),React.createElement("div",{className:e.buttonRow},React.createElement("button",{className:e.cancelButton,onClick:X,type:"button"},"Cancel"),React.createElement("button",{className:e.confirmButton,disabled:!g,type:"submit"},"OK")))))}z.__docgenInfo={description:"PromptDialog collects a short text response without relying on the browser prompt window.",methods:[],displayName:"PromptDialog",props:{message:{required:!0,tsType:{name:"string"},description:""},inputLabel:{required:!1,tsType:{name:"string"},description:""},placeholder:{required:!1,tsType:{name:"string"},description:""},initialValue:{required:!1,tsType:{name:"string"},description:"",defaultValue:{value:"''",computed:!1}},isPassword:{required:!1,tsType:{name:"boolean"},description:"",defaultValue:{value:"false",computed:!1}}}};const de={title:"Components/PromptDialog",component:z,args:{onConfirm:f(),onCancel:f()}},a={args:{message:"What would you like to name this project?",inputLabel:"Project Name",placeholder:"e.g. My Awesome Project",initialValue:"",isPassword:!1}},s={name:"Password Mode",args:{message:"Enter your password:",inputLabel:"Password",placeholder:"Type your secret password",initialValue:"",isPassword:!0}},r={name:"With Initial Value",args:{message:"Update the display name for this workspace:",inputLabel:"Display Name",placeholder:"Enter a display name",initialValue:"My Workspace",isPassword:!1}},t={name:"Empty Input (OK Disabled)",args:{message:"Please enter a reason for archiving this record:",inputLabel:"Reason",placeholder:"Describe why you are archiving this record",initialValue:"",isPassword:!1}},n={name:"Whitespace-Only Input (OK Disabled)",args:{message:"Enter a tag name for this release:",inputLabel:"Tag Name",placeholder:"e.g. v1.0.0",initialValue:"   ",isPassword:!1}},o={name:"No Label",args:{message:"Are you sure you want to delete this file? Type the filename to confirm:",inputLabel:void 0,placeholder:"filename.txt",initialValue:"",isPassword:!1}},i={name:"No Placeholder",args:{message:"Enter a new folder name:",inputLabel:"Folder Name",placeholder:void 0,initialValue:"",isPassword:!1}},l={name:"Password Mode With Pre-Filled Value",args:{message:"Confirm your current password to continue:",inputLabel:"Current Password",placeholder:"Enter your current password",initialValue:"hunter2",isPassword:!0}},c={name:"Long Message",args:{message:'You are about to permanently delete all snapshots associated with this environment. This action cannot be undone. Please type "DELETE" to confirm you understand the consequences and wish to proceed.',inputLabel:"Confirmation",placeholder:"Type DELETE to confirm",initialValue:"",isPassword:!1}},u={name:"Form Submission (Press Enter)",args:{message:"Enter a commit message for your changes:",inputLabel:"Commit Message",placeholder:"e.g. Fix login page styling",initialValue:"Update navigation bar layout",isPassword:!1}};var h,w,y;a.parameters={...a.parameters,docs:{...(h=a.parameters)==null?void 0:h.docs,source:{originalSource:`{
  args: {
    message: 'What would you like to name this project?',
    inputLabel: 'Project Name',
    placeholder: 'e.g. My Awesome Project',
    initialValue: '',
    isPassword: false
  }
}`,...(y=(w=a.parameters)==null?void 0:w.docs)==null?void 0:y.source}}};var b,P,E;s.parameters={...s.parameters,docs:{...(b=s.parameters)==null?void 0:b.docs,source:{originalSource:`{
  name: 'Password Mode',
  args: {
    message: 'Enter your password:',
    inputLabel: 'Password',
    placeholder: 'Type your secret password',
    initialValue: '',
    isPassword: true
  }
}`,...(E=(P=s.parameters)==null?void 0:P.docs)==null?void 0:E.source}}};var V,L,_;r.parameters={...r.parameters,docs:{...(V=r.parameters)==null?void 0:V.docs,source:{originalSource:`{
  name: 'With Initial Value',
  args: {
    message: 'Update the display name for this workspace:',
    inputLabel: 'Display Name',
    placeholder: 'Enter a display name',
    initialValue: 'My Workspace',
    isPassword: false
  }
}`,...(_=(L=r.parameters)==null?void 0:L.docs)==null?void 0:_.source}}};var N,v,D;t.parameters={...t.parameters,docs:{...(N=t.parameters)==null?void 0:N.docs,source:{originalSource:`{
  name: 'Empty Input (OK Disabled)',
  args: {
    message: 'Please enter a reason for archiving this record:',
    inputLabel: 'Reason',
    placeholder: 'Describe why you are archiving this record',
    initialValue: '',
    isPassword: false
  }
}`,...(D=(v=t.parameters)==null?void 0:v.docs)==null?void 0:D.source}}};var T,I,S;n.parameters={...n.parameters,docs:{...(T=n.parameters)==null?void 0:T.docs,source:{originalSource:`{
  name: 'Whitespace-Only Input (OK Disabled)',
  args: {
    message: 'Enter a tag name for this release:',
    inputLabel: 'Tag Name',
    placeholder: 'e.g. v1.0.0',
    initialValue: '   ',
    isPassword: false
  }
}`,...(S=(I=n.parameters)==null?void 0:I.docs)==null?void 0:S.source}}};var M,W,R;o.parameters={...o.parameters,docs:{...(M=o.parameters)==null?void 0:M.docs,source:{originalSource:`{
  name: 'No Label',
  args: {
    message: 'Are you sure you want to delete this file? Type the filename to confirm:',
    inputLabel: undefined,
    placeholder: 'filename.txt',
    initialValue: '',
    isPassword: false
  }
}`,...(R=(W=o.parameters)==null?void 0:W.docs)==null?void 0:R.source}}};var C,F,O;i.parameters={...i.parameters,docs:{...(C=i.parameters)==null?void 0:C.docs,source:{originalSource:`{
  name: 'No Placeholder',
  args: {
    message: 'Enter a new folder name:',
    inputLabel: 'Folder Name',
    placeholder: undefined,
    initialValue: '',
    isPassword: false
  }
}`,...(O=(F=i.parameters)==null?void 0:F.docs)==null?void 0:O.source}}};var x,B,k;l.parameters={...l.parameters,docs:{...(x=l.parameters)==null?void 0:x.docs,source:{originalSource:`{
  name: 'Password Mode With Pre-Filled Value',
  args: {
    message: 'Confirm your current password to continue:',
    inputLabel: 'Current Password',
    placeholder: 'Enter your current password',
    initialValue: 'hunter2',
    isPassword: true
  }
}`,...(k=(B=l.parameters)==null?void 0:B.docs)==null?void 0:k.source}}};var q,j,K;c.parameters={...c.parameters,docs:{...(q=c.parameters)==null?void 0:q.docs,source:{originalSource:`{
  name: 'Long Message',
  args: {
    message: 'You are about to permanently delete all snapshots associated with this environment. This action cannot be undone. Please type "DELETE" to confirm you understand the consequences and wish to proceed.',
    inputLabel: 'Confirmation',
    placeholder: 'Type DELETE to confirm',
    initialValue: '',
    isPassword: false
  }
}`,...(K=(j=c.parameters)==null?void 0:j.docs)==null?void 0:K.source}}};var A,U,Y;u.parameters={...u.parameters,docs:{...(A=u.parameters)==null?void 0:A.docs,source:{originalSource:`{
  name: 'Form Submission (Press Enter)',
  args: {
    message: 'Enter a commit message for your changes:',
    inputLabel: 'Commit Message',
    placeholder: 'e.g. Fix login page styling',
    initialValue: 'Update navigation bar layout',
    isPassword: false
  }
}`,...(Y=(U=u.parameters)==null?void 0:U.docs)==null?void 0:Y.source}}};const ge=["Default","PasswordMode","WithInitialValue","EmptyInput","WhitespaceOnlyInput","NoLabel","NoPlaceholder","PasswordWithInitialValue","LongMessage","FormSubmission"];export{a as Default,t as EmptyInput,u as FormSubmission,c as LongMessage,o as NoLabel,i as NoPlaceholder,s as PasswordMode,l as PasswordWithInitialValue,n as WhitespaceOnlyInput,r as WithInitialValue,ge as __namedExportsOrder,de as default};
