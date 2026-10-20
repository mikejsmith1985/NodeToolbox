// wizardJobProps.ts — The one contract every Wizard job screen follows, so Home can open any of them the same way.

/** The three jobs offered on Home. */
export type WizardJobId = 'change' | 'prb' | 'review';

/** What Home hands every job: the way back to Home. */
export interface WizardJobProps {
  onExit: () => void;
}

/** The job ids in Home's order, for code that needs to walk them. */
export const WIZARD_JOB_IDS: readonly WizardJobId[] = ['change', 'prb', 'review'];
