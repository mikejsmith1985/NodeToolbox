// SaveTemplateControl.test.tsx — Proves "Save as template" asks only for a name, confirms, and offers Replace on a name clash.

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import SaveTemplateControl from './SaveTemplateControl.tsx';
import type { TemplateDraft } from './useTemplateLibrary.ts';

const BLANK = { sysId: '', displayName: '' };
const DRAFT = {
  chgBasicInfo: { category: 'software', assignmentGroup: BLANK },
  chgPlanningAssessment: {},
  chgPlanningContent: { implementationPlan: '1. Deploy', backoutPlan: '', testPlan: '' },
  changeTasks: [],
} as unknown as TemplateDraft;
const TEMPLATES_KEY = 'ntbx-crg-templates';

function readSavedNames(): string[] {
  return (JSON.parse(localStorage.getItem(TEMPLATES_KEY) ?? '[]') as Array<{ name: string }>).map((template) => template.name);
}

function saveAs(templateName: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
  fireEvent.change(screen.getByLabelText('Name this template'), { target: { value: templateName } });
  fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
}

describe('SaveTemplateControl', () => {
  beforeEach(() => localStorage.clear());

  it('saves under the name given and says so', () => {
    render(<SaveTemplateControl draft={DRAFT} />);
    saveAs('Monthly release');
    expect(screen.getByRole('status').textContent).toContain('Saved ✓');
    expect(readSavedNames()).toEqual(['Monthly release']);
  });

  it('will not save without a name', () => {
    render(<SaveTemplateControl draft={DRAFT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }));
    expect((screen.getByRole('button', { name: 'Save template' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Name this template')).toBeNull();
  });

  it('offers to replace a template with the same name instead of making a second one', () => {
    render(<SaveTemplateControl draft={DRAFT} />);
    saveAs('Monthly release');
    saveAs('monthly release');
    expect(screen.getByText(/already have a template called/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Replace it' }));
    expect(screen.getByRole('status').textContent).toContain('Saved ✓');
    expect(readSavedNames()).toEqual(['Monthly release']);
  });

  it('lets the user pick another name after a clash', () => {
    render(<SaveTemplateControl draft={DRAFT} />);
    saveAs('Monthly release');
    saveAs('Monthly release');
    fireEvent.click(screen.getByRole('button', { name: 'Use another name' }));
    fireEvent.change(screen.getByLabelText('Name this template'), { target: { value: 'Hotfix' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));
    expect(readSavedNames()).toEqual(['Hotfix', 'Monthly release']);
  });
});
