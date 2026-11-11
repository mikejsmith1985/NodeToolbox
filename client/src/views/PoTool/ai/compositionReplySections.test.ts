// compositionReplySections.test.ts — Proves a Feature Composition reply written the way Google's AI Mode answers (a
// document with headings, an intro sentence, a closing offer, and a pasted table) is read into the same proposal a JSON
// reply gives, and that a reply missing sections is never filled in by guesswork but answered with a follow-up (GH #499).

import { describe, expect, it } from 'vitest';

import { DEFINITION_OF_READY } from '../coaching/definitionOfReady';
import { createEmptyCompositionDraft } from '../drafts/draftModel';
import { buildCompositionPrompt, parseCompositionIngest } from './compositionAiAssist';
import { buildCompositionAnswerLayout } from './compositionReplySections';

const WRITABLE_FIELDS = { customfield_10101: 'Target Start', customfield_10500: 'Initiative Type' };
const WRITABLE_FIELD_IDS = Object.keys(WRITABLE_FIELDS);

/** An AI Mode reply: intro sentence, markdown headings for every section, a markdown fields table, closing offer. */
const AI_MODE_DOCUMENT_REPLY = [
  'Here is a draft Jira Feature written to meet your Definition of Ready.',
  '',
  '## Summary',
  'Claimant document submission',
  '',
  '## Description',
  'Claimants email documents in today and some are lost.',
  '',
  '**Benefit Hypothesis**',
  'Fewer lost documents means faster claim decisions.',
  '',
  '### Acceptance Criteria',
  '- Given a draft claim, when a claimant uploads a PDF, then it is attached to the claim.',
  '',
  'Assumptions',
  'Claimants have a portal login.',
  '',
  'Dependencies',
  'The document store API.',
  '',
  'In Scope',
  'PDF and image uploads.',
  '',
  'Out of Scope',
  'Paper mail.',
  '',
  'Risks',
  'Upload limits may be too small — see DENP-77.',
  '',
  'Non-Functional Requirements (NFR)',
  'Uploads complete in under 5 seconds.',
  '',
  'Rationale',
  'Framed against the Definition of Ready.',
  '',
  'JIRA_FIELDS_TABLE:',
  '| Field id | Field | Value |',
  '|---|---|---|',
  '| customfield_10101 | Target Start | 2026-08-01 |',
  '| customfield_10500 | Initiative Type | ___ |',
  '',
  'If you provide the SLA details, I can refine the acceptance criteria further.',
].join('\n');

/** The same fields table pasted from the web page as tab-separated cells. */
const TAB_FIELDS_TABLE = [
  'Field id\tField\tValue',
  'customfield_10101\tTarget Start\t2026-09-01',
  'customfield_10500\tInitiative Type\tEnabler',
].join('\n');

describe('buildCompositionAnswerLayout', () => {
  it('asks for every section by label and pre-lists every offered field in the table', () => {
    const layout = buildCompositionAnswerLayout('featureCompositionIngest', WRITABLE_FIELDS);

    ['SUMMARY:', 'DESCRIPTION:', 'BENEFIT_HYPOTHESIS:', 'ACCEPTANCE_CRITERIA:', 'NFR:', 'RATIONALE:'].forEach((label) => {
      expect(layout).toContain(label);
    });
    expect(layout).toContain('customfield_10101 | Target Start | ___');
    expect(layout).not.toMatch(/Respond ONLY with valid JSON/);
  });

  it('leaves out the fields table when no field is writable', () => {
    expect(buildCompositionAnswerLayout('featureCompositionIngest', {})).not.toContain('JIRA_FIELDS_TABLE:');
  });

  it('is what the composition prompt ends with', () => {
    const prompt = buildCompositionPrompt(createEmptyCompositionDraft('profile-alpha', 'new:1'), DEFINITION_OF_READY, WRITABLE_FIELDS);

    expect(prompt.trimEnd().endsWith('customfield_10500 | Initiative Type | ___')).toBe(true);
  });
});

