import{within as L,expect as _e,userEvent as d,fn as Ge}from"./index-DeN4tkzB.js";import{r as k,R as s}from"./index-Bc2G9s8g.js";import{C as Ve}from"./index-BR7estDG.js";import{u as Ye}from"./ToastContext-Bi6AsIBh.js";import{s as i}from"./AdminHubView.module-BPj767VV.js";const $e="tbx",Xe="ntbx-",ze="toolbox-hygiene-",Qe=new Set(["nodetoolbox-art-teams","toolbox-snow-root-causes"]),Ze=new Set(["ntbx-crg-state","ntbx-relay-return-route"]);function j(e){return e.startsWith($e)?!0:Ze.has(e)?!1:e.startsWith(Xe)||e.startsWith(ze)||Qe.has(e)}function Ke(){const e={};for(let t=0;t<localStorage.length;t+=1){const o=localStorage.key(t);o!==null&&j(o)&&(e[o]=localStorage.getItem(o)??"")}return e}function et(e){for(const[t,o]of Object.entries(e))j(t)&&typeof o=="string"&&localStorage.setItem(t,o)}function tt(){const e=[];for(let t=0;t<localStorage.length;t+=1){const o=localStorage.key(t);o!==null&&j(o)&&e.push(o)}for(const t of e)localStorage.removeItem(t)}const M="demo",D="1",A="ntbx-demo-mode-enabled",N="ntbx-demo-local-storage:",ot=["tbx","ntbx-","toolbox-","nodetoolbox-"],nt="X-NodeToolbox-Demo-Mode";function T(){return typeof window<"u"&&typeof window.localStorage<"u"&&typeof window.sessionStorage<"u"&&typeof Storage<"u"}function rt(){return typeof window<"u"&&typeof window.fetch=="function"}function p(){const e=window;if(e.__nodeToolboxDemoStorageOriginals)return e.__nodeToolboxDemoStorageOriginals;const t={getItem:Storage.prototype.getItem,setItem:Storage.prototype.setItem,removeItem:Storage.prototype.removeItem,clear:Storage.prototype.clear,key:Storage.prototype.key,lengthDescriptor:Object.getOwnPropertyDescriptor(Storage.prototype,"length")};return e.__nodeToolboxDemoStorageOriginals=t,t}function B(e){return`${N}${e}`}function u(e){return T()&&e===window.localStorage}function _(e){return j(e)||ot.some(t=>e.startsWith(t))}function Me(e){return p().getItem.call(window.sessionStorage,e)}function Ae(e,t){p().setItem.call(window.sessionStorage,e,t)}function Je(e){p().removeItem.call(window.sessionStorage,e)}function P(){const e=p(),t=[];for(let o=0;o<window.sessionStorage.length;o+=1){const n=e.key.call(window.sessionStorage,o);n!=null&&n.startsWith(N)&&t.push(n.slice(N.length))}return t}function Ce(){const e=p(),t=[];for(let o=0;o<window.sessionStorage.length;o+=1){const n=e.key.call(window.sessionStorage,o);n!=null&&n.startsWith(N)&&t.push(n)}for(const o of t)e.removeItem.call(window.sessionStorage,o)}function at(){if(!T())return;const e=new URL(window.location.href);e.searchParams.get(M)===D&&(Ae(A,D),e.searchParams.delete(M),window.history.replaceState(window.history.state,"",`${e.pathname}${e.search}${e.hash}`))}function st(){var o;const e=window;if(e.__nodeToolboxDemoStorageIsPatched)return;const t=p();e.__nodeToolboxDemoStorageIsPatched=!0,Storage.prototype.getItem=function(r){return u(this)&&l()&&_(r)?Me(B(r)):t.getItem.call(this,r)},Storage.prototype.setItem=function(r,a){if(u(this)&&l()&&_(r)){Ae(B(r),a);return}t.setItem.call(this,r,a)},Storage.prototype.removeItem=function(r){if(u(this)&&l()&&_(r)){Je(B(r));return}t.removeItem.call(this,r)},Storage.prototype.clear=function(){if(u(this)&&l()){Ce();return}t.clear.call(this)},Storage.prototype.key=function(r){return u(this)&&l()?P()[r]??null:t.key.call(this,r)},(o=t.lengthDescriptor)!=null&&o.get&&Object.defineProperty(Storage.prototype,"length",{configurable:!0,get(){var n,r;return u(this)&&l()?P().length:((r=(n=t.lengthDescriptor)==null?void 0:n.get)==null?void 0:r.call(this))??0}})}function it(e){const t=e instanceof Request?e.url:e.toString();return new URL(t,window.location.href).origin===window.location.origin}function ct(e,t){const o=e instanceof Request?e.headers:void 0,n=new Headers((t==null?void 0:t.headers)??o);return n.set(nt,"1"),{...t,headers:n}}function lt(){if(!rt())return;const e=window;if(e.__nodeToolboxDemoFetchIsPatched&&window.fetch===e.__nodeToolboxDemoFetchPatched)return;const t=window.fetch.bind(window);e.__nodeToolboxDemoFetchOriginal=t,e.__nodeToolboxDemoFetchIsPatched=!0;const o=function(r,a){return l()&&it(r)?t(r,ct(r,a)):t(r,a)};e.__nodeToolboxDemoFetchPatched=o,window.fetch=o}function dt(){T()&&(at(),st(),lt())}function l(){return T()?Me(A)===D:!1}function ut(e){const t=new URL(e);return t.searchParams.set(M,D),t.toString()}function pt(){T()&&(Ce(),Je(A))}dt();function mt(e,t){const o=new Blob([t],{type:"application/json"}),n=URL.createObjectURL(o),r=document.createElement("a");r.href=n,r.download=e,r.click(),URL.revokeObjectURL(n)}function Pe(){const{showToast:e}=Ye(),t=k.useRef(null),[o,n]=k.useState(!1),[r,a]=k.useState(()=>l());function x(){const c=Ke(),f=JSON.stringify(c,null,2),g=new Date().toISOString().slice(0,10);mt(`nodetoolbox-backup-${g}.json`,f)}function m(c){var J;const f=(J=c.target.files)==null?void 0:J[0];if(!f)return;const g=new FileReader;g.onload=He=>{var C;try{const We=(C=He.target)==null?void 0:C.result,F=JSON.parse(We);if(typeof F!="object"||F===null||Array.isArray(F)){e("Import failed: backup file must be a plain JSON object.","error");return}et(F),window.location.reload()}catch{e("Import failed: invalid or corrupted backup file.","error")}},g.onerror=()=>{e("Import failed: could not read the selected file.","error")},g.readAsText(f),t.current&&(t.current.value="")}function U(){n(!1),tt(),window.location.reload()}function qe(){if(r){pt(),a(!1),e("Demo mode ended. Reloading your regular settings.","success"),window.location.reload();return}const c=ut(new URL("/setup",window.location.href).toString());window.open(c,"_blank","noopener")?e("Opening a first-install demo in a new tab. Your saved settings stay untouched.","success"):e("Demo tab was blocked by the browser. Allow pop-ups or open the current URL with ?demo=1.","error")}return React.createElement("section",{className:i.sectionCard},React.createElement("h2",{className:i.sectionTitle},"💾 Backup / Restore Settings"),React.createElement("p",{className:i.adminDescription},"Export all NodeToolbox configuration to a JSON file, or import a previously saved backup. Reset All Data removes every durable local setting, including older keys that some tools still use behind the scenes."),React.createElement("div",{className:i.devUtilitiesRow},React.createElement("button",{className:i.actionButton,onClick:qe},r?"🛑 Exit Demo Mode":"🎬 Open First-Install Demo"),React.createElement("button",{className:i.actionButton,onClick:x},"⬇ Export Settings"),React.createElement("input",{ref:t,type:"file",accept:".json",className:i.fileInputHidden,onChange:m,"aria-hidden":"true"}),React.createElement("button",{className:i.actionButton,onClick:()=>{var c;return(c=t.current)==null?void 0:c.click()}},"⬆ Import Settings"),React.createElement("button",{className:`${i.actionButton} ${i.dangerButton}`,onClick:()=>n(!0)},"🗑 Reset All Data")),o&&React.createElement(Ve,{confirmLabel:"Reset All Data",isDangerous:!0,message:"Clear all saved NodeToolbox settings? This removes every durable localStorage setting and cannot be undone.",onCancel:()=>n(!1),onConfirm:U}))}Pe.__docgenInfo={description:"Backup / Restore Settings section — export, import, or reset all durable local settings.",methods:[],displayName:"TbxBackupRestoreSection"};const O=k.createContext({showToast:()=>{},toasts:[]});let ft=0;function gt({children:e}){const[t,o]=k.useState([]),n=(r,a="info")=>{const x=++ft;o(m=>[...m,{id:x,message:r,severity:a}]),setTimeout(()=>{o(m=>m.filter(U=>U.id!==x))},4e3)};return s.createElement(O.Provider,{value:{showToast:n,toasts:t}},e,s.createElement("div",{style:{position:"fixed",bottom:24,right:24,display:"flex",flexDirection:"column",gap:8,zIndex:9999,pointerEvents:"none"}},t.map(r=>{const a={success:"#2e7d32",error:"#c62828",warning:"#e65100",info:"#01579b"};return s.createElement("div",{key:r.id,style:{background:a[r.severity],color:"#fff",padding:"10px 18px",borderRadius:6,boxShadow:"0 2px 8px rgba(0,0,0,0.3)",fontSize:14,maxWidth:360,opacity:.95}},r.message)})))}const Rt={title:"Settings/TbxBackupRestoreSection",component:Pe,decorators:[e=>s.createElement(gt,null,s.createElement("div",{style:{maxWidth:720,margin:"40px auto",fontFamily:"sans-serif"}},s.createElement(e,null)))],parameters:{docs:{description:{component:"Backup & Restore section that lets users export their toolbox configuration as JSON and import it back. Covers success paths, various failure modes, and browser pop-up blocking."}}}},w={name:"Default (Idle)",play:async({canvasElement:e})=>{L(e),await _e(e).toBeTruthy()}},y={name:"Successful Import",parameters:{docs:{description:{story:"User selects a well-formed backup JSON file. On success the component calls a page reload. The `window.location.reload` call is intercepted so the story does not actually reload."}}},decorators:[e=>(s.useEffect(()=>{const t=window.location.reload.bind(window.location);return window.location.reload=Ge(),()=>{window.location.reload=t}},[]),s.createElement(e,null))],play:async({canvasElement:e})=>{L(e);const t=JSON.stringify({version:"2.4.1",exportedAt:"2024-06-15T10:30:00.000Z",settings:{theme:"dark",language:"en-US",notifications:!0},tools:[{id:"tool-001",name:"JSON Formatter",enabled:!0,shortcut:"Ctrl+Shift+J"},{id:"tool-002",name:"Base64 Encoder",enabled:!0,shortcut:"Ctrl+Shift+B"},{id:"tool-003",name:"Regex Tester",enabled:!1,shortcut:null}],favorites:["tool-001","tool-002"]}),o=new File([t],"toolbox-backup-2024-06-15.json",{type:"application/json"}),n=e.querySelector('input[type="file"]');n&&await d.upload(n,o)}},h={name:"Import Failure — Corrupted JSON",parameters:{docs:{description:{story:"The selected file contains malformed JSON (e.g. truncated or corrupted). The component should surface an error toast and reset the file input."}}},play:async({canvasElement:e})=>{const t='{"version":"2.4.1","settings":{"theme":"dark","tools":[{id:"tool-001",,}',o=new File([t],"corrupted-backup.json",{type:"application/json"}),n=e.querySelector('input[type="file"]');n&&await d.upload(n,o)}},S={name:"Import Failure — File Read Error",parameters:{docs:{description:{story:"The FileReader fires an error event before completing. The component should catch this and show an appropriate error message."}}},decorators:[e=>(s.useEffect(()=>{const t=window.FileReader;class o extends t{readAsText(r){setTimeout(()=>{Object.defineProperty(this,"error",{value:new DOMException("Disk read error","NotReadableError"),writable:!1}),this.dispatchEvent(new ProgressEvent("error"))},50)}}return window.FileReader=o,()=>{window.FileReader=t}},[]),s.createElement(e,null))],play:async({canvasElement:e})=>{const t=new File(["some content"],"backup.json",{type:"application/json"}),o=e.querySelector('input[type="file"]');o&&await d.upload(o,t)}},b={name:"Import Failure — Non-Object JSON Structure",parameters:{docs:{description:{story:"The file contains valid JSON but the root value is not an object (it is an array). The component should reject it with a descriptive error."}}},play:async({canvasElement:e})=>{const t=JSON.stringify([{id:"tool-001",name:"JSON Formatter"},{id:"tool-002",name:"Base64 Encoder"}]),o=new File([t],"wrong-structure.json",{type:"application/json"}),n=e.querySelector('input[type="file"]');n&&await d.upload(n,o)}},R={name:"Import Failure — Null JSON Value",parameters:{docs:{description:{story:"The file contains `null` as its JSON value. Like the array case, this is not a valid backup object."}}},play:async({canvasElement:e})=>{const t=new File(["null"],"null-backup.json",{type:"application/json"}),o=e.querySelector('input[type="file"]');o&&await d.upload(o,t)}},v={name:"Demo Mode — Pop-up Blocked by Browser",parameters:{docs:{description:{story:"`window.open` returns `null`, simulating a browser pop-up blocker preventing the demo window from opening. The component should detect this and show a warning to the user."}}},decorators:[e=>(s.useEffect(()=>{const t=window.open.bind(window);return window.open=()=>null,()=>{window.open=t}},[]),s.createElement(e,null))],play:async({canvasElement:e})=>{const t=L(e),o=t.queryByRole("button",{name:/demo/i})??t.queryByRole("button",{name:/preview/i})??t.queryByRole("button",{name:/try/i});o&&await d.click(o)}},E={name:"File Input Reset After Failed Import",parameters:{docs:{description:{story:'After an import error the `<input type="file">` value should be cleared so the user can re-select the same file if desired.'}}},play:async({canvasElement:e})=>{const t=new File(["{bad json:::"],"bad-backup.json",{type:"application/json"}),o=e.querySelector('input[type="file"]');o&&(await d.upload(o,t),await _e(o.value).toBe(""))}},I={name:"Export Backup (Happy Path)",parameters:{docs:{description:{story:"Clicking the export button triggers a JSON file download. `URL.createObjectURL` and anchor click are intercepted to avoid side-effects in Storybook."}}},decorators:[e=>(s.useEffect(()=>{const t=URL.createObjectURL.bind(URL),o=URL.revokeObjectURL.bind(URL);URL.createObjectURL=()=>"blob:mock-url",URL.revokeObjectURL=()=>{};const n=r=>{const a=r.target;a.tagName==="A"&&a.getAttribute("download")&&r.preventDefault()};return document.addEventListener("click",n,!0),()=>{URL.createObjectURL=t,URL.revokeObjectURL=o,document.removeEventListener("click",n,!0)}},[]),s.createElement(e,null))],play:async({canvasElement:e})=>{const t=L(e),o=t.queryByRole("button",{name:/export/i})??t.queryByRole("button",{name:/backup/i})??t.queryByRole("button",{name:/download/i});o&&await d.click(o)}};var q,H,W;O.parameters={...O.parameters,docs:{...(q=O.parameters)==null?void 0:q.docs,source:{originalSource:`createContext<ToastContextValue>({
  showToast: () => {},
  toasts: []
})`,...(W=(H=O.parameters)==null?void 0:H.docs)==null?void 0:W.source}}};var G,V,Y,$,X;w.parameters={...w.parameters,docs:{...(G=w.parameters)==null?void 0:G.docs,source:{originalSource:`{
  name: 'Default (Idle)',
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    // The section should render without crashing
    await expect(canvasElement).toBeTruthy();
  }
}`,...(Y=(V=w.parameters)==null?void 0:V.docs)==null?void 0:Y.source},description:{story:"Default happy-path — component renders in its initial idle state.",...(X=($=w.parameters)==null?void 0:$.docs)==null?void 0:X.description}}};var z,Q,Z,K,ee;y.parameters={...y.parameters,docs:{...(z=y.parameters)==null?void 0:z.docs,source:{originalSource:`{
  name: 'Successful Import',
  parameters: {
    docs: {
      description: {
        story: 'User selects a well-formed backup JSON file. On success the component calls a page reload. The \`window.location.reload\` call is intercepted so the story does not actually reload.'
      }
    }
  },
  decorators: [Story => {
    // Intercept reload so Storybook doesn't actually navigate
    React.useEffect(() => {
      const original = window.location.reload.bind(window.location);
      // @ts-ignore
      window.location.reload = fn();
      return () => {
        // @ts-ignore
        window.location.reload = original;
      };
    }, []);
    return <Story />;
  }],
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const validBackup = JSON.stringify({
      version: '2.4.1',
      exportedAt: '2024-06-15T10:30:00.000Z',
      settings: {
        theme: 'dark',
        language: 'en-US',
        notifications: true
      },
      tools: [{
        id: 'tool-001',
        name: 'JSON Formatter',
        enabled: true,
        shortcut: 'Ctrl+Shift+J'
      }, {
        id: 'tool-002',
        name: 'Base64 Encoder',
        enabled: true,
        shortcut: 'Ctrl+Shift+B'
      }, {
        id: 'tool-003',
        name: 'Regex Tester',
        enabled: false,
        shortcut: null
      }],
      favorites: ['tool-001', 'tool-002']
    });
    const file = new File([validBackup], 'toolbox-backup-2024-06-15.json', {
      type: 'application/json'
    });
    const fileInput = canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
    if (fileInput) {
      await userEvent.upload(fileInput, file);
    }
  }
}`,...(Z=(Q=y.parameters)==null?void 0:Q.docs)==null?void 0:Z.source},description:{story:"Simulates selecting a valid JSON backup file and a successful import.",...(ee=(K=y.parameters)==null?void 0:K.docs)==null?void 0:ee.description}}};var te,oe,ne,re,ae;h.parameters={...h.parameters,docs:{...(te=h.parameters)==null?void 0:te.docs,source:{originalSource:`{
  name: 'Import Failure — Corrupted JSON',
  parameters: {
    docs: {
      description: {
        story: 'The selected file contains malformed JSON (e.g. truncated or corrupted). The component should surface an error toast and reset the file input.'
      }
    }
  },
  play: async ({
    canvasElement
  }) => {
    const corruptedContent = \`{"version":"2.4.1","settings":{"theme":"dark","tools":[{id:"tool-001",,}\`;
    const file = new File([corruptedContent], 'corrupted-backup.json', {
      type: 'application/json'
    });
    const fileInput = canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
    if (fileInput) {
      await userEvent.upload(fileInput, file);
    }
  }
}`,...(ne=(oe=h.parameters)==null?void 0:oe.docs)==null?void 0:ne.source},description:{story:"Simulates importing a file whose JSON is syntactically invalid (corrupted).",...(ae=(re=h.parameters)==null?void 0:re.docs)==null?void 0:ae.description}}};var se,ie,ce,le,de;S.parameters={...S.parameters,docs:{...(se=S.parameters)==null?void 0:se.docs,source:{originalSource:`{
  name: 'Import Failure — File Read Error',
  parameters: {
    docs: {
      description: {
        story: 'The FileReader fires an error event before completing. The component should catch this and show an appropriate error message.'
      }
    }
  },
  decorators: [Story => {
    React.useEffect(() => {
      const OriginalFileReader = window.FileReader;
      class MockErrorFileReader extends OriginalFileReader {
        readAsText(_blob: Blob) {
          setTimeout(() => {
            Object.defineProperty(this, 'error', {
              value: new DOMException('Disk read error', 'NotReadableError'),
              writable: false
            });
            this.dispatchEvent(new ProgressEvent('error'));
          }, 50);
        }
      }

      // @ts-ignore
      window.FileReader = MockErrorFileReader;
      return () => {
        window.FileReader = OriginalFileReader;
      };
    }, []);
    return <Story />;
  }],
  play: async ({
    canvasElement
  }) => {
    const file = new File(['some content'], 'backup.json', {
      type: 'application/json'
    });
    const fileInput = canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
    if (fileInput) {
      await userEvent.upload(fileInput, file);
    }
  }
}`,...(ce=(ie=S.parameters)==null?void 0:ie.docs)==null?void 0:ce.source},description:{story:"Simulates a FileReader error (e.g. file becomes unreadable mid-read).",...(de=(le=S.parameters)==null?void 0:le.docs)==null?void 0:de.description}}};var ue,pe,me,fe,ge;b.parameters={...b.parameters,docs:{...(ue=b.parameters)==null?void 0:ue.docs,source:{originalSource:`{
  name: 'Import Failure — Non-Object JSON Structure',
  parameters: {
    docs: {
      description: {
        story: 'The file contains valid JSON but the root value is not an object (it is an array). The component should reject it with a descriptive error.'
      }
    }
  },
  play: async ({
    canvasElement
  }) => {
    const arrayJSON = JSON.stringify([{
      id: 'tool-001',
      name: 'JSON Formatter'
    }, {
      id: 'tool-002',
      name: 'Base64 Encoder'
    }]);
    const file = new File([arrayJSON], 'wrong-structure.json', {
      type: 'application/json'
    });
    const fileInput = canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
    if (fileInput) {
      await userEvent.upload(fileInput, file);
    }
  }
}`,...(me=(pe=b.parameters)==null?void 0:pe.docs)==null?void 0:me.source},description:{story:"Simulates importing a JSON file that parses correctly but is not an object (e.g. an array or primitive).",...(ge=(fe=b.parameters)==null?void 0:fe.docs)==null?void 0:ge.description}}};var we,ye,he,Se,be;R.parameters={...R.parameters,docs:{...(we=R.parameters)==null?void 0:we.docs,source:{originalSource:`{
  name: 'Import Failure — Null JSON Value',
  parameters: {
    docs: {
      description: {
        story: 'The file contains \`null\` as its JSON value. Like the array case, this is not a valid backup object.'
      }
    }
  },
  play: async ({
    canvasElement
  }) => {
    const file = new File(['null'], 'null-backup.json', {
      type: 'application/json'
    });
    const fileInput = canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
    if (fileInput) {
      await userEvent.upload(fileInput, file);
    }
  }
}`,...(he=(ye=R.parameters)==null?void 0:ye.docs)==null?void 0:he.source},description:{story:"Simulates importing a JSON file with a null root value.",...(be=(Se=R.parameters)==null?void 0:Se.docs)==null?void 0:be.description}}};var Re,ve,Ee,Ie,Oe;v.parameters={...v.parameters,docs:{...(Re=v.parameters)==null?void 0:Re.docs,source:{originalSource:`{
  name: 'Demo Mode — Pop-up Blocked by Browser',
  parameters: {
    docs: {
      description: {
        story: "\`window.open\` returns \`null\`, simulating a browser pop-up blocker preventing the demo window from opening. The component should detect this and show a warning to the user."
      }
    }
  },
  decorators: [Story => {
    React.useEffect(() => {
      const originalOpen = window.open.bind(window);
      // @ts-ignore
      window.open = () => null; // simulate pop-up blocker

      return () => {
        window.open = originalOpen;
      };
    }, []);
    return <Story />;
  }],
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);

    // Find and click a demo / preview button if present
    const demoButton = canvas.queryByRole('button', {
      name: /demo/i
    }) ?? canvas.queryByRole('button', {
      name: /preview/i
    }) ?? canvas.queryByRole('button', {
      name: /try/i
    });
    if (demoButton) {
      await userEvent.click(demoButton);
    }
  }
}`,...(Ee=(ve=v.parameters)==null?void 0:ve.docs)==null?void 0:Ee.source},description:{story:"Demonstrates the demo mode window being blocked by a browser pop-up blocker.",...(Oe=(Ie=v.parameters)==null?void 0:Ie.docs)==null?void 0:Oe.description}}};var ke,Te,xe,Fe,De;E.parameters={...E.parameters,docs:{...(ke=E.parameters)==null?void 0:ke.docs,source:{originalSource:`{
  name: 'File Input Reset After Failed Import',
  parameters: {
    docs: {
      description: {
        story: 'After an import error the \`<input type="file">\` value should be cleared so the user can re-select the same file if desired.'
      }
    }
  },
  play: async ({
    canvasElement
  }) => {
    const badFile = new File(['{bad json:::'], 'bad-backup.json', {
      type: 'application/json'
    });
    const fileInput = canvasElement.querySelector<HTMLInputElement>('input[type="file"]');
    if (!fileInput) return;
    await userEvent.upload(fileInput, badFile);

    // After failure the input value should be empty
    await expect(fileInput.value).toBe('');
  }
}`,...(xe=(Te=E.parameters)==null?void 0:Te.docs)==null?void 0:xe.source},description:{story:"Verifies that the file input is reset (value cleared) after a failed import attempt.",...(De=(Fe=E.parameters)==null?void 0:Fe.docs)==null?void 0:De.description}}};var Ne,Le,je,Ue,Be;I.parameters={...I.parameters,docs:{...(Ne=I.parameters)==null?void 0:Ne.docs,source:{originalSource:`{
  name: 'Export Backup (Happy Path)',
  parameters: {
    docs: {
      description: {
        story: 'Clicking the export button triggers a JSON file download. \`URL.createObjectURL\` and anchor click are intercepted to avoid side-effects in Storybook.'
      }
    }
  },
  decorators: [Story => {
    React.useEffect(() => {
      const originalCreateObjectURL = URL.createObjectURL.bind(URL);
      const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = () => 'blob:mock-url';
      URL.revokeObjectURL = () => {};

      // Prevent actual download by intercepting anchor clicks
      const handler = (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'A' && target.getAttribute('download')) {
          e.preventDefault();
        }
      };
      document.addEventListener('click', handler, true);
      return () => {
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
        document.removeEventListener('click', handler, true);
      };
    }, []);
    return <Story />;
  }],
  play: async ({
    canvasElement
  }) => {
    const canvas = within(canvasElement);
    const exportButton = canvas.queryByRole('button', {
      name: /export/i
    }) ?? canvas.queryByRole('button', {
      name: /backup/i
    }) ?? canvas.queryByRole('button', {
      name: /download/i
    });
    if (exportButton) {
      await userEvent.click(exportButton);
    }
  }
}`,...(je=(Le=I.parameters)==null?void 0:Le.docs)==null?void 0:je.source},description:{story:"Shows the export / download backup action (happy path).",...(Be=(Ue=I.parameters)==null?void 0:Ue.docs)==null?void 0:Be.description}}};const vt=["ToastContext","Default","SuccessfulImport","ImportFailureCorruptedJSON","ImportFailureFileReadError","ImportFailureNonObjectJSON","ImportFailureNullJSON","DemoModePopupBlocked","FileInputResetAfterFailedImport","ExportBackup"];export{w as Default,v as DemoModePopupBlocked,I as ExportBackup,E as FileInputResetAfterFailedImport,h as ImportFailureCorruptedJSON,S as ImportFailureFileReadError,b as ImportFailureNonObjectJSON,R as ImportFailureNullJSON,y as SuccessfulImport,O as ToastContext,vt as __namedExportsOrder,Rt as default};
