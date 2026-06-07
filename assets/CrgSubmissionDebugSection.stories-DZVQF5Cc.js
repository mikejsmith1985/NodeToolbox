import{u as A}from"./useCrgSubmissionDebugStore-D-xCmarc.js";import{s as e}from"./AdminHubView.module-BPj767VV.js";import"./react-Li0Ki8N_.js";import"./index-Bc2G9s8g.js";function x(){const t=A(s=>s.lastSubmissionDebug);return t?React.createElement("section",{className:e.sectionCard},React.createElement("h2",{className:e.sectionTitle},"📋 CRG Submission Debug"),React.createElement("p",{className:e.panelHint},"Operation: ",t.operation.toUpperCase()," ",t.targetChgNumber),t.mismatchMessages.length>0?React.createElement("div",{className:e.fieldGroup},React.createElement("span",{className:e.fieldLabel},"Verification warnings"),React.createElement("ul",{className:e.environmentList},t.mismatchMessages.map(s=>React.createElement("li",{key:s},s)))):null,React.createElement("div",{className:e.fieldRow},React.createElement("label",{className:e.fieldLabel,htmlFor:"crg-request-payload"},"Request payload JSON"),React.createElement("textarea",{id:"crg-request-payload",className:e.releaseNotesTextarea,readOnly:!0,value:t.requestPayloadJson,rows:4})),React.createElement("div",{className:e.fieldRow},React.createElement("label",{className:e.fieldLabel,htmlFor:"crg-response"},"ServiceNow response JSON"),React.createElement("textarea",{id:"crg-response",className:e.releaseNotesTextarea,readOnly:!0,value:t.operationResponseJson,rows:4})),React.createElement("div",{className:e.fieldRow},React.createElement("label",{className:e.fieldLabel,htmlFor:"crg-verification"},"Post-update CHG record JSON"),React.createElement("textarea",{id:"crg-verification",className:e.releaseNotesTextarea,readOnly:!0,value:t.verificationRecordJson,rows:4}))):React.createElement("section",{className:e.sectionCard},React.createElement("h2",{className:e.sectionTitle},"📋 CRG Submission Debug"),React.createElement("p",{className:e.adminDescription},"No CRG submissions yet. Create or update a CHG in the SNow Hub CRG wizard to see diagnostics here."))}x.__docgenInfo={description:`CRG Submission Debug section — displays the most recent CRG create/update submission\r
including request payload, SNow response, verification record, and any field mismatches.\r
This allows admins to diagnose field mapping and submission issues without cluttering\r
the CRG wizard UI.`,methods:[],displayName:"CrgSubmissionDebugSection"};const q={lastSubmissionDebug:{operation:"create",targetChgNumber:"CHG0123456",mismatchMessages:["Field 'priority' expected 'High' but received 'high'","Field 'state' mapping incomplete"],requestPayloadJson:'{"chgNumber":"CHG0123456","priority":"High","state":"pending"}',operationResponseJson:'{"status":"success","recordId":"sys_id_12345","message":"CHG created successfully"}',verificationRecordJson:'{"chgNumber":"CHG0123456","priority":"High","state":"pending","createdAt":"2024-01-15T10:30:00Z"}'}},P={lastSubmissionDebug:null},Y={title:"CRG/CrgSubmissionDebugSection",component:x,parameters:{layout:"padded",docs:{description:{component:"Debug panel that surfaces the raw request payload, operation response, and field-level mismatch messages from the most recent CRG wizard CHG submission."}}}},a={name:"With Submission Data (Create)",decorators:[t=>{const s=({children:T})=>React.createElement(React.Fragment,null,T);return React.createElement(s,null,React.createElement(t,null))}],parameters:{crgDebugStore:q,docs:{description:{story:"Displays all debug sections: target CHG number, mismatch messages, request payload JSON, operation response JSON, and verification record JSON after a successful create operation."}}}},r={name:"With Submission Data (Update, No Mismatches)",parameters:{crgDebugStore:{lastSubmissionDebug:{operation:"update",targetChgNumber:"CHG0987654",mismatchMessages:[],requestPayloadJson:JSON.stringify({chgNumber:"CHG0987654",priority:"Critical",state:"approved",assignedTo:"jane.smith@example.com"},null,2),operationResponseJson:JSON.stringify({status:"success",recordId:"sys_id_67890",message:"CHG updated successfully"},null,2),verificationRecordJson:JSON.stringify({chgNumber:"CHG0987654",priority:"Critical",state:"approved",assignedTo:"jane.smith@example.com",updatedAt:"2024-03-22T14:15:00Z"},null,2)}},docs:{description:{story:"Update operation with no field-level mismatches detected. The mismatch section should render an empty or hidden state."}}}},i={name:"Many Mismatch Messages",parameters:{crgDebugStore:{lastSubmissionDebug:{operation:"create",targetChgNumber:"CHG0555123",mismatchMessages:["Field 'priority' expected 'High' but received 'high'","Field 'state' mapping incomplete","Field 'riskLevel' expected '2 - Medium' but received 'Medium'","Field 'category' expected 'Software' but received 'software'","Field 'assignmentGroup' not found in target instance","Field 'plannedStartDate' format mismatch: expected ISO-8601, received 'MM/DD/YYYY'","Field 'shortDescription' exceeds maximum length of 160 characters"],requestPayloadJson:JSON.stringify({chgNumber:"CHG0555123",priority:"High",state:"pending",riskLevel:"2 - Medium",category:"Software",assignmentGroup:"CAB Approval",plannedStartDate:"2024-04-01T09:00:00Z",shortDescription:"Emergency patch deployment for critical vulnerability CVE-2024-0001 affecting all production web servers in the APAC region"},null,2),operationResponseJson:JSON.stringify({status:"partial_success",recordId:"sys_id_99999",warnings:7,message:"CHG created with validation warnings"},null,2),verificationRecordJson:JSON.stringify({chgNumber:"CHG0555123",priority:"high",state:"pending",createdAt:"2024-04-01T08:45:00Z"},null,2)}},docs:{description:{story:"Renders a large number of mismatch messages to verify the list handles overflow gracefully."}}}},n={name:"Failed Operation Response",parameters:{crgDebugStore:{lastSubmissionDebug:{operation:"create",targetChgNumber:"CHG0000001",mismatchMessages:["Field 'assignedTo' is required but was not provided"],requestPayloadJson:JSON.stringify({chgNumber:"CHG0000001",priority:"Low",state:"draft"},null,2),operationResponseJson:JSON.stringify({status:"error",errorCode:"VALIDATION_FAILED",message:"Required fields are missing. Record was not created."},null,2),verificationRecordJson:null}},docs:{description:{story:"When the API returns an error, the debug panel still shows the request payload and error response. The verification record is null because no record was persisted."}}}},o={name:"No Submission Yet (Empty State)",parameters:{crgDebugStore:P,docs:{description:{story:"When no CHG submission has been made, the debug section shows an empty state with a message guiding the user to create or update a CHG record in the CRG wizard."}}}};var c,d,l,m,p;a.parameters={...a.parameters,docs:{...(c=a.parameters)==null?void 0:c.docs,source:{originalSource:`{
  name: 'With Submission Data (Create)',
  decorators: [Story => {
    // Provide mock store state for this story.
    // Replace with your real provider / decorator if the store is
    // Context-based rather than a module-level singleton.
    const MockProvider = ({
      children
    }: {
      children: React.ReactNode;
    }) => {
      // Stub – swap for the real provider if needed.
      return <>{children}</>;
    };
    return <MockProvider>\r
          <Story />\r
        </MockProvider>;
  }],
  parameters: {
    // Pass the mock state via story-level parameters so any custom decorator
    // or loader can pick it up.
    crgDebugStore: mockDebugData,
    docs: {
      description: {
        story: 'Displays all debug sections: target CHG number, mismatch messages, request payload JSON, operation response JSON, and verification record JSON after a successful create operation.'
      }
    }
  }
}`,...(l=(d=a.parameters)==null?void 0:d.docs)==null?void 0:l.source},description:{story:`Default – happy path showing a completed "create" submission with all debug\r
fields populated, including two mismatch warnings.`,...(p=(m=a.parameters)==null?void 0:m.docs)==null?void 0:p.description}}};var u,g,h,b,y;r.parameters={...r.parameters,docs:{...(u=r.parameters)==null?void 0:u.docs,source:{originalSource:`{
  name: 'With Submission Data (Update, No Mismatches)',
  parameters: {
    crgDebugStore: {
      lastSubmissionDebug: {
        operation: 'update',
        targetChgNumber: 'CHG0987654',
        mismatchMessages: [],
        requestPayloadJson: JSON.stringify({
          chgNumber: 'CHG0987654',
          priority: 'Critical',
          state: 'approved',
          assignedTo: 'jane.smith@example.com'
        }, null, 2),
        operationResponseJson: JSON.stringify({
          status: 'success',
          recordId: 'sys_id_67890',
          message: 'CHG updated successfully'
        }, null, 2),
        verificationRecordJson: JSON.stringify({
          chgNumber: 'CHG0987654',
          priority: 'Critical',
          state: 'approved',
          assignedTo: 'jane.smith@example.com',
          updatedAt: '2024-03-22T14:15:00Z'
        }, null, 2)
      }
    },
    docs: {
      description: {
        story: 'Update operation with no field-level mismatches detected. The mismatch section should render an empty or hidden state.'
      }
    }
  }
}`,...(h=(g=r.parameters)==null?void 0:g.docs)==null?void 0:h.source},description:{story:`Update operation – same panel but the submission was an update to an\r
existing CHG record, showing a different operation label and no mismatches.`,...(y=(b=r.parameters)==null?void 0:b.docs)==null?void 0:y.description}}};var f,S,C,N,v;i.parameters={...i.parameters,docs:{...(f=i.parameters)==null?void 0:f.docs,source:{originalSource:`{
  name: 'Many Mismatch Messages',
  parameters: {
    crgDebugStore: {
      lastSubmissionDebug: {
        operation: 'create',
        targetChgNumber: 'CHG0555123',
        mismatchMessages: ["Field 'priority' expected 'High' but received 'high'", "Field 'state' mapping incomplete", "Field 'riskLevel' expected '2 - Medium' but received 'Medium'", "Field 'category' expected 'Software' but received 'software'", "Field 'assignmentGroup' not found in target instance", "Field 'plannedStartDate' format mismatch: expected ISO-8601, received 'MM/DD/YYYY'", "Field 'shortDescription' exceeds maximum length of 160 characters"],
        requestPayloadJson: JSON.stringify({
          chgNumber: 'CHG0555123',
          priority: 'High',
          state: 'pending',
          riskLevel: '2 - Medium',
          category: 'Software',
          assignmentGroup: 'CAB Approval',
          plannedStartDate: '2024-04-01T09:00:00Z',
          shortDescription: 'Emergency patch deployment for critical vulnerability CVE-2024-0001 affecting all production web servers in the APAC region'
        }, null, 2),
        operationResponseJson: JSON.stringify({
          status: 'partial_success',
          recordId: 'sys_id_99999',
          warnings: 7,
          message: 'CHG created with validation warnings'
        }, null, 2),
        verificationRecordJson: JSON.stringify({
          chgNumber: 'CHG0555123',
          priority: 'high',
          state: 'pending',
          createdAt: '2024-04-01T08:45:00Z'
        }, null, 2)
      }
    },
    docs: {
      description: {
        story: 'Renders a large number of mismatch messages to verify the list handles overflow gracefully.'
      }
    }
  }
}`,...(C=(S=i.parameters)==null?void 0:S.docs)==null?void 0:C.source},description:{story:`Many mismatches – stress-tests the mismatch message list rendering with\r
several validation discrepancies returned from the API.`,...(v=(N=i.parameters)==null?void 0:N.docs)==null?void 0:v.description}}};var R,w,D,G,J;n.parameters={...n.parameters,docs:{...(R=n.parameters)==null?void 0:R.docs,source:{originalSource:`{
  name: 'Failed Operation Response',
  parameters: {
    crgDebugStore: {
      lastSubmissionDebug: {
        operation: 'create',
        targetChgNumber: 'CHG0000001',
        mismatchMessages: ["Field 'assignedTo' is required but was not provided"],
        requestPayloadJson: JSON.stringify({
          chgNumber: 'CHG0000001',
          priority: 'Low',
          state: 'draft'
        }, null, 2),
        operationResponseJson: JSON.stringify({
          status: 'error',
          errorCode: 'VALIDATION_FAILED',
          message: 'Required fields are missing. Record was not created.'
        }, null, 2),
        verificationRecordJson: null
      }
    },
    docs: {
      description: {
        story: 'When the API returns an error, the debug panel still shows the request payload and error response. The verification record is null because no record was persisted.'
      }
    }
  }
}`,...(D=(w=n.parameters)==null?void 0:w.docs)==null?void 0:D.source},description:{story:`Failed operation – the API returned an error response. Verifies the panel\r
still renders the payloads so developers can diagnose what was sent.`,...(J=(G=n.parameters)==null?void 0:G.docs)==null?void 0:J.description}}};var H,O,M,E,F;o.parameters={...o.parameters,docs:{...(H=o.parameters)==null?void 0:H.docs,source:{originalSource:`{
  name: 'No Submission Yet (Empty State)',
  parameters: {
    crgDebugStore: emptyDebugData,
    docs: {
      description: {
        story: 'When no CHG submission has been made, the debug section shows an empty state with a message guiding the user to create or update a CHG record in the CRG wizard.'
      }
    }
  }
}`,...(M=(O=o.parameters)==null?void 0:O.docs)==null?void 0:M.source},description:{story:`Empty state – no submission has been made yet. The panel should display a\r
helpful message prompting the user to create or update a CHG via the CRG\r
wizard before debug data will appear.`,...(F=(E=o.parameters)==null?void 0:E.docs)==null?void 0:F.description}}};const U=["Default","UpdateOperation","ManyMismatches","FailedOperation","EmptyState"];export{a as Default,o as EmptyState,n as FailedOperation,i as ManyMismatches,r as UpdateOperation,U as __namedExportsOrder,Y as default};
