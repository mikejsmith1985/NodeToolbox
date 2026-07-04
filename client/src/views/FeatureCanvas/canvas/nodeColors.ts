// nodeColors.ts — The shared color maps for canvas card markings.
//
// Kept in a dedicated (component-free) module so both the card renderer (FeatureNode) and the
// legend (CanvasLegend) read the exact same values — the key can never drift from the cards it
// describes — without tripping React Fast Refresh's "components-only export" rule.

// Status-category → left-stripe color, matching the product's WIP zone semantics.
export const STATUS_CATEGORY_COLORS: Record<string, string> = {
  new: '#6b7280',
  indeterminate: '#3b82f6',
  done: '#22c55e',
};

// Feature-health → corner-dot accent color.
export const HEALTH_COLORS: Record<string, string> = {
  green: '#22c55e',
  yellow: '#eab308',
  red: '#ef4444',
  blue: '#3b82f6',
  gray: '#6b7280',
};
