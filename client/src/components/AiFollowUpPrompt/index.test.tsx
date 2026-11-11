// index.test.tsx — The shared follow-up box an AI round shows when a reply strayed (GH #499).

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AiFollowUpPrompt } from './index.tsx';

describe('AiFollowUpPrompt', () => {
  it('shows nothing when there is no follow-up', () => {
    const { container } = render(<AiFollowUpPrompt followUpPrompt="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the follow-up and copies it', () => {
    const writeText = vi.fn(async (_copiedText: string) => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<AiFollowUpPrompt followUpPrompt="Your last reply was not in the form I need." />);

    expect(screen.getByLabelText('Follow-up for the same AI chat')).toHaveValue('Your last reply was not in the form I need.');
    fireEvent.click(screen.getByRole('button', { name: /Copy the follow-up/ }));
    expect(writeText).toHaveBeenCalledWith('Your last reply was not in the form I need.');
    expect(screen.queryByRole('button', { name: /^Copy part 1 of \d+$/ })).toBeNull();
  });

  it('offers a follow-up too long for AI Mode\'s box in parts that each fit AI Mode (GH #499)', () => {
    render(<AiFollowUpPrompt followUpPrompt={'Row | ___ | ___\n'.repeat(200)} />);
    expect(screen.getByRole('button', { name: /^Copy part 1 of \d+$/ })).toBeInTheDocument();
  });
});
