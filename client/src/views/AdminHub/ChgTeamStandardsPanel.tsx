// ChgTeamStandardsPanel.tsx — Admin Hub editor for the team's standing answers to the CHG risk check (GH #415).
//
// Some Formula Card fields have the same answer on every change. The risk check states these to the assistant and
// settles their fields itself, so nobody is asked them again. Practice changes, so they are edited here rather than
// in code. Durations are not listed: they are always worked out from the CTASK estimates.

import { useState } from 'react';

import { FORMULA_CARD_FIELDS } from '../SnowHub/chgFormula/formulaCard.ts';
import {
  readTeamStandards,
  resetTeamStandards,
  writeTeamStandards,
  type TeamStandard,
} from '../SnowHub/chgFormula/teamStandardsStore.ts';
import styles from './AdminHubView.module.css';

// Fields the CTASK estimates always settle — a standing answer for them would contradict the estimates.
const DURATION_FIELD_NAMES = new Set(['Implementation Duration', 'Validation Duration', 'Backout Duration', 'Recovery Time']);

// The card fields a standard may settle, picked from the card itself so a name always matches the review's.
const STANDARD_FIELD_NAMES = FORMULA_CARD_FIELDS
  .map((cardField) => cardField.field)
  .filter((fieldName) => !DURATION_FIELD_NAMES.has(fieldName));

/** One editable row: which field, and the team's answer for it. */
function StandardRow({ standard, rowNumber, onChange, onRemove }: {
  standard: TeamStandard;
  rowNumber: number;
  onChange: (nextStandard: TeamStandard) => void;
  onRemove: () => void;
}) {
  return (
    <div className={styles.panelSection}>
      <label className={styles.fieldLabel}>
        {`Formula Card field ${rowNumber}`}
        <select
          className={styles.inputField}
          onChange={(changeEvent) => onChange({ ...standard, fieldName: changeEvent.target.value })}
          value={standard.fieldName}
        >
          <option value="">Choose a field…</option>
          {STANDARD_FIELD_NAMES.map((fieldName) => <option key={fieldName} value={fieldName}>{fieldName}</option>)}
        </select>
      </label>
      <label className={styles.fieldLabel}>
        {`Standing answer ${rowNumber}`}
        <textarea
          className={styles.inputField}
          onChange={(changeEvent) => onChange({ ...standard, answer: changeEvent.target.value })}
          rows={2}
          value={standard.answer}
        />
      </label>
      <button className={styles.dangerButton} onClick={onRemove} type="button">
        {`Remove ${standard.fieldName || 'this standard'}`}
      </button>
    </div>
  );
}

/** The team's standing answers to the risk check, editable and saved on this machine. */
export function ChgTeamStandardsPanel(): React.JSX.Element {
  const [standards, setStandards] = useState<TeamStandard[]>(() => readTeamStandards());
  const [statusMessage, setStatusMessage] = useState('');

  const updateStandard = (rowIndex: number, nextStandard: TeamStandard) => {
    setStandards((currentStandards) => currentStandards.map((standard, index) => (index === rowIndex ? nextStandard : standard)));
    setStatusMessage('');
  };

  const removeStandard = (rowIndex: number) => {
    setStandards((currentStandards) => currentStandards.filter((_standard, index) => index !== rowIndex));
    setStatusMessage('');
  };

  const handleSave = () => {
    writeTeamStandards(standards);
    setStandards(readTeamStandards());
    setStatusMessage('Saved — the next risk check uses them.');
  };

  const handleReset = () => {
    resetTeamStandards();
    setStandards(readTeamStandards());
    setStatusMessage('Back to the default standards.');
  };

  return (
    <section className={styles.sectionCard}>
      <h2 className={styles.sectionTitle}>📐 CHG Risk Check — Team Standards</h2>
      <p className={styles.adminDescription}>
        Answers that hold for every change. The risk check gives them to the assistant as facts and marks their
        Formula Card fields as passing, so nobody is asked them again. Durations are not listed here — they always
        come from the CTASK estimates.
      </p>
      {standards.map((standard, rowIndex) => (
        <StandardRow
          key={rowIndex}
          onChange={(nextStandard) => updateStandard(rowIndex, nextStandard)}
          onRemove={() => removeStandard(rowIndex)}
          rowNumber={rowIndex + 1}
          standard={standard}
        />
      ))}
      <div className={styles.panelActions}>
        <button className={styles.actionButton} onClick={() => setStandards((current) => [...current, { fieldName: '', answer: '' }])} type="button">
          + Add standard
        </button>
        <button className={styles.saveButton} onClick={handleSave} type="button">Save standards</button>
        <button className={styles.actionButton} onClick={handleReset} type="button">Reset to defaults</button>
      </div>
      {statusMessage ? <p className={styles.panelStatusLine} role="status">{statusMessage}</p> : null}
    </section>
  );
}
