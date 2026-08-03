// test/unit/githubEmailIntakeScheduler.test.js — DI-tick fire logic and the drop-folder orchestrator.
// The real bundled engine (generated/githubEmailEngine.cjs, built by pretest) parses; all filesystem
// and Jira I/O is injected so the run is deterministic and touches nothing real.

'use strict';

const path = require('path');
const scheduler = require('../../src/services/githubEmailIntakeScheduler');

const DROP_FOLDER = path.join('C:', 'gh-emails');

function baseConfig(overrides = {}) {
  return {
    jira: { baseUrl: 'https://jira.example.com', pat: 'p' },
    sslVerify: true,
    scheduler: {
      githubEmailIntake: Object.assign({
        isEnabled: true,
        mode: 'full',
        scheduleTime: '07:00',
        intervalMin: 0,
        dropFolder: DROP_FOLDER,
        fileExtensions: ['.eml'],
        jiraProjectKeys: [],
        transitions: { branchCreated: '', commitPushed: '', prOpened: 'In Progress', prMerged: 'Done' },
      }, overrides),
    },
  };
}

function mergeEmail(messageId, prNumber, key) {
  return [
    'List-ID: myorg/toolbox <toolbox.myorg.github.com>',
    'Subject: [myorg/toolbox] Add thing (#' + prNumber + ')',
    'Message-ID: ' + messageId,
    'Date: Thu, 24 Jul 2026 12:00:00 +0000',
    'X-GitHub-Sender: jsmith',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    'Merged #' + prNumber + ' into main from feature/' + key + '.',
  ].join('\r\n');
}

/** Builds injected deps over an in-memory set of files; captures posts, moves, and the ledger. */
function buildDeps(filesByName, overrides = {}) {
  const state = { ledger: [], posts: [], moves: [] };
  const deps = {
    listFiles: () => Object.keys(filesByName),
    readFile: (fullPath) => filesByName[path.basename(fullPath)],
    moveFile: (fromFullPath, toDir, fileName) => state.moves.push({ fileName, toDir }),
    readLedger: () => state.ledger,
    writeLedger: (ledger) => { state.ledger = ledger; },
    postEvent: (args) => {
      state.posts.push({ jiraKey: args.jiraKey, eventType: args.eventType, options: args.options });
      // Simulate the shared helper's recordResult sink: dry-run or a successful post.
      args.recordResult({ jiraKey: args.jiraKey, isSuccess: true, message: 'ok' });
      return Promise.resolve();
    },
    nowIso: () => '2026-07-25T00:00:00.000Z',
    writeLastRun: false,
  };
  return { deps: Object.assign(deps, overrides), state };
}

