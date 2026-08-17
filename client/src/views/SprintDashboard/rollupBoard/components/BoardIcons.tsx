// BoardIcons.tsx — The board's icon vocabulary, which is now the whole app's.
//
// These wrappers were written here, when the board replaced its emoji: ⚑ ⛔ ⚠ 📎 ☐ ☑. The reasoning
// lives with the definitions in `components/AppIcons` now, but the short version is that an emoji is a
// colour glyph drawn by the operating system, so it cannot take the app's palette, its type scale, or
// its baseline.
//
// The SNow Hub then needed the same set. A second copy of these wrappers would have been two places
// deciding what "warning" looks like — the exact thing a shared vocabulary exists to prevent — so the
// definitions moved, and this re-exports them.
//
// Kept as a file rather than deleted so the board's eight importers and this module's own tests stay
// exactly as they were. The move is a change of ADDRESS; nothing about the board should have to know
// it happened.

export {
  AttachmentIcon,
  BlockedIcon,
  ChecklistDoneIcon,
  ChecklistInProgressIcon,
  ChecklistOpenIcon,
  ExcludedIcon,
  FlagIcon,
  IncludedIcon,
  InfoIcon,
  NotApplicableIcon,
  WarningIcon,
} from '../../../../components/AppIcons/index.tsx';
