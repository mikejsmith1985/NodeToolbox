// usePoHygieneContext.ts — Gives the PO Tool the same hygiene verdict the Hygiene tool would give.
//
// The point of this feature is that hygiene stops being an after-the-fact audit and becomes a guardrail
// while the Feature is written. That only works if it is the SAME engine and the SAME rules — a second
// opinion here would be worse than none, because a PO would clean a Feature only to see it flagged later.
//
// So this hook builds nothing of its own. It assembles the inputs the shared evaluator wants — the live
// instance's field config, the enterprise rules an admin configured, the team's own settings — and hands
// them over unchanged.

import { useCallback, useEffect, useState } from 'react';

import {
  loadEnterpriseRulesFromStorage,
  readEnabledBuiltInCheckIds,
  readEnabledRequiredFieldRules,
} from '../../AdminHub/enterpriseRules';
import { loadHygieneFieldConfig } from '../../Hygiene/checks/hygieneFieldConfig';
import {
  evaluateHygieneIssue,
  resolveHygieneFieldConfig,
  type HygieneEvaluationContext,
  type HygieneFieldConfig,
  type HygieneFlag,
  type JiraIssue as HygieneIssue,
} from '../../Hygiene/checks/hygieneChecks';
import { loadDashboardConfigFromStorage } from '../../SprintDashboard/hooks/useDashboardConfig';

export interface PoHygieneContext {
  /** Evaluates one issue-shaped draft against the shared rules. Returns [] for a clean draft. */
  evaluateDraft: (issue: HygieneIssue) => HygieneFlag[];
  /** The resolved field config — HygieneFixControl needs the resolved form, not a partial. */
  fieldConfig: HygieneFieldConfig;
  /** True until the live field config has been read; until then the verdict uses defaults only. */
  isLoadingFieldConfig: boolean;
  /** Set when the instance's field list could not be read — the verdict is then less accurate. */
  fieldConfigError: string | null;
}

/**
 * Assembles the hygiene evaluation context for the PO Tool's team.
 *
 * The field config comes from the live instance, which is what makes the "skip a check whose field this
 * Jira does not have" behaviour work — that is why an unconfigured field never false-flags a draft.
 */
export function usePoHygieneContext(dashboardTeamProfileId: string): PoHygieneContext {
  const [fieldConfig, setFieldConfig] = useState<HygieneFieldConfig>(() => resolveHygieneFieldConfig());
  const [isLoadingFieldConfig, setIsLoadingFieldConfig] = useState(true);
  const [fieldConfigError, setFieldConfigError] = useState<string | null>(null);

  useEffect(() => {
    // No setState before the await: the state already starts as loading, and setting it again here
    // would only trigger an extra render pass.
    let isActive = true;

    loadHygieneFieldConfig()
      .then((resolvedFieldConfig) => {
        if (!isActive) {
          return;
        }
        setFieldConfig(resolvedFieldConfig);
        setFieldConfigError(null);
      })
      .catch((loadError: unknown) => {
        if (!isActive) {
          return;
        }
        // Falling back to defaults keeps the checklist working; saying so keeps it honest, because a
        // default-only config can miss fields this instance actually uses.
        setFieldConfigError(
          loadError instanceof Error
            ? `Could not read this Jira's field list, so the checklist may be incomplete: ${loadError.message}`
            : "Could not read this Jira's field list, so the checklist may be incomplete.",
        );
      })
      .finally(() => {
        if (isActive) {
          setIsLoadingFieldConfig(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  const evaluateDraft = useCallback(
    (issue: HygieneIssue): HygieneFlag[] => {
      // Read per evaluation rather than cached: an admin can change the enabled rules in another tab,
      // and a stale rule set would quietly grade a draft against standards that no longer apply.
      const enterpriseRules = loadEnterpriseRulesFromStorage();
      const dashboardConfig = loadDashboardConfigFromStorage(dashboardTeamProfileId);

      const evaluationContext: HygieneEvaluationContext = {
        fieldConfig,
        enabledBuiltInCheckIds: readEnabledBuiltInCheckIds(enterpriseRules),
        customRules: readEnabledRequiredFieldRules(enterpriseRules),
        customStoryPointsFieldId: dashboardConfig.customStoryPointsFieldId || '',
        staleDaysThreshold: dashboardConfig.staleDaysThreshold,
      };

      return evaluateHygieneIssue(issue, evaluationContext);
    },
    [dashboardTeamProfileId, fieldConfig],
  );

  return { evaluateDraft, fieldConfig, isLoadingFieldConfig, fieldConfigError };
}
