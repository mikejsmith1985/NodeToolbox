// CodeWalkthroughView.tsx — Static documentation view with sidebar TOC, search, and guided tour.

import { useState } from 'react';
import styles from './CodeWalkthroughView.module.css';

/** A single section in the code walkthrough documentation. */
interface WalkthroughSection {
  id: string;
  title: string;
  emoji: string;
  content: string;
}

const WALKTHROUGH_SECTIONS: WalkthroughSection[] = [
  {
    id: 'architecture',
    title: 'Architecture',
    emoji: '🏗️',
    content: `
      NodeToolbox Architecture is built as a React + TypeScript SPA with a Vite build pipeline.
      The architecture follows a clean separation between views, hooks, services, and types.
      Each view manages its own state through a dedicated hook following the { state, actions } pattern.
      The backend is a Node.js Express proxy that forwards Jira and ServiceNow API calls
      to avoid CORS issues and centralise authentication. The architecture uses React Router
      for client-side navigation and CSS Modules with design tokens for consistent styling.
    `,
  },
  {
    id: 'security-model',
    title: 'Security Model',
    emoji: '🔒',
    content: `
      The Security Model in NodeToolbox ensures all credentials are stored server-side only.
      The Express proxy handles authentication headers so the browser never sees raw API tokens.
      The security model requires that all Jira and SNow requests pass through the proxy,
      which validates the session before forwarding. Personal access tokens are stored in
      environment variables on the server and never exposed to the React client. The security
      model also enforces CORS policies so only the local development origin can call the proxy.
    `,
  },
  {
    id: 'data-flow',
    title: 'Data Flow',
    emoji: '🔄',
    content: `
      Data Flow in NodeToolbox moves from the Jira/SNow APIs through the proxy server to
      the React hooks. The data flow begins when a view mounts: the hook calls jiraGet or
      snowGet, which calls fetch() with the proxy base URL. The proxy then appends credentials
      and forwards the request upstream. Responses arrive as typed objects matching the JiraIssue
      or SnowTicket interfaces. The data flow continues into component state managed by
      useState and useCallback hooks, then rendered through pure functional components.
    `,
  },
  {
    id: 'api-usage',
    title: 'API Usage',
    emoji: '🔌',
    content: `
      API Usage in NodeToolbox is centralised in the services directory. The jiraApi.ts service
      exports jiraGet and jiraPost for all Jira REST API calls. The snowApi.ts service handles
      ServiceNow table API and record operations. All API usage routes through the proxy so
      authentication is transparent to the view layer. API usage patterns include paginated
      JQL searches, board sprint listings, issue detail fetches, and comment post operations.
      Each API usage call is typed with generics so TypeScript catches shape mismatches.
    `,
  },
  {
    id: 'tool-breakdown',
    title: 'Tool Breakdown',
    emoji: '🧰',
    content: `
      Tool Breakdown covers the main tools and frameworks used in NodeToolbox. React 18 provides
      the component model and hooks API. TypeScript adds static type checking. Vite handles
      bundling and HMR. Vitest and React Testing Library cover unit and integration tests.
      The tool breakdown also includes Zustand for global settings state, React Router for
      navigation, and CSS Modules for scoped styling. The tool breakdown is intentionally
      minimal — no Redux, no GraphQL, no heavy ORM — to keep the codebase approachable.
    `,
  },
  {
    id: 'relay-deep-dive',
    title: 'Relay Deep Dive',
    emoji: '🌉',
    content: `
      The Relay Deep Dive explains the relay bridge mechanism that connects the React SPA
      to the SNow relay service. The relay deep dive covers how useRelayBridge polls the
      relay endpoint at a configurable interval and pushes updates into the connection store.
      The relay system uses a lightweight WebSocket-like protocol over HTTP long-polling.
      Relay deep dive topics include reconnection logic, message serialisation, and the
      RelaySystem type union that drives relay configuration. The relay bridge abstraction
      means views do not need to know whether data comes from Jira or a relay-forwarded source.
    `,
  },
  {
    id: 'jira-write-operations',
    title: 'Jira Write Operations',
    emoji: '✏️',
    content: `
      Jira Write Operations in NodeToolbox cover comment posting, worklog creation, and
      status transitions. All jira write operations use the jiraPost function from jiraApi.ts.
      The most common jira write operations are posting comments to issues (used by the
      Git Sync manual post feature) and logging work time. Write operations require the
      proxy to have a user account with appropriate Jira permissions. Jira write operations
      are auditable because every post includes a standardised comment body with a
      NodeToolbox attribution footer.
    `,
  },
  {
    id: 'snow-write-operations',
    title: 'SNow Write Operations',
    emoji: '❄️',
    content: `
      SNow Write Operations cover the ServiceNow table API calls that create or update records.
      Snow write operations in NodeToolbox include posting comments to incidents and updating
      assignment groups. All snow write operations go through the snowApi.ts service and the
      Express proxy. The snow write operations use Basic Auth credentials stored in environment
      variables. Write guards in the proxy ensure that snow write operations only modify
      records in approved table types (incident, problem, change_request). All snow write
      operations return the updated record for optimistic UI reconciliation.
    `,
  },
];