describe('checkAndFireGithubEmailIntake (DI-tick)', () => {
  it('fires the daily sweep at/after the scheduled time when not yet fired today', () => {
    const runIntake = jest.fn().mockResolvedValue({ ok: true });
    const fired = scheduler.checkAndFireGithubEmailIntake(baseConfig(), {
      today: '2026-07-25', currentTime: '07:05', firedDates: new Map(), recordFired: () => {}, runIntake, isRunBusy: () => false,
    });
    expect(fired).toBe(true);
    expect(runIntake).toHaveBeenCalledTimes(1);
  });

  it('does not fire again once it has fired today', () => {
    const runIntake = jest.fn();
    const firedDates = new Map([['githubEmailIntake', '2026-07-25']]);
    const fired = scheduler.checkAndFireGithubEmailIntake(baseConfig(), {
      today: '2026-07-25', currentTime: '09:00', firedDates, recordFired: () => {}, runIntake, isRunBusy: () => false,
    });
    expect(fired).toBe(false);
    expect(runIntake).not.toHaveBeenCalled();
  });

  it('does not fire when disabled, when busy, or when no drop folder is set', () => {
    const runIntake = jest.fn();
    const opts = { today: '2026-07-25', currentTime: '08:00', firedDates: new Map(), recordFired: () => {}, runIntake };
    expect(scheduler.checkAndFireGithubEmailIntake(baseConfig({ isEnabled: false }), { ...opts, isRunBusy: () => false })).toBe(false);
    expect(scheduler.checkAndFireGithubEmailIntake(baseConfig({ dropFolder: '' }), { ...opts, isRunBusy: () => false })).toBe(false);
    expect(scheduler.checkAndFireGithubEmailIntake(baseConfig(), { ...opts, isRunBusy: () => true })).toBe(false);
    expect(runIntake).not.toHaveBeenCalled();
  });

  it('interval mode fires on clock boundaries (:00/:30) at or after the daily start time', () => {
    const runIntake = jest.fn().mockResolvedValue({ ok: true });
    const config = baseConfig({ intervalMin: 30, scheduleTime: '07:00' });
    const base = { today: '2026-07-25', firedDates: new Map(), recordFired: () => {}, runIntake, isRunBusy: () => false, lastAlignedSlot: '' };

    // 07:00 — top of the hour, at the start time → fires.
    expect(scheduler.checkAndFireGithubEmailIntake(config, { ...base, currentTime: '07:00' })).toBe(true);
    // 07:30 — middle of the hour → fires.
    expect(scheduler.checkAndFireGithubEmailIntake(config, { ...base, currentTime: '07:30' })).toBe(true);
    // 07:07 — off a boundary → does not fire.
    expect(scheduler.checkAndFireGithubEmailIntake(config, { ...base, currentTime: '07:07' })).toBe(false);
    // 06:30 — a boundary but BEFORE the 07:00 start → does not fire.
    expect(scheduler.checkAndFireGithubEmailIntake(config, { ...base, currentTime: '06:30' })).toBe(false);
  });

  it('interval mode fires a given clock slot only once (the 60s tick cannot double-fire it)', () => {
    const runIntake = jest.fn().mockResolvedValue({ ok: true });
    const config = baseConfig({ intervalMin: 30, scheduleTime: '07:00' });
    const firstTick = scheduler.checkAndFireGithubEmailIntake(config, {
      today: '2026-07-25', currentTime: '08:00', lastAlignedSlot: '', runIntake, isRunBusy: () => false,
    });
    // The same slot on a second tick within the minute must not fire again.
    const secondTick = scheduler.checkAndFireGithubEmailIntake(config, {
      today: '2026-07-25', currentTime: '08:00', lastAlignedSlot: '2026-07-25 08:00', runIntake, isRunBusy: () => false,
    });
    expect(firstTick).toBe(true);
    expect(secondTick).toBe(false);
  });
});

