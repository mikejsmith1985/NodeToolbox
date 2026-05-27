// CodeWalkthroughView.tsx — Static documentation view with sidebar TOC, search, and guided tour.

import { useState } from 'react';
import styles from './CodeWalkthroughView.module.css';

/** A step-by-step workflow guide rendered inside one documentation section. */
interface WalkthroughPlaybook {
  title: string;
  steps: readonly string[];
}

/** A single section in the code walkthrough documentation. */
interface WalkthroughSection {
  id: string;
  title: string;
  emoji: string;
  summary: string;
  featureHighlights?: readonly string[];
  workflowPlaybooks?: readonly WalkthroughPlaybook[];
  troubleshootingTips?: readonly string[];
}

const WALKTHROUGH_SECTIONS: WalkthroughSection[] = [
  {
    id: 'architecture',
    title: 'Architecture',
    emoji: '🏗️',
    summary:
      'NodeToolbox is a local-first React + TypeScript application served by a Node.js Express proxy. The client is organized into workspaces such as Team Dashboard, ART View, My Issues, Reports Hub, SNow Hub, Business Helper, Dev Workspace, Text Tools, Admin Hub, Personal Toolbox, and Code Walkthrough. Most workspaces follow the same pattern: a top-level view, focused tabs or panels, a dedicated state hook, and typed service helpers that talk to localhost proxy routes instead of calling enterprise systems directly from the browser.',
  },
  {
    id: 'workspace-guide',
    title: 'Workspace Guide',
    emoji: '🧭',
    summary:
      'Team Dashboard owns team-level sprint execution, feature review, PI Review authoring, and release readiness. ART View owns the cross-team train picture, including dependencies, blueprint hierarchy, monthly reporting, and PI Review readouts. My Issues is the personal work queue with hygiene and linked ServiceNow context. Reports Hub serves leadership-ready reporting views. Business Helper provides simple Jira search and the Stablization funding workflow. Dev Workspace covers time tracking, Git sync, and repo monitoring. SNow Hub handles change, problem, release, and sync workflows. Text Tools provides transformation utilities, while Admin Hub covers setup, standards, diagnostics, backup, and visibility.',
  },
  {
    id: 'team-dashboard-features',
    title: 'Team Dashboard Features',
    emoji: '🏃',
    summary:
      'Team Dashboard is the team execution hub. It combines sprint overview, assignee grouping, blocker review, defect review, standup support, metrics, pipeline visibility, planning, pointing, Feature Review, PI Review, release readiness, and settings in one board-scoped workspace. It is also one of the main write-heavy surfaces because feature hygiene fixes, direct status transitions, PI Review authoring, and release-note workflows all happen there.',
    featureHighlights: [
      'Overview, blockers, defects, and metrics keep one team focused on the current sprint.',
      'Feature Review combines hygiene flags, child rollups, direct fixes, and direct status transitions.',
      'PI Review and Releases cover the board-scoped planning and release storytelling workflows.',
    ],
    workflowPlaybooks: [
      {
        title: 'Feature Review cleanup',
        steps: [
          'Open Team Dashboard and confirm the correct board and scope are loaded.',
          'Select Feature Review and sort or scan for the features that still show hygiene flags.',
          'Open the direct-fix panel on a flagged feature and apply the needed field or status change.',
          'Refresh the card state and confirm the hygiene badges clear before moving to the next feature.',
        ],
      },
      {
        title: 'PI Review authoring',
        steps: [
          'Open the PI Review tab after confirming the dashboard is attached to the correct team board.',
          'Update capacity first so the same snapshot feeds feature scope and confidence discussions.',
          'Edit the PI rows, confidence values, or carryover content that changed during planning.',
          'Save to the shared PI Review flow and confirm the team content is ready for the ART readout.',
        ],
      },
      {
        title: 'Release readiness and notes',
        steps: [
          'Open Releases and review the current fix-version readiness buckets for overdue or watch items.',
          'Build the release-note prompt once the release contents look correct.',
          'Paste the returned response back into the release workflow and verify the rendered table.',
          'Export the final release view when the draft is ready to share.',
        ],
      },
    ],
    troubleshootingTips: [
      'If Feature Review data looks incomplete, confirm the board, project key, and scope mode still point to the intended team.',
      'If a PI Review page does not appear, check that the team board is mapped in ART Settings and that the PI Review page URL is configured.',
      'If release buckets look stale, refresh the dashboard after confirming the active sprint or fix version still matches the work you expect to see.',
    ],
  },
  {
    id: 'art-view-features',
    title: 'ART View Features',
    emoji: '🚂',
    summary:
      'ART View owns the train-level picture. It brings together overview, impediments, predictability, releases, PI Review readout, blueprint hierarchy, dependencies, board prep, Scrum-of-Scrums support, monthly reporting, and ART settings. It is the best place to understand cross-team relationships and the current state of a PI without dropping into each individual team board.',
    featureHighlights: [
      'PI Review is the shared readout surface for multi-team Confluence-backed content.',
      'Blueprint and Dependencies provide the best hierarchy and linkage visibility above one team board.',
      'Settings keeps the ART roster, PI values, and page references aligned for every other ART workflow.',
    ],
    workflowPlaybooks: [
      {
        title: 'PI Review readout and export',
        steps: [
          'Open ART View and load the PI Review area for the teams you want to review.',
          'Confirm each team page resolves and that the latest Jira-backed values have been reconciled.',
          'Review feature rows, confidence history, and capacity snapshots with the train audience.',
          'Export the team panel as PNG or CSV when a shareable readout is needed.',
        ],
      },
      {
        title: 'Dependency review',
        steps: [
          'Open Dependencies and choose the lens that matches the conversation, such as team-to-team or by feature.',
          'Filter to the relationships that matter for the current PI or release discussion.',
          'Use the dependency output to identify the teams that need follow-up before the next planning checkpoint.',
        ],
      },
      {
        title: 'Monthly reporting starter',
        steps: [
          'Open Monthly Report after refreshing the latest ART data.',
          'Review the generated narrative starter against the most recent train accomplishments and risks.',
          'Copy or refine the summary before moving it into the formal reporting channel.',
        ],
      },
    ],
    troubleshootingTips: [
      'If a team PI Review panel is missing, confirm the team still exists in ART Settings and that the Confluence page reference is valid.',
      'If dependency views feel empty, make sure the underlying teams and project filters still include the work you expect to compare.',
      'If PI timing looks wrong, check the configured PI name and end date in ART Settings before reviewing urgency-based signals.',
    ],
  },
  {
    id: 'personal-work-features',
    title: 'Personal Work Features',
    emoji: '📋',
    summary:
      'My Issues, Reports Hub, and Personal Toolbox cover different kinds of personal or role-based visibility. My Issues is the individual work queue with hygiene, exports, bulk comments, and linked ServiceNow context. Reports Hub is the leadership reporting surface with dashboard, feature, defect, risk, flow, quality, sprint health, throughput, and individual views. Personal Toolbox lets a user compose their own workspace from the major modules instead of navigating across the full app every time.',
    featureHighlights: [
      'My Issues is the fastest place to work your own queue across multiple sourcing options.',
      'Reports Hub turns ART-wide issue data into copy-friendly reporting views.',
      'Personal Toolbox reduces navigation friction by letting one user build a custom tab bar.',
    ],
    workflowPlaybooks: [
      {
        title: 'Personal issue triage',
        steps: [
          'Open My Issues and choose the source that matches the current review, such as Mine, JQL, Saved Filter, or Board.',
          'Switch to the layout that best fits the task, such as cards for scanning or table for detailed review.',
          'Use status zones and sorting to narrow attention to the items that need action first.',
          'Open issue details, post bulk comments, or move into the Hygiene tab when data quality needs attention.',
        ],
      },
      {
        title: 'Leadership report preparation',
        steps: [
          'Open Reports Hub and load the report that matches the meeting outcome you need, such as Feature, Flow, or Sprint Health.',
          'Apply PI and team filters before discussing the numbers so the view reflects the right audience.',
          'Use the built-in report explainer to confirm the meaning of the current tab.',
          'Copy the report output once the view is narrowed to the exact slice you want to share.',
        ],
      },
      {
        title: 'Personal Toolbox setup',
        steps: [
          'Open Personal Toolbox and enter the builder panel.',
          'Toggle on the modules you want in your personal tab bar and remove the ones you rarely use.',
          'Reorder the active modules so your most common workflows appear first.',
          'Return to the tab strip and use the customized workspace as your daily landing area.',
        ],
      },
    ],
    troubleshootingTips: [
      'If My Issues returns less work than expected, verify the current source, board, or saved filter before assuming the queue is empty.',
      'If a Reports Hub view looks stale, reload the report after checking that the ART team configuration still matches the intended scope.',
      'If a Personal Toolbox tab disappears, confirm the module is still selected in the builder and was not removed from your saved order.',
    ],
  },
  {
    id: 'operations-features',
    title: 'Operations Features',
    emoji: '🛡️',
    summary:
      'SNow Hub, Dev Workspace, Admin Hub, Release Monitor, and the focused standup surfaces support operational execution. SNow Hub covers change, problem, release, and sync work. Dev Workspace covers timers, Git sync, hygiene, and monitor status. Admin Hub manages setup, standards, diagnostics, backup, demo mode, and visibility. Release Monitor gives a smaller fix-version-focused readiness view, and the standup boards keep daily review workflows lightweight when users do not need the whole Team Dashboard.',
    featureHighlights: [
      'SNow Hub is where Jira-backed change and problem workflows meet ServiceNow operations.',
      'Dev Workspace owns timers, commit-to-Jira automation, and scheduler-backed monitoring.',
      'Admin Hub centralizes platform setup, standards, diagnostics, backup, and visibility controls.',
    ],
    workflowPlaybooks: [
      {
        title: 'SNow change creation',
        steps: [
          'Open SNow Hub and start in CHG when you need to build a change request from Jira-backed release inputs.',
          'Walk through the wizard in order so the review step has complete issue, planning, and environment information.',
          'Confirm the generated fields before submission to avoid rework in ServiceNow after the change is created.',
        ],
      },
      {
        title: 'Dev Workspace Git sync review',
        steps: [
          'Open Dev Workspace and review the Settings tab so the repository, Jira project key, and polling rules are correct.',
          'Use Git Sync to start or review the polling behavior that turns matching commits into Jira updates.',
          'Check Repo Monitor for recent automation health and run history when you need to confirm the scheduler path is working.',
        ],
      },
      {
        title: 'Admin safety backup',
        steps: [
          'Open Admin Hub before a risky settings change or a demo reset.',
          'Use Backup and Restore to export the current durable settings snapshot.',
          'Apply the configuration change or launch demo mode only after the backup file is created.',
          'Restore from the saved file if the environment needs to return to the previous state.',
        ],
      },
    ],
    troubleshootingTips: [
      'If SNow workflows fail to load expected options, confirm the ServiceNow connection and credentials from Admin Hub or Settings.',
      'If Git Sync does not post updates, check the repository identifier, authentication, and commit-key pattern before changing the scheduler.',
      'If diagnostics show missing services, review Admin Hub connection settings before assuming the problem is in a feature workflow.',
    ],
  },
  {
    id: 'utility-features',
    title: 'Utility Features',
    emoji: '🛠️',
    summary:
      'Business Helper and Text Tools focus on speed and accessibility. Business Helper wraps Jira in business-friendly search and the Stablization funding workflow, including mappings, dropdowns, custom columns, and local drafts. Text Tools provides quick formatting, conversion, encoding, decoding, and extraction helpers for day-to-day copy-paste work.',
    featureHighlights: [
      'Business Helper turns Jira search and funding-table work into a guided workflow for non-technical users.',
      'Text Tools handles the short-lived formatting and extraction tasks that otherwise waste time in external tools.',
    ],
    workflowPlaybooks: [
      {
        title: 'Business Helper search to funding table',
        steps: [
          'Open Business Helper and start in Simple Search with a plain-language keyword.',
          'Expand the grouped results until you find the Jira item you want to move into the funding workflow.',
          'Use Send to Stablization so the mapped values populate the funding table automatically.',
          'Adjust formulas, custom columns, or dropdown-backed fields inside the Stablization tab before saving the draft locally.',
        ],
      },
      {
        title: 'Text Tools payload cleanup',
        steps: [
          'Choose the Text Tools tab that matches the payload type, such as JSON, URL, Base64, or Smart Formatter.',
          'Paste the source text into the input panel and confirm the transformed output looks correct.',
          'Copy the cleaned output immediately so you can reuse it in Jira, ServiceNow, or reporting workflows.',
        ],
      },
    ],
    troubleshootingTips: [
      'If Business Helper values do not land in the right funding columns, review the field-mapping settings before editing rows manually.',
      'If a Text Tools output looks wrong, confirm you selected the correct transformation tab and mode before assuming the input is bad.',
      'If the ServiceNow extractor flow returns incomplete payloads, re-run the bookmarklet on the target page before copying the filtered result.',
    ],
  },
  {
    id: 'security-model',
    title: 'Security Model',
    emoji: '🔒',
    summary:
      'The security model keeps Jira, ServiceNow, GitHub, and Confluence credentials out of browser code. The React app talks to localhost proxy routes, and the Express server injects credentials on the backend before forwarding requests upstream. That design keeps raw tokens and passwords out of the client bundle, centralizes write guards for sensitive operations, and makes it easier to audit which systems NodeToolbox is allowed to update.',
  },
  {
    id: 'data-flow',
    title: 'Data Flow',
    emoji: '🔄',
    summary:
      'Data flow starts in a view or workspace hook. The hook calls a client service helper, the helper calls a localhost route, the proxy injects credentials and forwards the request, and the typed response comes back into the hook and then into the UI. This pattern is used across Jira issue loading, ServiceNow synchronization, Confluence-backed PI Review content, and GitHub-backed automation status so the frontend stays modular without taking ownership of authentication.',
  },
  {
    id: 'api-usage',
    title: 'API Usage',
    emoji: '🔌',
    summary:
      'API usage is centralized in client service helpers and view-specific hooks. Jira helpers cover issue search, board data, transitions, work logs, feature metadata, and fix-version workflows. ServiceNow helpers cover problem, change, release, and sync operations. The same proxy-first pattern also supports GitHub scheduler endpoints and Confluence-backed PI Review save/load flows. Keeping those calls in helpers reduces copy-paste logic across the larger workspace views.',
  },
  {
    id: 'tool-breakdown',
    title: 'Tool Breakdown',
    emoji: '🧰',
    summary:
      'The technology stack stays intentionally straightforward: React 18 for views, TypeScript for typed data contracts, Vite for frontend builds, Vitest and React Testing Library for client validation, Zustand for shared settings, React Router for workspace routing, and CSS Modules for scoped styling. The product side is similarly modular: large hub views own tab composition, smaller helper components own focused interactions, and hooks keep fetch-and-state logic out of the layout code where possible.',
  },
  {
    id: 'relay-deep-dive',
    title: 'Relay Deep Dive',
    emoji: '🌉',
    summary:
      'Some NodeToolbox workflows need live operational updates without requiring every view to own its own polling behavior. The relay pattern isolates that concern into shared bridge logic so a workspace can subscribe to current status without re-implementing transport details. In practice, that keeps status displays, connectivity surfaces, and sync monitors simpler because they consume a prepared state model instead of low-level network events.',
  },
  {
    id: 'jira-write-operations',
    title: 'Jira Write Operations',
    emoji: '✏️',
    summary:
      'Jira write paths include issue field updates, direct status transitions, work-log posting, comment posting, PI Review date synchronization, and feature hygiene fixes. Those writes are intentionally routed through shared helpers so the app can reuse field IDs, preserve consistent payload shapes, and keep sensitive operations away from ad hoc browser-side fetch logic. Several workspaces depend on those writes, especially Team Dashboard, ART View PI Review, My Issues, and Dev Workspace.',
  },
  {
    id: 'snow-write-operations',
    title: 'SNow Write Operations',
    emoji: '❄️',
    summary:
      'ServiceNow write paths support change-request generation, problem record handling, release coordination, assignment updates, and comment or sync-related updates. The SNow Hub uses those guarded write operations heavily, but related workflows also appear in My Issues and operational support flows. Keeping those writes behind the proxy lets NodeToolbox enforce approved table targets and keep credentials outside the browser while still giving users fast, workflow-specific tooling.',
  },
];

