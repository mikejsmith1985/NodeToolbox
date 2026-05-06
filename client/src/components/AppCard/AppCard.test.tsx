// AppCard.test.tsx — Unit tests for the reusable Home view app card component.

import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { AppCard } from './AppCard.tsx';

const TEST_CARD_PROPS = {
  id: 'dev-workspace',
  icon: '🏗',
  title: 'Dev Workspace',
  description: 'Track time, sync commits, and manage integrations.',
  tags: ['Jira', 'Git', 'Automation'],
  route: '/dev-workspace',
} as const;

function renderAppCard(overrideProps?: Partial<ComponentProps<typeof AppCard>>) {
  render(
    <MemoryRouter>
      <AppCard {...TEST_CARD_PROPS} {...overrideProps} />
    </MemoryRouter>,
  );
}

describe('AppCard', () => {
  it('renders the card title', () => {
    renderAppCard();

    expect(screen.getByRole('heading', { name: 'Dev Workspace' })).toBeInTheDocument();
  });

  it('renders the icon', () => {
    renderAppCard();

    expect(screen.getByText('🏗')).toBeInTheDocument();
  });

  it('renders all tags', () => {
    renderAppCard();

    TEST_CARD_PROPS.tags.forEach((tagLabel) => {
      expect(screen.getByText(tagLabel)).toBeInTheDocument();
    });
  });

  it('uses the provided route for navigation', () => {
    renderAppCard();

    expect(screen.getByRole('link')).toHaveAttribute('href', '/dev-workspace');
  });

  it('spreads drag handle props when they are provided', () => {
    renderAppCard({
      dragHandleProps: {
        id: 'drag-handle',
        title: 'Drag this card',
      },
    });

    expect(screen.getByTitle('Drag this card')).toHaveAttribute('id', 'drag-handle');
  });
});
