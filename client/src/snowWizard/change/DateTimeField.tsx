// DateTimeField.tsx — A planned date-time picked as a day, an Hour from a list and Minutes from a list (00/15/30/45).
//
// Replaces the browser's combined date-time popup (owner feedback: no confirm, and scrolling to "00" minutes is a
// pain). Each part is set the moment it is picked; the parts are held here until a day and hour exist, so choosing the
// day first never wipes anything.

import { useId, useState } from 'react';

import { joinDateTime, listHourOptions, listMinuteOptions, splitDateTime, type DateTimeParts } from './dateTimeParts.ts';
import styles from './ChangeWizard.module.css';

interface DateTimeFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
}

const HOUR_OPTIONS = listHourOptions();

/** One planned date-time. */
export default function DateTimeField({ label, value, onChange }: DateTimeFieldProps) {
  const dayId = useId();
  const [draftParts, setDraftParts] = useState<DateTimeParts>(() => splitDateTime(value));
  // A value set from outside (a template, a resumed job) wins over half-chosen parts.
  const storedParts = splitDateTime(value);
  const parts = value && joinDateTime(draftParts) !== value ? storedParts : draftParts;

  function updatePart(partUpdate: Partial<DateTimeParts>) {
    const nextParts = { ...parts, ...partUpdate };
    setDraftParts(nextParts);
    const joinedValue = joinDateTime(nextParts);
    if (joinedValue || value) onChange(joinedValue);
  }

  return (
    <fieldset className={styles.fieldGroup}>
      <legend className={styles.fieldLabel}>{label}</legend>
      <div className={styles.fieldRow}>
        <input id={dayId} aria-label={`${label} day`} type="date" className={styles.inputField} value={parts.day} onChange={(changeEvent) => updatePart({ day: changeEvent.target.value })} />
        <select aria-label={`${label} hour`} className={styles.inputField} value={parts.hour} onChange={(changeEvent) => updatePart({ hour: changeEvent.target.value })}>
          <option value="">Hour</option>
          {HOUR_OPTIONS.map((hourOption) => <option key={hourOption.value} value={hourOption.value}>{hourOption.label}</option>)}
        </select>
        <select aria-label={`${label} minutes`} className={styles.inputField} value={parts.minute || '00'} onChange={(changeEvent) => updatePart({ minute: changeEvent.target.value })}>
          {listMinuteOptions(parts.minute).map((minuteOption) => <option key={minuteOption} value={minuteOption}>{`:${minuteOption}`}</option>)}
        </select>
      </div>
    </fieldset>
  );
}
