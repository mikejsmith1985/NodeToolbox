// personalToolboxModules.ts — Registry of top-level toolbox modules available in Personal Toolbox.

import type { ComponentType } from 'react';

import AdminHubView from '../AdminHub/AdminHubView.tsx';
import ArtView from '../ArtView/ArtView.tsx';
import CodeWalkthroughView from '../CodeWalkthrough/CodeWalkthroughView.tsx';
import DevWorkspaceView from '../DevWorkspace/DevWorkspaceView.tsx';
import MyIssuesView from '../MyIssues/MyIssuesView.tsx';
import ReportsHubView from '../ReportsHub/ReportsHubView.tsx';
import SnowHubView from '../SnowHub/SnowHubView.tsx';
import SprintDashboardView from '../SprintDashboard/SprintDashboardView.tsx';
import TextToolsView from '../TextTools/TextToolsView.tsx';

export interface PersonalToolboxModuleDefinition {
  id: string;
  title: string;
  description: string;
  component: ComponentType;
}

/** Ordered module list used for first-load defaults and builder options. */
export const PERSONAL_TOOLBOX_MODULES: readonly PersonalToolboxModuleDefinition[] = [
  {
    id: 'sprint-dashboard',
    title: 'Team Dashboard',
    description: 'Sprint execution, standup, metrics, and delivery tracking.',
    component: SprintDashboardView,
  },
  {
    id: 'art',
    title: 'ART View',
    description: 'Release train overview and portfolio health visibility.',
    component: ArtView,
  },
  {
    id: 'my-issues',
    title: 'My Issues',
    description: 'Personal Jira work queue, hygiene, and status actions.',
    component: MyIssuesView,
  },
  {
    id: 'dev-workspace',
    title: 'Dev Workspace',
    description: 'Developer-focused workflows, hygiene, and repo monitoring.',
    component: DevWorkspaceView,
  },
  {
    id: 'reports-hub',
    title: 'Reports Hub',
    description: 'Portfolio and delivery reporting views for leadership.',
    component: ReportsHubView,
  },
  {
    id: 'snow-hub',
    title: 'SNow Hub',
    description: 'ServiceNow automation and Jira-to-SNow workflows.',
    component: SnowHubView,
  },
  {
    id: 'text-tools',
    title: 'Text Tools',
    description: 'Formatting and conversion utilities for day-to-day work.',
    component: TextToolsView,
  },
  {
    id: 'code-walkthrough',
    title: 'Code Walkthrough',
    description: 'Architecture and system transparency documentation tools.',
    component: CodeWalkthroughView,
  },
  {
    id: 'admin-hub',
    title: 'Admin Hub',
    description: 'Administration, leadership, and operational controls.',
    component: AdminHubView,
  },
] as const;

