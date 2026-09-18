// IntakeQuestionList.tsx — The PO's questions for the current step, each a closed choice with any suggestion shown
// beside it and pre-selected: pick, don't type (spec 037, contracts/composition-mode.md §3).

import { useState } from 'react';

import compositionStyles from '../../FeatureCompositionTab.module.css';
import {
  INTAKE_LABELS,
  ITEM_KINDS,
  ITEM_OWNERS,
  readItemDisplayTitle,
  SET_ASIDE_REASONS,
  type Decision,
  type DuplicateVerdict,
  type EpicIntake,
  type IntakeItem,
  type IntakeLabel,
  type ItemKind,
  type ItemOwner,
  type SetAsideReason,
} from '../epicIntakeModel.ts';
import type { OpenDecision } from '../intakeChecklist.ts';
import { answerDuplicate, answerKind, answerLabel, answerOwner, placeLine, type LinePlacement } from '../intakePoAnswers.ts';
import styles from '../EpicIntakeWorkspace.module.css';
import { ITEM_KIND_LABELS, ITEM_OWNER_LABELS, SET_ASIDE_REASON_LABELS } from './intakeLabels.ts';

interface IntakeQuestionListProps {
  intake: EpicIntake;
  questions: readonly OpenDecision[];
  onChange: (intake: EpicIntake) => void;
  nowIso: () => string;
}

interface ChoiceOption {
  value: string;
  label: string;
}

/** Everything one question needs: what to ask, the choices, any suggestion, and how an answer changes the intake. */
interface QuestionSpec {
  key: string;
  prompt: string;
  hint: string | null;
  options: ChoiceOption[];
  suggestedValue: string | null;
  applyAnswer: (value: string, nowIso: string) => EpicIntake;
}

const NEW_EPIC_VALUE = 'createNew';
const NOT_ACTIONABLE_VALUE = 'notActionable';
const SET_ASIDE_PREFIX = 'setAside:';

// ── One question ──

interface ChoiceQuestionProps {
  spec: QuestionSpec;
  onAnswer: (value: string) => void;
}

