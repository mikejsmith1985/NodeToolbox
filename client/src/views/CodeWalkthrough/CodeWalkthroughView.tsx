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
      'NodeToolbox is a local-first React + TypeScript single-page app served by a Node.js Express proxy on localhost. '
      + 'The home page opens ten tool cards in three job-shaped sections, and the biggest tools are hubs: the Agile Hub '
      + '(Team, Product, Train, and Search spaces), My Issues, Reports Hub, SNow Hub, Jira Create, Admin Hub, Feature '
      + 'Canvas, Personal Toolbox, Text Tools, and this Code Walkthrough. Every workspace follows the same pattern: a '
      + 'top-level view, focused tabs or panels, a dedicated state hook, and typed service helpers that call localhost '
      + 'proxy routes — the browser never talks to Jira, ServiceNow, Confluence, or GitHub directly. The server also '
      + 'runs scheduled automations and hosts two browser-built engines (PI Review and Monthly Delivery) bundled with '
      + 'esbuild so scheduled saves reuse the exact code the UI runs.',
  },
  {
    id: 'home-navigation',
    title: 'Home & Navigation',
    emoji: '🏠',
    summary:
      'The home page groups ten cards into three sections named for the job, not the org: 🙋 My Work (My Issues, '
      + 'Personal Toolbox), 🏃 Agile Delivery (Agile Hub, Feature Canvas, Jira Create), and 📈 Insights & Admin '
      + '(Reports Hub, Admin Hub, SNow Hub, Code Walkthrough, Text Tools). Cards can be reordered by drag, and a '
      + 'recents strip remembers where you worked — including under retired tool names, which resolve to their '
      + 'successors. Gating is honest: the SNow Hub card and route exist only while this tab holds the Admin Hub '
      + 'unlock, and the Admin Hub Tool Visibility toggles remove a hidden tool’s card and route immediately. Gates '
      + 'apply on entry only — an open workspace is never yanked away mid-task. Old bookmarks keep working: '
      + '/sprint-dashboard, /po-tool, /art, /business-helper, /jira-template-maker, /jira-intake, and roughly a dozen '
      + 'legacy paths all redirect to their new homes with query parameters preserved.',
  },
  {
    id: 'agile-hub',
    title: 'Agile Hub',
    emoji: '🏃',
    summary:
      'The Agile Hub is one door with four spaces, switched by a strip at the top and deep-linkable via ?space=. '
      + 'Team is the sprint execution hub: Overview, By Assignee, Blockers, Defects, Standup, Hygiene, Metrics, '
      + 'Planning, Pointing, Feature Review, PI Review, Remediation, Releases, and Settings for the active team '
      + 'profile. Product is the PO workspace with its own team and PI selection: Feature Review, PI Review '
      + '(authoring), Feature Splitter, and Feature Composition. Train is the release-train picture: Overview, '
      + 'Impediments, Predictability, Releases, PI Review (readout), Blueprint, Dependencies, Board Prep, SoS, '
      + 'Monthly Report, and ART Settings. Search is business-friendly Jira keyword search with grouped results — '
      + 'no JQL required. Each space keeps its own selections; switching spaces never merges or resets them, and '
      + 'the hub reopens on your last-used space.',
    featureHighlights: [
      'Feature Review combines hygiene flags, child rollups, inline field fixes, and direct status transitions.',
      'PI Review appears in three roles: team adapter (Team), authoring (Product), and multi-team readout (Train).',
      'Simple Search groups results by Portfolio, ART, and Team, with expandable child and linked records.',
    ],
    workflowPlaybooks: [
      {
        title: 'Feature Review cleanup',
        steps: [
          'Open the Agile Hub and stay in the Team space, confirming the correct team profile is active.',
          'Select Feature Review and scan for the features that still show hygiene flags.',
          'Apply the needed field or status fix inline — dropdown fields map values to their Jira options automatically.',
          'Confirm the hygiene badges clear before moving to the next feature.',
        ],
      },
      {
        title: 'PI Review authoring and readout',
        steps: [
          'Author team content in the Product space PI Review tab, updating capacity first so one snapshot feeds scope and confidence.',
          'Save to Confluence when the team rows are ready — the same engine the scheduler runs server-side.',
          'Review the multi-team readout in the Train space and export PNG or CSV for the ART audience.',
        ],
      },
      {
        title: 'Dependency review',
        steps: [
          'Open the Train space Dependencies tab and choose the lens that matches the conversation.',
          'Filter to the relationships that matter for the current PI or release discussion.',
          'Identify the teams that need follow-up before the next planning checkpoint.',
        ],
      },
      {
        title: 'Simple Search without JQL',
        steps: [
          'Switch to the Search space and enter a plain-language keyword.',
          'Expand the grouped results (Portfolio, ART, Team) until you find the Jira item you need.',
          'Open child and linked records inline to understand the item’s relationships before acting on it.',
        ],
      },
    ],
    troubleshootingTips: [
      'If Feature Review data looks incomplete, confirm the team profile, project key, and scope still point to the intended team.',
      'If a PI Review page does not appear, check that the team is mapped in ART Settings and the Confluence page reference is valid.',
      'If the Product space shows the wrong team, remember it keeps its OWN selection — it never follows the Team space.',
    ],
  },
  {
    id: 'my-issues-today',
    title: 'My Issues & Today',
    emoji: '📊',
    summary:
      'My Issues is the personal workspace, opening on the Today tab: a daily Jira-hygiene checklist of eight '
      + 'cards — Respond to mentions, Unblock issues, My stale issues, Team stale issues, Unassigned in-progress, '
      + 'Sprint commitment gaps, Due / overdue today, and Untriaged new issues — each with a live count, a daily '
      + 'check-off, and a deep link that lands in the right tool with its filter already applied. The free-form '
      + 'To-Do list lives on the same tab (press F1 anywhere in the app to quick-add an item without leaving your '
      + 'screen), followed by a sprint flow snapshot. The Report tab is the flexible queue: sources (My Issues, '
      + 'JQL, Saved Filter, Board), card/compact/table layouts, status zones, bulk comments, and CSV, Markdown, '
      + 'TSV, or Excel export, with linked Jira-ServiceNow pairs shown together. Mentions, Hygiene (personal '
      + 'scope), Time Tracking, Git Sync, and Settings complete the tab strip.',
    featureHighlights: [
      'Today card counts come from the same shared hygiene scan the Hygiene tab runs — the numbers always agree.',
      'F1 opens the to-do quick-add from every screen; Enter adds and keeps the box open, Escape closes.',
      'Team-scoped cards deep-link into hygiene with the matching filter preselected (e.g. stale, commitment gaps).',
    ],
    workflowPlaybooks: [
      {
        title: 'Daily sweep',
        steps: [
          'Open My Issues — Today loads first — and work the cards left to right, checking each off as it clears.',
          'Capture side thoughts with F1 into the To-Do list without losing your place.',
          'Click a card with a nonzero count to land in the matching tool with the filter applied.',
        ],
      },
      {
        title: 'Personal issue triage',
        steps: [
          'Switch to the Report tab and choose the source that matches the review: My Issues, JQL, Saved Filter, or Board.',
          'Pick the layout that fits — cards for scanning, table for detail — and narrow with status zones.',
          'Open issue details inline, post bulk comments, or export the slice you need to share.',
        ],
      },
    ],
    troubleshootingTips: [
      'If a Today count looks wrong, open its deep link — the card and the landing view run the identical scan, so they cannot disagree.',
      'If the Report tab returns less work than expected, verify the current source, board, or saved filter before assuming the queue is empty.',
    ],
  },
  {
    id: 'hygiene-workspace',
    title: 'Hygiene Workspace',
    emoji: '🧼',
    summary:
      'Hygiene is one shared workspace rendered in three places — the Agile Hub Team space, My Issues (personal '
      + 'scope, including an all-my-projects mode), and its own deep-linked views. One scan pipeline evaluates '
      + 'every check (missing story points, acceptance criteria, assignee, fix version, due date, PI, feature '
      + 'link, stale, overdue dates, unpointed child stories, and more), so every surface shows the same counts '
      + 'by construction. Findings render with a semantic chip vocabulary: status chips toned by category, '
      + 'priority badges, issue-type icons, assignee avatars with full names, and age heat badges graded against '
      + 'the team’s stale threshold. Each flag carries a plain-language explanation and an inline fix control — '
      + 'including status transitions that collect any workflow-required screen fields before submitting, so a '
      + 'transition never fails for a missing field you could not see. The list can be sorted by status, '
      + 'assignee, issue type, or age when a cleanup pass benefits from grouping.',
    featureHighlights: [
      'Guided cleanup session: "Review these findings" walks the list with a visible N-of-M cursor.',
      'Keyboard flow: arrow keys navigate, Skip (S) explicitly settles a finding, Escape ends the session.',
      'The end-of-session summary reports fixed / commented / skipped / untouched separately — progress is never overstated.',
    ],
    workflowPlaybooks: [
      {
        title: 'Guided cleanup session',
        steps: [
          'Filter the findings with the summary tiles, and sort them if grouping helps (sort locks during the session).',
          'Start the session and settle each finding: fix it inline, nudge with a comment, or press Skip (S) deliberately.',
          'Fixes made mid-session keep your place — the rescan is deferred until the session ends.',
          'Read the honest four-bucket summary at the end; untouched findings are never counted as handled.',
        ],
      },
      {
        title: 'Fixing a flagged issue inline',
        steps: [
          'Expand the finding to see the full decision picture: linked issues with their statuses, labels, planning rows, and structured description.',
          'Use the labelled fix control next to the flag — dropdown fields list the real Jira options, and story points map to the field’s allowed values.',
          'For a status move, answer any required screen fields the transition demands; the button stays disabled until they are complete.',
        ],
      },
    ],
    troubleshootingTips: [
      'An empty scope shows an amber warning, never a perfect score — check the project key, PI, and extra JQL.',
      'A check whose Jira field does not exist on this instance shows "not checked", never a clean zero.',
      'If a required transition field cannot be edited inline, the control says so plainly and links to Jira.',
    ],
  },
  {
    id: 'jira-create',
    title: 'Jira Create',
    emoji: '🧩',
    summary:
      'Jira Create is one card with two ways to create issues. The Templates tab builds reusable issue templates '
      + 'with guided project, issue-type, and field pickers — including wiki-markup editing and shareable template '
      + 'links — then creates real issues in one click. The Intake tab imports Teams request submissions from an '
      + 'exported Excel/CSV (or a SharePoint pull), attributes reporters, deduplicates, and turns approved rows '
      + 'into Jira issues through a review queue. Both tools are mounted unchanged inside a thin tab shell; the '
      + 'old standalone routes redirect here with their parameters intact.',
  },
  {
    id: 'feature-canvas',
    title: 'Feature Canvas',
    emoji: '🗺️',
    summary:
      'Feature Canvas is visual backlog triage: pull features onto a canvas from the blueprint hierarchy or a JQL '
      + 'search, then drag them into sprint boxes, a parking lot, or provisional containers until the plan is '
      + 'committed. A coaching panel guides the journey from chaos to a committed plan, with story planning, '
      + 'capacity planning (configured override, then team velocity, then a fallback), a re-allocation planner, '
      + 'undo/redo, and a Review & Commit step that writes the agreed plan back. AI-assisted panels are available '
      + 'behind the propose-only gate. The canvas dependency loads lazily so users who never open it pay no '
      + 'bundle cost.',
  },
  {
    id: 'reports-hub',
    title: 'Reports Hub',
    emoji: '📈',
    summary:
      'Reports Hub is the leadership reporting surface with fifteen tabs: Defect Dashboard, Feature Report, '
      + 'Defect Tracker, Risk Board, Flow, Impact, Individual, Quality, Sprint Health, Throughput, Scope Change, '
      + 'Feature Change, Hygiene, Personal Flow, and Aging. A global PI and team filter bar scopes every tab; '
      + 'each report carries an "About this report" explainer, a last-generated timestamp, and a one-click Copy '
      + 'Report PNG for pasting into decks and chats. Some reports can also be sent to the server-side automation '
      + 'channel for scheduled delivery.',
    workflowPlaybooks: [
      {
        title: 'Leadership report preparation',
        steps: [
          'Load the report that matches the meeting outcome you need, such as Feature, Flow, or Sprint Health.',
          'Apply PI and team filters before discussing the numbers so the view reflects the right audience.',
          'Read the built-in explainer to confirm what the current tab measures.',
          'Copy the report PNG once the view shows the exact slice you want to share.',
        ],
      },
    ],
    troubleshootingTips: [
      'If a report looks stale, check the last-generated timestamp and reload after confirming the team configuration.',
      'If a view seems empty, widen the PI or team filter before assuming there is no data.',
    ],
  },
  {
    id: 'snow-hub',
    title: 'SNow Hub',
    emoji: '❄️',
    summary:
      'SNow Hub is the ServiceNow workspace, available only while this tab holds the Admin Hub unlock. Its tabs: '
      + 'CHG Generator builds change requests from Jira-backed release inputs through a stepwise wizard; PRB '
      + 'Generator converts problems; Assignment Groups manages group lookups; Release Management coordinates '
      + 'release records; Sync Monitor watches Jira-ServiceNow synchronization; and Configuration holds the '
      + 'hub’s settings. Browser-side ServiceNow access uses a relay bookmarklet pattern for pages the proxy '
      + 'cannot reach directly, and returns you to where you left off after the relay round-trip.',
    workflowPlaybooks: [
      {
        title: 'SNow change creation',
        steps: [
          'Unlock the Admin Hub, open SNow Hub, and start in CHG Generator.',
          'Walk the wizard in order so the review step has complete issue, planning, and environment information.',
          'Confirm the generated fields before submission to avoid rework in ServiceNow afterward.',
        ],
      },
    ],
    troubleshootingTips: [
      'If the SNow Hub card is missing from home, the Admin Hub unlock has not been entered in this tab.',
      'If SNow workflows fail to load expected options, confirm the ServiceNow connection from Admin Hub or Settings.',
    ],
  },
  {
    id: 'admin-hub',
    title: 'Admin Hub',
    emoji: '🛡️',
    summary:
      'Admin Hub is the platform control room. The Config tab covers proxy and server setup (status, restart, '
      + 'launcher downloads), ART settings (PI field IDs, PI name and dates), the admin access gate, service '
      + 'connectivity (ServiceNow, GitHub, Confluence credentials stored server-side), enterprise standards, '
      + 'Tool Visibility toggles that add or remove home cards live, backup/restore/reset, hygiene rules (stale '
      + 'days, unpointed warning), update management with rollback, and diagnostics. Further tabs manage the '
      + 'server automations: Repo Monitor, Reports Config (Scope Change, Feature Change, and Hygiene Monitor '
      + 'digests), Standup briefing, PI Review Sync, Monthly Delivery, and Sprint Release. Two extra tabs appear '
      + 'only when their unlocks are held: the Dev Panel (admin unlock) and AI Assist automation (AI unlock).',
    workflowPlaybooks: [
      {
        title: 'Admin safety backup',
        steps: [
          'Open Admin Hub before a risky settings change.',
          'Use Backup & Reset to download the current settings snapshot.',
          'Apply the change only after the backup file exists, and restore from it if the environment must roll back.',
        ],
      },
      {
        title: 'Scheduling a server automation',
        steps: [
          'Open the matching panel — Standup, PI Review Sync, Monthly Delivery, Sprint Release, or a Reports Config digest.',
          'Configure the scope (teams, pages, or filters) and the delivery time.',
          'Use Run Now to verify the output once before trusting the schedule.',
        ],
      },
    ],
    troubleshootingTips: [
      'If diagnostics show missing services, review connection settings before assuming a feature workflow is broken.',
      'If a scheduler panel reports itself disabled, its bundled engine may be missing — rebuild via the standard npm scripts.',
    ],
  },
  {
    id: 'text-tools',
    title: 'Text Tools',
    emoji: '🛠',
    summary:
      'Text Tools is the utility belt for day-to-day copy-paste work: Smart Formatter (HTML to Markdown, plain, '
      + 'or structured text), JSON (pretty-print or minify), Case (ten live case variants), URL encode/decode, '
      + 'Base64 encode/decode, and the Extractor — a ServiceNow field-extractor bookmarklet with JSON validation '
      + 'and field selection for pulling clean payloads off ServiceNow pages.',
  },
  {
    id: 'ai-assist-model',
    title: 'AI Assist Model',
    emoji: '⚡',
    summary:
      'Every AI surface in NodeToolbox is propose-only and session-gated. Ctrl+Alt+Z unlocks AI Assist for the '
      + 'current tab (press again to re-lock); until then no AI affordance is visible. The pattern is identical '
      + 'everywhere: the tool builds one prompt covering the work in scope, the reply comes back as structured '
      + 'JSON keyed by issue, and every proposed change is listed for individual accept or decline — nothing is '
      + 'written to Jira without a per-item click, and accepted writes go through the same shared writers as '
      + 'manual fixes. Surfaces include hygiene fixes, PI Review sizing, PO feature authoring, report '
      + 'narratives, Feature Canvas suggestions and re-allocation, and the CHG wizard. Server schedulers are '
      + 'report-only: they emit prompts or digests for a human to carry to the in-house agent — there is no '
      + 'automated AI channel.',
  },
  {
    id: 'schedulers-automation',
    title: 'Schedulers & Automation',
    emoji: '⏰',
    summary:
      'The Express server runs the recurring work so the browser does not have to stay open: Repo Monitor polls '
      + 'commits into Jira updates; Scope Change and Feature Change build change digests; the Hygiene Monitor '
      + 'runs scheduled scans; the Standup briefing delivers a daily roster summary; the Sprint Release '
      + 'scheduler orchestrates release timing; the PI Review scheduler saves team pages to Confluence on '
      + 'schedule; and the Monthly Delivery scheduler classifies last month’s delivered work into a plain-text '
      + 'report prompt on the second Tuesday. PI Review and Monthly Delivery reuse the browser code itself: '
      + 'esbuild bundles the client engines into the server, where a lightweight DOM host runs them — scheduled '
      + 'output can never drift from what the UI produces. All schedulers are configured from Admin Hub panels '
      + 'and deliver through the existing Confluence and webhook channels.',
  },
  {
    id: 'security-model',
    title: 'Security Model',
    emoji: '🔒',
    summary:
      'The security model keeps Jira, ServiceNow, GitHub, and Confluence credentials out of browser code '
      + 'entirely. The React app only ever calls localhost proxy routes; the Express server injects credentials '
      + 'server-side before forwarding upstream, so raw tokens never enter the client bundle. Capability gates '
      + 'are session-scoped and honest: the Admin Hub unlock (a username/password check against the server) '
      + 'lives in this tab’s session and gates the SNow Hub plus admin-only panels; the AI Assist unlock '
      + '(Ctrl+Alt+Z) gates every AI surface. Tool Visibility gates apply on route entry only — a mid-task '
      + 'state change never unmounts an open workspace. Hidden or gated tools are absent, never greyed out, so '
      + 'the UI never advertises capabilities it will refuse.',
  },
  {
    id: 'data-flow',
    title: 'Data Flow & Services',
    emoji: '🔄',
    summary:
      'Data flow starts in a view or workspace hook. The hook calls a typed client service helper, the helper '
      + 'calls a localhost route (/jira-proxy, /snow-proxy, /confluence-proxy, /github-proxy, or an /api '
      + 'endpoint), the proxy injects credentials and forwards the request, and the typed response flows back '
      + 'into the hook and then the UI. Jira helpers cover search, board data, transitions, comments, work logs, '
      + 'and field metadata; ServiceNow helpers cover change, problem, release, and sync operations; Confluence '
      + 'helpers back the PI Review save/load flows. For browser pages the proxy cannot reach, a relay '
      + 'bookmarklet bridge carries ServiceNow and SharePoint round-trips and returns you to the route you left. '
      + 'Live status (connection health, relay availability) flows through shared polling hooks and stores so '
      + 'individual views never own transport details.',
  },
  {
    id: 'jira-write-paths',
    title: 'Jira Write Paths',
    emoji: '✏️',
    summary:
      'Every Jira write funnels through shared, editmeta-aware helpers so behavior can never drift between '
      + 'surfaces. Story points detect dropdown-style fields and write the matching allowed option instead of a '
      + 'raw number. Status transitions fetch the fields each transition’s workflow screen requires, collect '
      + 'them inline, and submit them with the transition so a move never fails blind. Field fixes, comment '
      + 'posts, fix versions, user fields, and issue links all use the same writers — from the Agile Hub Feature '
      + 'Review, the hygiene fix controls, the inline issue detail panel, and every accepted AI proposal alike. '
      + 'Two surfaces showing or writing the same thing always share one code path: that is a project rule, not '
      + 'a coincidence.',
  },
  {
    id: 'snow-write-paths',
    title: 'SNow Write Paths',
    emoji: '❄️',
    summary:
      'ServiceNow write paths support change-request generation, problem conversion, release coordination, '
      + 'assignment updates, and sync-related updates — used chiefly by the SNow Hub wizards and the linked-pair '
      + 'workflows in My Issues. Keeping those writes behind the proxy enforces approved table targets and keeps '
      + 'credentials out of the browser, while the relay bookmarklet covers the session-bound pages the proxy '
      + 'cannot reach directly.',
  },
  {
    id: 'tech-stack',
    title: 'Tech Stack',
    emoji: '🧰',
    summary:
      'React 18 with TypeScript for views and typed contracts, Vite for the client build, Zustand stores for '
      + 'shared state (settings, connection, admin/AI unlocks, tool visibility, to-dos), React Router for '
      + 'workspace routing, and CSS Modules for scoped styling. Testing is layered: Vitest with React Testing '
      + 'Library for the client, Jest for the server, and Playwright for browser-level regression. The server '
      + 'is Node.js Express; esbuild bundles two client engines (PI Review, Monthly Delivery) into it, hosted '
      + 'under a lightweight DOM so schedulers run the same code the browser does. Heavy dependencies like the '
      + 'Feature Canvas board load lazily, and spreadsheet handling uses the already-shipped SheetJS via '
      + 'dynamic import.',
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
