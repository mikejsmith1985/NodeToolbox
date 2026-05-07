// homeCardData.ts — Static definitions for the Home view card catalog and section metadata.

/** Section identifiers used to group cards on the Home view. */
export type SectionKey = 'agile' | 'reports' | 'snow' | 'text' | 'admin' | 'docs';

/** Static definition for one tool card surfaced on the Home view. */
export interface AppCardDef {
  id: string;
  route: string;
  icon: string;
  title: string;
  description: string;
  tags: readonly string[];
  sectionKey: SectionKey;
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
  { key: 'agile', label: 'Agile & Delivery', icon: '🏃', color: '#8b5cf6' },
  { key: 'reports', label: 'Reports', icon: '📈', color: '#10b981' },
  { key: 'snow', label: 'SNow Hub', icon: '❄️', color: '#f59e0b' },
  { key: 'text', label: 'Text Tools', icon: '🛠', color: '#8b949e' },
  { key: 'admin', label: 'Administration', icon: '🛡️', color: '#ef4444' },
  { key: 'docs', label: 'Documentation', icon: '📖', color: '#8b949e' },
];

/** Ordered list of all cards shown on the Home view. */
export const APP_CARDS: AppCardDef[] = [
  {
    id: 'sprint-dashboard',
    route: '/sprint-dashboard',
    icon: '🏃',
    title: 'Team Dashboard',
    description:
      'Live sprint/Kanban view — burndown, assignee breakdown, blockers, standup, metrics & story pointing.',
    tags: ['Sprint', 'Kanban', 'Standup', 'DSU'],
    sectionKey: 'agile',
  },
  {
    id: 'art',
    route: '/art',
    icon: '🚂',
    title: 'ART View',
    description:
      'Release Train Engineer dashboard — team health, predictability vs goals, and release radar.',
    tags: ['ART', 'RTE', 'Release Radar'],
    sectionKey: 'agile',
  },
  {
    id: 'my-issues',
    route: '/my-issues',
    icon: '📊',
    title: 'My Issues',
    description:
      'Jira issues, custom JQL, saved filters, boards — filterable, color-coded, with export.',
    tags: ['Jira', 'My Work', 'Report'],
    sectionKey: 'agile',
  },
  {
    id: 'dev-workspace',
    route: '/dev-workspace',
    icon: '🏗',
    title: 'Dev Workspace',
    description:
      'Time tracking with Jira work-log posting, git commit sync, and integration settings.',
    tags: ['Jira', 'Time Tracking', 'Git', 'Automation'],
    sectionKey: 'agile',
  },
  {
    id: 'reports-hub',
    route: '/reports-hub',
    icon: '📈',
    title: 'Reports Hub',
    description:
      'PI-level reporting across your Agile Release Train — feature progress, defect triage, risk board.',
    tags: ['Jira', 'ART', 'Features', 'Defects', 'Risks'],
    sectionKey: 'reports',
  },
  {
    id: 'snow-hub',
    route: '/snow-hub',
    icon: '❄️',
    title: 'SNow Hub',
    description:
      'ServiceNow tooling: generate Change Requests from Jira fix versions, or create Jira Defect+Story pairs from Problem Records.',
    tags: ['ServiceNow', 'Jira', 'Change Request', 'PRB'],
    sectionKey: 'snow',
  },
  {
    id: 'text-tools',
    route: '/text-tools',
    icon: '🛠',
    title: 'Text Tools',
    description:
      'Smart Formatter, JSON Formatter, Case Converter, URL Encoder/Decoder, Base64, and Element Extractor.',
    tags: ['JSON', 'Markdown', 'Encode', 'Base64'],
    sectionKey: 'text',
  },
  {
    id: 'admin-hub',
    route: '/admin-hub',
    icon: '🛡️',
    title: 'Admin Hub',
    description:
      'POC leadership tools — team oversight, reporting dashboards, and administrative configuration.',
    tags: ['Admin', 'Leadership', 'Reports'],
    sectionKey: 'admin',
  },
  {
    id: 'sprint-planning',
    route: '/sprint-planning',
    icon: '📋',
    title: 'Sprint Planning',
    description:
      'Pull a backlog, point stories inline, and persist all changes with one batch save through Jira.',
    tags: ['Jira', 'Backlog', 'Story Points'],
    sectionKey: 'agile',
  },
  {
    id: 'work-log',
    route: '/work-log',
    icon: '⏱',
    title: 'Work Log',
    description:
      'Track time per Jira issue with running stopwatches, then post the elapsed time as a worklog entry.',
    tags: ['Jira', 'Time Tracking', 'Worklog'],
    sectionKey: 'agile',
  },
  {
    id: 'pointing',
    route: '/pointing',
    icon: '🎲',
    title: 'Story Pointing',
    description:
      'Run a focused planning poker session — load issues, vote with a Fibonacci deck, reveal, and save the estimate.',
    tags: ['Jira', 'Pointing', 'Planning'],
    sectionKey: 'agile',
  },
  {
    id: 'mermaid',
    route: '/mermaid',
    icon: '🧜',
    title: 'Mermaid Editor',
    description:
      'Author Mermaid diagrams with a live SVG preview, starter templates, and one-click copy or download.',
    tags: ['Diagrams', 'Mermaid', 'SVG'],
    sectionKey: 'text',
  },
  {
    id: 'pitch-deck',
    route: '/pitch-deck',
    icon: '🎯',
    title: 'Pitch Deck',
    description:
      'Executive presentation explaining the business case for a unified Agile toolset, with keyboard navigation.',
    tags: ['Presentation', 'Slides', 'Executive'],
    sectionKey: 'docs',
  },
  {
    id: 'defects',
    route: '/defects',
    icon: '🐛',
    title: 'Defect Management',
    description:
      'Standalone defect tracker — query bugs by project, filter by priority/status/assignee, and sort by age or last update.',
    tags: ['Jira', 'Bugs', 'Triage'],
    sectionKey: 'agile',
  },
  {
    id: 'hygiene',
    route: '/hygiene',
    icon: '🧼',
    title: 'Hygiene',
    description:
      'Issue health checker — flags missing story points, stale work, missing acceptance criteria, and unassigned in-progress items.',
    tags: ['Jira', 'Quality', 'Triage'],
    sectionKey: 'agile',
  },
  {
    id: 'pipeline',
    route: '/pipeline',
    icon: '🛤️',
    title: 'Pipeline View',
    description:
      'Epic pipeline visualization — see every epic in a project grouped by status with story-point rollups and completion percentages.',
    tags: ['Jira', 'Epics', 'Pipeline'],
    sectionKey: 'agile',
  },
  {
    id: 'code-walkthrough',
    route: '/code-walkthrough',
    icon: '📖',
    title: 'Code Walkthrough',
    description:
      'Technical transparency report — architecture, security model, data flow, and API usage breakdown.',
    tags: ['Security', 'Architecture', 'Audit'],
    sectionKey: 'docs',
  },
];

