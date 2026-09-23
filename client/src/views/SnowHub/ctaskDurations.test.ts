// ctaskDurations.test.ts — The CAB asked for three estimates on every CTASK and a confirmation that the planned
// window holds them. These prove the block says exactly that, never stacks, and that a short window is called short.

import { describe, expect, it } from 'vitest';

import {
  applyDurationBlock,
  buildDurationBlock,
  checkWindowCoversEstimates,
  EMPTY_DURATION_ESTIMATES,
  formatMinutes,
  listMissingEstimateLabels,
  normalizeEstimates,
  readEstimateMinutes,
  readEstimatesFromText,
  readPlannedWindowMinutes,
  rollUpEstimates,
  sumEstimateMinutes,
  type DurationEstimates,
} from './ctaskDurations.ts';

const FULL_ESTIMATES: DurationEstimates = {
  implementationMinutes: '45',
  validationMinutes:     '30',
  backoutMinutes:        '60',
};

describe('readEstimateMinutes', () => {
  it('reads a typed number as whole minutes', () => {
    expect(readEstimateMinutes(' 45 ')).toBe(45);
  });

  it('treats blank, zero, negative and nonsense as not estimated', () => {
    ['', '   ', '0', '-10', 'soon'].forEach((typedValue) => {
      expect(readEstimateMinutes(typedValue)).toBeNull();
    });
  });
});

describe('formatMinutes', () => {
  it('says it the way a person would', () => {
    expect(formatMinutes(45)).toBe('45 minutes');
    expect(formatMinutes(60)).toBe('1 hour');
    expect(formatMinutes(90)).toBe('1 hour 30 minutes');
    expect(formatMinutes(120)).toBe('2 hours');
    expect(formatMinutes(1)).toBe('1 minute');
  });
});

describe('the estimated-duration block', () => {
  it('names all three phases in the words the approver used', () => {
    const block = buildDurationBlock(FULL_ESTIMATES, '', '');
    expect(block).toContain('• Implementation: 45 minutes');
    expect(block).toContain('• Post-deployment validation/monitoring: 30 minutes');
    expect(block).toContain('• Backout/recovery and restoration validation: 1 hour');
  });

  it('confirms a window that holds the work', () => {
    // 09:00 → 13:00 is four hours; the work totals two hours fifteen.
    const block = buildDurationBlock(FULL_ESTIMATES, '2026-10-01T09:00', '2026-10-01T13:00');
    expect(block).toContain('sufficient for implementation and validation');
    expect(block).toContain('recovery and restoration validation if backout is required');
  });

  it('calls a short window short, and says by how much', () => {
    // One hour of window against two hours fifteen of work.
    const block = buildDurationBlock(FULL_ESTIMATES, '2026-10-01T09:00', '2026-10-01T10:00');
    expect(block).toContain('1 hour 15 minutes SHORT');
    expect(block).toContain('Extend the window before submitting.');
  });

  it('says a phase is not estimated rather than inventing a number', () => {
    const block = buildDurationBlock({ ...FULL_ESTIMATES, backoutMinutes: '' }, '', '');
    expect(block).toContain('• Backout/recovery and restoration validation: not estimated');
  });

  it('cannot confirm a window when nothing is estimated', () => {
    expect(buildDurationBlock(EMPTY_DURATION_ESTIMATES, '2026-10-01T09:00', '2026-10-01T13:00'))
      .toContain('nothing estimated yet');
  });
});

