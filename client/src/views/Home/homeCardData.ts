// homeCardData.ts — Static definitions for the Home view card catalog and section metadata.
//
// Spec 020: sections are named for the JOB, not the org — three sections, never a single-card
// section by design. The Team Dashboard, PO Tool, and ART View cards are retired in favor of the
// merged Agile Hub (their routes redirect into its spaces); their ids stay mapped below so old
// recents keep resolving.

/** Section identifiers used to group cards on the Home view. */
export type SectionKey = 'my-work' | 'agile' | 'insights-admin';

/** Session gates a card can require before it is shown or entered (spec 020 US1). */
export type CardGateKind = 'admin-unlock';

/** Static definition for one tool card surfaced on the Home view. */
export interface AppCardDef {
  id: string;
  route: string;
  icon: string;
  title: string;
  description: string;
  tags: readonly string[];
  sectionKey: SectionKey;
  /** Session gate required to SEE and ENTER the tool; absent = ungated. */
  gateKind?: CardGateKind;
}

/** Static definition for one Home view section divider. */
export interface SectionDef {
  key: SectionKey;
  label: string;
  icon: string;
  color: string;
}

/** Ordered section metadata used when rendering the Home view. */
export const APP_SECTIONS: SectionDef[] = [
  { key: 'my-work', label: 'My Work', icon: '🙋', color: '#22c55e' },
  { key: 'agile', label: 'Agile Delivery', icon: '🏃', color: '#8b5cf6' },
  { key: 'insights-admin', label: 'Insights & Admin', icon: '📈', color: '#f59e0b' },
];

/** Ordered list of all cards shown on the Home view. */
export const APP_CARDS: AppCardDef[] = [
  {
    id: 'my-issues',
    route: '/my-issues',
    icon: '📊',
    title: 'My Issues',
    description:
      'Personal Jira and linked ServiceNow work queue with saved views, hygiene checks, swimlanes, and bulk actions.',
    tags: ['Jira', 'My Work', 'Report'],
    sectionKey: 'my-work',
  },
  {
    id: 'personal-toolbox',
    route: '/personal-toolbox',
    icon: '🧰',
    title: 'Personal Toolbox',
    description:
      'Build your own workspace by choosing, reordering, and reusing the major NodeToolbox modules you need most.',
    tags: ['Workspace', 'Personalization', 'Tabs'],
    sectionKey: 'my-work',
  },
  {
    id: 'agile-hub',
    route: '/agile-hub',
    icon: '🏃',
    title: 'Agile Hub',
    description:
      'One agile workspace with Team, Product, and Train spaces: sprint health, standup, hygiene, Feature Review, PI Review, feature authoring, and release-train visibility.',
    tags: ['Team', 'Product', 'Train', 'Sprint', 'PI'],
    sectionKey: 'agile',
  },
  {
    id: 'feature-canvas',
    route: '/feature-canvas',
    icon: '🗺️',
    title: 'Feature Canvas',
    description:
      'Visual drag-and-drop backlog triage: pull features onto a canvas, box them into releases and sprints, and follow a guided five-stage coaching journey from chaos to a committed plan.',
    tags: ['Planning', 'Triage', 'Canvas', 'Coach'],
    sectionKey: 'agile',
  },
  {
    id: 'jira-create',
    route: '/jira-create',
    icon: '🧩',
    title: 'Jira Create',
    description:
      'Create Jira issues two ways in one tool: reusable guided templates, or imported Teams request submissions with dedup and a review queue.',
    tags: ['Jira', 'Templates', 'Intake', 'Create Issue'],
    sectionKey: 'agile',
  },
  {
    id: 'reports-hub',
    route: '/reports-hub',
    icon: '📈',
    title: 'Reports Hub',
    description:
      'Leadership reporting hub for delivery, defects, risks, flow, quality, sprint health, throughput, and individual workload views.',
    tags: ['Reports', 'Director', 'RTE', 'Dashboard'],
    sectionKey: 'insights-admin',
  },
  {
    id: 'admin-hub',
    route: '/admin-hub',
    icon: '🛡️',
    title: 'Admin Hub',
    description:
      'Platform controls for integrations, ART settings, enterprise standards, diagnostics, backup and restore, and tool visibility.',
    tags: ['Admin', 'Leadership', 'Reports'],
    sectionKey: 'insights-admin',
  },
  {
    id: 'snow-hub',
    route: '/snow-hub',
    icon: '❄️',
    title: 'SNow Hub',
    description:
      'ServiceNow workspace for change generation, PRB conversion, release management, configuration, and Jira-SNow sync monitoring.',
    tags: ['ServiceNow', 'Jira', 'Change Request', 'PRB'],
    sectionKey: 'insights-admin',
    // ServiceNow connectivity is admin-controlled: the card exists only while this tab holds
    // the Admin Hub unlock (spec 020 FR-001) — absent, never greyed.
    gateKind: 'admin-unlock',
  },
  {
    id: 'code-walkthrough',
    route: '/code-walkthrough',
    icon: '📖',
    title: 'Code Walkthrough',
    description:
      'In-app technical reference for architecture, workspace map, security model, data flow, and Jira/ServiceNow write paths.',
    tags: ['Security', 'Architecture', 'Audit'],
    sectionKey: 'insights-admin',
  },
  {
    id: 'text-tools',
    route: '/text-tools',
    icon: '🛠',
    title: 'Text Tools',
    description:
      'Utility suite for smart formatting, JSON cleanup, case conversion, URL and Base64 transforms, and element extraction.',
    tags: ['JSON', 'Markdown', 'Encode', 'Base64'],
    sectionKey: 'insights-admin',
  },
];

/**
 * Human-friendly labels used for the Home view recent-links strip.
 *
 * Every card in APP_CARDS must have an entry here, or its recent link shows a raw id like
 * "feature-canvas" instead of its name. Extra entries are expected and fine: legacy routes and
 * retired tools (sprint-dashboard, po-tool, art, standup …) can appear in recents too — they
 * resolve to the Agile Hub, where those jobs now live.
 */
export const RECENT_VIEW_LABELS: Record<string, string> = {
  'agile-hub': '🏃 Agile Hub',
  'feature-canvas': '🗺️ Feature Canvas',
  'jira-create': '🧩 Jira Create',
  'jira-template-maker': '🧩 Jira Create',
  'sprint-dashboard': '🏃 Agile Hub',
  'po-tool': '🏃 Agile Hub',
  'sprint-planning': '📋 Sprint Planning',
  'work-log': '⏱ Work Log',
  pointing: '🎲 Story Pointing',
  'pitch-deck': '🎯 Pitch Deck',
  defects: '🐛 Defect Management',
  hygiene: '🧼 Hygiene',
  pipeline: '🛤️ Pipeline View',
  'dsu-board': '🏃 Agile Hub',
  art: '🏃 Agile Hub',
  'my-issues': '📊 My Issues',
  'jira-intake': '🧩 Jira Create',
  'personal-toolbox': '🧰 Personal Toolbox',
  'business-helper': '🏃 Agile Hub',
  'dev-workspace': '📊 My Issues',
  'snow-hub': '❄️ SNow Hub',
  'text-tools': '🛠 Text Tools',
  'reports-hub': '📈 Reports Hub',
  'admin-hub': '🛡️ Admin Hub',
  'code-walkthrough': '📖 Code Walkthrough',
  standup: '🧍 Standup Board',
  metrics: '📐 Metrics',
  'dsu-daily': '🗒️ DSU Daily',
  'dev-panel': '🛰️ Dev Panel',
  'impact-analysis': '💥 Impact Analysis',
  'release-monitor': '🚀 Release Monitor',
};
