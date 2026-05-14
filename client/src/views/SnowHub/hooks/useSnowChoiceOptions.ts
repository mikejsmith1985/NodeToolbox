// useSnowChoiceOptions — Fetches planning dropdown choices from the SNow sys_choice table.
// Falls back to hardcoded options when the relay is unavailable or the request fails.
// This ensures the dropdowns always match the options a user would see in ServiceNow itself.

import { useEffect, useState } from 'react';

import { snowFetch } from '../../../services/snowApi.ts';

/** A single selectable option in a SNow choice field (label is what the user sees). */
export interface SnowChoiceOption {
  value: string;
  label: string;
}

/** Maps a SNow field name to its resolved list of selectable options. */
export type SnowChoiceOptionMap = Record<string, SnowChoiceOption[]>;

// All change_request choice fields we want to resolve in one API call.
const CHANGE_REQUEST_CHOICE_FIELDS = [
  'category',
  'type',
  'u_environment',
  'impact',
  'u_availability_impact',
  'u_change_tested',
  'u_impacted_persons_aware',
  'u_performed_previously',
  'u_success_probability',
  'u_can_be_backed_out',
] as const;

type ChangeRequestChoiceField = (typeof CHANGE_REQUEST_CHOICE_FIELDS)[number];

// ── Hardcoded fallbacks used when the SNow relay is unavailable ──
// These represent typical enterprise SNow option sets and are shown until
// the live options load, or permanently if the relay/sys_choice fetch fails.
const FALLBACK_OPTIONS: Record<ChangeRequestChoiceField, SnowChoiceOption[]> = {
  category: [
    { value: '',               label: '' },
    { value: 'Software',       label: 'Software' },
    { value: 'Hardware',       label: 'Hardware' },
    { value: 'Network',        label: 'Network' },
    { value: 'Infrastructure', label: 'Infrastructure' },
    { value: 'Database',       label: 'Database' },
    { value: 'Security',       label: 'Security' },
    { value: 'Other',          label: 'Other' },
  ],
  type: [
    { value: '',          label: '' },
    { value: 'Normal',    label: 'Normal' },
    { value: 'Standard',  label: 'Standard' },
    { value: 'Emergency', label: 'Emergency' },
  ],
  u_environment: [
    { value: '',                   label: '' },
    { value: 'Production',         label: 'Production' },
    { value: 'Production Fix',     label: 'Production Fix' },
    { value: 'Development',        label: 'Development' },
    { value: 'Test/QA',            label: 'Test/QA' },
    { value: 'Staging',            label: 'Staging' },
    { value: 'Disaster Recovery',  label: 'Disaster Recovery' },
  ],
  impact: [
    { value: '',           label: '' },
    { value: '1 - High',   label: '1 - High' },
    { value: '2 - Medium', label: '2 - Medium' },
    { value: '3 - Low',    label: '3 - Low' },
  ],
  u_availability_impact: [
    { value: '',             label: '' },
    { value: 'Interruption', label: 'Interruption' },
    { value: 'Degradation',  label: 'Degradation' },
    { value: 'No Impact',    label: 'No Impact' },
  ],
  u_change_tested: [
    { value: '',    label: '' },
    { value: 'Yes', label: 'Yes' },
    { value: 'No',  label: 'No' },
  ],
  u_impacted_persons_aware: [
    { value: '',    label: '' },
    { value: 'Yes', label: 'Yes' },
    { value: 'No',  label: 'No' },
  ],
  u_performed_previously: [
    { value: '',    label: '' },
    { value: 'Yes', label: 'Yes' },
    { value: 'No',  label: 'No' },
  ],
  u_success_probability: [
    { value: '',               label: '' },
    { value: '100%',           label: '100%' },
    { value: '90-99%',         label: '90-99%' },
    { value: '70-89%',         label: '70-89%' },
    { value: '50-69%',         label: '50-69%' },
    { value: 'Less than 50%',  label: 'Less than 50%' },
  ],
  u_can_be_backed_out: [
    { value: '',          label: '' },
    { value: 'Yes',       label: 'Yes' },
    { value: 'No',        label: 'No' },
    { value: 'Partially', label: 'Partially' },
  ],
};

interface SysChoiceRecord {
  element: string;
  value:   string;
  label:   string;
}

interface SysChoiceResponse {
  result: SysChoiceRecord[];
}

/**
 * Builds a sys_choice query URL that fetches all choice options for the given
 * fields on the change_request table in a single API call.
 */
function buildSysChoicePath(fields: readonly string[]): string {
  const fieldList = fields.join(',');
  const query = encodeURIComponent(
    `name=change_request^elementIN${fieldList}^language=en^inactive=false`,
  );
  return `/api/now/table/sys_choice?sysparm_query=${query}&sysparm_fields=element,value,label&sysparm_limit=200&sysparm_display_value=false`;
}

/**
 * Groups a flat list of sys_choice records into a map from field name → options.
 * Prepends an empty option to every list so the user can leave a field blank.
 */
function groupChoicesByField(records: SysChoiceRecord[]): SnowChoiceOptionMap {
  const grouped: SnowChoiceOptionMap = {};

  for (const record of records) {
    if (!grouped[record.element]) {
      grouped[record.element] = [{ value: '', label: '' }];
    }
    grouped[record.element].push({ value: record.value, label: record.label });
  }

  return grouped;
}

interface UseSnowChoiceOptionsResult {
  /** Options per field name — guaranteed to have at least the hardcoded fallbacks. */
  choiceOptions: SnowChoiceOptionMap;
  /** True while the sys_choice fetch is in flight. */
  isLoadingChoices: boolean;
  /** True if the live fetch succeeded (options are from SNow, not hardcoded). */
  areChoicesFromSnow: boolean;
}

/**
 * Fetches all change_request dropdown choices from the SNow sys_choice table in one
 * API call, then replaces the hardcoded fallback options with the live SNow values.
 * If the relay is unavailable or the request fails, the hardcoded fallbacks remain.
 */
export function useSnowChoiceOptions(): UseSnowChoiceOptionsResult {
  const [choiceOptions, setChoiceOptions] = useState<SnowChoiceOptionMap>(
    // Start with hardcoded fallbacks so the dropdowns are usable immediately.
    () => ({ ...FALLBACK_OPTIONS }),
  );
  const [isLoadingChoices, setIsLoadingChoices]   = useState<boolean>(false);
  const [areChoicesFromSnow, setAreChoicesFromSnow] = useState<boolean>(false);

  useEffect(() => {
    let isCancelled = false;

    async function fetchChoiceOptions() {
      setIsLoadingChoices(true);
      try {
        const path = buildSysChoicePath(CHANGE_REQUEST_CHOICE_FIELDS);
        const response = await snowFetch<SysChoiceResponse>(path);
        if (isCancelled) return;

        const liveOptions = groupChoicesByField(response.result ?? []);

        // Merge live options over the fallbacks — fields with no live data keep
        // their fallback options so the UI never shows an empty dropdown.
        setChoiceOptions((previous) => ({ ...previous, ...liveOptions }));
        setAreChoicesFromSnow(true);
      } catch {
        // Relay not connected, session expired, or SNow returned an error —
        // silently stay with hardcoded fallbacks.
      } finally {
        if (!isCancelled) setIsLoadingChoices(false);
      }
    }

    void fetchChoiceOptions();

    return () => { isCancelled = true; };
  }, []);

  return { choiceOptions, isLoadingChoices, areChoicesFromSnow };
}
