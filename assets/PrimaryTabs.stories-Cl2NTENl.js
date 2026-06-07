import{fn as B}from"./index-DeN4tkzB.js";import{P as G}from"./PrimaryTabs-x7ty6h1d.js";const j={title:"Components/PrimaryTabs",component:G,parameters:{layout:"padded"},args:{onChange:B()}},e={args:{tabs:[{key:"overview",label:"Overview"},{key:"settings",label:"Settings"},{key:"advanced",label:"Advanced"}],activeTab:"overview",ariaLabel:"Toolbox navigation",idPrefix:"tool"}},a={name:"Settings Tab Active",args:{tabs:[{key:"overview",label:"Overview"},{key:"settings",label:"Settings"},{key:"advanced",label:"Advanced"}],activeTab:"settings",ariaLabel:"Toolbox navigation",idPrefix:"tool"}},n={name:"Advanced Tab Active",args:{tabs:[{key:"overview",label:"Overview"},{key:"settings",label:"Settings"},{key:"advanced",label:"Advanced"}],activeTab:"advanced",ariaLabel:"Toolbox navigation",idPrefix:"tool"}},i={name:"Many Tabs",args:{tabs:[{key:"overview",label:"Overview"},{key:"profile",label:"Profile"},{key:"billing",label:"Billing"},{key:"notifications",label:"Notifications"},{key:"settings",label:"Settings"},{key:"advanced",label:"Advanced"}],activeTab:"billing",ariaLabel:"Account navigation",idPrefix:"account"}},t={name:"Single Tab",args:{tabs:[{key:"overview",label:"Overview"}],activeTab:"overview",ariaLabel:"Single tab navigation",idPrefix:"single"}},r={name:"Empty Tabs Array",args:{tabs:[],activeTab:"overview",ariaLabel:"Empty navigation",idPrefix:"empty"}},s={name:"Active Tab Not Present in Tabs Array",args:{tabs:[{key:"overview",label:"Overview"},{key:"settings",label:"Settings"},{key:"advanced",label:"Advanced"}],activeTab:"profile",ariaLabel:"Toolbox navigation",idPrefix:"tool"}},o={name:"Without Custom ID Prefix (Default)",args:{tabs:[{key:"overview",label:"Overview"},{key:"settings",label:"Settings"},{key:"advanced",label:"Advanced"}],activeTab:"overview",ariaLabel:"Toolbox navigation"}},l={name:"Tabs With Long Labels",args:{tabs:[{key:"overview",label:"General Overview"},{key:"settings",label:"Account Settings & Preferences"},{key:"advanced",label:"Advanced Configuration Options"}],activeTab:"settings",ariaLabel:"Extended navigation",idPrefix:"extended"}};var v,b,c;e.parameters={...e.parameters,docs:{...(v=e.parameters)==null?void 0:v.docs,source:{originalSource:`{
  args: {
    tabs: [{
      key: 'overview',
      label: 'Overview'
    }, {
      key: 'settings',
      label: 'Settings'
    }, {
      key: 'advanced',
      label: 'Advanced'
    }],
    activeTab: 'overview',
    ariaLabel: 'Toolbox navigation',
    idPrefix: 'tool'
  }
}`,...(c=(b=e.parameters)==null?void 0:b.docs)==null?void 0:c.source}}};var d,g,m;a.parameters={...a.parameters,docs:{...(d=a.parameters)==null?void 0:d.docs,source:{originalSource:`{
  name: 'Settings Tab Active',
  args: {
    tabs: [{
      key: 'overview',
      label: 'Overview'
    }, {
      key: 'settings',
      label: 'Settings'
    }, {
      key: 'advanced',
      label: 'Advanced'
    }],
    activeTab: 'settings',
    ariaLabel: 'Toolbox navigation',
    idPrefix: 'tool'
  }
}`,...(m=(g=a.parameters)==null?void 0:g.docs)==null?void 0:m.source}}};var y,T,p;n.parameters={...n.parameters,docs:{...(y=n.parameters)==null?void 0:y.docs,source:{originalSource:`{
  name: 'Advanced Tab Active',
  args: {
    tabs: [{
      key: 'overview',
      label: 'Overview'
    }, {
      key: 'settings',
      label: 'Settings'
    }, {
      key: 'advanced',
      label: 'Advanced'
    }],
    activeTab: 'advanced',
    ariaLabel: 'Toolbox navigation',
    idPrefix: 'tool'
  }
}`,...(p=(T=n.parameters)==null?void 0:T.docs)==null?void 0:p.source}}};var k,u,f;i.parameters={...i.parameters,docs:{...(k=i.parameters)==null?void 0:k.docs,source:{originalSource:`{
  name: 'Many Tabs',
  args: {
    tabs: [{
      key: 'overview',
      label: 'Overview'
    }, {
      key: 'profile',
      label: 'Profile'
    }, {
      key: 'billing',
      label: 'Billing'
    }, {
      key: 'notifications',
      label: 'Notifications'
    }, {
      key: 'settings',
      label: 'Settings'
    }, {
      key: 'advanced',
      label: 'Advanced'
    }],
    activeTab: 'billing',
    ariaLabel: 'Account navigation',
    idPrefix: 'account'
  }
}`,...(f=(u=i.parameters)==null?void 0:u.docs)==null?void 0:f.source}}};var w,A,x;t.parameters={...t.parameters,docs:{...(w=t.parameters)==null?void 0:w.docs,source:{originalSource:`{
  name: 'Single Tab',
  args: {
    tabs: [{
      key: 'overview',
      label: 'Overview'
    }],
    activeTab: 'overview',
    ariaLabel: 'Single tab navigation',
    idPrefix: 'single'
  }
}`,...(x=(A=t.parameters)==null?void 0:A.docs)==null?void 0:x.source}}};var S,P,L;r.parameters={...r.parameters,docs:{...(S=r.parameters)==null?void 0:S.docs,source:{originalSource:`{
  name: 'Empty Tabs Array',
  args: {
    tabs: [],
    activeTab: 'overview',
    ariaLabel: 'Empty navigation',
    idPrefix: 'empty'
  }
}`,...(L=(P=r.parameters)==null?void 0:P.docs)==null?void 0:L.source}}};var O,E,h;s.parameters={...s.parameters,docs:{...(O=s.parameters)==null?void 0:O.docs,source:{originalSource:`{
  name: 'Active Tab Not Present in Tabs Array',
  args: {
    tabs: [{
      key: 'overview',
      label: 'Overview'
    }, {
      key: 'settings',
      label: 'Settings'
    }, {
      key: 'advanced',
      label: 'Advanced'
    }],
    activeTab: 'profile' as TabKey,
    ariaLabel: 'Toolbox navigation',
    idPrefix: 'tool'
  }
}`,...(h=(E=s.parameters)==null?void 0:E.docs)==null?void 0:h.source}}};var C,D,I;o.parameters={...o.parameters,docs:{...(C=o.parameters)==null?void 0:C.docs,source:{originalSource:`{
  name: 'Without Custom ID Prefix (Default)',
  args: {
    tabs: [{
      key: 'overview',
      label: 'Overview'
    }, {
      key: 'settings',
      label: 'Settings'
    }, {
      key: 'advanced',
      label: 'Advanced'
    }],
    activeTab: 'overview',
    ariaLabel: 'Toolbox navigation'
  }
}`,...(I=(D=o.parameters)==null?void 0:D.docs)==null?void 0:I.source}}};var N,W,M;l.parameters={...l.parameters,docs:{...(N=l.parameters)==null?void 0:N.docs,source:{originalSource:`{
  name: 'Tabs With Long Labels',
  args: {
    tabs: [{
      key: 'overview',
      label: 'General Overview'
    }, {
      key: 'settings',
      label: 'Account Settings & Preferences'
    }, {
      key: 'advanced',
      label: 'Advanced Configuration Options'
    }],
    activeTab: 'settings',
    ariaLabel: 'Extended navigation',
    idPrefix: 'extended'
  }
}`,...(M=(W=l.parameters)==null?void 0:W.docs)==null?void 0:M.source}}};const q=["Default","SettingsTabActive","AdvancedTabActive","ManyTabs","SingleTab","EmptyTabs","ActiveTabNotInList","WithoutIdPrefix","LongLabels"];export{s as ActiveTabNotInList,n as AdvancedTabActive,e as Default,r as EmptyTabs,l as LongLabels,i as ManyTabs,a as SettingsTabActive,t as SingleTab,o as WithoutIdPrefix,q as __namedExportsOrder,j as default};
