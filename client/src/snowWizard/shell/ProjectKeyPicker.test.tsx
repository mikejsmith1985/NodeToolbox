// ProjectKeyPicker.test.tsx — Proves a project is found by typing its key: the list narrows, a full key picks it, Enter
// picks the best match, and the chosen project never drops out of the list.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ProjectKeyPicker from './ProjectKeyPicker.tsx';

const PROJECTS = [
  { key: 'ENFCT', name: 'Fulfillment Core Team' },
  { key: 'DENP', name: 'Digital Enrollment Portfolio' },
  { key: 'ENCUC', name: 'Enrollment Customer Care' },
];

function renderPicker(value = '', onChoose = vi.fn()) {
  render(<ProjectKeyPicker id="test-project" projects={PROJECTS} value={value} isLoading={false} onChoose={onChoose} />);
  return onChoose;
}

const listedKeys = () => Array.from((screen.getByLabelText('Jira project') as HTMLSelectElement).options).map((option) => option.value).filter((key) => key !== '');

describe('ProjectKeyPicker', () => {
  it('lists every project key-first, sorted by key', () => {
    renderPicker();
    expect(listedKeys()).toEqual(['DENP', 'ENCUC', 'ENFCT']);
    expect(screen.getByRole('option', { name: 'DENP — Digital Enrollment Portfolio' })).toBeTruthy();
  });

  it('narrows the list to the projects matching the typed key, and says how many', () => {
    renderPicker();
    fireEvent.change(screen.getByLabelText('Find a project by key or name'), { target: { value: 'en' } });
    expect(listedKeys()).toEqual(['ENCUC', 'ENFCT', 'DENP']);
    expect(screen.getByText('3 of 3 projects match.')).toBeTruthy();
  });

  it('picks the project as soon as its whole key is typed', () => {
    const onChoose = renderPicker();
    fireEvent.change(screen.getByLabelText('Find a project by key or name'), { target: { value: 'encuc' } });
    expect(onChoose).toHaveBeenCalledWith('ENCUC');
  });

  it('picks the best match on Enter', () => {
    const onChoose = renderPicker();
    const findBox = screen.getByLabelText('Find a project by key or name');
    fireEvent.change(findBox, { target: { value: 'portfolio' } });
    fireEvent.keyDown(findBox, { key: 'Enter' });
    expect(onChoose).toHaveBeenCalledWith('DENP');
  });

  it('keeps the chosen project in the list while the search hides it, and says when nothing matches', () => {
    renderPicker('DENP');
    fireEvent.change(screen.getByLabelText('Find a project by key or name'), { target: { value: 'zzz' } });
    expect(listedKeys()).toEqual(['DENP']);
    expect(screen.getByText('No project key or name matches “zzz”.')).toBeTruthy();
  });
});
