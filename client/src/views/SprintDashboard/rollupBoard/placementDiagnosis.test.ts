// placementDiagnosis.test.ts — Proves the board can explain an issue's absence without a round trip.
//
// The two real cases from GH #306 are the fixtures: DASP-925, whose Feature is in a project the team
// does not track, and DENP-1371, which needed the answer that only live data could give.

import { describe, expect, it } from 'vitest';

import { diagnosePlacement, summarizeDiagnosis, type PlacementDiagnosisInput } from './placementDiagnosis.ts';

const PI_FIELD = 'customfield_10301';
const FEATURE_LINK_FIELD = 'customfield_10108';

/** A diagnosis input with everything healthy, overridable per test. */
function buildInput(overrides: Partial<PlacementDiagnosisInput> = {}): PlacementDiagnosisInput {
  return {
    issueKey: 'ENCUC-1',
    issueFields: { [PI_FIELD]: 'PI 26.4', status: { statusCategory: { key: 'new' } } },
    piFieldId: PI_FIELD,
    featureLinkFieldId: FEATURE_LINK_FIELD,
    selectedPiValue: 'PI 26.4',
    carryOverPiValue: '',
    featureProjectKeys: ['DENP'],
    featureKey: 'DENP-1',
    featureFields: { status: { statusCategory: { key: 'indeterminate' } } },
    ...overrides,
  };
}

/** The step answering one question. */
function stepFor(steps: ReturnType<typeof diagnosePlacement>, prefix: string) {
  return steps.find((step) => step.question.startsWith(prefix))!;
}

describe('diagnosePlacement — the PI scope', () => {
  it('confirms an issue the scope query reaches', () => {
    const step = stepFor(diagnosePlacement(buildInput()), 'Is it in the PI');
    expect(step.verdict).toBe('included');
  });

  it('names an empty PI field, which is invisible to every PI-scoped tab', () => {
    const step = stepFor(diagnosePlacement(buildInput({ issueFields: {} })), 'Is it in the PI');

    expect(step.verdict).toBe('excluded');
    expect(step.detail).toContain('EMPTY');
  });

  it('shows both PI values when they differ, rather than only saying no', () => {
    const input = buildInput({ issueFields: { [PI_FIELD]: 'PI 26.3' } });
    const step = stepFor(diagnosePlacement(input), 'Is it in the PI');

    expect(step.detail).toContain('PI 26.3');
    expect(step.detail).toContain('PI 26.4');
  });

  it('reads a PI held as a select option, not only as a string', () => {
    const input = buildInput({ issueFields: { [PI_FIELD]: { value: 'PI 26.4' } } });
    expect(stepFor(diagnosePlacement(input), 'Is it in the PI').verdict).toBe('included');
  });
});

describe('diagnosePlacement — the carry-over sweep', () => {
  it('says so plainly when no carry-over PI is set', () => {
    const step = stepFor(diagnosePlacement(buildInput()), 'Would the carry-over');

    expect(step.verdict).toBe('not-applicable');
    expect(step.detail).toContain('No carry-over PI is set');
  });

  it('names the untracked project when the Feature lives outside the team — the DASP-925 case', () => {
    const input = buildInput({
      carryOverPiValue: 'PI 26.3',
      featureKey: 'DASP-925',
      featureProjectKeys: ['DENP', 'ENCUC'],
    });
    const step = stepFor(diagnosePlacement(input), 'Would the carry-over');

    expect(step.verdict).toBe('excluded');
    expect(step.detail).toContain('DASP');
    expect(step.detail).toContain('DENP, ENCUC');
  });

  it('names the Feature\'s actual PI when it is not the one being carried', () => {
    const input = buildInput({
      carryOverPiValue: 'PI 26.3',
      featureFields: { [PI_FIELD]: 'PI 26.2', status: { statusCategory: { key: 'new' } } },
    });
    const step = stepFor(diagnosePlacement(input), 'Would the carry-over');

    expect(step.detail).toContain('PI 26.2');
    expect(step.detail).toContain('PI 26.3');
  });

  it('explains that a finished Feature was delivered rather than carried', () => {
    const input = buildInput({
      carryOverPiValue: 'PI 26.3',
      featureFields: { [PI_FIELD]: 'PI 26.3', status: { statusCategory: { key: 'done' } } },
    });
    const step = stepFor(diagnosePlacement(input), 'Would the carry-over');

    expect(step.verdict).toBe('excluded');
    expect(step.detail).toContain('unfinished');
  });

  it('confirms a Feature the sweep does reach', () => {
    const input = buildInput({
      carryOverPiValue: 'PI 26.3',
      featureFields: { [PI_FIELD]: 'PI 26.3', status: { statusCategory: { key: 'indeterminate' } } },
    });

    expect(stepFor(diagnosePlacement(input), 'Would the carry-over').verdict).toBe('included');
  });
});

