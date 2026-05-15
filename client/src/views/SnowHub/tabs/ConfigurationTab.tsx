// ConfigurationTab.tsx — Dedicated CRG setup tab for cloning changes, saving defaults, and managing CTASK templates.

import CrgTab from './CrgTab.tsx';

/**
 * Renders the dedicated CRG configuration workspace so users can prepare reusable defaults
 * outside the step-by-step CHG creation flow.
 */
export default function ConfigurationTab() {
  return <CrgTab mode="configuration" />;
}