/** Persona-specific priority order for cards that move based on the user's role. */
export const PERSONA_CARD_ORDERS: Record<string, string[]> = {
  all: [
    'sprint-dashboard',
    'sprint-planning',
    'pointing',
    'pipeline',
    'art',
    'my-issues',
    'defects',
    'hygiene',
    'work-log',
    'dev-workspace',
    'snow-hub',
    'mermaid',
    'text-tools',
    'pitch-deck',
    'code-walkthrough',
  ],
  dev: [
    'dev-workspace',
    'work-log',
    'mermaid',
    'my-issues',
    'defects',
    'sprint-dashboard',
    'sprint-planning',
    'pointing',
    'pipeline',
    'hygiene',
    'snow-hub',
    'text-tools',
    'art',
    'pitch-deck',
    'code-walkthrough',
  ],
  qa: [
    'my-issues',
    'defects',
    'hygiene',
    'work-log',
    'snow-hub',
    'sprint-dashboard',
    'sprint-planning',
    'pointing',
    'pipeline',
    'mermaid',
    'dev-workspace',
    'text-tools',
    'art',
    'pitch-deck',
    'code-walkthrough',
  ],
  sm: [
    'sprint-dashboard',
    'sprint-planning',
    'pointing',
    'pipeline',
    'hygiene',
    'my-issues',
    'defects',
    'snow-hub',
    'art',
    'dev-workspace',
    'work-log',
    'mermaid',
    'text-tools',
    'pitch-deck',
    'code-walkthrough',
  ],
  po: [
    'sprint-dashboard',
    'sprint-planning',
    'pipeline',
    'pointing',
    'my-issues',
    'hygiene',
    'art',
    'pitch-deck',
    'defects',
    'snow-hub',
    'dev-workspace',
    'work-log',
    'mermaid',
    'text-tools',
    'code-walkthrough',
  ],
  rte: [
    'art',
    'pipeline',
    'sprint-dashboard',
    'sprint-planning',
    'pointing',
    'hygiene',
    'my-issues',
    'defects',
    'pitch-deck',
    'snow-hub',
    'dev-workspace',
    'work-log',
    'mermaid',
    'text-tools',
    'code-walkthrough',
  ],
};

/** Human-friendly labels used for the Home view recent-links strip. */
export const RECENT_VIEW_LABELS: Record<string, string> = {
  'sprint-dashboard': '🏃 Team Dashboard',
  'sprint-planning': '📋 Sprint Planning',
  'work-log': '⏱ Work Log',
  pointing: '🎲 Story Pointing',
  mermaid: '🧜 Mermaid Editor',
  'pitch-deck': '🎯 Pitch Deck',
  defects: '🐛 Defect Management',
  hygiene: '🧼 Hygiene',
  pipeline: '🛤️ Pipeline View',
  'dsu-board': '🏃 Team Dashboard',
  art: '🚂 ART View',
  'my-issues': '📊 My Issues',
  'dev-workspace': '🏗 Dev Workspace',
  'snow-hub': '❄️ SNow Hub',
  'text-tools': '🛠 Text Tools',
  'reports-hub': '📈 Reports Hub',
  'admin-hub': '🛡️ Admin Hub',
  'code-walkthrough': '📖 Code Walkthrough',
};
