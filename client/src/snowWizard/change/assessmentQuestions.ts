// assessmentQuestions.ts — The change's pick-from-a-list answers, each in plain words with the ServiceNow list feeding it.
//
// One list shared by the Details/Planning screens and the AI draft prompt, so the AI is asked exactly the questions the
// screens show and can only answer with a value from the same ServiceNow list.

import type { ChgBasicInfo, ChgPlanningAssessment } from '../../views/SnowHub/hooks/useCrgState.ts';

/** One planning answer: its plain question, and which ServiceNow list feeds it. */
export interface AssessmentQuestion {
  stateKey: keyof ChgPlanningAssessment;
  choiceListName: string;
  question: string;
}

/** One pick-from-a-list detail on "Tell us about the change". */
export interface DetailChoice {
  stateKey: keyof Pick<ChgBasicInfo, 'category' | 'changeType'>;
  choiceListName: string;
  question: string;
}

/** The planning answers shown first. */
export const MAIN_ASSESSMENT_QUESTIONS: readonly AssessmentQuestion[] = [
  { stateKey: 'impact', choiceListName: 'impact', question: 'How many people does it affect?' },
  { stateKey: 'hasBeenTested', choiceListName: 'u_change_tested', question: 'Has it been tested?' },
  { stateKey: 'canBeBackedOut', choiceListName: 'u_can_be_backed_out', question: 'Can it be backed out?' },
  { stateKey: 'successProbability', choiceListName: 'u_success_probability', question: 'How likely is it to succeed?' },
];

/** The planning answers folded under "More". */
export const MORE_ASSESSMENT_QUESTIONS: readonly AssessmentQuestion[] = [
  { stateKey: 'systemAvailabilityImplication', choiceListName: 'u_availability_impact', question: 'Will systems be unavailable?' },
  { stateKey: 'hasBeenPerformedPreviously', choiceListName: 'u_performed_previously', question: 'Has this been done before?' },
  { stateKey: 'impactedPersonsAware', choiceListName: 'u_impacted_persons_aware', question: 'Are the people affected ready for checkout?' },
];

/** The two pick-from-a-list details. */
export const DETAIL_CHOICES: readonly DetailChoice[] = [
  { stateKey: 'category', choiceListName: 'category', question: 'Category' },
  { stateKey: 'changeType', choiceListName: 'type', question: 'Change type' },
];
