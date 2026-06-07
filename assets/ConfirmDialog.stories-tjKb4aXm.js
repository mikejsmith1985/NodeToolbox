import{fn as i}from"./index-DeN4tkzB.js";import{C as K}from"./index-BR7estDG.js";const B={title:"Components/ConfirmDialog",component:K,args:{onConfirm:i(),onCancel:i()}},e={args:{message:"Are you sure you want to delete this item? This action cannot be undone.",confirmLabel:"Delete",cancelLabel:"Keep",isDangerous:!0}},a={args:{message:"Are you sure you want to proceed?"}},s={args:{message:"",confirmLabel:"Confirm",cancelLabel:"Cancel"}},r={args:{message:"Are you sure you want to permanently remove all historical transaction records from your account? This will delete over 5 years of financial data including receipts, invoices, and payment confirmations. This action is irreversible and cannot be undone by our support team. Please make sure you have exported any data you wish to keep before proceeding.",confirmLabel:"Yes, Delete Everything",cancelLabel:"Go Back",isDangerous:!0}},o={args:{message:"Are you sure you want to revoke access for Sarah Johnson? She will immediately lose access to all shared resources and ongoing projects.",confirmLabel:"Revoke Access",cancelLabel:"Cancel",isDangerous:!0}},n={args:{message:"Would you like to save your changes before leaving?",confirmLabel:"Save Changes",cancelLabel:"Discard",isDangerous:!1}},t={args:{message:"Are you sure you want to archive this project? It will be moved to the archive and hidden from your main dashboard.",confirmLabel:"Archive",cancelLabel:"Keep Active",isDangerous:!1}},c={args:{message:"Are you sure you want to sign out? Any unsaved changes will be lost.",confirmLabel:"Sign Out",cancelLabel:"Stay Signed In",isDangerous:!1}};var l,u,m;e.parameters={...e.parameters,docs:{...(l=e.parameters)==null?void 0:l.docs,source:{originalSource:`{
  args: {
    message: 'Are you sure you want to delete this item? This action cannot be undone.',
    confirmLabel: 'Delete',
    cancelLabel: 'Keep',
    isDangerous: true
  }
}`,...(m=(u=e.parameters)==null?void 0:u.docs)==null?void 0:m.source}}};var g,d,p;a.parameters={...a.parameters,docs:{...(g=a.parameters)==null?void 0:g.docs,source:{originalSource:`{
  args: {
    message: 'Are you sure you want to proceed?'
  }
}`,...(p=(d=a.parameters)==null?void 0:d.docs)==null?void 0:p.source}}};var y,f,b;s.parameters={...s.parameters,docs:{...(y=s.parameters)==null?void 0:y.docs,source:{originalSource:`{
  args: {
    message: '',
    confirmLabel: 'Confirm',
    cancelLabel: 'Cancel'
  }
}`,...(b=(f=s.parameters)==null?void 0:f.docs)==null?void 0:b.source}}};var h,v,L;r.parameters={...r.parameters,docs:{...(h=r.parameters)==null?void 0:h.docs,source:{originalSource:`{
  args: {
    message: 'Are you sure you want to permanently remove all historical transaction records from your account? This will delete over 5 years of financial data including receipts, invoices, and payment confirmations. This action is irreversible and cannot be undone by our support team. Please make sure you have exported any data you wish to keep before proceeding.',
    confirmLabel: 'Yes, Delete Everything',
    cancelLabel: 'Go Back',
    isDangerous: true
  }
}`,...(L=(v=r.parameters)==null?void 0:v.docs)==null?void 0:L.source}}};var D,w,A;o.parameters={...o.parameters,docs:{...(D=o.parameters)==null?void 0:D.docs,source:{originalSource:`{
  args: {
    message: 'Are you sure you want to revoke access for Sarah Johnson? She will immediately lose access to all shared resources and ongoing projects.',
    confirmLabel: 'Revoke Access',
    cancelLabel: 'Cancel',
    isDangerous: true
  }
}`,...(A=(w=o.parameters)==null?void 0:w.docs)==null?void 0:A.source}}};var S,C,k;n.parameters={...n.parameters,docs:{...(S=n.parameters)==null?void 0:S.docs,source:{originalSource:`{
  args: {
    message: 'Would you like to save your changes before leaving?',
    confirmLabel: 'Save Changes',
    cancelLabel: 'Discard',
    isDangerous: false
  }
}`,...(k=(C=n.parameters)==null?void 0:C.docs)==null?void 0:k.source}}};var I,T,E;t.parameters={...t.parameters,docs:{...(I=t.parameters)==null?void 0:I.docs,source:{originalSource:`{
  args: {
    message: 'Are you sure you want to archive this project? It will be moved to the archive and hidden from your main dashboard.',
    confirmLabel: 'Archive',
    cancelLabel: 'Keep Active',
    isDangerous: false
  }
}`,...(E=(T=t.parameters)==null?void 0:T.docs)==null?void 0:E.source}}};var O,j,x;c.parameters={...c.parameters,docs:{...(O=c.parameters)==null?void 0:O.docs,source:{originalSource:`{
  args: {
    message: 'Are you sure you want to sign out? Any unsaved changes will be lost.',
    confirmLabel: 'Sign Out',
    cancelLabel: 'Stay Signed In',
    isDangerous: false
  }
}`,...(x=(j=c.parameters)==null?void 0:j.docs)==null?void 0:x.source}}};const G=["Default","DefaultLabels","EmptyMessage","LongMessage","DangerousWithCustomLabel","NonDestructiveConfirm","ArchiveItem","SignOut"];export{t as ArchiveItem,o as DangerousWithCustomLabel,e as Default,a as DefaultLabels,s as EmptyMessage,r as LongMessage,n as NonDestructiveConfirm,c as SignOut,G as __namedExportsOrder,B as default};
