// ForecastTab.tsx — The release clock, in one place, for one fix version at a time.
//
// The Roll-Up Board answers "where is this work?" and the Today tab answers "what must start
// today?". This answers the third question, the one that triggers a scope conversation: given how
// many working days are left before code freeze, and who is holding the work, does this release fit?
//
// The two clocks are rendered as SEPARATE, separately-headed blocks and are never combined into one
// figure. Merging them is the confusion the whole feature exists to end, and this is the surface
// where both are on screen at once.

import { useCallback, useEffect, useMemo, useState } from 'react';

import { fetchPiWindowFixVersions } from '../../ArtView/piPlan/piPlanReleaseSchedule.ts';
import { loadHygieneFieldConfig } from '../../Hygiene/checks/hygieneFieldConfig.ts';
import { resolveStoryPointsFieldIds } from '../../Hygiene/checks/storyPointsField.ts';
import { readArtSettings, readRawForecastSettings } from '../../../services/artSettingsStore.ts';
import { toCalendarDay } from '../../../utils/calendarDate.ts';
import { readStoredStandupRosterMembers } from '../hooks/useStandupRosterStore.ts';
import { loadBoardPreferences } from '../rollupBoard/boardPreferencesStore.ts';
import { adaptHygieneIssues, type JiraIssueLike } from './forecastAdapters.ts';
import { buildForecastConfig } from './forecastSettings.ts';
import { computeForecast } from './forecastCompose.ts';
import { ForecastAiPanel } from './ai/ForecastAiPanel.tsx';
import { buildScopeCutPlan, type ScopeCutPlan } from './scopeCut.ts';
import type { CapacityAssessment, CapacityPerson, ForecastResult, ReleaseClock } from './forecastTypes.ts';
import styles from '../SprintDashboardView.module.css';

const TAB_HEADING = 'Delivery forecast';
const NO_VERSION_MESSAGE = 'Pick a fix version to see whether its work fits the time left.';
const NO_VERSIONS_MESSAGE = 'This project has no fix versions to forecast.';
const LOADING_MESSAGE = 'Loading fix versions…';

export interface ForecastTabProps {
  projectKey: string;
  teamProfileId: string;
  /** The Jira board, so the saved lane order (the team's own priority) can be read back. */
  boardId?: number | null;
  /** The dashboard's already-scoped issue set — this tab re-queries nothing. */
  scopedIssues: readonly JiraIssueLike[];
}

/** One labelled figure in a summary strip. */
function Figure({ label, value, isAlert = false }: { label: string; value: string; isAlert?: boolean }) {
  return (
    <div className={styles.forecastFigure}>
      <span className={styles.forecastFigureLabel}>{label}</span>
      {/* The words carry the meaning; the tint is an addition, never the only cue. */}
      <span className={isAlert ? styles.forecastFigureValueAlert : styles.forecastFigureValue}>{value}</span>
    </div>
  );
}

/** Names how much of a total could not be measured, so it never reads as more complete than it is. */
function describeCompleteness(assessment: CapacityAssessment): string {
  const caveats = [
    assessment.unsizedIssueCount > 0 ? `${assessment.unsizedIssueCount} unsized` : null,
    assessment.undatedIssueCount > 0 ? `${assessment.undatedIssueCount} undated versions` : null,
    assessment.unassignedIssueKeys.length > 0 ? `${assessment.unassignedIssueKeys.length} unassigned` : null,
  ].filter((caveat): caveat is string => caveat !== null);
  return caveats.length === 0 ? 'nothing unmeasured' : caveats.join(' · ');
}

/**
 * The one line somebody should be able to read from across the room.
 *
 * The complaint this answers: two lists that told a Scrum Master nothing about whether they were on
 * track. A verdict has to come first and be unmissable, and every figure below it is the working
 * that supports it — not a substitute for it.
 */