/** One closed-choice question with an explicit Save, so a stray keystroke never records an answer. */
function ChoiceQuestion({ spec, onAnswer }: ChoiceQuestionProps) {
  const [selectedValue, setSelectedValue] = useState(spec.suggestedValue ?? '');
  const questionId = `intake-${spec.key}`;
  return (
    <li className={styles.intakeQuestion}>
      <label className={compositionStyles.fieldLabel} htmlFor={questionId}>{spec.prompt}</label>
      {spec.hint ? <p className={styles.intakeQuestionHint}>{spec.hint}</p> : null}
      <div className={styles.intakeActions}>
        <select
          id={questionId}
          className={compositionStyles.selectInput}
          value={selectedValue}
          onChange={(changeEvent) => setSelectedValue(changeEvent.target.value)}
        >
          <option value="">Choose…</option>
          {spec.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        <button
          type="button"
          className={compositionStyles.secondaryButton}
          disabled={selectedValue === ''}
          onClick={() => onAnswer(selectedValue)}
        >
          Save
        </button>
      </div>
    </li>
  );
}

// ── Options ──

function buildMatchOptions(item: IntakeItem): ChoiceOption[] {
  const candidates = item.candidates.map((candidate) => ({
    value: candidate.key,
    label: `${candidate.key} — ${candidate.summary} [${candidate.statusName}]`,
  }));
  const unusableKeys = item.namedKeys
    .filter((namedKey) => namedKey.lookup.status === 'unusable')
    .map((namedKey) => ({ value: namedKey.key, label: `Use ${namedKey.key} anyway` }));
  return [
    ...candidates,
    ...unusableKeys,
    { value: NEW_EPIC_VALUE, label: 'None of these — create a new Epic' },
    { value: NOT_ACTIONABLE_VALUE, label: 'Not actionable' },
  ];
}

function readVerdictValue(verdict: DuplicateVerdict): string {
  return verdict.verdict === 'existing' ? verdict.key : verdict.verdict;
}

function toVerdict(value: string): DuplicateVerdict {
  if (value === NEW_EPIC_VALUE) return { verdict: 'createNew' };
  return value === NOT_ACTIONABLE_VALUE ? { verdict: 'notActionable' } : { verdict: 'existing', key: value };
}

function buildLineOptions(intake: EpicIntake): ChoiceOption[] {
  const itemOptions = intake.items.map((item) => ({ value: item.id, label: `Part of: ${readItemDisplayTitle(item)}` }));
  const setAsideOptions = SET_ASIDE_REASONS.map((reason) => ({
    value: `${SET_ASIDE_PREFIX}${reason}`,
    label: `Set aside — ${SET_ASIDE_REASON_LABELS[reason]}`,
  }));
  return [...itemOptions, ...setAsideOptions];
}

function toPlacement(value: string): LinePlacement {
  return value.startsWith(SET_ASIDE_PREFIX)
    ? { setAsideReason: value.slice(SET_ASIDE_PREFIX.length) as SetAsideReason }
    : { itemId: value };
}

// ── Specs ──

/** The suggestion and hint on an open decision, or nothing once it is settled. */
function readSuggestion<TValue>(
  decision: Decision<TValue>,
  formatValue: (value: TValue) => string,
): { hint: string | null; suggestedValue: string | null } {
  if (decision.state !== 'open') {
    return { hint: null, suggestedValue: null };
  }
  return {
    hint: decision.aiReason ?? decision.lastRejection,
    suggestedValue: decision.aiProposal === null ? null : formatValue(decision.aiProposal),
  };
}

function buildLineSpec(lineNumber: number, intake: EpicIntake): QuestionSpec {
  const lineText = intake.lines.find((candidate) => candidate.lineNumber === lineNumber)?.text ?? '';
  return {
    key: `line-${lineNumber}`,
    prompt: `Where does line ${lineNumber} belong? "${lineText}"`,
    hint: 'Each line belongs to exactly one item, or is set aside.',
    options: buildLineOptions(intake),
    suggestedValue: null,
    applyAnswer: (value, nowIso) => placeLine(intake, lineNumber, toPlacement(value), nowIso),
  };
}

function buildItemSpec(question: OpenDecision, intake: EpicIntake, item: IntakeItem): QuestionSpec | null {
  const title = readItemDisplayTitle(item);
  const key = `${question.slot}-${item.id}`;
  const { decisions } = item;
  switch (question.slot) {
    case 'kind':
      return {
        key, prompt: `What is "${title}"?`, ...readSuggestion(decisions.kind, String),
        options: ITEM_KINDS.map((kind) => ({ value: kind, label: ITEM_KIND_LABELS[kind] })),
        applyAnswer: (value, nowIso) => answerKind(intake, item.id, value as ItemKind, nowIso),
      };
    case 'owner':
      return {
        key, prompt: `Who owns "${title}"?`, ...readSuggestion(decisions.owner, String),
        options: ITEM_OWNERS.map((owner) => ({ value: owner, label: ITEM_OWNER_LABELS[owner] })),
        applyAnswer: (value, nowIso) => answerOwner(intake, item.id, value as ItemOwner, nowIso),
      };
    case 'duplicate':
      return {
        key, prompt: `Does an open Epic already cover "${title}"?`, ...readSuggestion(decisions.duplicate, readVerdictValue),
        options: buildMatchOptions(item),
        applyAnswer: (value, nowIso) => answerDuplicate(intake, item.id, toVerdict(value), nowIso),
      };
    case 'label':
      return {
        key, prompt: `Label for the new Epic "${title}"`, ...readSuggestion(decisions.label, String),
        options: INTAKE_LABELS.map((label) => ({ value: label, label })),
        applyAnswer: (value, nowIso) => answerLabel(intake, item.id, value as IntakeLabel, nowIso),
      };
    default:
      return null;
  }
}

function buildQuestionSpec(question: OpenDecision, intake: EpicIntake): QuestionSpec | null {
  if (question.slot === 'lineCoverage') {
    return question.lineNumber === undefined ? null : buildLineSpec(question.lineNumber, intake);
  }
  const item = intake.items.find((candidate) => candidate.id === question.itemId);
  return item === undefined ? null : buildItemSpec(question, intake, item);
}

/** The list of closed-choice questions the PO is asked in the current step. */
export default function IntakeQuestionList({ intake, questions, onChange, nowIso }: IntakeQuestionListProps) {
  const specs = questions
    .map((question) => buildQuestionSpec(question, intake))
    .filter((spec): spec is QuestionSpec => spec !== null);
  if (specs.length === 0) {
    return null;
  }
  return (
    <ul className={styles.intakeQuestionList} aria-label="Questions for you">
      {specs.map((spec) => (
        <ChoiceQuestion key={spec.key} spec={spec} onAnswer={(value) => onChange(spec.applyAnswer(value, nowIso()))} />
      ))}
    </ul>
  );
}
