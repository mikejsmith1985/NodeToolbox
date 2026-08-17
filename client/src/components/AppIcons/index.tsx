// AppIcons — the app's icon vocabulary, in one place for every surface.
//
// This started life as the Roll-Up Board's own `BoardIcons`, written when the board replaced its emoji.
// The reasoning has not changed and is worth keeping where the code is:
//
//   • an emoji is a COLOUR glyph drawn by the operating system, so it cannot inherit `currentColor` —
//     a red ⛔ stays the same red in both themes, which is where a careful two-theme palette stops
//   • it is Segoe UI Emoji on Windows and Apple Color Emoji on a Mac, so weight, stroke and optical
//     size are the vendor's choice rather than ours
//   • its baseline differs per glyph, so ⚠ and 📋 never sit level with the text beside them
//
// What HAS changed is the scope. The SNow Hub needed the same vocabulary, and a second copy of these
// wrappers would have been two places deciding what "warning" looks like — which is exactly the thing
// a shared vocabulary exists to prevent. So it lives here, and `BoardIcons` re-exports it: the board's
// eight importers are untouched, and there is still only one definition.

import {
  AlertTriangle,
  Ban,
  Check,
  CheckCircle2,
  CheckSquare,
  Clipboard,
  Flag,
  Info,
  Minus,
  Paperclip,
  Pencil,
  Pin,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Square,
  X,
} from 'lucide-react';

/**
 * One size for every icon in the app.
 *
 * In `em`, not pixels, so an icon grows with the text it sits beside — including at the larger text
 * settings, where a fixed pixel icon would shrink relative to everything around it.
 */
const ICON_SIZE = '1em';

/** Shared props: sized in em, coloured by the text around it, and never read aloud on its own. */
const SHARED_ICON_PROPS = {
  size: ICON_SIZE,
  'aria-hidden': true as const,
  // Slightly lighter than lucide's default 2, which reads heavy at text size.
  strokeWidth: 1.75,
  style: { flexShrink: 0, verticalAlign: '-0.125em' },
};

// ── Board vocabulary ──

/** Jira's impediment flag. */
export function FlagIcon() {
  return <Flag {...SHARED_ICON_PROPS} />;
}

/** Blocked — by a link, by a status, or by a label. */
export function BlockedIcon() {
  return <Ban {...SHARED_ICON_PROPS} />;
}

/** Something the app wants to warn about but has not refused. */
export function WarningIcon() {
  return <AlertTriangle {...SHARED_ICON_PROPS} />;
}

/** Something the app is telling you, which needs no action. */
export function InfoIcon() {
  return <Info {...SHARED_ICON_PROPS} />;
}

/** Attachments on an issue. */
export function AttachmentIcon() {
  return <Paperclip {...SHARED_ICON_PROPS} />;
}

/** A checklist item that has not been started. */
export function ChecklistOpenIcon() {
  return <Square {...SHARED_ICON_PROPS} />;
}

/** A checklist item in progress. */
export function ChecklistInProgressIcon() {
  return <Play {...SHARED_ICON_PROPS} />;
}

/** A finished checklist item. */
export function ChecklistDoneIcon() {
  return <CheckSquare {...SHARED_ICON_PROPS} />;
}

/** A troubleshooter step that included the issue. */
export function IncludedIcon() {
  return <Check {...SHARED_ICON_PROPS} />;
}

/** A troubleshooter step that excluded it — the one somebody is scanning for. */
export function ExcludedIcon() {
  return <X {...SHARED_ICON_PROPS} />;
}

/** A troubleshooter step that did not apply, which is neither good news nor bad. */
export function NotApplicableIcon() {
  return <Minus {...SHARED_ICON_PROPS} />;
}

// ── Actions, shared by every surface that offers them ──

/** Confirms a thing was done, or a value resolved. */
export function CheckIcon() {
  return <Check {...SHARED_ICON_PROPS} />;
}

/** A finished whole — a record loaded, a job complete. Distinct from a bare tick on purpose. */
export function LoadedIcon() {
  return <CheckCircle2 {...SHARED_ICON_PROPS} />;
}

/** Creates something new. */
export function AddIcon() {
  return <Plus {...SHARED_ICON_PROPS} />;
}

/** Edits something that already exists. */
export function EditIcon() {
  return <Pencil {...SHARED_ICON_PROPS} />;
}

/** Keeps a choice for next time. */
export function PinIcon() {
  return <Pin {...SHARED_ICON_PROPS} />;
}

/** Copies to the clipboard, or the thing that was copied. */
export function ClipboardIcon() {
  return <Clipboard {...SHARED_ICON_PROPS} />;
}

/** Starts again from the beginning. */
export function StartOverIcon() {
  return <RotateCcw {...SHARED_ICON_PROPS} />;
}

/**
 * An AI-assisted action.
 *
 * Its own icon rather than a shared one because every AI surface in this app is propose-only and
 * gated, and a reader is entitled to know which buttons involve the assistant before pressing one.
 */
export function AiAssistIcon() {
  return <Sparkles {...SHARED_ICON_PROPS} />;
}