function VerdictBanner({
  versionName,
  assessment,
  counts,
}: {
  versionName: string;
  assessment: CapacityAssessment;
  counts: Record<string, number>;
}) {
  const lateCount = (counts.behind ?? 0) + (counts['start-today'] ?? 0) + (counts['cannot-fit'] ?? 0);
  const isAtRisk = assessment.shouldRemoveScope || lateCount > 0 || assessment.window.hasPassed;

  const headline = assessment.window.hasPassed
    ? 'CODE FREEZE HAS PASSED'
    : assessment.shouldRemoveScope
      ? `AT RISK — SHORT BY ${assessment.shortfallWorkingDays} WORKING DAYS`
      : lateCount > 0
        ? `AT RISK — ${lateCount} ITEM${lateCount === 1 ? '' : 'S'} LATE`
        : 'ON TRACK';

  const detail = assessment.window.hasPassed
    ? 'Every day in this window is behind, not remaining.'
    : `${assessment.window.workingDayCount} working days to code freeze · `
      + `${assessment.totalRemainingWorkingDays} days of work left · `
      + `${assessment.totalAvailableWorkingDays} days of capacity`;

  return (
    <section className={isAtRisk ? styles.verdictBannerRisk : styles.verdictBannerOk}>
      <span className={styles.verdictVersion}>{versionName}</span>
      {/* The words carry it. The colour is an addition, never the only thing saying "at risk". */}
      <strong className={styles.verdictHeadline}>{headline}</strong>
      <span className={styles.verdictDetail}>{detail}</span>
    </section>
  );
}

/** The whole board in six numbers, so nothing has to be counted by eye. */
function StatusStrip({ counts }: { counts: Record<string, number> }) {
  const cells: Array<{ state: string; label: string; tone: 'bad' | 'warn' | 'good' | 'muted' }> = [
    { state: 'behind', label: 'Behind', tone: 'bad' },
    { state: 'start-today', label: 'Start today', tone: 'warn' },
    { state: 'cannot-fit', label: 'Deadline gone', tone: 'bad' },
    { state: 'on-track', label: 'On track', tone: 'good' },
    { state: 'ahead', label: 'Ahead', tone: 'good' },
    { state: 'unsized', label: 'Unsized', tone: 'muted' },
    { state: 'unassignable', label: 'No owner', tone: 'muted' },
  ];

  return (
    <div className={styles.statusStrip}>
      {cells.map((cell) => (
        <div className={styles[`statusCell_${cell.tone}`] ?? styles.statusCell_muted} key={cell.state}>
          <strong className={styles.statusCount}>{counts[cell.state] ?? 0}</strong>
          <span className={styles.statusLabel}>{cell.label}</span>
        </div>
      ))}
    </div>
  );
}

/** A bar for one person, so being over capacity is visible before the number is read. */
function LoadBar({ inScopeDays, availableDays }: { inScopeDays: number; availableDays: number }) {
  const capacity = Math.max(availableDays, 1);
  const filledPercent = Math.min(100, Math.round((inScopeDays / capacity) * 100));
  const isOver = inScopeDays > availableDays;

  return (
    <div className={styles.loadBarTrack} title={`${inScopeDays}d of ${availableDays}d`}>
      <div
        className={isOver ? styles.loadBarFillOver : styles.loadBarFill}
        style={{ width: `${filledPercent}%` }}
      />
    </div>
  );
}