describe('runGithubEmailIntakeNow (orchestration)', () => {
  it('posts an event per actionable email and moves each to the processed folder', async () => {
    const files = { 'a.eml': mergeEmail('<a@github.com>', 123, 'DENP-1414') };
    const { deps, state } = buildDeps(files);

    const outcome = await scheduler.runGithubEmailIntakeNow(baseConfig(), deps);

    expect(outcome.ok).toBe(true);
    expect(state.posts).toHaveLength(1);
    expect(state.posts[0]).toMatchObject({ jiraKey: 'DENP-1414', eventType: 'pr_merged' });
    expect(outcome.result.postedCount).toBe(1);
    expect(state.moves).toHaveLength(1);
    expect(state.moves[0].toDir).toContain('_processed');
    // Both the file key and the event key are ledgered after a real post.
    expect(state.ledger.some((row) => row.key === '<a@github.com>')).toBe(true);
    expect(state.ledger.some((row) => row.key.startsWith('event:'))).toBe(true);
  });

  it('skips a duplicate email (same Message-ID) without posting again', async () => {
    const files = { 'dup.eml': mergeEmail('<a@github.com>', 123, 'DENP-1414') };
    const { deps, state } = buildDeps(files);
    state.ledger = [{ key: '<a@github.com>', processedAtIso: '', eventType: 'pr_merged', jiraKey: 'DENP-1414', outcome: 'posted' }];

    const outcome = await scheduler.runGithubEmailIntakeNow(baseConfig(), deps);

    expect(state.posts).toHaveLength(0);
    expect(outcome.result.skippedCount).toBe(1);
    expect(outcome.result.events[0].reason).toBe('duplicate-email');
  });

  it('fires once for two DIFFERENT emails about the same PR merge (event dedup)', async () => {
    const files = {
      'first.eml':  mergeEmail('<first@github.com>', 123, 'DENP-1414'),
      'second.eml': mergeEmail('<second@github.com>', 123, 'DENP-1414'),
    };
    const { deps, state } = buildDeps(files);

    await scheduler.runGithubEmailIntakeNow(baseConfig(), deps);

    expect(state.posts).toHaveLength(1);
    const secondEvent = state.ledger.find((row) => row.key === '<second@github.com>');
    expect(secondEvent.outcome).toBe('skipped');
  });

  it('skips an unclassified email and one whose project is filtered out', async () => {
    const files = {
      'noise.eml': [
        'List-ID: myorg/toolbox <toolbox.myorg.github.com>',
        'Subject: [myorg/toolbox] just chatting',
        'Message-ID: <n@github.com>',
        'Content-Type: text/plain',
        '',
        'a comment mentioning DENP-1 but no action',
      ].join('\r\n'),
      'other.eml': mergeEmail('<o@github.com>', 9, 'ZZZ-9'),
    };
    const { deps, state } = buildDeps(files, {});
    const config = baseConfig({ jiraProjectKeys: ['DENP'] });

    const outcome = await scheduler.runGithubEmailIntakeNow(config, deps);

    expect(state.posts).toHaveLength(0);
    expect(outcome.result.skippedCount).toBe(2);
    const reasons = outcome.result.events.map((event) => event.reason).sort();
    expect(reasons).toEqual(['project-filtered', 'unclassified']);
  });

  it('routes an unparseable file to the error folder WITHOUT ledgering it', async () => {
    const files = { 'broken.eml': 'not an email' };
    const { deps, state } = buildDeps(files, {
      // Force a parse throw by injecting an engine whose parse throws for this input.
      engine: {
        parseGithubEmail: () => { throw new Error('boom'); },
        isProcessed: () => false,
        appendProcessed: (ledger, entry) => [...ledger, entry],
      },
    });

    const outcome = await scheduler.runGithubEmailIntakeNow(baseConfig(), deps);

    expect(outcome.result.errorCount).toBe(1);
    expect(state.moves[0].toDir).toContain('_errors');
    expect(state.ledger).toHaveLength(0); // not ledgered → a fixed export can be retried
  });

  it('dry-run mode posts with dryRun and does NOT claim the event key', async () => {
    const files = { 'a.eml': mergeEmail('<a@github.com>', 123, 'DENP-1414') };
    const { deps, state } = buildDeps(files);

    await scheduler.runGithubEmailIntakeNow(baseConfig({ mode: 'dryRun' }), deps);

    expect(state.posts[0].options).toEqual({ dryRun: true });
    expect(state.ledger.some((row) => row.key.startsWith('event:'))).toBe(false);
  });

  it('returns an honest error when no drop folder is configured', async () => {
    const outcome = await scheduler.runGithubEmailIntakeNow(baseConfig({ dropFolder: '' }), {});
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/drop folder/i);
  });

  // Proves the DEFAULT read path handles a binary Outlook .msg: dropFolder points at the fixtures dir,
  // listFiles/moveFile are injected (so the real fixture is never moved), but readFile is left to the
  // default so it must detect the .msg, read bytes, and reconstruct the email via the bundled engine.
  it('reads a real Outlook .msg from disk through the default read path', async () => {
    const fixturesDir = path.join(__dirname, '..', 'fixtures', 'github-emails');
    const posts = [];
    const config = baseConfig({ mode: 'dryRun', dropFolder: fixturesDir, fileExtensions: ['.msg'] });

    const outcome = await scheduler.runGithubEmailIntakeNow(config, {
      listFiles: () => ['synthetic-review-requested.msg'],
      moveFile: () => {}, // no-op: never move the committed fixture
      readLedger: () => [],
      writeLedger: () => {},
      writeLastRun: false,
      postEvent: (args) => { posts.push({ jiraKey: args.jiraKey, eventType: args.eventType }); },
    });

    expect(outcome.ok).toBe(true);
    const parsedEvent = outcome.result.events[0];
    expect(parsedEvent.eventType).toBe('review_requested');
    expect(parsedEvent.jiraKey).toBe('TEST-123');
    expect(posts[0]).toEqual({ jiraKey: 'TEST-123', eventType: 'review_requested' });
  });

  it('applies a config-driven custom rule the built-in table would miss', async () => {
    // Built-ins call this 'unknown'; a custom rule reclassifies it as pr_opened so it drives Jira.
    const openedEmail = [
      'List-ID: org/repo <repo.org.github.com>',
      'Subject: [org/repo] [DENP-1414] New work (#42)',
      'X-GitHub-Reason: subscribed',
      'Message-ID: <opened-1@github.com>',
      'Date: Thu, 24 Jul 2026 12:00:00 +0000',
      'X-GitHub-Sender: jsmith',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'jsmith wants to merge 3 commits',
    ].join('\r\n');
    const { deps, state } = buildDeps({ 'a.eml': openedEmail });

    const config = baseConfig({
      customRules: [{ id: 'org-pr-opened', eventType: 'pr_opened', bodyPattern: 'wants to merge', requiresPrNumber: true }],
    });
    await scheduler.runGithubEmailIntakeNow(config, deps);

    expect(state.posts[0]).toEqual(expect.objectContaining({ jiraKey: 'DENP-1414', eventType: 'pr_opened' }));
  });

  it('uses a rule\'s custom comment and forces its per-rule status transition', async () => {
    const openedEmail = [
      'List-ID: org/repo <repo.org.github.com>',
      'Subject: [org/repo] [DENP-1600] New work (#88)',
      'X-GitHub-Reason: subscribed',
      'Message-ID: <opened-2@github.com>',
      'Date: Thu, 24 Jul 2026 12:00:00 +0000',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'jsmith wants to merge 3 commits',
    ].join('\r\n');
    const captured = [];
    const { deps } = buildDeps({ 'a.eml': openedEmail }, {
      postEvent: (args) => {
        captured.push({ commentText: args.commentText, options: args.options });
        args.recordResult({ jiraKey: args.jiraKey, isSuccess: true, message: 'ok' });
        return Promise.resolve();
      },
    });

    const config = baseConfig({
      mode: 'full',
      customRules: [{
        id: 'org-pr-opened', eventType: 'pr_opened', bodyPattern: 'wants to merge', requiresPrNumber: true,
        comment: 'Custom: the PR is up for review.', transitionStatus: 'In Review',
      }],
    });
    await scheduler.runGithubEmailIntakeNow(config, deps);

    expect(captured[0].commentText).toBe('Custom: the PR is up for review.');
    expect(captured[0].options.forcedTransitionStatus).toBe('In Review');
  });

  it('passes a rule\'s parent-story actions (with the configured Sub-status field id) to the post', async () => {
    const mergedEmail = [
      'List-ID: org/repo <repo.org.github.com>',
      'Subject: [org/repo] [DENP-1602] Deliver work (#90)',
      'X-GitHub-Reason: subscribed',
      'Message-ID: <merged-1@github.com>',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'jsmith merged 3 commits into develop',
    ].join('\r\n');
    const captured = [];
    const { deps } = buildDeps({ 'a.eml': mergedEmail }, {
      postEvent: (args) => {
        captured.push({ options: args.options });
        args.recordResult({ jiraKey: args.jiraKey, isSuccess: true, message: 'ok' });
        return Promise.resolve();
      },
    });

    const config = baseConfig({
      mode: 'full',
      subStatusFieldId: 'customfield_10201',
      customRules: [{
        id: 'org-branch-merged', eventType: 'pr_merged', bodyPattern: 'merged .* into (main|develop)', requiresPrNumber: true,
        transitionStatus: 'Done',
        parentTransitionStatus: 'Ready for Testing',
        parentSubStatusValue: 'Dev Complete',
      }],
    });
    await scheduler.runGithubEmailIntakeNow(config, deps);

    expect(captured[0].options.forcedTransitionStatus).toBe('Done');
    expect(captured[0].options.parentActions).toEqual({
      transitionStatus: 'Ready for Testing',
      requireAllDevDone: true,
      subStatusValue: 'Dev Complete',
      subStatusFieldId: 'customfield_10201',
    });
  });

  it('gives a custom bucket (AI-authored event type) an emoji-led default comment like the built-ins', async () => {
    const approvedEmail = [
      'List-ID: org/repo <repo.org.github.com>',
      'Subject: [org/repo] [DENP-1604] Review done (#92)',
      'X-GitHub-Reason: subscribed',
      'Message-ID: <approved-1@github.com>',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'jsmith approved this pull request',
    ].join('\r\n');
    const captured = [];
    const { deps } = buildDeps({ 'a.eml': approvedEmail }, {
      postEvent: (args) => {
        captured.push({ commentText: args.commentText });
        args.recordResult({ jiraKey: args.jiraKey, isSuccess: true, message: 'ok' });
        return Promise.resolve();
      },
    });

    const config = baseConfig({
      mode: 'full',
      customRules: [{ id: 'org-pr-approved', eventType: 'pr_approved', bodyPattern: 'approved this pull request' }],
    });
    await scheduler.runGithubEmailIntakeNow(config, deps);

    expect(captured[0].commentText).toMatch(/^🔔 GitHub: pr approved\./);
  });

  it('omits parentActions entirely when the rule sets no parent fields', async () => {
    const openedEmail = [
      'List-ID: org/repo <repo.org.github.com>',
      'Subject: [org/repo] [DENP-1603] New work (#91)',
      'X-GitHub-Reason: subscribed',
      'Message-ID: <opened-9@github.com>',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'jsmith wants to merge 3 commits',
    ].join('\r\n');
    const captured = [];
    const { deps } = buildDeps({ 'a.eml': openedEmail }, {
      postEvent: (args) => {
        captured.push({ options: args.options });
        args.recordResult({ jiraKey: args.jiraKey, isSuccess: true, message: 'ok' });
        return Promise.resolve();
      },
    });

    const config = baseConfig({
      mode: 'full',
      customRules: [{ id: 'org-pr-opened', eventType: 'pr_opened', bodyPattern: 'wants to merge', requiresPrNumber: true }],
    });
    await scheduler.runGithubEmailIntakeNow(config, deps);

    expect(captured[0].options.parentActions).toBeUndefined();
  });

  it('skips a DISABLED rule so its email classifies as unknown (no comment)', async () => {
    const openedEmail = [
      'List-ID: org/repo <repo.org.github.com>',
      'Subject: [org/repo] [DENP-1601] New work (#89)',
      'X-GitHub-Reason: subscribed',
      'Message-ID: <opened-3@github.com>',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'jsmith wants to merge 3 commits',
    ].join('\r\n');
    const { deps, state } = buildDeps({ 'a.eml': openedEmail });

    const config = baseConfig({
      customRules: [{ id: 'org-pr-opened', eventType: 'pr_opened', bodyPattern: 'wants to merge', requiresPrNumber: true, isEnabled: false }],
    });
    await scheduler.runGithubEmailIntakeNow(config, deps);

    // The disabled rule does not fire; nothing built-in matches "wants to merge", so no comment is posted.
    expect(state.posts).toHaveLength(0);
  });

  it('drives a comment for a NEW custom bucket the AI can coin (e.g. pr_approved)', async () => {
    // An approval email fits none of the built-in types; a custom-bucket rule classifies it and it drives Jira.
    const approvedEmail = [
      'List-ID: org/repo <repo.org.github.com>',
      'Subject: [org/repo] [DENP-1500] Add thing (#77)',
      'X-GitHub-Reason: subscribed',
      'Message-ID: <approved-1@github.com>',
      'Date: Thu, 24 Jul 2026 12:00:00 +0000',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'octocat approved this pull request.',
    ].join('\r\n');
    const { deps, state } = buildDeps({ 'a.eml': approvedEmail });

    const config = baseConfig({
      customRules: [{ id: 'pr-approved', eventType: 'pr_approved', bodyPattern: 'approved this pull request', requiresPrNumber: true }],
    });
    await scheduler.runGithubEmailIntakeNow(config, deps);

    // The custom bucket is actionable and posts a comment (its generic template); no transition is configured for it.
    expect(state.posts[0]).toEqual(expect.objectContaining({ jiraKey: 'DENP-1500', eventType: 'pr_approved' }));
  });
});

