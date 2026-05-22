// ViewFrame.test.tsx — Tests for the shared responsive page wrapper component.

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import ViewFrame from './ViewFrame.tsx';
import styles from './ViewFrame.module.css';

describe('ViewFrame', () => {
  it('renders the title, subtitle, and body content', () => {
    render(
      <ViewFrame subtitle="Shared subtitle" title="Shared title">
        <div>Wrapped content</div>
      </ViewFrame>,
    );

    expect(screen.getByRole('heading', { name: 'Shared title' })).toBeInTheDocument();
    expect(screen.getByText('Shared subtitle')).toBeInTheDocument();
    expect(screen.getByText('Wrapped content')).toBeInTheDocument();
  });

  it('applies width and header alignment variants', () => {
    const { container } = render(
      <ViewFrame headerAlign="center" title="Centered title" width="wide">
        <div>Content</div>
      </ViewFrame>,
    );

    const viewFrameElement = container.firstElementChild;
    expect(viewFrameElement).toHaveClass(styles.viewFrame);
    expect(viewFrameElement).toHaveClass(styles.widthWide);
    expect(screen.getByRole('heading', { name: 'Centered title' }).parentElement).toHaveClass(styles.headerCenter);
  });
});
