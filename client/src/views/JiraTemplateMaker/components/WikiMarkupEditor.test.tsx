// WikiMarkupEditor.test.tsx — Component test for the wiki-markup editor toolbar + textarea.

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import WikiMarkupEditor from './WikiMarkupEditor.tsx';

describe('WikiMarkupEditor', () => {
  it('emits typed content', () => {
    const onChange = vi.fn();
    render(<WikiMarkupEditor id="x" value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello' } });
    expect(onChange).toHaveBeenCalledWith('hello');
  });

  it('wraps content in bold wiki markup via the toolbar', () => {
    const onChange = vi.fn();
    render(<WikiMarkupEditor id="x" value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(onChange).toHaveBeenCalledWith('*bold*');
  });

  it('inserts a heading token via the toolbar', () => {
    const onChange = vi.fn();
    render(<WikiMarkupEditor id="x" value="" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'H2' }));
    expect(onChange).toHaveBeenCalledWith('h2. Heading');
  });
});