describe('parseCompositionIngest — a document-shaped AI Mode reply', () => {
  it('reads the summary, all nine sections, the acceptance criteria and the filled-in fields', () => {
    const result = parseCompositionIngest(AI_MODE_DOCUMENT_REPLY, WRITABLE_FIELD_IDS);
    const proposal = result.items[0];

    expect(result.errors).toEqual([]);
    expect(result.followUpPrompt).toBeUndefined();
    expect(proposal.summary).toBe('Claimant document submission');
    expect(proposal.description).toContain('Benefit Hypothesis:');
    expect(proposal.description).toContain('Fewer lost documents');
    expect(proposal.description).toContain('Uploads complete in under 5 seconds.');
    expect(proposal.acceptanceCriteria).toContain('when a claimant uploads a PDF');
    expect(proposal.rationale).toBe('Framed against the Definition of Ready.');
    // A blank stays blank: Initiative Type was left as ___ and is not filled in.
    expect(proposal.fields).toEqual({ customfield_10101: '2026-08-01' });
  });

  it('drops the closing offer and never folds the fields table into a section', () => {
    const proposal = parseCompositionIngest(AI_MODE_DOCUMENT_REPLY, WRITABLE_FIELD_IDS).items[0];

    expect(proposal.description).not.toMatch(/If you provide/);
    expect(proposal.rationale).not.toContain('customfield_10101');
  });

  it('reads a fields table pasted as tab-separated cells', () => {
    const reply = AI_MODE_DOCUMENT_REPLY.replace(/JIRA_FIELDS_TABLE:[\s\S]*$/, `JIRA_FIELDS_TABLE:\n${TAB_FIELDS_TABLE}`);

    const proposal = parseCompositionIngest(reply, WRITABLE_FIELD_IDS).items[0];

    expect(proposal.fields).toEqual({ customfield_10101: '2026-09-01', customfield_10500: 'Enabler' });
  });

  it('still drops a field id the prompt never offered', () => {
    const reply = AI_MODE_DOCUMENT_REPLY.replace('| customfield_10500 | Initiative Type | ___ |', '| customfield_99999 | Invented | x |');

    const result = parseCompositionIngest(reply, WRITABLE_FIELD_IDS);

    expect(result.items[0].fields).toEqual({ customfield_10101: '2026-08-01' });
    expect(result.errors.join(' ')).toMatch(/customfield_99999.*ignored/);
  });
});

describe('parseCompositionIngest — follow-ups instead of guesses', () => {
  it('offers the whole layout again for a reply with no sections at all', () => {
    const result = parseCompositionIngest('That sounds like a great Feature idea!', WRITABLE_FIELD_IDS);

    expect(result.items).toEqual([]);
    expect(result.errors[0]).toBe('No JSON object found in the assistant response.');
    expect(result.followUpPrompt).toMatch(/not in the form I need/);
    expect(result.followUpPrompt).toContain('SUMMARY: [text]');
  });

  it('does not read a new Feature that left sections out, and asks for only those', () => {
    const partialReply = AI_MODE_DOCUMENT_REPLY.replace(/Risks\n[^\n]*\n\nNon-Functional Requirements \(NFR\)\n[^\n]*\n\n/, '');

    const result = parseCompositionIngest(partialReply, WRITABLE_FIELD_IDS);

    expect(result.items).toEqual([]);
    expect(result.errors[0]).toMatch(/left out RISKS, NFR/);
    expect(result.followUpPrompt).toContain('RISKS: [text]');
    expect(result.followUpPrompt).toContain('NFR: [text]');
    expect(result.followUpPrompt).not.toContain('SUMMARY: [text]');
  });

  it('reads the reply once the follow-up answer is added under it', () => {
    const partialReply = AI_MODE_DOCUMENT_REPLY.replace(/Risks\n[^\n]*\n\nNon-Functional Requirements \(NFR\)\n[^\n]*\n\n/, '');
    const followUpAnswer = 'RISKS: Upload limits may be too small.\nNFR: Uploads finish in 5 seconds.';

    const result = parseCompositionIngest(`${partialReply}\n\n${followUpAnswer}`, WRITABLE_FIELD_IDS);

    expect(result.items[0].description).toContain('Upload limits may be too small.');
    expect(result.items[0].description).toContain('Uploads finish in 5 seconds.');
  });

  it('asks only for the summary when enriching an existing Feature — only additions were requested', () => {
    const enrichReply = 'Benefit Hypothesis\nFaster decisions.';

    const result = parseCompositionIngest(enrichReply, WRITABLE_FIELD_IDS, 'Description:\nClaimants lose documents.');

    expect(result.items).toEqual([]);
    expect(result.followUpPrompt).toContain('SUMMARY: [text]');
    expect(result.followUpPrompt).not.toContain('RISKS: [text]');
  });
});
