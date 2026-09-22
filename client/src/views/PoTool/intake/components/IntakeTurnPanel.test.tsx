// IntakeTurnPanel.test.tsx — Renders whatever the current step needs and nothing else: the assistant's copy/paste
// panel plus "Answer these myself" when it is the assistant's turn, the Check DENP button when it is Toolbox's
// turn, and the PO's own questions otherwise.

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAiAssistUnlocked, useAiAssistStore } from '../../../../store/aiAssistStore';
import {
  createIntakeItem,
  EPIC_INTAKE_SCHEMA_VERSION,
  type EpicIntake,
  type SourceLine,
} from '../epicIntakeModel.ts';
import { settleDecision } from '../intakeChecklist.ts';
import IntakeTurnPanel, { type IntakeJiraDeps } from './IntakeTurnPanel.tsx';

const NOW_ISO = '2026-09-18T12:00:00.000Z';

function buildLine(lineNumber: number, text: string): SourceLine {
  return { lineNumber, text, rawText: text, outlineLevel: 1 };
}

function buildBaseIntake(): EpicIntake {
  return {
    schemaVersion: EPIC_INTAKE_SCHEMA_VERSION,
    id: 'intake-1',
    teamProfileId: 'team-a',
    name: 'Test intake',
    targetProjectKey: 'DENP',
    createdAtIso: NOW_ISO,
    updatedAtIso: NOW_ISO,
    sourceTitles: ['Pasted notes'],
    lines: [buildLine(1, 'Member portal work')],
    items: [],
    setAsideLines: [],
    epicType: { state: 'resolved', id: '10000', name: 'Epic' },
    batchRequiredFieldValues: {},
    roundHistory: [],
  };
}

/** An item still needing its kind decided — matches step "sortNotes" being the assistant's or the PO's turn. */
function buildSortNotesIntake(): EpicIntake {
  const item = createIntakeItem(1, 'Member portal work', [1]);
  return { ...buildBaseIntake(), items: [item] };
}

/** Enrollment work whose duplicate check has not run yet — matches step "checkDenp", Toolbox's turn. */
function buildCheckDenpIntake(): EpicIntake {
  const item = createIntakeItem(1, 'Member portal work', [1]);
  item.decisions.kind = settleDecision(item.decisions.kind, 'work', 'rule', 'Notes say work');
  item.decisions.owner = settleDecision(item.decisions.owner, 'enrollment', 'rule', 'Stated sizes');
  return { ...buildBaseIntake(), items: [item] };
}

/** A new Epic whose label has not been confirmed yet — matches step "confirmLabels", always the PO's turn. */
function buildConfirmLabelsIntake(): EpicIntake {
  const item = createIntakeItem(1, 'Member portal work', [1]);
  item.decisions.kind = settleDecision(item.decisions.kind, 'work', 'rule', 'Notes say work');
  item.decisions.owner = settleDecision(item.decisions.owner, 'enrollment', 'rule', 'Stated sizes');
  item.decisions.duplicate = settleDecision(item.decisions.duplicate, { verdict: 'createNew' }, 'po', 'Chosen by the PO');
  return { ...buildBaseIntake(), items: [item] };
}

function buildJiraDepsStub(): IntakeJiraDeps {
  return {
    search: {
      getProjectIssueTypes: vi.fn(),
      searchIssues: vi.fn(async () => []),
      fetchIssueByKey: vi.fn(),
      extractHttpStatus: vi.fn(() => null),
    },
    create: { createIssue: vi.fn(), searchIssues: vi.fn(async () => []), nowIso: () => NOW_ISO },
    loadCreateFields: vi.fn(async () => ({ values: [] })),
  };
}

describe('IntakeTurnPanel', () => {
  afterEach(() => {
    setAiAssistUnlocked(false);
  });

  describe('the assistant\'s turn', () => {
    beforeEach(() => {
      useAiAssistStore.setState({ isAiAssistUnlocked: true });
    });

    it('renders the assistant panel and "Answer these myself"', () => {
      render(
        <IntakeTurnPanel
          intake={buildSortNotesIntake()}
          isAiUnlocked
          onChange={vi.fn()}
          jiraDeps={buildJiraDepsStub()}
          nowIso={() => NOW_ISO}
        />,
      );

      expect(screen.getByRole('button', { name: 'Build the prompt' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Answer these myself' })).toBeInTheDocument();
    });

    it('"Answer these myself" hands the step\'s open questions to the PO', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <IntakeTurnPanel
          intake={buildSortNotesIntake()}
          isAiUnlocked
          onChange={onChange}
          jiraDeps={buildJiraDepsStub()}
          nowIso={() => NOW_ISO}
        />,
      );

      await user.click(screen.getByRole('button', { name: 'Answer these myself' }));

      expect(onChange).toHaveBeenCalledTimes(1);
      const updatedIntake = onChange.mock.calls[0][0] as EpicIntake;
      const kindDecision = updatedIntake.items[0].decisions.kind;
      expect(kindDecision.state === 'open' && kindDecision.isAwaitingPo).toBe(true);
    });
  });

  it('Check DENP calls the injected Jira search functions and reports the result through onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const jiraDeps = buildJiraDepsStub();

    render(
      <IntakeTurnPanel
        intake={buildCheckDenpIntake()}
        isAiUnlocked={false}
        onChange={onChange}
        jiraDeps={jiraDeps}
        nowIso={() => NOW_ISO}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Check DENP' }));

    expect(jiraDeps.search.searchIssues).toHaveBeenCalled();
    expect(jiraDeps.search.getProjectIssueTypes).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalled();
    const updatedIntake = onChange.mock.calls.at(-1)?.[0] as EpicIntake;
    expect(updatedIntake.items[0].searchStatus).not.toBe('notRun');
  });

  it('renders the PO\'s own question list on the PO\'s turn', () => {
    render(
      <IntakeTurnPanel
        intake={buildConfirmLabelsIntake()}
        isAiUnlocked={false}
        onChange={vi.fn()}
        jiraDeps={buildJiraDepsStub()}
        nowIso={() => NOW_ISO}
      />,
    );

    expect(screen.getByRole('combobox', { name: /Label for the new Epic/ })).toBeInTheDocument();
  });

  it('shows Check DENP for ready items alongside another item\'s open owner question (GH #387)', () => {
    // The reported dead end: five close-call owners held back Check DENP for six items that were ready.
    const readyItem = buildCheckDenpIntake().items[0];
    const closeCall = createIntakeItem(2, 'EAM Upgrades', [2]);
    closeCall.decisions.kind = settleDecision(closeCall.decisions.kind, 'work', 'ai', 'Sorted');
    closeCall.decisions.searchTerms = settleDecision(closeCall.decisions.searchTerms, ['eam upgrades'], 'ai', 'Suggested');
    closeCall.decisions.owner = { ...closeCall.decisions.owner, isAwaitingPo: true, aiReason: 'Estimated Enrollment share 50% is a close call' } as typeof closeCall.decisions.owner;
    const intake = { ...buildBaseIntake(), lines: [buildLine(1, 'Member portal work'), buildLine(2, 'EAM Upgrades')], items: [readyItem, closeCall] };

    render(
      <IntakeTurnPanel intake={intake} isAiUnlocked={false} onChange={vi.fn()} jiraDeps={buildJiraDepsStub()} nowIso={() => NOW_ISO} />,
    );

    expect(screen.getByRole('button', { name: 'Check DENP' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /Who owns "EAM Upgrades"/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Questions for you (1)' })).toBeInTheDocument();
  });
});