describe('diagnosePlacement — roll-up and the project filter', () => {
  it('points at the No Feature lane when nothing links it to a Feature', () => {
    const step = stepFor(diagnosePlacement(buildInput({ featureKey: null })), 'Does it roll up');

    expect(step.verdict).toBe('excluded');
    expect(step.detail).toContain('No Feature');
  });

  it('names the untracked project and what to do about it', () => {
    const input = buildInput({ featureKey: 'QEINT-613', featureProjectKeys: ['DENP'] });
    const step = stepFor(diagnosePlacement(input), 'Is its Feature one this team tracks');

    expect(step.verdict).toBe('excluded');
    expect(step.detail).toContain('QEINT');
    expect(step.detail).toContain('Board setup');
  });

  it('filters nothing when no Feature projects are configured', () => {
    const input = buildInput({ featureProjectKeys: [] });
    expect(stepFor(diagnosePlacement(input), 'Is its Feature one this team tracks').verdict)
      .toBe('not-applicable');
  });
});

describe('diagnosePlacement — an unreadable issue', () => {
  it('stops at the first question rather than guessing about the rest', () => {
    const steps = diagnosePlacement(buildInput({ issueFields: null }));

    expect(steps).toHaveLength(1);
    expect(steps[0].detail).toContain('could not be read');
  });
});

describe('summarizeDiagnosis — one sentence a person can act on', () => {
  it('says it never reaches the board when neither the scope nor the sweep selects it', () => {
    const input = buildInput({ issueFields: { [PI_FIELD]: 'PI 26.3' } });
    const sentence = summarizeDiagnosis('DENP-1371', diagnosePlacement(input));

    expect(sentence).toContain('never reaches the board');
  });

  it('distinguishes reaching the board and then being removed', () => {
    const input = buildInput({ featureKey: 'QEINT-613' });
    const sentence = summarizeDiagnosis('ENCUC-1', diagnosePlacement(input));

    expect(sentence).toContain('reaches the board but is then removed');
    expect(sentence).toContain('QEINT');
  });

  it('says the issue should be there when nothing excluded it', () => {
    expect(summarizeDiagnosis('ENCUC-1', diagnosePlacement(buildInput())))
      .toContain('should be on the board');
  });
});

describe('diagnosePlacement — the issue IS a Feature', () => {
  // DENP-1371 is itself a Feature, so "is it in the dashboard's PI scope?" and "does it roll up to a
  // Feature?" are both category errors: the scope query asks the TEAM's project, which a Feature does
  // not live in, and a Feature does not roll up to anything — it is the lane.
  function buildFeatureInput(overrides: Partial<PlacementDiagnosisInput> = {}): PlacementDiagnosisInput {
    return buildInput({
      issueKey: 'DENP-1371',
      issueFields: {
        issuetype: { name: 'Feature' },
        [PI_FIELD]: 'PI 26.3',
        status: { statusCategory: { key: 'indeterminate' } },
      },
      carryOverPiValue: 'PI 26.3',
      featureProjectKeys: ['DENP'],
      featureKey: null,
      featureFields: null,
      ...overrides,
    });
  }

  it('never asks a Feature whether it rolls up to a Feature', () => {
    const questions = diagnosePlacement(buildFeatureInput()).map((step) => step.question);
    expect(questions.some((question) => question.startsWith('Does it roll up'))).toBe(false);
  });

  it('never judges a Feature by the dashboard\'s PI scope, which asks the team\'s project', () => {
    const questions = diagnosePlacement(buildFeatureInput()).map((step) => step.question);
    expect(questions.some((question) => question.startsWith('Is it in the PI'))).toBe(false);
  });

  it('judges the carry-over sweep on the FEATURE\'S own PI and status', () => {
    const steps = diagnosePlacement(buildFeatureInput());
    const sweepStep = steps.find((step) => step.question.startsWith('Would the carry-over'))!;

    expect(sweepStep.verdict).toBe('included');
    expect(sweepStep.detail).toContain('DENP-1371');
  });

  it('says a finished Feature was delivered rather than carried', () => {
    const steps = diagnosePlacement(buildFeatureInput({
      issueFields: {
        issuetype: { name: 'Feature' },
        [PI_FIELD]: 'PI 26.3',
        status: { statusCategory: { key: 'done' } },
      },
    }));

    expect(steps.find((step) => step.question.startsWith('Would the carry-over'))!.verdict).toBe('excluded');
  });

  it('points at Board setup when no carry-over PI is configured', () => {
    const steps = diagnosePlacement(buildFeatureInput({ carryOverPiValue: '' }));
    const sweepStep = steps.find((step) => step.question.startsWith('Would the carry-over'))!;

    expect(sweepStep.detail).toContain('no carry-over PI is set');
    expect(sweepStep.detail).toContain('PI 26.3');
  });

  it('checks the Feature\'s OWN project against the tracked list', () => {
    const steps = diagnosePlacement(buildFeatureInput({ featureProjectKeys: ['ENCUC'] }));
    const projectStep = steps.find((step) => step.question.startsWith('Is it one of the Feature projects'))!;

    expect(projectStep.verdict).toBe('excluded');
    expect(projectStep.detail).toContain('DENP');
  });

  it('reminds that a Feature also earns a lane from work beneath it', () => {
    const steps = diagnosePlacement(buildFeatureInput());
    expect(steps.some((step) => step.question.startsWith('Does any in-scope work'))).toBe(true);
  });

  it('treats an Epic the same way, since the board counts both as the outcome', () => {
    const steps = diagnosePlacement(buildFeatureInput({
      issueFields: { issuetype: { name: 'Epic' }, [PI_FIELD]: 'PI 26.3', status: { statusCategory: { key: 'new' } } },
    }));

    expect(steps.some((step) => step.question.startsWith('Does it roll up'))).toBe(false);
  });
});
