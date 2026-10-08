// rcpNewChange.ts — The RCP checklist for a change that has not been created yet (GH #415).
//
// Before a change exists, three rules can be judged from what is typed — the window, the justification, and
// that a Director is named — and two cannot: the approval email can only be attached to a record that exists,
// and the risk level is calculated by ServiceNow on save. Those two are reported as "confirm once created"
// rather than guessed. The dates typed here are the user's own local time.

import type { SnowReference } from '../hooks/useCrgState.ts';
import type { RcpApprovalEmailContext } from './rcpApprovalEmail.ts';
import {
  checkImplementationWindow,
  checkJustification,
  checkLeadTime,
  checkRequestedByIsDirector,
  describeCentralWindow,
  type RcpCheckResult,
} from './rcpRules.ts';

/** What the change builder holds that the RCP rules judge. */
export interface NewChangeRcpInput {
  /** The enabled Production environment (PRD, else PFIX); null when the change is not for Production. */
  productionEnvironment: {
    label: string;
    plannedStartUtc: string | null;
    plannedEndUtc: string | null;
    configItem: SnowReference;
  } | null;
  totalEstimateMinutes: number | null;
  requestedBy: SnowReference;
  justification: string;
  shortDescription: string;
  backoutPlan: string;
  todayIso: string;
}

/** The checklist and the approval-email facts for a new change. */
export interface NewChangeRcpEvaluation {
  results: RcpCheckResult[];
  emailContext: RcpApprovalEmailContext;
}

/** A date-time typed into the builder (local time) as an ISO instant, or null when there is none. */
export function readLocalDateTimeAsUtc(localDateTime: string): string | null {
  if (localDateTime.trim() === '') {
    return null;
  }
  const parsedTime = Date.parse(localDateTime);
  return Number.isNaN(parsedTime) ? null : new Date(parsedTime).toISOString();
}

/** The RCP checklist for a change still being built; null when it is not a Production change. */
export function evaluateNewChangeRcp(input: NewChangeRcpInput): NewChangeRcpEvaluation | null {
  const environment = input.productionEnvironment;
  if (environment === null) {
    return null;
  }
  const results: RcpCheckResult[] = [
    checkImplementationWindow({ ...environment, totalEstimateMinutes: input.totalEstimateMinutes }),
    checkRequestedByIsDirector(input.requestedBy, null),
    {
      ruleId: 'approval',
      title: 'Director approval attached',
      status: 'check',
      detail: 'Once the change is created, attach the Director\'s approval email to it — then re-check it in Modify Existing CHG.',
    },
    checkJustification(input.justification),
    checkLeadTime({ riskLabel: '', todayIso: input.todayIso, plannedStartUtc: environment.plannedStartUtc }),
  ];
  return {
    results,
    emailContext: {
      changeNumber: '[CONFIRM: change number once created]',
      shortDescription: input.shortDescription,
      environmentLabel: environment.label,
      windowText: describeCentralWindow(environment.plannedStartUtc, environment.plannedEndUtc),
      configItemName: environment.configItem.displayName,
      directorName: input.requestedBy.displayName,
      riskLabel: '',
      justification: input.justification,
      backoutPlan: input.backoutPlan,
    },
  };
}
