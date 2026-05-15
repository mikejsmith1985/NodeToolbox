// useCrgFieldPins.ts — Persists reusable CRG field values so users can build ad hoc defaults from multiple cloned CHGs.

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { SnowReference } from './useCrgState.ts';

const CRG_FIELD_PINS_STORAGE_KEY = 'ntbx-crg-field-pins';

type PinnedFieldValue = string | boolean | SnowReference;

export interface CrgPinnedField {
  id: string;
  key: string;
  label: string;
  section: string;
  value: PinnedFieldValue;
}

export type CrgPinnedFieldInput = Omit<CrgPinnedField, 'id'>;

interface UseCrgFieldPinsResult {
  pinnedFields: CrgPinnedField[];
  upsertPin: (pinnedField: CrgPinnedFieldInput) => void;
  removePin: (pinId: string) => void;
  clearPins: () => void;
  getPinnedFields: (fieldKey: string) => CrgPinnedField[];
  findPinnedField: (fieldKey: string, fieldValue: PinnedFieldValue) => CrgPinnedField | undefined;
}

function loadPinnedFieldsFromStorage(): CrgPinnedField[] {
  try {
    const storedJson = localStorage.getItem(CRG_FIELD_PINS_STORAGE_KEY);
    if (!storedJson) {
      return [];
    }

    const parsedValue = JSON.parse(storedJson) as unknown;
    return Array.isArray(parsedValue) ? (parsedValue as CrgPinnedField[]) : [];
  } catch {
    return [];
  }
}

function savePinnedFieldsToStorage(pinnedFields: CrgPinnedField[]): void {
  try {
    localStorage.setItem(CRG_FIELD_PINS_STORAGE_KEY, JSON.stringify(pinnedFields));
  } catch {
    // Storage access can fail in private browsing; in-memory state remains authoritative.
  }
}

function serializePinnedFieldValue(fieldValue: PinnedFieldValue): string {
  if (typeof fieldValue === 'string') {
    return `string:${fieldValue.trim()}`;
  }

  if (typeof fieldValue === 'boolean') {
    return `boolean:${fieldValue ? 'true' : 'false'}`;
  }

  return `reference:${fieldValue.sysId.trim()}|${fieldValue.displayName.trim()}`;
}

function buildPinnedFieldId(fieldKey: string, fieldValue: PinnedFieldValue): string {
  return `${fieldKey}:${serializePinnedFieldValue(fieldValue)}`;
}

/**
 * Stores intentionally pinned ServiceNow values so each CRG field can offer reusable
 * pinned options without forcing every variation into a full template.
 */
export function useCrgFieldPins(): UseCrgFieldPinsResult {
  const [pinnedFields, setPinnedFields] = useState<CrgPinnedField[]>(() => loadPinnedFieldsFromStorage());

  useEffect(() => {
    savePinnedFieldsToStorage(pinnedFields);
  }, [pinnedFields]);

  const upsertPin = useCallback((pinnedField: CrgPinnedFieldInput) => {
    const nextPinnedField: CrgPinnedField = {
      ...pinnedField,
      id: buildPinnedFieldId(pinnedField.key, pinnedField.value),
    };

    setPinnedFields((previousPins) => {
      const remainingPins = previousPins.filter((existingPin) => existingPin.id !== nextPinnedField.id);
      return [...remainingPins, nextPinnedField].sort((leftPin, rightPin) =>
        `${leftPin.section}:${leftPin.label}:${leftPin.id}`.localeCompare(`${rightPin.section}:${rightPin.label}:${rightPin.id}`),
      );
    });
  }, []);

  const removePin = useCallback((pinId: string) => {
    setPinnedFields((previousPins) => previousPins.filter((existingPin) => existingPin.id !== pinId));
  }, []);

  const clearPins = useCallback(() => {
    setPinnedFields([]);
  }, []);

  const pinnedFieldsByKey = useMemo(() => {
    const groupedPins = new Map<string, CrgPinnedField[]>();
    pinnedFields.forEach((pinnedField) => {
      const existingPins = groupedPins.get(pinnedField.key) ?? [];
      groupedPins.set(pinnedField.key, [...existingPins, pinnedField]);
    });
    return groupedPins;
  }, [pinnedFields]);

  const getPinnedFields = useCallback((fieldKey: string) => {
    return pinnedFieldsByKey.get(fieldKey) ?? [];
  }, [pinnedFieldsByKey]);

  const findPinnedField = useCallback((fieldKey: string, fieldValue: PinnedFieldValue) => {
    const targetPinId = buildPinnedFieldId(fieldKey, fieldValue);
    return pinnedFieldsByKey.get(fieldKey)?.find((pinnedField) => pinnedField.id === targetPinId);
  }, [pinnedFieldsByKey]);

  return {
    pinnedFields,
    upsertPin,
    removePin,
    clearPins,
    getPinnedFields,
    findPinnedField,
  };
}
