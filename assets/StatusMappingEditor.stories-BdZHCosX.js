import{fn as o}from"./index-DeN4tkzB.js";import{r as P,R as e}from"./index-Bc2G9s8g.js";import{u as ue}from"./settingsStore-D1ohuLZB.js";import"./react-Li0Ki8N_.js";const me="_editorWrapper_f3q73_5",ce="_sectionTitle_f3q73_17",Se="_sectionSubtitle_f3q73_31",ge="_mappingTable_f3q73_49",fe="_mappingRow_f3q73_61",we="_mappingRowSystem_f3q73_85",ye="_mappingArrow_f3q73_95",he="_mappingInput_f3q73_109",De="_mappingInputDisabled_f3q73_141",ve="_systemLabel_f3q73_153",be="_removeButton_f3q73_177",Me="_addRowWrapper_f3q73_215",Pe="_addButton_f3q73_231",Ne="_persistenceNote_f3q73_263",s={editorWrapper:me,sectionTitle:ce,sectionSubtitle:Se,mappingTable:ge,mappingRow:fe,mappingRowSystem:we,mappingArrow:ye,mappingInput:he,mappingInputDisabled:De,systemLabel:ve,removeButton:be,addRowWrapper:Me,addButton:Pe,persistenceNote:Ne},h={jiraStatus:"To Do",snowStatus:"New",isSystemDefined:!0},D="";function ne(){const{statusMappings:i,setStatusMappings:a}=ue(),[n,f]=P.useState(D),[p,w]=P.useState(D),r=i.filter(t=>!t.isSystemDefined);function v(){const t=n.trim(),y=p.trim();if(!t||!y||i.some(le=>le.jiraStatus.toLowerCase()===t.toLowerCase()))return;const de={jiraStatus:t,snowStatus:y,isSystemDefined:!1};a([h,...r,de]),f(D),w(D)}function ie(t){const y=r.filter(M=>M.jiraStatus!==t);a([h,...y])}function re(t){f(t.target.value)}function oe(t){w(t.target.value)}function b(t){t.key==="Enter"&&v()}const pe=!n.trim()||!p.trim();return e.createElement("div",{className:s.editorWrapper},e.createElement("p",{className:s.sectionTitle},"Jira → ServiceNow Status Mapping"),e.createElement("p",{className:s.sectionSubtitle},"Define which Jira status maps to which SNow state for the health-check badge. Mappings are saved automatically and persist across app updates."),e.createElement("div",{className:s.mappingTable,role:"list","aria-label":"Status mappings"},e.createElement("div",{className:`${s.mappingRow} ${s.mappingRowSystem}`,role:"listitem"},e.createElement("input",{className:`${s.mappingInput} ${s.mappingInputDisabled}`,value:h.jiraStatus,readOnly:!0,disabled:!0,"aria-label":"System Jira status (read-only)"}),e.createElement("span",{className:s.mappingArrow},"→"),e.createElement("input",{className:`${s.mappingInput} ${s.mappingInputDisabled}`,value:h.snowStatus,readOnly:!0,disabled:!0,"aria-label":"System SNow state (read-only)"}),e.createElement("span",{className:s.systemLabel},"System")),r.map(t=>e.createElement("div",{key:t.jiraStatus,className:s.mappingRow,role:"listitem","aria-label":`Mapping: ${t.jiraStatus} → ${t.snowStatus}`},e.createElement("input",{className:s.mappingInput,value:t.jiraStatus,readOnly:!0,"aria-label":`Jira status: ${t.jiraStatus}`}),e.createElement("span",{className:s.mappingArrow},"→"),e.createElement("input",{className:s.mappingInput,value:t.snowStatus,readOnly:!0,"aria-label":`SNow state: ${t.snowStatus}`}),e.createElement("button",{className:s.removeButton,onClick:()=>ie(t.jiraStatus),"aria-label":`Remove mapping for ${t.jiraStatus}`,title:`Remove "${t.jiraStatus}" mapping`},"×"))),e.createElement("div",{className:s.addRowWrapper},e.createElement("input",{className:s.mappingInput,placeholder:"Jira status (e.g. In Progress)",value:n,onChange:re,onKeyDown:b,"aria-label":"New Jira status"}),e.createElement("span",{className:s.mappingArrow},"→"),e.createElement("input",{className:s.mappingInput,placeholder:"SNow state (e.g. In Progress)",value:p,onChange:oe,onKeyDown:b,"aria-label":"New SNow state"}),e.createElement("button",{className:s.addButton,onClick:v,disabled:pe,"aria-label":"Add status mapping"},"+ Add"))),e.createElement("p",{className:s.persistenceNote},"✓ Mappings are saved automatically in your browser and will persist after updates."))}ne.__docgenInfo={description:`Editor panel for the Jira→SNow status mapping configuration.\r
\r
Renders a table of current mappings with inline delete buttons, plus\r
a form row at the bottom for adding new mappings. Changes are written\r
to localStorage immediately — no explicit "Save" action is required.`,methods:[],displayName:"StatusMappingEditor"};const g=e.createContext({statusMappings:[],setStatusMappings:()=>{}});function je({initialMappings:i,onSetStatusMappings:a,children:n}){const[f,p]=e.useState(i),w=e.useCallback(r=>{p(r),a==null||a(r)},[a]);return e.createElement(g.Provider,{value:{statusMappings:f,setStatusMappings:w}},n)}const Re={title:"Settings/StatusMappingEditor",component:ne,parameters:{layout:"centered",docs:{description:{component:"Allows users to map Jira statuses to ServiceNow (SNOW) statuses. System-defined mappings are read-only; user-defined mappings can be added or removed. Validates for duplicate Jira statuses and incomplete entries."}}},decorators:[(i,a)=>{const n=a.parameters.storeProps??{initialMappings:[{jiraStatus:"To Do",snowStatus:"New",isSystemDefined:!0},{jiraStatus:"In Progress",snowStatus:"In Progress",isSystemDefined:!1},{jiraStatus:"Done",snowStatus:"Resolved",isSystemDefined:!1}]};return e.createElement(je,{initialMappings:n.initialMappings,onSetStatusMappings:n.onSetStatusMappings},e.createElement(i,null))}]},d={name:"Default (Populated)",parameters:{storeProps:{initialMappings:[{jiraStatus:"To Do",snowStatus:"New",isSystemDefined:!0},{jiraStatus:"In Progress",snowStatus:"In Progress",isSystemDefined:!1},{jiraStatus:"Done",snowStatus:"Resolved",isSystemDefined:!1}],onSetStatusMappings:o()},docs:{description:{story:'The standard view with a locked system-defined mapping ("To Do → New") and two editable user-defined mappings.'}}}},l={name:"Empty State (System Mapping Only)",parameters:{storeProps:{initialMappings:[{jiraStatus:"To Do",snowStatus:"New",isSystemDefined:!0}],onSetStatusMappings:o()},docs:{description:{story:'Only the system-defined "To Do → New" mapping is present. The user has not yet added any custom mappings. The system row should be locked (non-deletable).'}}}},u={name:"Validation – Duplicate Jira Status",parameters:{storeProps:{initialMappings:[{jiraStatus:"To Do",snowStatus:"New",isSystemDefined:!0},{jiraStatus:"In Progress",snowStatus:"In Progress",isSystemDefined:!1},{jiraStatus:"In Progress",snowStatus:"Work in Progress",isSystemDefined:!1}],onSetStatusMappings:o()},docs:{description:{story:'Two rows share the Jira status "In Progress". The editor should highlight the duplicate and prevent saving until the conflict is resolved.'}}}},m={name:"Validation – Incomplete Mapping",parameters:{storeProps:{initialMappings:[{jiraStatus:"To Do",snowStatus:"New",isSystemDefined:!0},{jiraStatus:"In Progress",snowStatus:"In Progress",isSystemDefined:!1},{jiraStatus:"Blocked",snowStatus:"",isSystemDefined:!1}],onSetStatusMappings:o()},docs:{description:{story:'A mapping row with a Jira status of "Blocked" has no corresponding SNOW status. The editor should flag the incomplete entry and block the user from saving.'}}}},c={name:"All User Mappings Removed",parameters:{storeProps:{initialMappings:[{jiraStatus:"To Do",snowStatus:"New",isSystemDefined:!0}],onSetStatusMappings:o()},docs:{description:{story:"After removing every user-defined mapping the list contains only the immutable system mapping. The delete button for that row must be disabled or hidden."}}}},S={name:"Large Mapping List",parameters:{storeProps:{initialMappings:[{jiraStatus:"To Do",snowStatus:"New",isSystemDefined:!0},{jiraStatus:"Open",snowStatus:"Open",isSystemDefined:!1},{jiraStatus:"In Progress",snowStatus:"In Progress",isSystemDefined:!1},{jiraStatus:"In Review",snowStatus:"Pending Review",isSystemDefined:!1},{jiraStatus:"Blocked",snowStatus:"On Hold",isSystemDefined:!1},{jiraStatus:"Ready for QA",snowStatus:"Pending",isSystemDefined:!1},{jiraStatus:"QA In Progress",snowStatus:"Work in Progress",isSystemDefined:!1},{jiraStatus:"QA Passed",snowStatus:"Resolved",isSystemDefined:!1},{jiraStatus:"Done",snowStatus:"Closed",isSystemDefined:!1},{jiraStatus:"Won't Do",snowStatus:"Cancelled",isSystemDefined:!1}],onSetStatusMappings:o()},docs:{description:{story:"Ten mappings covering a complete Jira workflow mapped to ServiceNow statuses. Tests layout stability and scroll behaviour when many rows are present."}}}};var N,j,I;g.parameters={...g.parameters,docs:{...(N=g.parameters)==null?void 0:N.docs,source:{originalSource:`React.createContext<SettingsStoreState>({
  statusMappings: [],
  setStatusMappings: () => {}
})`,...(I=(j=g.parameters)==null?void 0:j.docs)==null?void 0:I.source}}};var T,_,E,R,A;d.parameters={...d.parameters,docs:{...(T=d.parameters)==null?void 0:T.docs,source:{originalSource:`{
  name: 'Default (Populated)',
  parameters: {
    storeProps: {
      initialMappings: [{
        jiraStatus: 'To Do',
        snowStatus: 'New',
        isSystemDefined: true
      }, {
        jiraStatus: 'In Progress',
        snowStatus: 'In Progress',
        isSystemDefined: false
      }, {
        jiraStatus: 'Done',
        snowStatus: 'Resolved',
        isSystemDefined: false
      }],
      onSetStatusMappings: fn()
    },
    docs: {
      description: {
        story: 'The standard view with a locked system-defined mapping ("To Do → New") and two editable user-defined mappings.'
      }
    }
  }
}`,...(E=(_=d.parameters)==null?void 0:_.docs)==null?void 0:E.source},description:{story:`Happy path – three mappings (one system-defined, two user-defined).\r
Demonstrates the full, realistic populated state of the editor.`,...(A=(R=d.parameters)==null?void 0:R.docs)==null?void 0:A.description}}};var k,J,O,C,W;l.parameters={...l.parameters,docs:{...(k=l.parameters)==null?void 0:k.docs,source:{originalSource:`{
  name: 'Empty State (System Mapping Only)',
  parameters: {
    storeProps: {
      initialMappings: [{
        jiraStatus: 'To Do',
        snowStatus: 'New',
        isSystemDefined: true
      }],
      onSetStatusMappings: fn()
    },
    docs: {
      description: {
        story: 'Only the system-defined "To Do → New" mapping is present. The user has not yet added any custom mappings. The system row should be locked (non-deletable).'
      }
    }
  }
}`,...(O=(J=l.parameters)==null?void 0:J.docs)==null?void 0:O.source},description:{story:`Only the system-defined mapping exists – the list is otherwise empty.\r
The "Add Mapping" button should be visible and the sole row locked.`,...(W=(C=l.parameters)==null?void 0:C.docs)==null?void 0:W.description}}};var q,B,L,$,V;u.parameters={...u.parameters,docs:{...(q=u.parameters)==null?void 0:q.docs,source:{originalSource:`{
  name: 'Validation – Duplicate Jira Status',
  parameters: {
    storeProps: {
      initialMappings: [{
        jiraStatus: 'To Do',
        snowStatus: 'New',
        isSystemDefined: true
      }, {
        jiraStatus: 'In Progress',
        snowStatus: 'In Progress',
        isSystemDefined: false
      },
      // Intentional duplicate to trigger validation UI
      {
        jiraStatus: 'In Progress',
        snowStatus: 'Work in Progress',
        isSystemDefined: false
      }],
      onSetStatusMappings: fn()
    },
    docs: {
      description: {
        story: 'Two rows share the Jira status "In Progress". The editor should highlight the duplicate and prevent saving until the conflict is resolved.'
      }
    }
  }
}`,...(L=(B=u.parameters)==null?void 0:B.docs)==null?void 0:L.source},description:{story:`Simulates a state where a duplicate Jira status would be attempted.\r
Pre-populate two mappings that share the same Jira status so the editor\r
shows its duplicate-validation error state on render (or when submit is\r
attempted, depending on implementation).`,...(V=($=u.parameters)==null?void 0:$.docs)==null?void 0:V.description}}};var x,U,Q,H,K;m.parameters={...m.parameters,docs:{...(x=m.parameters)==null?void 0:x.docs,source:{originalSource:`{
  name: 'Validation – Incomplete Mapping',
  parameters: {
    storeProps: {
      initialMappings: [{
        jiraStatus: 'To Do',
        snowStatus: 'New',
        isSystemDefined: true
      }, {
        jiraStatus: 'In Progress',
        snowStatus: 'In Progress',
        isSystemDefined: false
      },
      // Incomplete row: snowStatus is intentionally blank
      {
        jiraStatus: 'Blocked',
        snowStatus: '',
        isSystemDefined: false
      }],
      onSetStatusMappings: fn()
    },
    docs: {
      description: {
        story: 'A mapping row with a Jira status of "Blocked" has no corresponding SNOW status. The editor should flag the incomplete entry and block the user from saving.'
      }
    }
  }
}`,...(Q=(U=m.parameters)==null?void 0:U.docs)==null?void 0:Q.source},description:{story:`Simulates a state where one of the user-defined rows has an empty Jira or\r
SNOW status, triggering the incomplete-mapping validation.`,...(K=(H=m.parameters)==null?void 0:H.docs)==null?void 0:K.description}}};var G,Y,z,F,X;c.parameters={...c.parameters,docs:{...(G=c.parameters)==null?void 0:G.docs,source:{originalSource:`{
  name: 'All User Mappings Removed',
  parameters: {
    storeProps: {
      initialMappings: [
      // Start with user mappings that were already deleted – result state
      {
        jiraStatus: 'To Do',
        snowStatus: 'New',
        isSystemDefined: true
      }],
      onSetStatusMappings: fn()
    },
    docs: {
      description: {
        story: 'After removing every user-defined mapping the list contains only the immutable system mapping. The delete button for that row must be disabled or hidden.'
      }
    }
  }
}`,...(z=(Y=c.parameters)==null?void 0:Y.docs)==null?void 0:z.source},description:{story:`All user-defined mappings have been removed; only the locked system mapping\r
remains. Verifies that the delete action on the last user row works and that\r
the system-defined row remains protected.`,...(X=(F=c.parameters)==null?void 0:F.docs)==null?void 0:X.description}}};var Z,ee,te,se,ae;S.parameters={...S.parameters,docs:{...(Z=S.parameters)==null?void 0:Z.docs,source:{originalSource:`{
  name: 'Large Mapping List',
  parameters: {
    storeProps: {
      initialMappings: [{
        jiraStatus: 'To Do',
        snowStatus: 'New',
        isSystemDefined: true
      }, {
        jiraStatus: 'Open',
        snowStatus: 'Open',
        isSystemDefined: false
      }, {
        jiraStatus: 'In Progress',
        snowStatus: 'In Progress',
        isSystemDefined: false
      }, {
        jiraStatus: 'In Review',
        snowStatus: 'Pending Review',
        isSystemDefined: false
      }, {
        jiraStatus: 'Blocked',
        snowStatus: 'On Hold',
        isSystemDefined: false
      }, {
        jiraStatus: 'Ready for QA',
        snowStatus: 'Pending',
        isSystemDefined: false
      }, {
        jiraStatus: 'QA In Progress',
        snowStatus: 'Work in Progress',
        isSystemDefined: false
      }, {
        jiraStatus: 'QA Passed',
        snowStatus: 'Resolved',
        isSystemDefined: false
      }, {
        jiraStatus: 'Done',
        snowStatus: 'Closed',
        isSystemDefined: false
      }, {
        jiraStatus: 'Won\\'t Do',
        snowStatus: 'Cancelled',
        isSystemDefined: false
      }],
      onSetStatusMappings: fn()
    },
    docs: {
      description: {
        story: 'Ten mappings covering a complete Jira workflow mapped to ServiceNow statuses. Tests layout stability and scroll behaviour when many rows are present.'
      }
    }
  }
}`,...(te=(ee=S.parameters)==null?void 0:ee.docs)==null?void 0:te.source},description:{story:`A richer, real-world scenario with many mappings to verify layout and\r
scrollability when the list grows long.`,...(ae=(se=S.parameters)==null?void 0:se.docs)==null?void 0:ae.description}}};const Ae=["SettingsStoreContext","Default","EmptyUserMappings","DuplicateJiraStatusValidation","EmptyInputValidation","AllUserMappingsRemoved","LargeMapping"];export{c as AllUserMappingsRemoved,d as Default,u as DuplicateJiraStatusValidation,m as EmptyInputValidation,l as EmptyUserMappings,S as LargeMapping,g as SettingsStoreContext,Ae as __namedExportsOrder,Re as default};
