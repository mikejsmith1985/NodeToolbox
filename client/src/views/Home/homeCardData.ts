// homeCardData.ts — Static definitions for the Home view card catalog and section metadata.

/** Section identifiers used to group cards on the Home view. */
export type SectionKey = 'agile' | 'snow' | 'text' | 'admin' | 'docs';

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
      'Team execution hub for sprint health, blockers, defects, standup, planning, Feature Review, PI Review, and release readiness.',
    tags: ['Sprint', 'Kanban', 'Standup', 'DSU'],
    sectionKey: 'agile',
  },
  {
    id: 'art',
    route: '/art',
    icon: '🚂',
    title: 'ART View',
    description:
      'Release-train workspace for PI health, dependencies, blueprint rollups, PI Review readouts, release visibility, and ART settings.',
    tags: ['ART', 'RTE', 'Release Radar'],
    sectionKey: 'agile',
  },
  {
    id: 'my-issues',
    route: '/my-issues',
    icon: '📊',
    title: 'My Issues',
    description:
      'Personal Jira and linked ServiceNow work queue with saved views, hygiene checks, swimlanes, and bulk actions.',
    tags: ['Jira', 'My Work', 'Report'],
    sectionKey: 'agile',
  },
  {
    id: 'personal-toolbox',
    route: '/personal-toolbox',
    icon: '🧰',
    title: 'Personal Toolbox',
    description:
      'Build your own workspace by choosing, reordering, and reusing the major NodeToolbox modules you need most.',
    tags: ['Workspace', 'Personalization', 'Tabs'],
    sectionKey: 'agile',
  },
  {
    id: 'business-helper',
    route: '/business-helper',
    icon: '💼',
    title: 'Business Helper',
    description:
      'Business-friendly Jira search plus the Stablization funding workflow with mappings, custom columns, and local draft support.',
    tags: ['Jira', 'Search', 'Business'],
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
    sectionKey: 'admin',
  },
  {
    id: 'snow-hub',
    route: '/snow-hub',
    icon: '❄️',
    title: 'SNow Hub',
    description:
      'ServiceNow workspace for change generation, PRB conversion, release management, configuration, and Jira-SNow sync monitoring.',
    tags: ['ServiceNow', 'Jira', 'Change Request', 'PRB'],
    sectionKey: 'snow',
  },
  {
    id: 'jira-template-maker',
    route: '/jira-template-maker',
    icon: '🧩',
    title: 'Jira Template Maker',
    description:
      'Build reusable Jira issue templates with guided project, issue-type, and field pickers, then create real issues in one click.',
    tags: ['Jira', 'Templates', 'Create Issue'],
    sectionKey: 'agile',
  },
  {
    id: 'jira-intake',
    route: '/jira-intake',
    icon: '📥',
    title: 'Jira Intake',
    description:
      'Import Teams request submissions from an exported Excel/CSV and turn them into Jira issues, with reporter attribution, dedup, and a review queue.',
    tags: ['Jira', 'Teams', 'Intake', 'Create Issue'],
    sectionKey: 'agile',
  },
  {
    id: 'text-tools',
    route: '/text-tools',
    icon: '🛠',
    title: 'Text Tools',
    description:
      'Utility suite for smart formatting, JSON cleanup, case conversion, URL and Base64 transforms, and element extraction.',
    tags: ['JSON', 'Markdown', 'Encode', 'Base64'],
    sectionKey: 'text',
  },
  {
    id: 'code-walkthrough',
    route: '/code-walkthrough',
    icon: '📖',
    title: 'Code Walkthrough',
    description:
      'In-app technical reference for architecture, workspace map, security model, data flow, and Jira/ServiceNow write paths.',
    tags: ['Security', 'Architecture', 'Audit'],
    sectionKey: 'docs',
  },
  {
    id: 'admin-hub',
    route: '/admin-hub',
    icon: '🛡️',
    title: 'Admin Hub',
    description:
      'Platform controls for integrations, ART settings, enterprise standards, diagnostics, backup and restore, and tool visibility.',
    tags: ['Admin', 'Leadership', 'Reports'],
    sectionKey: 'admin',
  },
];

/** Human-friendly labels used for the Home view recent-links strip. */
export const RECENT_VIEW_LABELS: Record<string, string> = {
  'sprint-dashboard': '🏃 Team Dashboard',
  'sprint-planning': '📋 Sprint Planning',
  'work-log': '⏱ Work Log',
  pointing: '🎲 Story Pointing',
  'pitch-deck': '🎯 Pitch Deck',
  defects: '🐛 Defect Management',
  hygiene: '🧼 Hygiene',
  pipeline: '🛤️ Pipeline View',
  'dsu-board': '🏃 Team Dashboard',
  art: '🚂 ART View',
  'my-issues': '📊 My Issues',
  'jira-intake': '📥 Jira Intake',
  'personal-toolbox': '🧰 Personal Toolbox',
  'business-helper': '💼 Business Helper',
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