describe('collectRuleSamples (bulk rule generator source)', () => {
  // An email the built-in table cannot classify (no actionable body/reason) → eventType 'unknown'.
  const unknownEmail = [
    'List-ID: org/repo <repo.org.github.com>',
    'Subject: [org/repo] [DENP-7] Chatter',
    'Message-ID: <u1@github.com>',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    'just a comment, no action here',
  ].join('\r\n');

  function sampleDeps(filesByName, includeAll) {
    return {
      includeAll,
      listFiles: () => Object.keys(filesByName),
      readFile: (fullPath) => filesByName[require('path').basename(fullPath)],
    };
  }

  it('returns only unclassified emails by default, with counts', () => {
    const files = {
      'known.eml': mergeEmail('<k@github.com>', 5, 'DENP-5'), // classifies as pr_merged
      'mystery.eml': unknownEmail,
    };
    const outcome = scheduler.collectRuleSamples(baseConfig(), sampleDeps(files, false));

    expect(outcome.ok).toBe(true);
    expect(outcome.totalCount).toBe(2);
    expect(outcome.unknownCount).toBe(1);
    expect(outcome.samples).toHaveLength(1);
    expect(outcome.samples[0].fileName).toBe('mystery.eml');
    expect(outcome.samples[0].eventType).toBe('unknown');
    expect(outcome.samples[0].rawSource).toContain('just a comment');
  });

  it('returns every email when includeAll is set', () => {
    const files = {
      'known.eml': mergeEmail('<k@github.com>', 5, 'DENP-5'),
      'mystery.eml': unknownEmail,
    };
    const outcome = scheduler.collectRuleSamples(baseConfig(), sampleDeps(files, true));

    expect(outcome.samples).toHaveLength(2);
    expect(outcome.samples.map((row) => row.eventType).sort()).toEqual(['pr_merged', 'unknown']);
  });

  it('also reads the _processed archive, since a run moves emails out of the root (GH #262)', () => {
    // The root is empty (a prior dry run swept everything into _processed); the email needing a rule lives there.
    const processedDir = require('path').join(DROP_FOLDER, '_processed');
    const filesByFolder = {
      [DROP_FOLDER]: {},
      [processedDir]: { 'mystery.eml': unknownEmail },
    };
    const deps = {
      includeAll: false,
      listFiles: (folder) => Object.keys(filesByFolder[folder] || {}),
      readFile: (fullPath) => {
        const parts = require('path');
        return (filesByFolder[parts.dirname(fullPath)] || {})[parts.basename(fullPath)];
      },
    };

    const outcome = scheduler.collectRuleSamples(baseConfig(), deps);

    expect(outcome.ok).toBe(true);
    expect(outcome.totalCount).toBe(1);
    expect(outcome.unknownCount).toBe(1);
    expect(outcome.samples).toHaveLength(1);
    expect(outcome.samples[0].fileName).toBe('mystery.eml');
    expect(outcome.samples[0].rawSource).toContain('just a comment');
  });

  it('fails cleanly when no drop folder is configured', () => {
    const outcome = scheduler.collectRuleSamples(baseConfig({ dropFolder: '' }), sampleDeps({}, false));
    expect(outcome.ok).toBe(false);
    expect(outcome.samples).toEqual([]);
  });
});

