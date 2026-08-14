// BoardIcons.tsx — The board's icon vocabulary, in one place.
//
// The board used emoji: ⚑ ⛔ ⚠ 📎 ☐ ☑. They read as casual next to Jira, but the reason is concrete
// rather than a matter of taste. An emoji is a COLOUR glyph drawn by the operating system, so:
//
//   • it cannot inherit `currentColor` — a red ⛔ stays the same red in the light theme and the dark
//     one, which is why the board's careful two-theme palette stopped at the icons
//   • it is Segoe UI Emoji on Windows and Apple Color Emoji on a Mac, so weight, stroke and optical
//     size are the vendor's choice and not ours
//   • its baseline differs per glyph, so ⚠ and 📎 never sit level with the text beside them
//
// Lucide icons are monochrome line art that take their colour from the surrounding text, scale with
// the font, and share one stroke weight — so they obey the theme and the type scale instead of
// fighting them.
//
// They live behind this module rather than being imported all over the board, for the same reason the
// status chips do: an icon is a piece of VOCABULARY. "Blocked" should look the same everywhere it is
// said, and that is only true while there is one place that decides what it looks like.

import {
  AlertTriangle,
  Ban,
  Check,
  CheckSquare,
  Flag,
  Info,
  Minus,
  Paperclip,
  Play,
  Square,
  X,
} from 'lucide-react';

/**
 * One size for every icon on the board.
 *
 * In `em`, not pixels, so an icon grows with the text it sits beside — including at the app's larger
 * text settings, where a fixed pixel icon would shrink relative to everything around it.
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

/** Jira's impediment flag. */
export function FlagIcon() {
  return <Flag {...SHARED_ICON_PROPS} />;
}

/** Blocked — by a link, by a status, or by a label. */
export function BlockedIcon() {
  return <Ban {...SHARED_ICON_PROPS} />;
}

/** Something the board wants to warn about but has not refused. */
export function WarningIcon() {
  return <AlertTriangle {...SHARED_ICON_PROPS} />;
}

/** Something the board is telling you, which needs no action. */
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
