import{r as o}from"./index-Bc2G9s8g.js";import{T}from"./ToastContext-Bi6AsIBh.js";const X="_toastContainer_2ceac_5",Z="_toast_2ceac_5",ee="_slideIn_2ceac_1",te="_success_2ceac_49",re="_error_2ceac_59",ae="_warning_2ceac_69",se="_info_2ceac_79",b={toastContainer:X,toast:Z,slideIn:ee,success:te,error:re,warning:ae,info:se},ne=4e3;function s({children:e}){const[n,t]=o.useState([]),c=o.useRef(0),f=o.useCallback((r,y="info")=>{c.current+=1;const v=`toast-${c.current}`;t(h=>[...h,{id:v,message:r,type:y}]),window.setTimeout(()=>{t(h=>h.filter(V=>V.id!==v))},ne)},[]);return React.createElement(T.Provider,{value:{showToast:f}},e,React.createElement("div",{className:b.toastContainer,"aria-live":"polite","aria-atomic":"true"},n.map(r=>React.createElement("div",{key:r.id,className:`${b.toast} ${b[r.type]}`},r.message))))}s.__docgenInfo={description:"ToastProvider renders a shared toast stack so any screen can show in-app notifications.",methods:[],displayName:"ToastProvider",props:{children:{required:!0,tsType:{name:"ReactReactNode",raw:"React.ReactNode"},description:""}}};const le={title:"Components/ToastProvider",component:s,parameters:{layout:"centered"}};function a({label:e,message:n,type:t="info",triggerOnMount:c=!1,delayMs:f=0}){const{addToast:r}=o.useContext(T);return o.useEffect(()=>{if(!c)return;const y=setTimeout(()=>r({message:n,type:t}),f);return()=>clearTimeout(y)},[c,n,t,f,r]),React.createElement("button",{onClick:()=>r({message:n,type:t}),style:{padding:"8px 16px",borderRadius:6,border:"none",cursor:"pointer",background:t==="success"?"#22c55e":t==="error"?"#ef4444":t==="warning"?"#f59e0b":"#3b82f6",color:"#fff",fontFamily:"sans-serif",fontSize:14,marginRight:8,marginTop:8}},e)}function oe(){const{addToast:e}=o.useContext(T),n=()=>{e({message:"Your profile has been updated.",type:"success"}),e({message:"Failed to sync calendar events. Please try again.",type:"error"}),e({message:"New version available — refresh to update.",type:"info"}),e({message:"Storage is 90% full. Consider freeing up space.",type:"warning"})};return React.createElement("button",{onClick:n,style:{padding:"8px 16px",borderRadius:6,border:"none",cursor:"pointer",background:"#6366f1",color:"#fff",fontFamily:"sans-serif",fontSize:14,marginTop:8}},"Fire 4 toasts at once")}function i({children:e}){return React.createElement("div",{style:{width:560,minHeight:320,background:"#f8fafc",borderRadius:12,border:"1px solid #e2e8f0",padding:32,fontFamily:"sans-serif",display:"flex",flexDirection:"column",gap:16}},React.createElement("h2",{style:{margin:0,fontSize:18,color:"#1e293b"}},"Application Content"),React.createElement("p",{style:{margin:0,fontSize:14,color:"#64748b"}},"Click a button below to trigger a toast notification."),e)}const l={render:()=>React.createElement(s,null,React.createElement(i,null,React.createElement("div",null,React.createElement(a,{label:"✓ Success",message:"Your changes have been saved successfully.",type:"success"}),React.createElement(a,{label:"✕ Error",message:"Failed to submit the form. Check your connection and try again.",type:"error"}),React.createElement(a,{label:"ℹ Info",message:"Your session will expire in 5 minutes.",type:"info"}),React.createElement(a,{label:"⚠ Warning",message:"Unsaved changes will be lost if you navigate away.",type:"warning"}))))},u={render:()=>React.createElement(s,null,React.createElement(i,null,React.createElement("p",{style:{margin:0,fontSize:14,color:"#94a3b8",fontStyle:"italic"}},"No toasts are queued. The toast stack is empty.")))},d={render:()=>React.createElement(s,null,React.createElement(i,null,React.createElement("p",{style:{margin:0,fontSize:14,color:"#64748b"}},"Press the button to queue four toasts at the same time."),React.createElement(oe,null)))},p={render:()=>React.createElement(s,null,React.createElement(i,null,React.createElement("p",{style:{margin:0,fontSize:14,color:"#64748b"}},"A toast will appear automatically and dismiss itself after 4 seconds."),React.createElement(a,{label:"Re-trigger auto-dismiss",message:"This notification will disappear automatically in 4 seconds.",type:"info",triggerOnMount:!0})))},m={render:()=>React.createElement(s,null,React.createElement(i,null,React.createElement("p",{style:{margin:0,fontSize:14,color:"#64748b"}},"Trigger a toast with a very long body to verify it renders correctly."),React.createElement(a,{label:"Show long message",message:"We were unable to complete your request because the server encountered an unexpected condition that prevented it from fulfilling the request. Our engineering team has been notified and is actively working on a resolution. In the meantime, please try again in a few minutes or contact support at help@example.com if the problem persists.",type:"error",triggerOnMount:!0})))},g={render:()=>React.createElement(s,null,React.createElement(i,null,React.createElement("p",{style:{margin:0,fontSize:14,color:"#64748b"}},"Three toasts arrive 0 s, 1.5 s, and 3 s after mount — simulating asynchronous server events."),React.createElement(a,{label:"Re-trigger first",message:"Import started — processing 1 of 3 files.",type:"info",triggerOnMount:!0,delayMs:0}),React.createElement(a,{label:"Re-trigger second",message:"File 'invoice_march.pdf' uploaded successfully.",type:"success",triggerOnMount:!0,delayMs:1500}),React.createElement(a,{label:"Re-trigger third",message:"'report_q1.xlsx' could not be parsed — invalid format.",type:"error",triggerOnMount:!0,delayMs:3e3})))};var R,S,E,w,_;l.parameters={...l.parameters,docs:{...(R=l.parameters)==null?void 0:R.docs,source:{originalSource:`{
  render: () => <ToastProvider>\r
      <AppShell>\r
        <div>\r
          <ToastTrigger label="✓ Success" message="Your changes have been saved successfully." type="success" />\r
          <ToastTrigger label="✕ Error" message="Failed to submit the form. Check your connection and try again." type="error" />\r
          <ToastTrigger label="ℹ Info" message="Your session will expire in 5 minutes." type="info" />\r
          <ToastTrigger label="⚠ Warning" message="Unsaved changes will be lost if you navigate away." type="warning" />\r
        </div>\r
      </AppShell>\r
    </ToastProvider>
}`,...(E=(S=l.parameters)==null?void 0:S.docs)==null?void 0:E.source},description:{story:"Default happy-path story — interactive buttons to trigger various toasts.",...(_=(w=l.parameters)==null?void 0:w.docs)==null?void 0:_.description}}};var x,A,M,P,k;u.parameters={...u.parameters,docs:{...(x=u.parameters)==null?void 0:x.docs,source:{originalSource:`{
  render: () => <ToastProvider>\r
      <AppShell>\r
        <p style={{
        margin: 0,
        fontSize: 14,
        color: "#94a3b8",
        fontStyle: "italic"
      }}>\r
          No toasts are queued. The toast stack is empty.\r
        </p>\r
      </AppShell>\r
    </ToastProvider>
}`,...(M=(A=u.parameters)==null?void 0:A.docs)==null?void 0:M.source},description:{story:"No toasts are active — shows only the app content with an empty toast stack.",...(k=(P=u.parameters)==null?void 0:P.docs)==null?void 0:k.description}}};var C,z,O,I,q;d.parameters={...d.parameters,docs:{...(C=d.parameters)==null?void 0:C.docs,source:{originalSource:`{
  render: () => <ToastProvider>\r
      <AppShell>\r
        <p style={{
        margin: 0,
        fontSize: 14,
        color: "#64748b"
      }}>\r
          Press the button to queue four toasts at the same time.\r
        </p>\r
        <MultiToastTrigger />\r
      </AppShell>\r
    </ToastProvider>
}`,...(O=(z=d.parameters)==null?void 0:z.docs)==null?void 0:O.source},description:{story:"Fires four different toasts simultaneously to verify queue/stacking behaviour.",...(q=(I=d.parameters)==null?void 0:I.docs)==null?void 0:q.description}}};var F,N,D,Y,W;p.parameters={...p.parameters,docs:{...(F=p.parameters)==null?void 0:F.docs,source:{originalSource:`{
  render: () => <ToastProvider>\r
      <AppShell>\r
        <p style={{
        margin: 0,
        fontSize: 14,
        color: "#64748b"
      }}>\r
          A toast will appear automatically and dismiss itself after 4 seconds.\r
        </p>\r
        <ToastTrigger label="Re-trigger auto-dismiss" message="This notification will disappear automatically in 4 seconds." type="info" triggerOnMount />\r
      </AppShell>\r
    </ToastProvider>
}`,...(D=(N=p.parameters)==null?void 0:N.docs)==null?void 0:D.source},description:{story:`A success toast fires automatically on mount so reviewers can observe\r
the 4-second auto-dismiss timer without any interaction.`,...(W=(Y=p.parameters)==null?void 0:Y.docs)==null?void 0:W.description}}};var U,$,L,Q,H;m.parameters={...m.parameters,docs:{...(U=m.parameters)==null?void 0:U.docs,source:{originalSource:`{
  render: () => <ToastProvider>\r
      <AppShell>\r
        <p style={{
        margin: 0,
        fontSize: 14,
        color: "#64748b"
      }}>\r
          Trigger a toast with a very long body to verify it renders correctly.\r
        </p>\r
        <ToastTrigger label="Show long message" message="We were unable to complete your request because the server encountered an unexpected condition that prevented it from fulfilling the request. Our engineering team has been notified and is actively working on a resolution. In the meantime, please try again in a few minutes or contact support at help@example.com if the problem persists." type="error" triggerOnMount />\r
      </AppShell>\r
    </ToastProvider>
}`,...(L=($=m.parameters)==null?void 0:$.docs)==null?void 0:L.source},description:{story:"Toast carrying an unusually long message to verify text wrapping / truncation.",...(H=(Q=m.parameters)==null?void 0:Q.docs)==null?void 0:H.description}}};var j,B,G,J,K;g.parameters={...g.parameters,docs:{...(j=g.parameters)==null?void 0:j.docs,source:{originalSource:`{
  render: () => <ToastProvider>\r
      <AppShell>\r
        <p style={{
        margin: 0,
        fontSize: 14,
        color: "#64748b"
      }}>\r
          Three toasts arrive 0 s, 1.5 s, and 3 s after mount — simulating\r
          asynchronous server events.\r
        </p>\r
        <ToastTrigger label="Re-trigger first" message="Import started — processing 1 of 3 files." type="info" triggerOnMount delayMs={0} />\r
        <ToastTrigger label="Re-trigger second" message="File 'invoice_march.pdf' uploaded successfully." type="success" triggerOnMount delayMs={1500} />\r
        <ToastTrigger label="Re-trigger third" message="'report_q1.xlsx' could not be parsed — invalid format." type="error" triggerOnMount delayMs={3000} />\r
      </AppShell>\r
    </ToastProvider>
}`,...(G=(B=g.parameters)==null?void 0:B.docs)==null?void 0:G.source},description:{story:"Staggered toasts arriving at different intervals to simulate real-world async events.",...(K=(J=g.parameters)==null?void 0:J.docs)==null?void 0:K.description}}};const ue=["Default","EmptyToastStack","MultipleToastsQueued","AutoDismissAfterFourSeconds","LongMessageText","StaggeredArrivals"];export{p as AutoDismissAfterFourSeconds,l as Default,u as EmptyToastStack,m as LongMessageText,d as MultipleToastsQueued,g as StaggeredArrivals,ue as __namedExportsOrder,le as default};
