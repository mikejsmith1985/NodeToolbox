// PlanningStep.tsx — Step 3 "How will it go?": the implementation, test and backout plans, and the planning answers.
//
// The answers come from ServiceNow's own lists; the three plans are free text the Release Manager reads.

import { useId } from 'react';

import type { SnowChoiceOptionMap } from '../../../views/SnowHub/hooks/useSnowChoiceOptions.ts';
import { MAIN_ASSESSMENT_QUESTIONS, MORE_ASSESSMENT_QUESTIONS, type AssessmentQuestion } from '../assessmentQuestions.ts';
import ChoiceSelect from '../ChoiceSelect.tsx';
import type { ChangeStepProps } from '../changeWizardSession.ts';
import styles from '../ChangeWizard.module.css';

/** Planning also needs ServiceNow's choice lists, read once for the whole job. */
export interface PlanningStepProps extends ChangeStepProps {
  choiceOptions: SnowChoiceOptionMap;
}

/** One plan's text area. */
function PlanEntry({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (value: string) => void }) {
  const fieldId = useId();
  return (
    <div className={styles.fieldGroup}>
      <label className={styles.fieldLabel} htmlFor={fieldId}>{label}</label>
      <p className={styles.hint}>{hint}</p>
      <textarea id={fieldId} className={styles.textArea} value={value} onChange={(changeEvent) => onChange(changeEvent.target.value)} />
    </div>
  );
}

/** A group of planning answers, each from its ServiceNow list. */
function AssessmentQuestions({ crg, choiceOptions, questions }: PlanningStepProps & { questions: readonly AssessmentQuestion[] }) {
  return (
    <div className={styles.fieldRow}>
      {questions.map((assessmentQuestion) => (
        <ChoiceSelect
          key={assessmentQuestion.stateKey}
          label={assessmentQuestion.question}
          options={choiceOptions[assessmentQuestion.choiceListName] ?? []}
          value={crg.state.chgPlanningAssessment[assessmentQuestion.stateKey]}
          onChange={(value) => crg.actions.setChgPlanningAssessment({ [assessmentQuestion.stateKey]: value })}
        />
      ))}
    </div>
  );
}

/** Step 3: how the change will be carried out, checked and undone. */
export default function PlanningStep(props: PlanningStepProps) {
  const { state, actions } = props.crg;
  const plans = state.chgPlanningContent;
  return (
    <div>
      <p className={styles.stepIntro}>Write how the change will be done, how you will know it worked, and how to undo it.</p>
      <PlanEntry label="Implementation plan (needed)" hint="Numbered steps: who does what, and how they check it worked." value={plans.implementationPlan} onChange={(text) => actions.setChgPlanningContent({ implementationPlan: text })} />
      <PlanEntry label="Test plan (needed)" hint="What was tested before, and what will be checked after the change." value={plans.testPlan} onChange={(text) => actions.setChgPlanningContent({ testPlan: text })} />
      <PlanEntry label="Backout plan (needed)" hint="When you would undo it, who decides, and the steps to put things back." value={plans.backoutPlan} onChange={(text) => actions.setChgPlanningContent({ backoutPlan: text })} />
      <AssessmentQuestions {...props} questions={MAIN_ASSESSMENT_QUESTIONS} />
      <details className={styles.moreOptions}>
        <summary>More options</summary>
        <AssessmentQuestions {...props} questions={MORE_ASSESSMENT_QUESTIONS} />
      </details>
    </div>
  );
}
