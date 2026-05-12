// HomeView.tsx — Application home page with sortable tool cards and recent-views strip.

import type { CSSProperties, HTMLAttributes } from 'react';
import { useMemo } from 'react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Link } from 'react-router-dom';

import { AppCard } from '@/components/AppCard/index.ts';
import { useSettingsStore } from '@/store/settingsStore.ts';
import styles from './HomeView.module.css';
import {
  APP_CARDS,
  APP_SECTIONS,
  RECENT_VIEW_LABELS,
} from './homeCardData.ts';
import type { AppCardDef, SectionKey } from './homeCardData.ts';

const HOME_HEADING = 'Your personal utility belt';
const HOME_SUBHEADING = 'Choose the tools that match your day and drag cards into your preferred order.';
const ACTIVE_OPACITY = 0.5;
const DEFAULT_OPACITY = 1;
const APP_CARD_BY_ID = new Map(APP_CARDS.map((cardDef) => [cardDef.id, cardDef]));
const LEGACY_RECENT_VIEW_CARD_IDS: Record<string, string> = {
  'dsu-board': 'sprint-dashboard',
};
const LEGACY_RECENT_VIEW_ROUTES: Record<string, string> = {
  'dsu-board': '/sprint-dashboard',
};

interface SortableCardProps {
  cardDef: AppCardDef;
  handleCardSelection: (cardId: string) => void;
}

interface RecentViewLinkDef {
  id: string;
  label: string;
  route: string;
}

interface RecentViewSectionProps {
  recentViewIds: string[];
  handleCardSelection: (cardId: string) => void;
}

interface SectionedHomeGridProps {
  sortedCards: AppCardDef[];
  handleCardSelection: (cardId: string) => void;
}

function SortableCard({ cardDef, handleCardSelection }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: cardDef.id,
  });
  const sortableStyle: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition: transition ?? undefined,
    opacity: isDragging ? ACTIVE_OPACITY : DEFAULT_OPACITY,
  };
  const dragHandleProps = {
    ...attributes,
    ...listeners,
  } as HTMLAttributes<HTMLDivElement>;

  return (
    <div ref={setNodeRef} style={sortableStyle} onClickCapture={() => handleCardSelection(cardDef.id)}>
      <AppCard
        id={cardDef.id}
        icon={cardDef.icon}
        title={cardDef.title}
        description={cardDef.description}
        tags={cardDef.tags}
        route={cardDef.route}
        dragHandleProps={dragHandleProps}
      />
    </div>
  );
}

function RecentViewSection({ recentViewIds, handleCardSelection }: RecentViewSectionProps) {
  const recentViewLinks = getRecentViewLinks(recentViewIds);

  if (recentViewLinks.length === 0) {
    return null;
  }

  return (
    <section className={styles.recentSection}>
      <div className={styles.recentLabel}>Recently Used</div>
      <div className={styles.recentChips}>
        {recentViewLinks.map((recentViewLink) => (
          <Link
            key={recentViewLink.id}
            className={styles.recentChip}
            onClick={() => handleCardSelection(recentViewLink.id)}
            to={recentViewLink.route}
          >
            {recentViewLink.label}
          </Link>
        ))}
      </div>
    </section>
  );
}

function SectionedHomeGrid({ sortedCards, handleCardSelection }: SectionedHomeGridProps) {
  return APP_SECTIONS.map((sectionDef) => {
    const sectionCards = getCardsForSection(sortedCards, sectionDef.key);

    if (sectionCards.length === 0) {
      return null;
    }

    return (
      <section key={sectionDef.key}>
        <div className={styles.sectionDivider}>
          <span className={styles.sectionLabel} style={{ color: sectionDef.color }}>
            {sectionDef.icon} {sectionDef.label}
          </span>
          <div className={styles.sectionLine} />
        </div>
        <div className={styles.cardGrid}>
          {sectionCards.map((cardDef) => (
            <SortableCard
              key={cardDef.id}
              cardDef={cardDef}
              handleCardSelection={handleCardSelection}
            />
          ))}
        </div>
      </section>
    );
  });
}

function getCardsForSection(cardDefs: readonly AppCardDef[], sectionKey: SectionKey): AppCardDef[] {
  return cardDefs.filter((cardDef) => cardDef.sectionKey === sectionKey);
}

function resolveRecentViewCard(recentViewId: string): AppCardDef | undefined {
  const resolvedCardId = LEGACY_RECENT_VIEW_CARD_IDS[recentViewId] ?? recentViewId;
  return APP_CARD_BY_ID.get(resolvedCardId);
}

function getRecentViewLinks(recentViewIds: readonly string[]): RecentViewLinkDef[] {
  return recentViewIds.flatMap((recentViewId) => {
    const appCard = resolveRecentViewCard(recentViewId);
    const recentViewLabel = RECENT_VIEW_LABELS[recentViewId];

    if (!recentViewLabel) {
      return [];
    }

    const route = appCard?.route ?? LEGACY_RECENT_VIEW_ROUTES[recentViewId] ?? `/${recentViewId}`;
    return [{ id: recentViewId, label: recentViewLabel, route }];
  });
}

function applySavedCardOrder(cardDefs: AppCardDef[], savedCardIds: readonly string[]): AppCardDef[] {
  if (savedCardIds.length === 0) {
    return cardDefs;
  }

  const availableCardIds = new Set(cardDefs.map((cardDef) => cardDef.id));
  const savedCards = savedCardIds.flatMap((cardId) => {
    if (!availableCardIds.has(cardId)) {
      return [];
    }

    const appCard = APP_CARD_BY_ID.get(cardId);
    return appCard ? [appCard] : [];
  });
  const savedCardIdSet = new Set(savedCards.map((cardDef) => cardDef.id));
  const missingCards = cardDefs.filter((cardDef) => !savedCardIdSet.has(cardDef.id));

  return [...savedCards, ...missingCards];
}

/** Renders the Home view card grid with recents and drag-to-reorder. */
export default function HomeView() {
  const cardOrder = useSettingsStore((state) => state.cardOrder);
  const recentViews = useSettingsStore((state) => state.recentViews);
  const setCardOrder = useSettingsStore((state) => state.setCardOrder);
  const addRecentView = useSettingsStore((state) => state.addRecentView);
  const sortedCards = useMemo(
    () => applySavedCardOrder([...APP_CARDS], cardOrder),
    [cardOrder],
  );

  function handleDragEnd(dragEvent: DragEndEvent): void {
    const { active, over } = dragEvent;
    if (!over || active.id === over.id) {
      return;
    }

    const activeCardIndex = sortedCards.findIndex((cardDef) => cardDef.id === active.id);
    const overCardIndex = sortedCards.findIndex((cardDef) => cardDef.id === over.id);
    if (activeCardIndex === -1 || overCardIndex === -1) {
      return;
    }

    const nextCardOrder = arrayMove(sortedCards, activeCardIndex, overCardIndex).map(
      (cardDef) => cardDef.id,
    );
    setCardOrder(nextCardOrder);
  }

  return (
    <div className={styles.homeView}>
      <h1 className={styles.heading}>{HOME_HEADING}</h1>
      <p className={styles.subheading}>{HOME_SUBHEADING}</p>
      <RecentViewSection recentViewIds={recentViews} handleCardSelection={addRecentView} />
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sortedCards.map((cardDef) => cardDef.id)} strategy={rectSortingStrategy}>
          <SectionedHomeGrid sortedCards={sortedCards} handleCardSelection={addRecentView} />
        </SortableContext>
      </DndContext>
    </div>
  );
}
