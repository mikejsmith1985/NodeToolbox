# Contract: Admin Access & AI Visibility (Area 2)

This is a **change contract** (what is removed / preserved / fixed), not an external API contract.
The server `/api/admin-verify` and the `aiAssistStore` passphrase gate are **unchanged**.

---

## Removed

| Element | Location | Why |
|---------|----------|-----|
| "Hidden prompt tools" checkbox (JSX + props) | `AdminHubView.tsx:525-536`, props `:444/:449/:473`, wiring `:2619` | Only AI element visible on admin unlock; the leak the owner reported |
| `FeatureFlags.isAiEnabled` | `useAdminHubState.ts:99` | Orphan flag — zero consumers app-wide |
| `FEATURE_AI_KEY = 'tbxFeatureAIVisible'` + init + toggle branch | `useAdminHubState.ts:30, :396, :725-740` | Backing store for the removed flag |
| `isAiEnabled` test fixture field | `AdminHubView.test.tsx:27` | Follows the type removal |

After removal, `onToggleFeatureFlag` handles only `isSnowIntegrationEnabled`.

## Preserved (must NOT change)

| Element | Location | Note |
|---------|----------|------|
| Ctrl+Alt+Z passphrase machinery | `AdminHubView.tsx:2703-2753, :2794-2815` | Appears only after the passphrase — never on admin unlock; the intended owner-only path |
| "⚡ AI Assist" tab + `AiAssistAutomationPanel` | `AdminHubView.tsx:2751-2753, :2900-2904` | Owner-only (passphrase-gated); hosts AI-assist automation config reachable nowhere else |
| SNow / GitHub proxy URL fields | `AdminHubView.tsx:267` | Admin-gated operational feature |
| Service-connectivity credential editor | `AdminHubView.tsx:1306-1310` | Admin-gated operational feature |
| Advanced feature controls (SNow Integration) + Developer Utilities | `AdminHubView.tsx:499-549` | Admin-gated operational features |
| The four non-admin Ctrl+Alt+Z listeners | CreateChgTab / SprintDashboard×2 / RiskManagementSection | Passphrase entry survives independently |

## Changed — admin credential entry (silent-unlock fix)

`useAdminHubState.ts` `tryUnlock` (`:749-757`):

- **Before**: `usernameToSubmit = adminUsernameRef.current || DEFAULT_ADMIN_USERNAME`;
  `passwordToSubmit = adminPinInputRef.current || DEFAULT_ADMIN_PASSWORD` → blank fields silently
  submit `admin:toolbox`.
- **After**: submit the **entered** username/password verbatim. If either is empty, set the unlock
  error (e.g. "Enter admin credentials.") and **do not POST**.
- Server behavior (`api.js:642-675`) is unchanged: a correctly-entered default `admin:toolbox` still
  unlocks on an unconfigured install (designed first-run), a configured `credentialHash` is enforced,
  and truly-empty input 400s.
- **No** default-credential warning; **no** forced custom-credential setup (per Q3).

## Optional — Dev Panel gating (pending confirmation, R11)

- **Today**: the Dev Panel tab (`AdminHubView.tsx:79`) + panel (`:2829-2880`) render with **no**
  `isAdminUnlocked` check — always accessible.
- **If confirmed**: gate the Dev Panel tab/panel behind `isAdminUnlocked`, matching the intended admin
  scope ("admin unlocks SNow access + Dev Panel").
- **If declined**: no change to the Dev Panel; FR-5.5 is dropped.

## Behavioral acceptance (maps to spec)

- Unlock admin (password) → inspect every admin section → **no AI reference** (SC-6).
- AI tools remain disabled after any admin action; enabled only by Ctrl+Alt+Z (SC-5).
- Click Unlock with empty fields → **not unlocked** (SC-7); a correctly-entered credential still
  unlocks (no regression).
- SNow config + (if gated) Dev Panel available after a valid unlock (SC-8).