function buildSectionSearchText(section: WalkthroughSection): string {
  const playbookText = (section.workflowPlaybooks ?? []).flatMap((playbook) => [
    playbook.title,
    ...playbook.steps,
  ]);
  return [
    section.title,
    section.summary,
    ...(section.featureHighlights ?? []),
    ...playbookText,
    ...(section.troubleshootingTips ?? []),
  ]
    .join(' ')
    .toLowerCase();
}

function renderFeatureHighlights(featureHighlights: readonly string[]) {
  return (
    <div className={styles.sectionBlock}>
      <h3 className={styles.sectionSubheading}>Feature highlights</h3>
      <ul className={styles.detailList}>
        {featureHighlights.map((featureHighlight) => (
          <li key={featureHighlight} className={styles.detailListItem}>
            {featureHighlight}
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderWorkflowPlaybooks(workflowPlaybooks: readonly WalkthroughPlaybook[]) {
  return (
    <div className={styles.sectionBlock}>
      <h3 className={styles.sectionSubheading}>Workflow playbooks</h3>
      <div className={styles.playbookList}>
        {workflowPlaybooks.map((workflowPlaybook) => (
          <article key={workflowPlaybook.title} className={styles.playbookCard}>
            <h4 className={styles.playbookHeading}>{workflowPlaybook.title}</h4>
            <ol className={styles.playbookSteps}>
              {workflowPlaybook.steps.map((workflowStep) => (
                <li key={workflowStep} className={styles.detailListItem}>
                  {workflowStep}
                </li>
              ))}
            </ol>
          </article>
        ))}
      </div>
    </div>
  );
}

function renderTroubleshootingTips(troubleshootingTips: readonly string[]) {
  return (
    <div className={styles.sectionBlock}>
      <h3 className={styles.sectionSubheading}>Troubleshooting</h3>
      <ul className={styles.detailList}>
        {troubleshootingTips.map((troubleshootingTip) => (
          <li key={troubleshootingTip} className={styles.detailListItem}>
            {troubleshootingTip}
          </li>
        ))}
      </ul>
    </div>
  );
}

function WalkthroughSectionCard({
  isHighlighted,
  section,
}: {
  isHighlighted: boolean;
  section: WalkthroughSection;
}) {
  return (
    <section
      id={section.id}
      className={`${styles.docSection} ${isHighlighted ? styles.docSectionHighlighted : ''}`}
    >
      <h2 className={styles.sectionHeading}>
        {section.emoji} {section.title}
      </h2>
      <p className={styles.sectionSummary}>{section.summary}</p>

      {section.featureHighlights && section.featureHighlights.length > 0 && (
        renderFeatureHighlights(section.featureHighlights)
      )}

      {section.workflowPlaybooks && section.workflowPlaybooks.length > 0 && (
        renderWorkflowPlaybooks(section.workflowPlaybooks)
      )}

      {section.troubleshootingTips && section.troubleshootingTips.length > 0 && (
        renderTroubleshootingTips(section.troubleshootingTips)
      )}
    </section>
  );
}

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
          buildSectionSearchText(section).includes(normalizedQuery),
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
            <WalkthroughSectionCard
              key={section.id}
              isHighlighted={currentTourSection === section.id}
              section={section}
            />
          ))}
        </main>
      </div>
    </div>
  );
}