const TOUR_STEPS = WALKTHROUGH_SECTIONS.map((section) => section.id);

/** Static code walkthrough documentation view with TOC sidebar, search, and guided tour. */
export default function CodeWalkthroughView() {
  const [searchQuery, setSearchQuery] = useState('');
  const [isTourActive, setIsTourActive] = useState(false);
  const [tourStepIndex, setTourStepIndex] = useState(0);

  const normalizedQuery = searchQuery.toLowerCase().trim();
  const filteredSections = normalizedQuery
    ? WALKTHROUGH_SECTIONS.filter(
        (section) =>
          section.title.toLowerCase().includes(normalizedQuery) ||
          section.content.toLowerCase().includes(normalizedQuery),
      )
    : WALKTHROUGH_SECTIONS;

  function handleStartTour() {
    setIsTourActive(true);
    setTourStepIndex(0);
  }

  function handleTourNext() {
    setTourStepIndex((previous) => Math.min(previous + 1, TOUR_STEPS.length - 1));
  }

  function handleTourExit() {
    setIsTourActive(false);
    setTourStepIndex(0);
  }

  const currentTourSection = isTourActive ? TOUR_STEPS[tourStepIndex] : null;

  return (
    <div className={styles.walkthroughView}>
      <div className={styles.topBar}>
        <h1 className={styles.pageTitle}>Code Walkthrough</h1>
        <div className={styles.topBarControls}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search documentation…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {!isTourActive && (
            <button className={styles.tourBtn} onClick={handleStartTour}>
              Start Guided Tour
            </button>
          )}
        </div>
      </div>

      {isTourActive && (
        <div className={styles.tourBar}>
          <span className={styles.tourProgress}>
            Step {tourStepIndex + 1} of {TOUR_STEPS.length}: {WALKTHROUGH_SECTIONS[tourStepIndex]?.title}
          </span>
          <div className={styles.tourControls}>
            <button className={styles.tourNextBtn} onClick={handleTourNext} disabled={tourStepIndex >= TOUR_STEPS.length - 1}>
              Next
            </button>
            <button className={styles.tourExitBtn} onClick={handleTourExit}>
              Exit Tour
            </button>
          </div>
        </div>
      )}

      <div className={styles.layout}>
        <nav className={styles.sidebar}>
          <ul className={styles.tocList}>
            {WALKTHROUGH_SECTIONS.map((section) => (
              <li key={section.id} className={styles.tocItem}>
                <a
                  href={`#${section.id}`}
                  className={`${styles.tocLink} ${currentTourSection === section.id ? styles.tocLinkActive : ''}`}
                >
                  {section.emoji} {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className={styles.content}>
          {filteredSections.length === 0 && (
            <p className={styles.noResults}>No results found for "{searchQuery}"</p>
          )}
          {filteredSections.map((section) => (
            <section
              key={section.id}
              id={section.id}
              className={`${styles.docSection} ${currentTourSection === section.id ? styles.docSectionHighlighted : ''}`}
            >
              <h2 className={styles.sectionHeading}>
                {section.emoji} {section.title}
              </h2>
              <p className={styles.sectionContent}>{section.content}</p>
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
