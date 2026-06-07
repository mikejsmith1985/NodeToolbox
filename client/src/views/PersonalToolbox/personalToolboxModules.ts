// personalToolboxModules.ts — Registry of top-level toolbox modules available in Personal Toolbox.

import type { ComponentType } from 'react';

import AdminHubView from '../AdminHub/AdminHubView.tsx';
import ArtView from '../ArtView/ArtView.tsx';
import BusinessHelperView from '../BusinessHelper/BusinessHelperView.tsx';
import CodeWalkthroughView from '../CodeWalkthrough/CodeWalkthroughView.tsx';

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
    description: 'Sprint execution hub with blockers, defects, metrics, Feature Review, PI Review, and releases.',
    component: SprintDashboardView,
  },
  {
    id: 'art',
    title: 'ART View',
    description: 'Release-train visibility for dependencies, blueprint rollups, PI Review, releases, and team health.',
    component: ArtView,
  },
  {
    id: 'my-issues',
    title: 'My Issues',
    description: 'Personal Jira and linked ServiceNow queue with hygiene checks, swimlanes, and issue actions.',
    component: MyIssuesView,
  },
  {
    id: 'business-helper',
    title: 'Business Helper',
    description: 'Business-friendly Jira search and the Stablization funding workflow with mappings and custom columns.',
    component: BusinessHelperView,
  },
  {
    id: 'reports-hub',
    title: 'Reports Hub',
    description: 'Leadership reporting views for delivery, defects, risks, flow, quality, sprint health, and throughput.',
    component: ReportsHubView,
  },
  {
    id: 'snow-hub',
    title: 'SNow Hub',
    description: 'ServiceNow workflows for changes, problem conversion, release coordination, and sync monitoring.',
    component: SnowHubView,
  },
  {
    id: 'text-tools',
    title: 'Text Tools',
    description: 'Formatting, conversion, encoding, and extraction utilities for day-to-day copy-paste work.',
    component: TextToolsView,
  },
  {
    id: 'code-walkthrough',
    title: 'Code Walkthrough',
    description: 'In-app technical reference for architecture, workspace structure, data flow, and guarded write paths.',
    component: CodeWalkthroughView,
  },
  {
    id: 'admin-hub',
    title: 'Admin Hub',
    description: 'Administrative controls for integrations, standards, diagnostics, backup and restore, and visibility.',
    component: AdminHubView,
  },
] as const;
