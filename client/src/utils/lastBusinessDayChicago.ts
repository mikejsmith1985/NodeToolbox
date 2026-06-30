// lastBusinessDayChicago.ts — Shared "last business day 5 PM (Chicago)" cutoff.
//
// The DSU board's "New since last business day" section and the Today dashboard's untriaged
// card must count the same freshly-created issues, so they share this single cutoff helper.
// Keeping it here (rather than inside either hook) lets both import it without dragging one
// hook's module side-effects into the other's import graph.

const SUNDAY_DAYS_BACK = 2;
const SATURDAY_DAYS_BACK = 1;
const MONDAY_DAYS_BACK = 3;
const DEFAULT_DAYS_BACK = 1;

/**
 * Returns the "5 PM on the last business day" cutoff in Chicago time, formatted as the
 * `YYYY/MM/DD 17:00` string Jira JQL expects. Weekends roll back to the prior Friday, and
 * Monday rolls back to the prior Friday as well, so a Monday morning still sees Friday's work.
 */
export function formatLastBusinessDayEndChicago(): string {
  const chicagoParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  }).formatToParts(new Date());
  const partMap = Object.fromEntries(chicagoParts.map((part) => [part.type, part.value]));
  const weekday = partMap.weekday;
  const daysBack =
    weekday === 'Sunday'
      ? SUNDAY_DAYS_BACK
      : weekday === 'Saturday'
        ? SATURDAY_DAYS_BACK
        : weekday === 'Monday'
          ? MONDAY_DAYS_BACK
          : DEFAULT_DAYS_BACK;
  const businessDay = new Date(Number(partMap.year), Number(partMap.month) - 1, Number(partMap.day) - daysBack);
  return `${businessDay.getFullYear()}/${String(businessDay.getMonth() + 1).padStart(2, '0')}/${String(businessDay.getDate()).padStart(2, '0')} 17:00`;
}