/** The work proposed for removal, in the team's own board order. */
function ScopeCutSection({ plan }: { plan: ScopeCutPlan }) {
  if (plan.candidates.length === 0) {
    return null;
  }

  return (
    <section className={styles.forecastSection}>
      <h4 className={styles.forecastSectionTitle}>
        {`To make this release fit, drop ${plan.candidates.length} item${plan.candidates.length === 1 ? '' : 's'}`}
      </h4>
      <p className={styles.forecastSectionNote}>
        Ordered by the rank you set on the Roll-Up Board — lowest-priority Feature first. This
        proposes nothing about priority; it reads the order you already gave.
      </p>

      {plan.isStillShortAfterCut && (
        <p className={styles.forecastAlert} role="status">
          {`Dropping all of this recovers ${plan.recoveredWorkingDays} of the ${plan.shortfallWorkingDays} `}
          {'working days needed. The release does not fit even then — the gap is bigger than the work available to cut.'}
        </p>
      )}

      <table className={styles.forecastTable}>
        <thead>
          <tr>
            <th scope="col">Drop</th>
            <th scope="col">Feature</th>
            <th scope="col">Rank</th>
            <th scope="col">Owner</th>
            <th scope="col">Recovers</th>
            <th scope="col">Still short</th>
          </tr>
        </thead>
        <tbody>
          {plan.candidates.map((candidate) => (
            <tr key={candidate.issueKey}>
              <th scope="row">{`${candidate.issueKey} — ${candidate.summary}`}</th>
              <td>{candidate.featureKey ?? '—'}</td>
              <td>{candidate.featureRank ?? 'unranked'}</td>
              <td>{candidate.assigneeDisplayName ?? 'Unassigned'}</td>
              <td>{`${candidate.remainingWorkingDays}d`}</td>
              <td>{candidate.remainingShortfallWorkingDays === 0 ? '✓ fits' : `${candidate.remainingShortfallWorkingDays}d`}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {plan.unsizedIssueKeys.length > 0 && (
        <p className={styles.forecastSectionNote}>
          {`${plan.unsizedIssueKeys.length} item${plan.unsizedIssueKeys.length === 1 ? '' : 's'} could not be weighed `}
          {'because nobody sized them, so they are not proposed: '}
          {plan.unsizedIssueKeys.join(', ')}
        </p>
      )}
    </section>
  );
}

/** One capacity table: who holds what, who is over, and whether the whole thing fits. */
function CapacitySection({
  title,
  explanation,
  assessment,
  remedies,
}: {
  title: string;
  explanation: string;
  assessment: CapacityAssessment;
  remedies: string;
}) {
  return (
    <section className={styles.forecastSection}>
      <h4 className={styles.forecastSectionTitle}>{title}</h4>
      <p className={styles.forecastSectionNote}>{explanation}</p>

      <div className={styles.forecastFigureRow}>
        <Figure label="WORKING DAYS" value={String(assessment.window.workingDayCount)} isAlert={assessment.window.hasPassed} />
        <Figure label="WORK LEFT" value={`${assessment.totalRemainingWorkingDays}d`} />
        <Figure label="CAPACITY" value={`${assessment.totalAvailableWorkingDays}d`} />
        <Figure
          label="SHORTFALL"
          value={assessment.shortfallWorkingDays === 0 ? 'None' : `${assessment.shortfallWorkingDays}d`}
          isAlert={assessment.shouldRemoveScope}
        />
      </div>

      {assessment.window.hasPassed && (
        <p className={styles.forecastAlert} role="status">
          This window has already passed — every day in it is behind, not remaining.
        </p>
      )}

      {assessment.shouldRemoveScope && (
        // Both remedies named, because the flag on its own does not say what to do about it.
        <p className={styles.forecastAlert} role="status">
          {`Short by ${assessment.shortfallWorkingDays} working days. ${remedies}`}
        </p>
      )}

      {assessment.personLoads.length > 0 && (
        <table className={styles.forecastTable}>
          <thead>
            <tr>
              <th scope="col">Person</th>
              <th scope="col">In scope</th>
              <th scope="col">All their work</th>
              <th scope="col">Available</th>
              <th scope="col">Over by</th>
            </tr>
          </thead>
          <tbody>
            {assessment.personLoads.map((load) => (
              <tr key={load.personKey} className={load.isOverCapacity ? styles.forecastRowAlert : undefined}>
                <th scope="row">
                  {load.displayName}
                  {/* Work assigned to somebody nobody rostered is exactly what a capacity report
                      exists to surface, so it is labelled rather than hidden. */}
                  {!load.isOnRoster && <span className={styles.forecastNoteChip}>not on roster</span>}
                </th>
                <td>
                  <LoadBar inScopeDays={load.inScopeWorkingDays} availableDays={load.availableWorkingDays} />
                  {`${load.inScopeWorkingDays}d`}
                </td>
                <td>{load.totalAssignedWorkingDays}d</td>
                <td>{load.availableWorkingDays}d</td>
                <td>{load.isOverCapacity ? `⚠ ${load.overCapacityWorkingDays}d over` : '✓ fits'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {assessment.unassignedIssueKeys.length > 0 && (
        // Named, never pooled: spreading it across an average would hide the finding.
        <p className={styles.forecastSectionNote}>
          {`No owner — cannot be forecast: ${assessment.unassignedWorkingDays}d across `}
          {assessment.unassignedIssueKeys.join(', ')}
        </p>
      )}

      <p className={styles.forecastSectionNote}>{describeCompleteness(assessment)}</p>
    </section>
  );
}

/** The four boundaries of the chosen release, so the windows below can be read against a calendar. */
function ReleaseCalendar({ clock }: { clock: ReleaseClock }) {
  return (
    <div className={styles.forecastFigureRow}>
      <Figure label="CODE FREEZE" value={clock.codeFreezeIso} />
      <Figure label="EXTERNAL TEST" value={`${clock.externalTestStartIso} → ${clock.externalTestEndIso}`} />
      <Figure label="DEPLOY BUFFER" value={`${clock.deployBufferStartIso} → ${clock.releaseDateIso}`} />
      <Figure label="RELEASE" value={clock.releaseDateIso} />
    </div>
  );
}

/** The PI commitment for every Feature on this board — the OTHER clock, kept visibly apart. */
function PiCommitmentSection({ forecast }: { forecast: ForecastResult }) {
  if (forecast.featureAssessments.length === 0) {
    return null;
  }

  return (
    <section className={styles.forecastSection}>
      <h4 className={styles.forecastSectionTitle}>PI commitment — can each Feature reach Integrated Test?</h4>
      <p className={styles.forecastSectionNote}>
        A different deadline from the release above, and often the tighter one. A Feature can miss its
        release and still meet the PI, or make the release with the PI at risk.
      </p>
      <table className={styles.forecastTable}>
        <thead>
          <tr>
            <th scope="col">Feature</th>
            <th scope="col">INT by</th>
            <th scope="col">Verdict</th>
            <th scope="col">Holding it up</th>
          </tr>
        </thead>
        <tbody>
          {forecast.featureAssessments.map((assessment) => (
            <tr
              key={assessment.featureKey}
              className={assessment.piVerdict === 'at-risk' ? styles.forecastRowAlert : undefined}
            >
              <th scope="row">{assessment.featureKey}</th>
              <td>{assessment.dodDateIso ?? '—'}</td>
              <td>{describePiVerdict(assessment.piVerdict, assessment.riskCause)}</td>
              <td>
                {assessment.blockingIssueKeys.length === 0
                  ? (assessment.hasNoSlStory ? 'No SL test story' : '—')
                  : assessment.blockingIssueKeys.join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Puts the PI verdict into words, naming which half of the chain is at fault when one is. */
function describePiVerdict(
  piVerdict: ForecastResult['featureAssessments'][number]['piVerdict'],
  riskCause: ForecastResult['featureAssessments'][number]['riskCause'],
): string {
  if (piVerdict === 'not-configured') return 'No PI end date set';
  if (piVerdict === 'meets') return 'On track';
  // Naming the cause is the difference between "find more testers" and "split the work".
  return riskCause === 'test-squeeze' ? 'At risk — test squeeze' : 'At risk — dev too large';
}

/**
 * Features whose children have outgrown the estimate somebody put on them.
 *
 * Only the ones worth acting on are listed. A Feature sized correctly needs no row, and a table of
 * mostly-fine rows is one nobody reads.
 */
function SizingSection({ forecast }: { forecast: ForecastResult }) {
  const notable = forecast.sizingFlags.filter((flag) => flag.state !== 'within');
  if (notable.length === 0) {
    return null;
  }

  return (
    <section className={styles.forecastSection}>
      <h4 className={styles.forecastSectionTitle}>Features that have outgrown their estimate</h4>
      <p className={styles.forecastSectionNote}>
        Stories are built out through the PI rather than up front, so a mis-sized Feature only shows
        up after the fact — and only if something is watching.
      </p>
      <table className={styles.forecastTable}>
        <thead>
          <tr>
            <th scope="col">Feature</th>
            <th scope="col">Estimated</th>
            <th scope="col">Children</th>
            <th scope="col">Over by</th>
          </tr>
        </thead>
        <tbody>
          {notable.map((flag) => (
            <tr key={flag.featureKey} className={flag.state === 'over' ? styles.forecastRowAlert : undefined}>
              <th scope="row">
                {flag.featureKey}
                {flag.unsizedChildCount > 0 && (
                  // The sum beside it is a floor, not a total, and a reader has to know that.
                  <span className={styles.forecastNoteChip}>{`${flag.unsizedChildCount} unsized`}</span>
                )}
              </th>
              <td>{flag.featurePoints === null ? 'Not sized' : flag.featurePoints}</td>
              <td>{flag.childrenPoints}</td>
              <td>
                {flag.state === 'not-sized'
                  ? '—'
                  : `${flag.overagePoints} pts (${flag.overagePercent}%)`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/** Only the fix versions whose dates need explaining — a clean resolution needs no row. */
function ReleaseDateNotes({ forecast }: { forecast: ForecastResult }) {
  const notable = forecast.releaseDateResolutions.filter(
    (resolution) => resolution.hasDisagreement || resolution.hasAmbiguousName || resolution.source === 'none',
  );
  if (notable.length === 0) {
    return null;
  }

  return (
    <section className={styles.forecastSection}>
      <h4 className={styles.forecastSectionTitle}>Fix version dates worth a look</h4>
      <ul className={styles.forecastNoteList}>
        {notable.map((resolution) => (
          <li key={resolution.versionName}>
            <strong>{resolution.versionName}</strong>
            {resolution.source === 'none' && ' — no release date and none in the name, so its work cannot be forecast'}
            {resolution.hasDisagreement
              && ` — the release date says ${resolution.fieldDateIso}, the name says ${resolution.nameDateIso}; the field was used`}
            {resolution.hasAmbiguousName && ' — the name holds more than one date; the first was used'}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Renders the release clock and the PI clock for one team, side by side and separately labelled. */
export default function ForecastTab({ projectKey, teamProfileId, scopedIssues, boardId = null }: ForecastTabProps) {
  const [versionNames, setVersionNames] = useState<string[] | null>(null);
  const [selectedVersionName, setSelectedVersionName] = useState('');
  const [fieldIds, setFieldIds] = useState<{
    subStatusFieldIds: string[];
    targetStartFieldIds: string[];
    featureLinkFieldIds: string[];
  } | null>(null);

  // Jira's own list, never a typed name: a value that must match Jira exactly is picked, not typed.
  useEffect(() => {
    let isMounted = true;
    if (projectKey.trim() === '') {
      setVersionNames([]);
      return;
    }
    void fetchPiWindowFixVersions(projectKey)
      .then((versions) => {
        if (!isMounted) return;
        setVersionNames(versions
          .filter((version) => version.archived !== true)
          .map((version) => (version.name ?? '').trim())
          .filter((versionName) => versionName !== ''));
      })
      .catch(() => { if (isMounted) setVersionNames([]); });
    return () => { isMounted = false; };
  }, [projectKey]);

  useEffect(() => {
    let isMounted = true;
    void loadHygieneFieldConfig().then((config) => {
      if (!isMounted) return;
      setFieldIds({
        subStatusFieldIds: config.subStatusFieldIds ?? [],
        targetStartFieldIds: config.targetStartFieldIds ?? [],
        featureLinkFieldIds: config.featureLinkFieldIds ?? [],
      });
    }).catch(() => {
      if (isMounted) setFieldIds({ subStatusFieldIds: [], targetStartFieldIds: [], featureLinkFieldIds: [] });
    });
    return () => { isMounted = false; };
  }, []);

  /**
   * The team's own lane order, as ranks.
   *
   * Read from the saved board vocabulary rather than recomputed: this IS the priority somebody set
   * by dragging lanes, and a second ordering derived here would eventually disagree with the board
   * it claims to reflect.
   */
  const featureRankByKey = useMemo<Record<string, number>>(() => {
    // Board id 0 is the same key the board itself falls back to when no Jira board is selected;
    // the lane order is stored per team-and-board and this reads whichever the team actually saved.
    const preferences = loadBoardPreferences(teamProfileId, boardId ?? 0);
    return Object.fromEntries(preferences.laneOrder.map((featureKey, index) => [featureKey, index + 1]));
  }, [teamProfileId, boardId]);

  const readRosterPeople = useCallback((): CapacityPerson[] => readStoredStandupRosterMembers(teamProfileId)
    .map((member) => ({
      personKey: member.jiraAccountId ?? member.displayName,
      displayName: member.displayName,
      isOnRoster: true,
      canDevelop: member.roleCapabilities?.canDevelop === true,
      canInternalTest: member.roleCapabilities?.canInternalTest === true,
    })), [teamProfileId]);

  // The SAME computeForecast the board and Today call. There is one figure, so there is nothing for
  // the three surfaces to disagree about.
  const forecast = useMemo<ForecastResult | null>(() => {
    if (fieldIds === null) {
      return null;
    }
    const items = adaptHygieneIssues(scopedIssues, {
      storyPointsFieldIds: resolveStoryPointsFieldIds(''),
      subStatusFieldIds: fieldIds.subStatusFieldIds,
      targetStartFieldIds: fieldIds.targetStartFieldIds,
      featureLinkFieldIds: fieldIds.featureLinkFieldIds,
    });
    const artSettings = readArtSettings();
    const { config, rejectedSettings } = buildForecastConfig(readRawForecastSettings(), toCalendarDay(new Date()));
    const computed = computeForecast(
      {
        items,
        orderedColumnIds: [],
        fixVersions: (versionNames ?? []).map((versionName) => ({ name: versionName })),
        people: readRosterPeople(),
        piEndDate: artSettings.piEndDate,
        hasSubStatusField: fieldIds.subStatusFieldIds.length > 0,
        teamProfileId,
      },
      config,
    );
    return { ...computed, rejectedSettings };
  }, [scopedIssues, versionNames, fieldIds, readRosterPeople, teamProfileId]);

  const selectedClock = forecast?.releaseClocksByVersionName[selectedVersionName] ?? null;
  const codeFreezeAssessment = forecast?.codeFreezeCapacityByVersionName[selectedVersionName] ?? null;

  /** How many issues sit in each verdict, so the strip can be read without counting rows. */
  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    (forecast?.issueForecasts ?? []).forEach((issueForecast) => {
      counts[issueForecast.state] = (counts[issueForecast.state] ?? 0) + 1;
    });
    return counts;
  }, [forecast]);

  /**
   * The work to drop, in the team's own board order.
   *
   * The rank comes from the saved board vocabulary's lane order, which is the priority the team
   * already set by dragging. Nothing here decides what matters least.
   */
  const scopeCutPlan = useMemo<ScopeCutPlan | null>(() => {
    if (forecast === null || codeFreezeAssessment === null || !codeFreezeAssessment.shouldRemoveScope) {
      return null;
    }
    const inScopeIssueKeys = codeFreezeAssessment.personLoads.flatMap((load) => load.inScopeIssueKeys)
      .concat(codeFreezeAssessment.unassignedIssueKeys);
    return buildScopeCutPlan(
      forecast,
      codeFreezeAssessment.shortfallWorkingDays,
      inScopeIssueKeys,
      { rankByFeatureKey: featureRankByKey },
    );
  }, [forecast, codeFreezeAssessment, featureRankByKey]);

  return (
    <div className={styles.forecastTab} data-testid="forecast-tab">
      <header className={styles.forecastHeader}>
        <h3 className={styles.forecastHeading}>{TAB_HEADING}</h3>
        <label className={styles.forecastVersionPicker}>
          <span>Fix version</span>
          <select
            aria-label="Fix version"
            onChange={(changeEvent) => setSelectedVersionName(changeEvent.target.value)}
            value={selectedVersionName}
          >
            <option value="">— pick a version —</option>
            {(versionNames ?? []).map((versionName) => (
              <option key={versionName} value={versionName}>{versionName}</option>
            ))}
          </select>
        </label>
      </header>

      {forecast !== null && forecast.rejectedSettings.length > 0 && (
        // Shown rather than swallowed: otherwise these numbers cannot be reconciled with the
        // settings screen, and a reader trusts whichever they saw last.
        <ul className={styles.forecastNoteList} role="status">
          {forecast.rejectedSettings.map((rejected) => (
            <li key={`${rejected.name}-${rejected.storedValue}`}>
              <strong>{rejected.name}</strong> — {rejected.storedValue} {rejected.reason}
            </li>
          ))}
        </ul>
      )}

      {versionNames === null && <p className={styles.forecastSectionNote} role="status">{LOADING_MESSAGE}</p>}
      {versionNames !== null && versionNames.length === 0 && (
        <p className={styles.forecastSectionNote} role="status">{NO_VERSIONS_MESSAGE}</p>
      )}
      {versionNames !== null && versionNames.length > 0 && selectedVersionName === '' && (
        <p className={styles.forecastSectionNote} role="status">{NO_VERSION_MESSAGE}</p>
      )}

      {forecast !== null && selectedVersionName !== '' && selectedClock === null && (
        <p className={styles.forecastAlert} role="status">
          {`${selectedVersionName} has no release date, and none could be read from its name — its work cannot be forecast.`}
        </p>
      )}

      {forecast !== null && selectedClock !== null && codeFreezeAssessment !== null && (
        <>
          <VerdictBanner
            versionName={selectedVersionName}
            assessment={codeFreezeAssessment}
            counts={stateCounts}
          />
          <StatusStrip counts={stateCounts} />
          {scopeCutPlan !== null && <ScopeCutSection plan={scopeCutPlan} />}
          <ReleaseCalendar clock={selectedClock} />
          <CapacitySection
            title="Release clock — can this be built by code freeze?"
            explanation="Working days between today and code freeze, against the development work committed to this release."
            assessment={forecast.codeFreezeCapacityByVersionName[selectedVersionName]}
            remedies="Remove scope from this release, or move work to a later one."
          />
          <CapacitySection
            title="External test — can the fortnight after code freeze absorb it?"
            explanation="The two weeks after code freeze. The final week before the release is deploy buffer and carries no test capacity."
            assessment={forecast.externalTestCapacityByVersionName[selectedVersionName]}
            remedies="Reduce scope, or add test resource."
          />
        </>
      )}

      {forecast !== null && <PiCommitmentSection forecast={forecast} />}
      {forecast !== null && <SizingSection forecast={forecast} />}
      {forecast !== null && (
        <ForecastAiPanel
          forecast={forecast}
          codeFreezeAssessment={selectedVersionName === ''
            ? null
            : forecast.codeFreezeCapacityByVersionName[selectedVersionName] ?? null}
          externalTestAssessment={selectedVersionName === ''
            ? null
            : forecast.externalTestCapacityByVersionName[selectedVersionName] ?? null}
          scopeCutPlan={scopeCutPlan}
        />
      )}
      {forecast !== null && <ReleaseDateNotes forecast={forecast} />}
    </div>
  );
}
