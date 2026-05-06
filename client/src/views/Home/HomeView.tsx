// HomeView.tsx — Application home page with persona-aware, sortable tool cards.

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
  PERSONA_CARD_ORDERS,
  RECENT_VIEW_LABELS,
} from './homeCardData.ts';
import type { AppCardDef, SectionKey } from './homeCardData.ts';

const HOME_HEADING = 'Your personal utility belt';
const HOME_SUBHEADING = 'Choose the tools that match your day and drag cards into your preferred order.';
const PERSONA_ALL = 'all';
const REPORTS_CARD_ID = 'reports-hub';
const ADMIN_CARD_ID = 'admin-hub';
const ACTIVE_OPACITY = 0.5;
const DEFAULT_OPACITY = 1;
const PERSONA_OPTIONS = [
  { id: 'all', label: 'All', icon: '🧰' },
  { id: 'dev', label: 'Dev', icon: '👨‍💻' },
  { id: 'qa', label: 'QA', icon: '🧪' },
  { id: 'sm', label: 'SM', icon: '🧭' },
  { id: 'po', label: 'PO', icon: '📌' },
  { id: 'rte', label: 'RTE', icon: '🚂' },
] as const;
const APP_CARD_BY_ID = new Map(APP_CARDS.map((cardDef) => [cardDef.id, cardDef]));
const FIXED_SECTION_CARD_IDS: Partial<Record<SectionKey, string>> = {
  reports: REPORTS_CARD_ID,
  admin: ADMIN_CARD_ID,
};
const LEGACY_RECENT_VIEW_CARD_IDS: Record<string, string> = {
  'dsu-board': 'sprint-dashboard',
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

interface PersonaFilterStripProps {
  activePersona: string;
  handlePersonaSelection: (personaId: string) => void;
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

function PersonaFilterStrip({ activePersona, handlePersonaSelection }: PersonaFilterStripProps) {
  return (
    <div className={styles.personaStrip}>
      {PERSONA_OPTIONS.map((personaOption) => {
        const isActivePersona = activePersona === personaOption.id;
        const buttonClassName = isActivePersona
          ? `${styles.personaBtn} ${styles.active}`
          : styles.personaBtn;

        return (
          <button
            key={personaOption.id}
            className={buttonClassName}
            onClick={() => handlePersonaSelection(personaOption.id)}
            type="button"
          >
            {personaOption.icon} {personaOption.label}
          </button>
        );
      })}
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

    if (!appCard || !recentViewLabel) {
      return [];
    }

    return [{ id: recentViewId, label: recentViewLabel, route: appCard.route }];
  });
}

function groupCardsBySection(cardDefs: readonly AppCardDef[]): Map<SectionKey, AppCardDef[]> {
  return cardDefs.reduce((cardsBySection, cardDef) => {
    const existingSectionCards = cardsBySection.get(cardDef.sectionKey) ?? [];
    cardsBySection.set(cardDef.sectionKey, [...existingSectionCards, cardDef]);
    return cardsBySection;
  }, new Map<SectionKey, AppCardDef[]>());
}

function getPersonaCards(homePersona: string): AppCardDef[] {
  if (homePersona === PERSONA_ALL) {
    return [...APP_CARDS];
  }

  const personaCardOrder = PERSONA_CARD_ORDERS[homePersona] ?? PERSONA_CARD_ORDERS[PERSONA_ALL];
  const orderedPersonaCards = personaCardOrder.flatMap((cardId) => {
    const appCard = APP_CARD_BY_ID.get(cardId);
    return appCard ? [appCard] : [];
  });
  const cardsBySection = groupCardsBySection(orderedPersonaCards);

  // Reports and Admin stay anchored to their original sections even when personas reprioritize the rest.
  return APP_SECTIONS.flatMap((sectionDef) => {
    const fixedSectionCardId = FIXED_SECTION_CARD_IDS[sectionDef.key];
    if (fixedSectionCardId) {
      const fixedSectionCard = APP_CARD_BY_ID.get(fixedSectionCardId);
      return fixedSectionCard ? [fixedSectionCard] : [];
    }

    return cardsBySection.get(sectionDef.key) ?? [];
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

/** Renders the Home view card grid with persona filters, recents, and drag ordering. */
export default function HomeView() {
  const homePersona = useSettingsStore((state) => state.homePersona);
  const cardOrder = useSettingsStore((state) => state.cardOrder);
  const recentViews = useSettingsStore((state) => state.recentViews);
  const setHomePersona = useSettingsStore((state) => state.setHomePersona);
  const setCardOrder = useSettingsStore((state) => state.setCardOrder);
  const addRecentView = useSettingsStore((state) => state.addRecentView);
  const sortedCards = useMemo(
    () => applySavedCardOrder(getPersonaCards(homePersona), cardOrder),
    [cardOrder, homePersona],
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
      <PersonaFilterStrip activePersona={homePersona} handlePersonaSelection={setHomePersona} />
      <RecentViewSection recentViewIds={recentViews} handleCardSelection={addRecentView} />
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={sortedCards.map((cardDef) => cardDef.id)} strategy={rectSortingStrategy}>
          {homePersona === PERSONA_ALL ? (
            <SectionedHomeGrid sortedCards={sortedCards} handleCardSelection={addRecentView} />
          ) : (
            <div className={styles.flatGrid}>
              {sortedCards.map((cardDef) => (
                <SortableCard
                  key={cardDef.id}
                  cardDef={cardDef}
                  handleCardSelection={addRecentView}
                />
              ))}
            </div>
          )}
        </SortableContext>
      </DndContext>
    </div>
  );
}
