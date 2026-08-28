// ReportVisuals.test.tsx — The shapes every report draws with.

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  DistributionBar,
  EmptyNote,
  MeterList,
  ReportPanel,
  StatCards,
} from './ReportVisuals.tsx';

describe('ReportPanel', () => {
  it('carries a title and a caption saying how to read it', () => {
    render(<ReportPanel caption="How to read this." title="Where work piles up"><p>body</p></ReportPanel>);

    expect(screen.getByText('Where work piles up')).toBeInTheDocument();
    expect(screen.getByText('How to read this.')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });

  it('renders without a caption when there is nothing to explain', () => {
    render(<ReportPanel title="Plain"><p>body</p></ReportPanel>);

    expect(screen.getByText('Plain')).toBeInTheDocument();
  });
});

describe('StatCards', () => {
  it('shows the label, the figure and what it is measured against', () => {
    render(<StatCards stats={[{ label: 'The constraint', value: 'Ready for Testing', context: '4 issues' }]} />);

    expect(screen.getByText('The constraint')).toBeInTheDocument();
    expect(screen.getByText('Ready for Testing')).toBeInTheDocument();
    expect(screen.getByText('4 issues')).toBeInTheDocument();
  });

  it('renders a card with no context at all', () => {
    render(<StatCards stats={[{ label: 'Open', value: '12' }]} />);

    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('renders every card it is given', () => {
    render(<StatCards stats={[{ label: 'A', value: '1' }, { label: 'B', value: '2' }, { label: 'C', value: '3' }]} />);

    ['A', 'B', 'C'].forEach((label) => expect(screen.getByText(label)).toBeInTheDocument());
  });
});

describe('MeterList', () => {
  it('names each bar and the figure behind it', () => {
    render(<MeterList rows={[{ name: 'Ready for Testing', value: 112, valueLabel: '4 issues · 112d' }]} />);

    expect(screen.getByText('Ready for Testing')).toBeInTheDocument();
    expect(screen.getByText('4 issues · 112d')).toBeInTheDocument();
  });

  it('draws every row it is given', () => {
    render(<MeterList rows={[
      { name: 'A', value: 10, valueLabel: '10' },
      { name: 'B', value: 5, valueLabel: '5' },
    ]} />);

    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('survives a set of rows that are all zero, rather than dividing by nothing', () => {
    expect(() => render(<MeterList rows={[{ name: 'A', value: 0, valueLabel: '0' }]} />)).not.toThrow();
  });

  it('renders nothing but survives an empty list', () => {
    expect(() => render(<MeterList rows={[]} />)).not.toThrow();
  });
});

describe('DistributionBar', () => {
  it('names every slice and its count in the legend', () => {
    // A thin slice must still be readable, rather than being a colour nobody can name.
    render(<DistributionBar slices={[{ name: 'In Progress', count: 16 }, { name: 'Cancelled', count: 1 }]} />);

    expect(screen.getByText('In Progress — 16')).toBeInTheDocument();
    expect(screen.getByText('Cancelled — 1')).toBeInTheDocument();
  });

  it('says there is nothing to show rather than drawing an empty bar', () => {
    render(<DistributionBar slices={[]} />);

    expect(screen.getByText(/no items fell into any of these/)).toBeInTheDocument();
  });

  it('treats all-zero counts as nothing to show', () => {
    render(<DistributionBar slices={[{ name: 'A', count: 0 }]} />);

    expect(screen.getByText(/no items fell into any of these/)).toBeInTheDocument();
  });

  it('labels each segment for a reader who hovers it', () => {
    const { container } = render(<DistributionBar slices={[{ name: 'In Progress', count: 16 }]} />);

    expect(container.querySelector('[title="In Progress: 16"]')).not.toBeNull();
  });
});

describe('EmptyNote', () => {
  it('says what was not found, rather than leaving a reader unsure it is broken', () => {
    render(<EmptyNote>No open work was found.</EmptyNote>);

    expect(screen.getByText('No open work was found.')).toBeInTheDocument();
  });
});

describe('the panels together', () => {
  it('read as one card: title, caption, then the drawing', () => {
    render(
      <ReportPanel caption="Ranked by accumulated waiting." title="Where work piles up">
        <MeterList rows={[{ name: 'Ready for Testing', value: 112, valueLabel: '112d' }]} />
      </ReportPanel>,
    );

    const panel = screen.getByText('Where work piles up').closest('section') as HTMLElement;

    expect(within(panel).getByText('Ranked by accumulated waiting.')).toBeInTheDocument();
    expect(within(panel).getByText('Ready for Testing')).toBeInTheDocument();
  });
});
