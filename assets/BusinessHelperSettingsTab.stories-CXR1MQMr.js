import{within as x,userEvent as g}from"./index-DeN4tkzB.js";import{r as m}from"./index-Bc2G9s8g.js";function xe(e,t){const[c,n]=m.useState(()=>{try{const d=window.localStorage.getItem(e);return d!==null?JSON.parse(d):t}catch{return t}}),u=m.useCallback(d=>{try{window.localStorage.setItem(e,JSON.stringify(d))}catch{}n(d)},[e]);return[c,u]}const Me="tbxBusinessHelperSettings",E="none",De="jira-key-summary",q=50,Ie=20,He=8,$=180,j=96,ke=520,G=[{key:"grouping",label:"Grouping"},{key:"name",label:"Name"},{key:"justification",label:"Justification"}],z=[{value:"none",label:"Do not populate this column"},{value:"jira-key",label:"Jira Key"},{value:"summary",label:"Summary"},{value:"jira-key-summary",label:"Jira Key + Summary"},{value:"issue-type",label:"Issue Type"},{value:"status",label:"Status"},{value:"assignee",label:"Assignee"},{value:"updated-date",label:"Updated Date"}],F={grouping:"Grouping",name:"Name",justification:"Justification"},h={grouping:160,name:280,fulfillmentCost:132,enrollmentCost:132,billing:132,testing:148,total:148,justification:220,timing:148,cost:132,actions:120};function D(e){return e==="text"||e==="dropdown"}function Le(){const[e,t]=xe(Me,Ue()),c=m.useMemo(()=>Pe(e),[e]),n=m.useRef(c);m.useEffect(()=>{n.current=c},[c]);const u=m.useCallback((r,p)=>{const l={...n.current,stablizationColumns:{...n.current.stablizationColumns,[r]:{...n.current.stablizationColumns[r],inputKind:p}}};n.current=l,t(l)},[t]),d=m.useCallback((r,p)=>{const l=p.trim();if(!l)return;const i=n.current.stablizationColumns[r].dropdownOptions;if(i.includes(l)||i.length>=q)return;const w={...n.current,stablizationColumns:{...n.current.stablizationColumns,[r]:{...n.current.stablizationColumns[r],dropdownOptions:[...i,l]}}};n.current=w,t(w)},[t]),y=m.useCallback((r,p)=>{const l={...n.current,stablizationColumns:{...n.current.stablizationColumns,[r]:{...n.current.stablizationColumns[r],dropdownOptions:n.current.stablizationColumns[r].dropdownOptions.filter(i=>i!==p)}}};n.current=l,t(l)},[t]),f=m.useCallback((r,p)=>{const l={...n.current,simpleSearchMapping:{...n.current.simpleSearchMapping,[r]:p}};n.current=l,t(l)},[t]),I=m.useCallback((r,p)=>{const l={...n.current,stablizationColumnWidths:{...n.current.stablizationColumnWidths,[r]:b(p)}};n.current=l,t(l)},[t]),M=m.useCallback((r,p)=>{const l=r.trim();if(!l||n.current.stablizationUserColumns.length>=Ie)return;const i={...n.current,stablizationUserColumns:[...n.current.stablizationUserColumns,Je(l,p)]};n.current=i,t(i)},[t]),H=m.useCallback(r=>{const p={...n.current,stablizationUserColumns:n.current.stablizationUserColumns.filter(l=>l.id!==r)};n.current=p,t(p)},[t]),k=m.useCallback((r,p)=>{const l=p.trim();if(!l)return;const i={...n.current,stablizationUserColumns:n.current.stablizationUserColumns.map(w=>w.id===r?{...w,label:l}:w)};n.current=i,t(i)},[t]),L=m.useCallback((r,p)=>{const l={...n.current,stablizationUserColumns:n.current.stablizationUserColumns.map(i=>i.id!==r?i:{...i,dataType:p,simpleSearchMapping:D(p)?i.simpleSearchMapping:E})};n.current=l,t(l)},[t]),U=m.useCallback((r,p)=>{const l={...n.current,stablizationUserColumns:n.current.stablizationUserColumns.map(i=>i.id!==r?i:{...i,simpleSearchMapping:D(i.dataType)?p:E})};n.current=l,t(l)},[t]),a=m.useCallback((r,p)=>{const l=p.trim();if(!l)return;const i={...n.current,stablizationUserColumns:n.current.stablizationUserColumns.map(w=>w.id!==r||w.dataType!=="dropdown"||w.dropdownOptions.includes(l)||w.dropdownOptions.length>=q?w:{...w,dropdownOptions:[...w.dropdownOptions,l]})};n.current=i,t(i)},[t]),s=m.useCallback((r,p)=>{const l={...n.current,stablizationUserColumns:n.current.stablizationUserColumns.map(i=>i.id===r?{...i,dropdownOptions:i.dropdownOptions.filter(w=>w!==p)}:i)};n.current=l,t(l)},[t]),S=m.useCallback((r,p)=>{const l={...n.current,stablizationUserColumns:n.current.stablizationUserColumns.map(i=>i.id===r?{...i,widthPx:b(p,$)}:i)};n.current=l,t(l)},[t]);return{settings:c,updateColumnInputKind:u,addDropdownOption:d,removeDropdownOption:y,updateSimpleSearchMapping:f,updateStablizationColumnWidth:I,addUserColumn:M,removeUserColumn:H,updateUserColumnLabel:k,updateUserColumnDataType:L,updateUserColumnSimpleSearchMapping:U,addUserColumnDropdownOption:a,removeUserColumnDropdownOption:s,updateUserColumnWidth:S}}function Ue(){return{stablizationColumns:{grouping:{inputKind:"text",dropdownOptions:[]},name:{inputKind:"text",dropdownOptions:[]},justification:{inputKind:"text",dropdownOptions:[]}},stablizationColumnWidths:h,simpleSearchMapping:{grouping:E,name:De,justification:E},stablizationUserColumns:[]}}function Pe(e){var t,c,n,u,d,y;return{stablizationColumns:{grouping:P((t=e.stablizationColumns)==null?void 0:t.grouping),name:P((c=e.stablizationColumns)==null?void 0:c.name),justification:P((n=e.stablizationColumns)==null?void 0:n.justification)},stablizationColumnWidths:Fe(e.stablizationColumnWidths),simpleSearchMapping:{grouping:A((u=e.simpleSearchMapping)==null?void 0:u.grouping),name:A((d=e.simpleSearchMapping)==null?void 0:d.name,De),justification:A((y=e.simpleSearchMapping)==null?void 0:y.justification)},stablizationUserColumns:qe(e.stablizationUserColumns)}}function P(e){return{inputKind:$e(e==null?void 0:e.inputKind)?e.inputKind:"text",dropdownOptions:Ae(e==null?void 0:e.dropdownOptions)}}function qe(e){return Array.isArray(e)?e.map(ze).filter(t=>!!t).slice(0,Ie):[]}function ze(e){var d,y;if(!e||typeof e!="object")return null;const t=e,c=(d=t.label)==null?void 0:d.trim(),n=(y=t.id)==null?void 0:y.trim();if(!c||!n)return null;const u=Ge(t.dataType)?t.dataType:"text";return{id:n,label:c,dataType:u,dropdownOptions:Ae(t.dropdownOptions),widthPx:b(t.widthPx,$),simpleSearchMapping:D(u)?A(t.simpleSearchMapping):E}}function Ae(e){return Array.isArray(e)?e.filter(t=>typeof t=="string").map(t=>t.trim()).filter(Boolean).slice(0,q):[]}function A(e,t=E){return je(e)?e:t}function $e(e){return e==="text"||e==="dropdown"}function je(e){return z.some(t=>t.value===e)}function Ge(e){return e==="text"||e==="dropdown"||e==="currency"||e==="date"}function Fe(e){return{grouping:b(e==null?void 0:e.grouping,h.grouping),name:b(e==null?void 0:e.name,h.name),fulfillmentCost:b(e==null?void 0:e.fulfillmentCost,h.fulfillmentCost),enrollmentCost:b(e==null?void 0:e.enrollmentCost,h.enrollmentCost),billing:b(e==null?void 0:e.billing,h.billing),testing:b(e==null?void 0:e.testing,h.testing),total:b(e==null?void 0:e.total,h.total),justification:b(e==null?void 0:e.justification,h.justification),timing:b(e==null?void 0:e.timing,h.timing),cost:b(e==null?void 0:e.cost,h.cost),actions:b(e==null?void 0:e.actions,h.actions)}}function b(e,t=j){return typeof e!="number"||!Number.isFinite(e)?t:Math.min(ke,Math.max(j,Math.round(e)))}function Je(e,t){return{id:Xe(),label:e,dataType:t,dropdownOptions:[],widthPx:$,simpleSearchMapping:(D(t),E)}}function Xe(){var e;return typeof((e=globalThis.crypto)==null?void 0:e.randomUUID)=="function"?globalThis.crypto.randomUUID():`stablization-user-column-${Date.now()}-${Math.random().toString(36).slice(2,2+He)}`}const Ze="_settingsTab_1774u_5",Ve="_sectionHeader_1774u_17",Ye="_sectionTitle_1774u_29",Qe="_sectionSubtitle_1774u_41",Ke="_settingsSection_1774u_53",We="_sectionHeading_1774u_73",et="_sectionDescription_1774u_85",tt="_settingsTableWrapper_1774u_99",nt="_settingsTable_1774u_99",ot="_customColumnCreator_1774u_125",at="_tableHeaderCell_1774u_139",st="_tableCell_1774u_141",rt="_controlSelect_1774u_177",lt="_controlInput_1774u_179",it="_optionEditor_1774u_213",ct="_optionInputRow_1774u_225",pt="_optionAddButton_1774u_237",ut="_optionRemoveButton_1774u_239",mt="_optionList_1774u_277",dt="_optionChip_1774u_295",yt="_emptyHint_1774u_315",o={settingsTab:Ze,sectionHeader:Ve,sectionTitle:Ye,sectionSubtitle:Qe,settingsSection:Ke,sectionHeading:We,sectionDescription:et,settingsTableWrapper:tt,settingsTable:nt,customColumnCreator:ot,tableHeaderCell:at,tableCell:st,controlSelect:rt,controlInput:lt,optionEditor:it,optionInputRow:ct,optionAddButton:pt,optionRemoveButton:ut,optionList:mt,optionChip:dt,emptyHint:yt},J="Settings",wt="Configure how Business Helper tables behave and how Simple Search sends Jira data into Stablization.",bt="Custom Stablization columns",ht="Add your own Stablization columns and choose whether they behave as text, dropdown, currency, or date fields.",St="Built-in Stablization column settings",gt="Choose whether each built-in editable text column stays freeform or becomes a dropdown with a curated option list.",Rt="Simple Search to built-in Stablization mapping",Et="Choose which Jira result field should populate each built-in Stablization text column when the user sends a result into the table.",ft=[{value:"text",label:"Freeform text"},{value:"dropdown",label:"Dropdown list"}],X=[{value:"text",label:"Text"},{value:"dropdown",label:"Dropdown"},{value:"currency",label:"Currency"},{value:"date",label:"Date"}],Z="No dropdown options configured yet.",Nt="This column stays freeform unless you switch it to a dropdown.",_t="Column label",Tt="Add custom column",vt="Manual only for this data type.";function Ct(){return{grouping:"",name:"",justification:""}}function R(){const e=Le(),[t,c]=m.useState(Ct),[n,u]=m.useState({}),[d,y]=m.useState(""),[f,I]=m.useState("text");function M(a,s){c(S=>({...S,[a]:s}))}function H(a,s){u(S=>({...S,[a]:s}))}function k(a){e.addDropdownOption(a,t[a]),c(s=>({...s,[a]:""}))}function L(){e.addUserColumn(d,f),y(""),I("text")}function U(a){e.addUserColumnDropdownOption(a,n[a]??""),u(s=>({...s,[a]:""}))}return React.createElement("section",{className:o.settingsTab,"aria-label":J},React.createElement("header",{className:o.sectionHeader},React.createElement("h2",{className:o.sectionTitle},J),React.createElement("p",{className:o.sectionSubtitle},wt)),React.createElement("section",{className:o.settingsSection},React.createElement("h3",{className:o.sectionHeading},bt),React.createElement("p",{className:o.sectionDescription},ht),React.createElement("div",{className:o.customColumnCreator},React.createElement("input",{"aria-label":"New custom column label",className:o.controlInput,onChange:a=>y(a.target.value),placeholder:_t,type:"text",value:d}),React.createElement("select",{"aria-label":"New custom column data type",className:o.controlSelect,onChange:a=>I(a.target.value),value:f},X.map(a=>React.createElement("option",{key:a.value,value:a.value},a.label))),React.createElement("button",{className:o.optionAddButton,onClick:L,type:"button"},Tt)),React.createElement("div",{className:o.settingsTableWrapper},React.createElement("table",{className:o.settingsTable},React.createElement("thead",null,React.createElement("tr",null,React.createElement("th",{className:o.tableHeaderCell,scope:"col"},"Column label"),React.createElement("th",{className:o.tableHeaderCell,scope:"col"},"Data type"),React.createElement("th",{className:o.tableHeaderCell,scope:"col"},"Simple Search mapping"),React.createElement("th",{className:o.tableHeaderCell,scope:"col"},"Dropdown list"),React.createElement("th",{className:o.tableHeaderCell,scope:"col"},"Actions"))),React.createElement("tbody",null,e.settings.stablizationUserColumns.length>0?e.settings.stablizationUserColumns.map(a=>React.createElement("tr",{key:a.id},React.createElement("td",{className:o.tableCell},React.createElement("input",{"aria-label":`${a.label} label`,className:o.controlInput,onChange:s=>e.updateUserColumnLabel(a.id,s.target.value),type:"text",value:a.label})),React.createElement("td",{className:o.tableCell},React.createElement("select",{"aria-label":`${a.label} data type`,className:o.controlSelect,onChange:s=>e.updateUserColumnDataType(a.id,s.target.value),value:a.dataType},X.map(s=>React.createElement("option",{key:s.value,value:s.value},s.label)))),React.createElement("td",{className:o.tableCell},D(a.dataType)?React.createElement("select",{"aria-label":`${a.label} mapping source`,className:o.controlSelect,onChange:s=>e.updateUserColumnSimpleSearchMapping(a.id,s.target.value),value:a.simpleSearchMapping},z.map(s=>React.createElement("option",{key:s.value,value:s.value},s.label))):React.createElement("p",{className:o.emptyHint},vt)),React.createElement("td",{className:o.tableCell},a.dataType==="dropdown"?React.createElement("div",{className:o.optionEditor},React.createElement("div",{className:o.optionInputRow},React.createElement("input",{"aria-label":`New option for ${a.label}`,className:o.controlInput,onChange:s=>H(a.id,s.target.value),placeholder:`Add a ${a.label} option`,type:"text",value:n[a.id]??""}),React.createElement("button",{"aria-label":`Add option to ${a.label}`,className:o.optionAddButton,onClick:()=>U(a.id),type:"button"},"Add option")),a.dropdownOptions.length>0?React.createElement("ul",{className:o.optionList},a.dropdownOptions.map(s=>React.createElement("li",{key:s,className:o.optionChip},React.createElement("span",null,s),React.createElement("button",{"aria-label":`Remove ${s} from ${a.label}`,className:o.optionRemoveButton,onClick:()=>e.removeUserColumnDropdownOption(a.id,s),type:"button"},"Remove")))):React.createElement("p",{className:o.emptyHint},Z)):React.createElement("p",{className:o.emptyHint},"Not used for this data type.")),React.createElement("td",{className:o.tableCell},React.createElement("button",{"aria-label":`Remove ${a.label}`,className:o.optionRemoveButton,onClick:()=>e.removeUserColumn(a.id),type:"button"},"Remove")))):React.createElement("tr",null,React.createElement("td",{className:o.tableCell,colSpan:5},React.createElement("p",{className:o.emptyHint},"No custom columns yet."))))))),React.createElement("section",{className:o.settingsSection},React.createElement("h3",{className:o.sectionHeading},St),React.createElement("p",{className:o.sectionDescription},gt),React.createElement("div",{className:o.settingsTableWrapper},React.createElement("table",{className:o.settingsTable},React.createElement("thead",null,React.createElement("tr",null,React.createElement("th",{className:o.tableHeaderCell,scope:"col"},"Column"),React.createElement("th",{className:o.tableHeaderCell,scope:"col"},"Input style"),React.createElement("th",{className:o.tableHeaderCell,scope:"col"},"Dropdown list"))),React.createElement("tbody",null,G.map(({key:a,label:s})=>{const S=e.settings.stablizationColumns[a];return React.createElement("tr",{key:a},React.createElement("td",{className:o.tableCell},s),React.createElement("td",{className:o.tableCell},React.createElement("select",{"aria-label":`${s} input type`,className:o.controlSelect,onChange:r=>e.updateColumnInputKind(a,r.target.value),value:S.inputKind},ft.map(r=>React.createElement("option",{key:r.value,value:r.value},r.label)))),React.createElement("td",{className:o.tableCell},S.inputKind==="dropdown"?React.createElement("div",{className:o.optionEditor},React.createElement("div",{className:o.optionInputRow},React.createElement("input",{"aria-label":`New option for ${s}`,className:o.controlInput,onChange:r=>M(a,r.target.value),placeholder:`Add a ${s} option`,type:"text",value:t[a]}),React.createElement("button",{"aria-label":`Add option to ${s}`,className:o.optionAddButton,onClick:()=>k(a),type:"button"},"Add option")),S.dropdownOptions.length>0?React.createElement("ul",{className:o.optionList},S.dropdownOptions.map(r=>React.createElement("li",{key:r,className:o.optionChip},React.createElement("span",null,r),React.createElement("button",{"aria-label":`Remove ${r} from ${s}`,className:o.optionRemoveButton,onClick:()=>e.removeDropdownOption(a,r),type:"button"},"Remove")))):React.createElement("p",{className:o.emptyHint},Z)):React.createElement("p",{className:o.emptyHint},Nt)))}))))),React.createElement("section",{className:o.settingsSection},React.createElement("h3",{className:o.sectionHeading},Rt),React.createElement("p",{className:o.sectionDescription},Et),React.createElement("div",{className:o.settingsTableWrapper},React.createElement("table",{className:o.settingsTable},React.createElement("thead",null,React.createElement("tr",null,React.createElement("th",{className:o.tableHeaderCell,scope:"col"},"Destination column"),React.createElement("th",{className:o.tableHeaderCell,scope:"col"},"Simple Search source"))),React.createElement("tbody",null,G.map(({key:a})=>React.createElement("tr",{key:a},React.createElement("td",{className:o.tableCell},F[a]),React.createElement("td",{className:o.tableCell},React.createElement("select",{"aria-label":`${F[a]} mapping source`,className:o.controlSelect,onChange:s=>e.updateSimpleSearchMapping(a,s.target.value),value:e.settings.simpleSearchMapping[a]},z.map(s=>React.createElement("option",{key:s.value,value:s.value},s.label)))))))))))}R.__docgenInfo={description:"Renders Business Helper settings so the Stablization table can be configured without editing code.",methods:[],displayName:"BusinessHelperSettingsTab"};const Dt={title:"Components/BusinessHelperSettingsTab",component:R,parameters:{layout:"padded",docs:{description:{component:"Settings tab for configuring Business Helper custom columns, including column names, data types, and dropdown options."}}}},N={render:()=>React.createElement(R,null)},_={render:()=>React.createElement(R,null),parameters:{docs:{description:{story:"Shows the initial state before any custom columns have been configured. The user sees an empty column list or a prompt to add their first column."}}}},T={render:()=>React.createElement(R,null),parameters:{docs:{description:{story:"When a column has a non-dropdown data type (e.g., Text, Number, Date), the dropdown list editor is hidden. Only the column name and type selector are shown."}}},play:async({canvasElement:e})=>{const t=x(e);await new Promise(n=>setTimeout(n,300));const c=t.queryAllByRole("combobox");if(c.length>0){const n=c[0];await g.click(n);const u=t.queryByRole("option",{name:/text/i})||t.queryByRole("option",{name:/number/i})||t.queryByRole("option",{name:/date/i});u&&await g.click(u)}}},v={render:()=>React.createElement(R,null),parameters:{docs:{description:{story:"When a column has the Dropdown data type selected, the full dropdown list editor appears, allowing the user to add, edit, and remove dropdown options."}}},play:async({canvasElement:e})=>{const t=x(e);await new Promise(n=>setTimeout(n,300));const c=t.queryAllByRole("combobox");if(c.length>0){const n=c[0];await g.click(n);const u=t.queryByRole("option",{name:/dropdown/i})||t.queryByRole("option",{name:/select/i})||t.queryByRole("option",{name:/list/i});u&&await g.click(u)}}},C={render:()=>React.createElement(R,null),parameters:{docs:{description:{story:"Shows the dropdown list editor in its empty state — when a column has been set to Dropdown type but no options have been added yet. The user sees an empty list with an 'Add option' prompt."}}},play:async({canvasElement:e})=>{const t=x(e);await new Promise(n=>setTimeout(n,300));const c=t.queryAllByRole("combobox");if(c.length>0){const n=c[0];await g.click(n);const u=t.queryByRole("option",{name:/dropdown/i})||t.queryByRole("option",{name:/select/i})||t.queryByRole("option",{name:/list/i});u&&await g.click(u)}}},O={render:()=>React.createElement(R,null),parameters:{docs:{description:{story:"Demonstrates the dynamic behavior when a user switches a column's data type between Dropdown and a non-dropdown type (e.g., Text). The dropdown list editor should appear when Dropdown is selected and disappear when another type is chosen."}}},play:async({canvasElement:e})=>{const t=x(e);await new Promise(y=>setTimeout(y,300));const c=t.queryAllByRole("combobox");if(c.length===0)return;const n=c[0];await g.click(n);const u=t.queryByRole("option",{name:/dropdown/i})||t.queryByRole("option",{name:/select/i})||t.queryByRole("option",{name:/list/i});u&&(await g.click(u),await new Promise(y=>setTimeout(y,600)));const d=t.queryAllByRole("combobox");if(d.length>0){await g.click(d[0]);const y=t.queryByRole("option",{name:/text/i})||t.queryByRole("option",{name:/number/i})||t.queryByRole("option",{name:/date/i});y&&(await g.click(y),await new Promise(f=>setTimeout(f,600)))}}},B={render:()=>React.createElement(R,null),parameters:{docs:{description:{story:"A realistic scenario where the user has configured multiple custom columns. Some columns use simple data types (Text, Number) while at least one uses the Dropdown type with options populated."}}}};var V,Y,Q,K,W;N.parameters={...N.parameters,docs:{...(V=N.parameters)==null?void 0:V.docs,source:{originalSource:`{
  render: () => <BusinessHelperSettingsTab />
}`,...(Q=(Y=N.parameters)==null?void 0:Y.docs)==null?void 0:Q.source},description:{story:`Default story: Shows the settings tab in its initial state.\r
Represents a realistic happy path where the user can interact\r
with column configurations.`,...(W=(K=N.parameters)==null?void 0:K.docs)==null?void 0:W.description}}};var ee,te,ne,oe,ae;_.parameters={..._.parameters,docs:{...(ee=_.parameters)==null?void 0:ee.docs,source:{originalSource:`{
  render: () => <BusinessHelperSettingsTab />,
  parameters: {
    docs: {
      description: {
        story: "Shows the initial state before any custom columns have been configured. The user sees an empty column list or a prompt to add their first column."
      }
    }
  }
}`,...(ne=(te=_.parameters)==null?void 0:te.docs)==null?void 0:ne.source},description:{story:`No custom columns configured yet.\r
This edge case shows the empty state when no columns have been\r
added by the user.`,...(ae=(oe=_.parameters)==null?void 0:oe.docs)==null?void 0:ae.description}}};var se,re,le,ie,ce;T.parameters={...T.parameters,docs:{...(se=T.parameters)==null?void 0:se.docs,source:{originalSource:`{
  render: () => <BusinessHelperSettingsTab />,
  parameters: {
    docs: {
      description: {
        story: "When a column has a non-dropdown data type (e.g., Text, Number, Date), the dropdown list editor is hidden. Only the column name and type selector are shown."
      }
    }
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);

    // Wait for the component to render
    await new Promise(resolve => setTimeout(resolve, 300));

    // Try to find a column type selector and set it to a non-dropdown type
    const typeSelectors = canvas.queryAllByRole("combobox");
    if (typeSelectors.length > 0) {
      // Select a non-dropdown type like "Text" or "Number"
      const firstSelector = typeSelectors[0];
      await userEvent.click(firstSelector);

      // Look for a non-dropdown option
      const textOption = canvas.queryByRole("option", {
        name: /text/i
      }) || canvas.queryByRole("option", {
        name: /number/i
      }) || canvas.queryByRole("option", {
        name: /date/i
      });
      if (textOption) {
        await userEvent.click(textOption);
      }
    }
  }
}`,...(le=(re=T.parameters)==null?void 0:re.docs)==null?void 0:le.source},description:{story:`User column with non-dropdown data type.\r
When a column is configured as a text, number, or date type,\r
the dropdown list editor should NOT be shown.`,...(ce=(ie=T.parameters)==null?void 0:ie.docs)==null?void 0:ce.description}}};var pe,ue,me,de,ye;v.parameters={...v.parameters,docs:{...(pe=v.parameters)==null?void 0:pe.docs,source:{originalSource:`{
  render: () => <BusinessHelperSettingsTab />,
  parameters: {
    docs: {
      description: {
        story: "When a column has the Dropdown data type selected, the full dropdown list editor appears, allowing the user to add, edit, and remove dropdown options."
      }
    }
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);

    // Wait for the component to render
    await new Promise(resolve => setTimeout(resolve, 300));

    // Try to find a column type selector and set it to dropdown
    const typeSelectors = canvas.queryAllByRole("combobox");
    if (typeSelectors.length > 0) {
      const firstSelector = typeSelectors[0];
      await userEvent.click(firstSelector);

      // Look for a dropdown option
      const dropdownOption = canvas.queryByRole("option", {
        name: /dropdown/i
      }) || canvas.queryByRole("option", {
        name: /select/i
      }) || canvas.queryByRole("option", {
        name: /list/i
      });
      if (dropdownOption) {
        await userEvent.click(dropdownOption);
      }
    }
  }
}`,...(me=(ue=v.parameters)==null?void 0:ue.docs)==null?void 0:me.source},description:{story:`User column with dropdown data type.\r
When a column is configured as a dropdown type, the full\r
dropdown list editor should be displayed.`,...(ye=(de=v.parameters)==null?void 0:de.docs)==null?void 0:ye.description}}};var we,be,he,Se,ge;C.parameters={...C.parameters,docs:{...(we=C.parameters)==null?void 0:we.docs,source:{originalSource:`{
  render: () => <BusinessHelperSettingsTab />,
  parameters: {
    docs: {
      description: {
        story: "Shows the dropdown list editor in its empty state — when a column has been set to Dropdown type but no options have been added yet. The user sees an empty list with an 'Add option' prompt."
      }
    }
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);

    // Wait for the component to render
    await new Promise(resolve => setTimeout(resolve, 300));

    // Select dropdown type to show the editor
    const typeSelectors = canvas.queryAllByRole("combobox");
    if (typeSelectors.length > 0) {
      const firstSelector = typeSelectors[0];
      await userEvent.click(firstSelector);
      const dropdownOption = canvas.queryByRole("option", {
        name: /dropdown/i
      }) || canvas.queryByRole("option", {
        name: /select/i
      }) || canvas.queryByRole("option", {
        name: /list/i
      });
      if (dropdownOption) {
        await userEvent.click(dropdownOption);
      }
    }

    // At this point the dropdown editor should show an empty state
  }
}`,...(he=(be=C.parameters)==null?void 0:be.docs)==null?void 0:he.source},description:{story:`Empty dropdown options for a column.\r
Shows the dropdown list editor when a dropdown column type is\r
selected but no options have been added yet.`,...(ge=(Se=C.parameters)==null?void 0:Se.docs)==null?void 0:ge.description}}};var Re,Ee,fe,Ne,_e;O.parameters={...O.parameters,docs:{...(Re=O.parameters)==null?void 0:Re.docs,source:{originalSource:`{
  render: () => <BusinessHelperSettingsTab />,
  parameters: {
    docs: {
      description: {
        story: "Demonstrates the dynamic behavior when a user switches a column's data type between Dropdown and a non-dropdown type (e.g., Text). The dropdown list editor should appear when Dropdown is selected and disappear when another type is chosen."
      }
    }
  },
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);

    // Wait for the component to render
    await new Promise(resolve => setTimeout(resolve, 300));
    const typeSelectors = canvas.queryAllByRole("combobox");
    if (typeSelectors.length === 0) return;
    const firstSelector = typeSelectors[0];

    // Step 1: Select dropdown type
    await userEvent.click(firstSelector);
    const dropdownOption = canvas.queryByRole("option", {
      name: /dropdown/i
    }) || canvas.queryByRole("option", {
      name: /select/i
    }) || canvas.queryByRole("option", {
      name: /list/i
    });
    if (dropdownOption) {
      await userEvent.click(dropdownOption);
      // Pause so the user can observe the dropdown editor appearing
      await new Promise(resolve => setTimeout(resolve, 600));
    }

    // Step 2: Switch back to a non-dropdown type
    const updatedTypeSelectors = canvas.queryAllByRole("combobox");
    if (updatedTypeSelectors.length > 0) {
      await userEvent.click(updatedTypeSelectors[0]);
      const textOption = canvas.queryByRole("option", {
        name: /text/i
      }) || canvas.queryByRole("option", {
        name: /number/i
      }) || canvas.queryByRole("option", {
        name: /date/i
      });
      if (textOption) {
        await userEvent.click(textOption);
        // Pause so the user can observe the dropdown editor disappearing
        await new Promise(resolve => setTimeout(resolve, 600));
      }
    }
  }
}`,...(fe=(Ee=O.parameters)==null?void 0:Ee.docs)==null?void 0:fe.source},description:{story:`Switching between dropdown and non-dropdown data types.\r
Demonstrates that the dropdown list editor appears and disappears\r
as the user switches the column data type.`,...(_e=(Ne=O.parameters)==null?void 0:Ne.docs)==null?void 0:_e.description}}};var Te,ve,Ce,Oe,Be;B.parameters={...B.parameters,docs:{...(Te=B.parameters)==null?void 0:Te.docs,source:{originalSource:`{
  render: () => <BusinessHelperSettingsTab />,
  parameters: {
    docs: {
      description: {
        story: "A realistic scenario where the user has configured multiple custom columns. Some columns use simple data types (Text, Number) while at least one uses the Dropdown type with options populated."
      }
    }
  }
}`,...(Ce=(ve=B.parameters)==null?void 0:ve.docs)==null?void 0:Ce.source},description:{story:`Multiple columns configured with mixed types.\r
Shows a realistic scenario where several columns are configured\r
with different data types including at least one dropdown column.`,...(Be=(Oe=B.parameters)==null?void 0:Oe.docs)==null?void 0:Be.description}}};const It=["Default","NoCustomColumnsConfigured","NonDropdownColumnType","DropdownColumnType","EmptyDropdownOptions","SwitchingColumnDataType","MultipleColumnsWithMixedTypes"];export{N as Default,v as DropdownColumnType,C as EmptyDropdownOptions,B as MultipleColumnsWithMixedTypes,_ as NoCustomColumnsConfigured,T as NonDropdownColumnType,O as SwitchingColumnDataType,It as __namedExportsOrder,Dt as default};
