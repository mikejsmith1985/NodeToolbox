// NlToJqlControl.test.tsx — Verifies the gated NL→JQL helper is hidden when locked and additive when unlocked.

import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setAiAssistUnlocked } from '../../../store/aiAssistStore.ts';
import { NlToJqlControl } from './NlToJqlControl.tsx';

describe('NlToJqlControl', () => {
  afterEach(() => {
    act(() => setAiAssistUnlocked(false));
  });

  it('renders nothing when AI Assist is locked (manual parity)', () => {
    const { container } = render(<NlToJqlControl projectKey="ENCUC" piName="PI 26.3" onAcceptJql={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('proposes a JQL from a valid reply and accepts it into the scope box', () => {
    act(() => setAiAssistUnlocked(true));
    const onAcceptJql = vi.fn();
    render(<NlToJqlControl projectKey="ENCUC" piName="PI 26.3" onAcceptJql={onAcceptJql} />);

    fireEvent.click(screen.getByRole('button', { name: /Ask/ }));
    fireEvent.change(screen.getByLabelText(/Paste reply/), { target: { value: '{"kind":"scopeQuery","jql":"project = ENCUC AND labels = ENCUC"}' } });
    fireEvent.click(screen.getByRole('button', { name: /Get JQL/ }));
    fireEvent.click(screen.getByRole('button', { name: /Use this query/ }));

    expect(onAcceptJql).toHaveBeenCalledWith('project = ENCUC AND labels = ENCUC');
  });

  it('shows a descriptive error on a malformed reply and proposes nothing', () => {
    act(() => setAiAssistUnlocked(true));
    const onAcceptJql = vi.fn();
    render(<NlToJqlControl projectKey="ENCUC" piName="PI 26.3" onAcceptJql={onAcceptJql} />);

    fireEvent.click(screen.getByRole('button', { name: /Ask/ }));
    fireEvent.change(screen.getByLabelText(/Paste reply/), { target: { value: 'not json' } });
    fireEvent.click(screen.getByRole('button', { name: /Get JQL/ }));

    expect(screen.getByText(/No JSON object/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Use this query/ })).not.toBeInTheDocument();
    expect(onAcceptJql).not.toHaveBeenCalled();
  });
});