describe('applyDurationBlock', () => {
  it('keeps the text that was already there', () => {
    const applied = applyDurationBlock('Run the deployment script.', FULL_ESTIMATES, '', '');
    expect(applied).toContain('Run the deployment script.');
    expect(applied).toContain('• Implementation: 45 minutes');
  });

  it('replaces its own earlier block instead of stacking copies', () => {
    const once = applyDurationBlock('Deploy.', FULL_ESTIMATES, '', '');
    const twice = applyDurationBlock(once, { ...FULL_ESTIMATES, implementationMinutes: '90' }, '', '');

    expect(twice.match(/--- Estimated duration ---/g)).toHaveLength(1); // one block, not two
    expect(twice).toContain('• Implementation: 1 hour 30 minutes');
    expect(twice).not.toContain('• Implementation: 45 minutes');
    expect(twice).toContain('Deploy.');
  });

  it('is just the block when there is no description yet', () => {
    expect(applyDurationBlock('', FULL_ESTIMATES, '', '')).toMatch(/^--- Estimated duration ---/);
  });
});

describe('window coverage', () => {
  it('reads a window in minutes, and refuses a backwards or unset one', () => {
    expect(readPlannedWindowMinutes('2026-10-01T09:00', '2026-10-01T11:30')).toBe(150);
    expect(readPlannedWindowMinutes('2026-10-01T11:00', '2026-10-01T09:00')).toBeNull();
    expect(readPlannedWindowMinutes('', '2026-10-01T09:00')).toBeNull();
  });

  it('reports the shortfall, the total and whether all three phases are estimated', () => {
    const coverage = checkWindowCoversEstimates(FULL_ESTIMATES, '2026-10-01T09:00', '2026-10-01T10:00');
    expect(coverage).toEqual({
      totalEstimatedMinutes: 135,
      windowMinutes:         60,
      isSufficient:          false,
      shortfallMinutes:      75,
      isFullyEstimated:      true,
    });
  });

  it('names the phases still missing an estimate', () => {
    expect(listMissingEstimateLabels({ ...FULL_ESTIMATES, validationMinutes: '' }))
      .toEqual(['Post-deployment validation/monitoring']);
  });

  it('adds the three phases up', () => {
    expect(sumEstimateMinutes(FULL_ESTIMATES)).toBe(135);
  });
});

describe('rollUpEstimates — the CHG takes as long as its CTASKs take', () => {
  it('sums each phase across the staged CTASKs', () => {
    const rolledUp = rollUpEstimates([
      FULL_ESTIMATES,
      { implementationMinutes: '15', validationMinutes: '', backoutMinutes: '30' },
    ]);
    expect(rolledUp).toEqual({ implementationMinutes: '60', validationMinutes: '30', backoutMinutes: '90' });
  });

  it('leaves a phase no CTASK estimated as not estimated, rather than zero', () => {
    expect(rollUpEstimates([])).toEqual(EMPTY_DURATION_ESTIMATES);
  });

  it('tolerates a CTASK saved before estimates existed', () => {
    expect(rollUpEstimates([undefined, FULL_ESTIMATES])).toEqual(FULL_ESTIMATES);
  });
});

describe('normalizeEstimates', () => {
  it('turns a template that predates estimates into an empty set rather than undefined fields', () => {
    expect(normalizeEstimates(undefined)).toEqual(EMPTY_DURATION_ESTIMATES);
    expect(normalizeEstimates({ implementationMinutes: '20' }))
      .toEqual({ implementationMinutes: '20', validationMinutes: '', backoutMinutes: '' });
  });
});

describe('readEstimatesFromText — cloning a CTASK keeps the numbers it already recorded', () => {
  it('reads the three phases back out of a block', () => {
    const description = applyDurationBlock('Deploy the service.', FULL_ESTIMATES, '', '');
    expect(readEstimatesFromText(description)).toEqual(FULL_ESTIMATES);
  });

  it('returns nothing for a description that has no block', () => {
    expect(readEstimatesFromText('Just a description.')).toEqual(EMPTY_DURATION_ESTIMATES);
  });

  it('leaves a phase recorded as "not estimated" empty', () => {
    const description = applyDurationBlock('', { ...FULL_ESTIMATES, validationMinutes: '' }, '', '');
    expect(readEstimatesFromText(description).validationMinutes).toBe('');
  });
});
