# Contract: Roster Role Capabilities (Part 1)

The UI contract for recording and reading the three role capabilities on a roster member. This is the
"interface" the rest of the feature (and the re-allocation prompt) depends on.

## Store surface (`useStandupRosterStore`)

**Type addition**
```ts
export interface RosterRoleCapabilities {
  canDevelop: boolean;
  canInternalTest: boolean;
  canExternalTest: boolean;
}
// StandupRosterMember & StandupRosterMemberDraft gain: roleCapabilities?: RosterRoleCapabilities
```

**New action**
```ts
setRosterMemberRoles(memberId: string, capabilities: RosterRoleCapabilities): void
```

**Behavioral contract**
- Setting roles on a member persists immediately to the team-scoped roster localStorage entry and updates
  in-memory state (same write path as `removeRosterMember`).
- `roleCapabilities` is preserved across every existing mutation (`addRosterMember`, `upsertRosterMembers`,
  `replaceRosterMembers`, SNow linking) — no edit silently drops it.
- Reading a legacy member (no `roleCapabilities`) yields `undefined`, which all consumers treat as
  "no roles set" (all three false). No migration writes occur on read.
- A malformed persisted `roleCapabilities` (non-object, or non-boolean members) is coerced to `undefined` by
  `isStandupRosterMember`; the member still loads.

## UI contract (`RosterTab` → Current roster card)

| Element | Behavior |
|---------|----------|
| Three role toggles per member | Labeled **Developer**, **Internal Tester**, **External Tester**; each reflects the member's current flag and calls `setRosterMemberRoles` with the updated triple on change. |
| Role chips | The member's *set* roles render as chips (alongside the existing `roleName`/team chips) so coverage is glanceable (FR-2.2). |
| Availability with AI locked | Toggles and chips are present and functional regardless of `useAiAssistStore` unlock state (FR-2.3, SC-7). |
| Scope | Only the active-team members shown by the existing `filterRosterMembersByActiveTeam` are editable here; role state is per team profile. |

## Acceptance (maps to spec scenarios)

- Mark a member Developer + Internal Tester → both persist and show as chips; External Tester stays off; state
  survives reload. *(Set roles on a member; SC-1, SC-2)*
- Two members with different role sets each read back exactly their own roles — no default/forced single role.
  *(Roles are independent)*
- Set roles on Team A, switch active team → Team B members show independent role state. *(Roles are team-scoped)*
- With AI locked, roles are fully settable/visible; no re-allocation panel appears. *(Manual parity; SC-7)*

## Out of scope (this contract)

- Auto-detecting roles from Jira/SNow/history (spec non-goal).
- Any role beyond the three named, or a free-form role taxonomy (spec non-goal).
- Per-role capacity/availability numbers (deferred to the additional-details box).