describe('buildCommentText wording', () => {
  it('states the PR-review request with PR details and no "(via email)" tag', () => {
    const commentText = scheduler.buildCommentText({ eventType: 'review_requested', prNumber: 553, actor: 'C13478_Zilver' });
    expect(commentText).toBe('👀 GitHub: a review was requested. (PR #553 by @C13478_Zilver)');
    expect(commentText).not.toContain('via email');
  });

  it('drops the "(via email)" tag from every event template', () => {
    const eventTypes = ['branch_created', 'commit_pushed', 'pr_opened', 'pr_merged', 'review_requested'];
    for (const eventType of eventTypes) {
      const commentText = scheduler.buildCommentText({ eventType, prNumber: null, actor: null });
      expect(commentText).not.toContain('via email');
      expect(commentText).toContain('GitHub:');
    }
  });
});

// ── Run log (persistent activity history — user report: no way to prove scheduled runs happen) ──

describe('run log persistence', () => {
  const fs = require('fs');
  const os = require('os');
  let temporaryDirectory;

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'tbx-gh-runlog-'));
    process.env.TBX_GITHUB_EMAIL_RUN_LOG_PATH = path.join(temporaryDirectory, 'run-log.json');
    process.env.TBX_GITHUB_EMAIL_RESULTS_PATH = path.join(temporaryDirectory, 'last-run.json');
  });

  afterEach(() => {
    delete process.env.TBX_GITHUB_EMAIL_RUN_LOG_PATH;
    delete process.env.TBX_GITHUB_EMAIL_RESULTS_PATH;
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  it('returns an empty list when no run log exists yet', () => {
    expect(scheduler.readRunLog()).toEqual([]);
  });

  it('appends entries newest-first and caps the stored history', () => {
    for (let runIndex = 0; runIndex < 105; runIndex += 1) {
      scheduler.appendRunLogEntry({ ranAtIso: 'run-' + runIndex, trigger: 'scheduled', postedCount: runIndex });
    }

    const runs = scheduler.readRunLog();
    expect(runs).toHaveLength(100);
    expect(runs[0].ranAtIso).toBe('run-104');
    expect(runs[99].ranAtIso).toBe('run-5');
  });

  it('records every completed run in the log — including an empty sweep', async () => {
    const { deps } = buildDeps({});

    const outcome = await scheduler.runGithubEmailIntakeNow(
      baseConfig(),
      Object.assign({}, deps, { writeLastRun: true }),
    );

    expect(outcome.ok).toBe(true);
    const runs = scheduler.readRunLog();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trigger: 'manual', postedCount: 0, skippedCount: 0, errorCount: 0 });
    expect(typeof runs[0].ranAtIso).toBe('string');
  });
});
