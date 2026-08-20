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

// ── SharePoint source (v1: read-only pull — the relay downloads files, the server ingests them) ──

/** Builds the non-filesystem deps for a sources run: Jira post capture, in-memory ledger, seen-name sink. */
function buildSourcesDeps() {
  const state = { ledger: [], posts: [], seenNames: [] };
  const deps = {
    readLedger: () => state.ledger,
    writeLedger: (ledger) => { state.ledger = ledger; },
    postEvent: (args) => {
      state.posts.push({ jiraKey: args.jiraKey, eventType: args.eventType });
      args.recordResult({ jiraKey: args.jiraKey, isSuccess: true, message: 'ok' });
      return Promise.resolve();
    },
    recordSeenNames: (names) => state.seenNames.push(...names),
    nowIso: () => '2026-08-04T00:00:00.000Z',
    writeLastRun: false,
  };
  return { deps, state };
}

describe('runGithubEmailSourcesNow (SharePoint sources)', () => {
  it('runs the full pipeline over in-memory sources without requiring a local drop folder', async () => {
    // No local drop folder configured — the SharePoint source must not depend on one.
    const config = baseConfig({ dropFolder: '' });
    const sources = [{ fileName: 'a.eml', content: mergeEmail('<a@github.com>', 123, 'DENP-1414') }];
    const { deps, state } = buildSourcesDeps();

    const outcome = await scheduler.runGithubEmailSourcesNow(
      config, { folderLabel: '/sites/Team/GitHubEmails', sources }, deps);

    expect(outcome.ok).toBe(true);
    expect(outcome.result.trigger).toBe('sharepoint');
    // The run result names the SharePoint folder (not a local path) so the Activity Log stays honest.
    expect(outcome.result.dropFolder).toBe('/sites/Team/GitHubEmails');
    expect(outcome.result.postedCount).toBe(1);
    expect(state.posts).toEqual([{ jiraKey: 'DENP-1414', eventType: 'pr_merged' }]);
    // Every ingested file is recorded as seen so the next pull never re-downloads it.
    expect(state.seenNames).toEqual(['a.eml']);
  });

  it('ingests every supplied source regardless of extension (the client curates) and dedups by the content ledger', async () => {
    const config = baseConfig({ dropFolder: '' }); // fileExtensions: ['.eml'] must NOT filter sources
    const emailSource = mergeEmail('<b@github.com>', 200, 'DENP-2');
    // Power Automate names files by SUBJECT — often extensionless (GH #282). The client already
    // curated the candidate set, so the server must ingest exactly what it is handed.
    const extensionlessSource = mergeEmail('<c@github.com>', 300, 'DENP-3');
    const sources = [
      { fileName: 'keep.eml', content: emailSource },
      { fileName: '[org_repo] corrected webexId (PR #379)', content: extensionlessSource },
    ];
    const { deps, state } = buildSourcesDeps();

    const firstOutcome = await scheduler.runGithubEmailSourcesNow(config, { folderLabel: 'sp', sources }, deps);
    expect(firstOutcome.result.postedCount).toBe(2);
    expect(state.seenNames).toEqual(['keep.eml', '[org_repo] corrected webexId (PR #379)']);

    // The same email arriving under a NEW name is caught by the Message-ID ledger, not reposted.
    const secondOutcome = await scheduler.runGithubEmailSourcesNow(
      config, { folderLabel: 'sp', sources: [{ fileName: 'copy.eml', content: emailSource }] }, deps);
    expect(secondOutcome.result.postedCount).toBe(0);
    expect(secondOutcome.result.skippedCount).toBe(1);
    expect(state.posts).toHaveLength(2);
  });

  it('records an EMPTY sweep when there are no new sources — "nothing new" must be distinguishable from "never ran"', async () => {
    // The Activity Log exists because an idle pipeline was indistinguishable from a dead one
    // (90+ emails sat invisible). A pull that finds nothing new must still leave a record.
    const { deps } = buildSourcesDeps();
    const outcome = await scheduler.runGithubEmailSourcesNow(
      baseConfig(),
      { folderLabel: '/sites/Team/GitHubEmails', sources: [], listedCount: 7 },
      deps, // writeLastRun: false — the RESULT shape is asserted; persistence shares the normal path
    );

    expect(outcome.ok).toBe(true);
    expect(outcome.result.trigger).toBe('sharepoint');
    expect(outcome.result.dropFolder).toBe('/sites/Team/GitHubEmails');
    expect(outcome.result.postedCount).toBe(0);
    expect(outcome.result.events).toEqual([]);
  });

  it('still rejects a run whose sources are not an array', async () => {
    const { deps } = buildSourcesDeps();
    const outcome = await scheduler.runGithubEmailSourcesNow(baseConfig(), { folderLabel: 'sp', sources: 'nope' }, deps);
    expect(outcome.ok).toBe(false);
    expect(outcome.message).toMatch(/source/i);
  });
});

describe('one Activity Log entry per pull (batches merge by pullId)', () => {
  it('mergePullRunResults sums counts and concatenates events, keeping the first batch start time', () => {
    const firstBatch = { hasRun: true, ranAtIso: '2026-08-04T16:20:00.000Z', trigger: 'sharepoint', mode: 'full', pullId: 'pull-1', postedCount: 3, skippedCount: 17, errorCount: 0, events: [{ fileName: 'a.eml', outcome: 'posted' }] };
    const secondBatch = { hasRun: true, ranAtIso: '2026-08-04T16:21:00.000Z', trigger: 'sharepoint', mode: 'full', pullId: 'pull-1', postedCount: 1, skippedCount: 19, errorCount: 2, events: [{ fileName: 'b.eml', outcome: 'skipped' }] };

    const merged = scheduler.mergePullRunResults(firstBatch, secondBatch);

    expect(merged.postedCount).toBe(4);
    expect(merged.skippedCount).toBe(36);
    expect(merged.errorCount).toBe(2);
    expect(merged.events.map((event) => event.fileName)).toEqual(['a.eml', 'b.eml']);
    expect(merged.ranAtIso).toBe('2026-08-04T16:20:00.000Z');
    expect(merged.pullId).toBe('pull-1');
  });

  it('appendRunLogEntry REPLACES the newest entry when the pullId matches, instead of stacking batches', () => {
    const runLogPath = require('path').join(require('os').tmpdir(), 'tbx-test-run-log-' + process.pid + '.json');
    process.env.TBX_GITHUB_EMAIL_RUN_LOG_PATH = runLogPath;
    try {
      require('fs').rmSync(runLogPath, { force: true });
      scheduler.appendRunLogEntry({ ranAtIso: '1', trigger: 'sharepoint', pullId: 'pull-1', postedCount: 3, events: [] });
      // The second write is the CUMULATIVE merged result — it replaces the first, never stacks.
      scheduler.appendRunLogEntry({ ranAtIso: '1', trigger: 'sharepoint', pullId: 'pull-1', postedCount: 4, events: [] });
      scheduler.appendRunLogEntry({ ranAtIso: '2', trigger: 'sharepoint', pullId: 'pull-2', postedCount: 1, events: [] });

      const runLog = scheduler.readRunLog();
      expect(runLog).toHaveLength(2);
      expect(runLog[0].pullId).toBe('pull-2');
      expect(runLog[1].pullId).toBe('pull-1');
      expect(runLog[1].postedCount).toBe(4);
    } finally {
      delete process.env.TBX_GITHUB_EMAIL_RUN_LOG_PATH;
      require('fs').rmSync(runLogPath, { force: true });
    }
  });

  it('runGithubEmailSourcesNow stamps the pullId on the run result (batches and empty sweeps alike)', async () => {
    const { deps } = buildSourcesDeps();
    const batchOutcome = await scheduler.runGithubEmailSourcesNow(
      baseConfig({ dropFolder: '' }),
      { folderLabel: 'sp', sources: [{ fileName: 'a.eml', content: mergeEmail('<p@github.com>', 9, 'DENP-9') }], pullId: 'pull-9' },
      deps,
    );
    expect(batchOutcome.result.pullId).toBe('pull-9');

    const sweepOutcome = await scheduler.runGithubEmailSourcesNow(
      baseConfig({ dropFolder: '' }), { folderLabel: 'sp', sources: [], listedCount: 0, pullId: 'pull-9' }, deps);
    expect(sweepOutcome.result.pullId).toBe('pull-9');
  });
});

describe('sanitizeLastRunResult', () => {
  it('suppresses a last run whose only content is the healed URL-drop-folder misconfiguration', () => {
    // That run's ENOENT banner kept showing AFTER the config was healed, reading as a live failure.
    const poisonedRun = {
      hasRun: true,
      ranAtIso: '2026-08-04T13:00:00.000Z',
      dropFolder: 'https://myfyi.sharepoint.com/:f:/r/sites/Team/Shared%20Documents/gh_emails?web=1',
      folderError: "Could not read drop folder: ENOENT: no such file or directory, scandir '...'",
      events: [], postedCount: 0, skippedCount: 0, errorCount: 0,
    };
    expect(scheduler.sanitizeLastRunResult(poisonedRun)).toEqual({ hasRun: false });
  });

  it('passes an ordinary run through unchanged — including a real local-folder error', () => {
    const localErrorRun = { hasRun: true, dropFolder: 'C:\\gh', folderError: 'Could not read drop folder: EACCES', events: [] };
    expect(scheduler.sanitizeLastRunResult(localErrorRun)).toBe(localErrorRun);
    const healthyRun = { hasRun: true, dropFolder: '/sites/Team/GitHubEmails', postedCount: 2, events: [] };
    expect(scheduler.sanitizeLastRunResult(healthyRun)).toBe(healthyRun);
  });
});

describe('filterNewSharePointFileNames', () => {
  it('returns only the names the seen-ledger has not recorded, preserving order', () => {
    const readSeenNames = () => ['old-1.eml', 'old-2.eml'];
    const newNames = scheduler.filterNewSharePointFileNames(
      ['old-1.eml', 'fresh-1.eml', 'old-2.eml', 'fresh-2.eml'], { readSeenNames });
    expect(newNames).toEqual(['fresh-1.eml', 'fresh-2.eml']);
  });

  it('drops blank and non-string entries', () => {
    const newNames = scheduler.filterNewSharePointFileNames(['a.eml', '', null, 42], { readSeenNames: () => [] });
    expect(newNames).toEqual(['a.eml']);
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

// ── The SharePoint schedule, now owned by the server ──────────────────────────
//
// This used to be impossible: the tick bailed on `!cfg.dropFolder`, so a SharePoint-only board had no
// server schedule at all and the browser tab had to keep one. Closing the tab stopped it.

describe('checkAndFireGithubEmailIntake — SharePoint-only boards', () => {
  const sharePointConfig = {
    scheduler: {
      githubEmailIntake: {
        isEnabled: true,
        dropFolder: '',
        sharePointFolderUrl: 'https://contoso.sharepoint.com/sites/T/Shared%20Documents/Mail',
        scheduleTime: '07:00',
        intervalMin: 30,
      },
    },
  };

  it('fires on a boundary even with no local drop folder', () => {
    const fired = [];

    const didFire = scheduler.checkAndFireGithubEmailIntake(sharePointConfig, {
      today: '2026-08-13',
      currentTime: '07:30',
      isRunBusy: () => false,
      lastAlignedSlot: null,
      runIntake: (configuration) => { fired.push(configuration); return Promise.resolve({ ok: true }); },
    });

    expect(didFire).toBe(true);
    expect(fired).toHaveLength(1);
  });

  it('still does nothing when neither a folder nor a SharePoint library is configured', () => {
    const emptyConfig = { scheduler: { githubEmailIntake: { isEnabled: true, dropFolder: '', sharePointFolderUrl: '' } } };

    expect(scheduler.checkAndFireGithubEmailIntake(emptyConfig, {
      today: '2026-08-13', currentTime: '07:30', isRunBusy: () => false, lastAlignedSlot: null,
    })).toBe(false);
  });

  it('honours the start time on a SharePoint board exactly as on a local one', () => {
    expect(scheduler.checkAndFireGithubEmailIntake(sharePointConfig, {
      today: '2026-08-13',
      currentTime: '06:30',
      isRunBusy: () => false,
      lastAlignedSlot: null,
      runIntake: () => Promise.resolve({ ok: true }),
    })).toBe(false);
  });

  it('fires once per slot, not once per tick', () => {
    expect(scheduler.checkAndFireGithubEmailIntake(sharePointConfig, {
      today: '2026-08-13',
      currentTime: '07:30',
      isRunBusy: () => false,
      lastAlignedSlot: '2026-08-13 07:30',
      runIntake: () => Promise.resolve({ ok: true }),
    })).toBe(false);
  });
});

describe('runSharePointIntakeNow', () => {
  const configuration = {
    scheduler: {
      githubEmailIntake: {
        isEnabled: true,
        dropFolder: '',
        sharePointFolderUrl: 'https://contoso.sharepoint.com/sites/T/Shared%20Documents/Mail',
        shouldClearSharePointAfterIngest: false,
      },
    },
  };

  it('collects the folder and hands it to the existing pipeline', async () => {
    const runSources = jest.fn(async () => ({ ok: true, result: { postedCount: 2, skippedCount: 0, errorCount: 0 } }));
    const relay = {
      collectNewSharePointSources: async () => ({
        sources: [{ fileName: 'mail-one', content: 'a' }, { fileName: 'mail-two', content: 'b' }],
        listedCount: 2,
        unsupportedCount: 0,
      }),
      recycleConfirmedFiles: jest.fn(),
    };

    const outcome = await scheduler.runSharePointIntakeNow(configuration, { relay, runSources, filterNewFileNames: async (names) => names });

    expect(outcome.ok).toBe(true);
    expect(outcome.result.postedCount).toBe(2);
    // The clear flag is off, so nothing is touched in the library.
    expect(relay.recycleConfirmedFiles).not.toHaveBeenCalled();
  });

  it('records an empty sweep, because "nothing new" once looked identical to "never ran"', async () => {
    const runSources = jest.fn(async () => ({ ok: true, result: { postedCount: 0, skippedCount: 0, errorCount: 0 } }));
    const relay = {
      collectNewSharePointSources: async () => ({ sources: [], listedCount: 9, unsupportedCount: 0 }),
      recycleConfirmedFiles: jest.fn(),
    };

    await scheduler.runSharePointIntakeNow(configuration, { relay, runSources, filterNewFileNames: async () => [] });

    expect(runSources).toHaveBeenCalledTimes(1);
    expect(runSources.mock.calls[0][1].sources).toEqual([]);
  });

  it('gives every batch of one sweep the same pull id, so the log shows one row', async () => {
    const seenPullIds = [];
    const runSources = jest.fn(async (ignored, pullInput) => {
      seenPullIds.push(pullInput.pullId);
      return { ok: true, result: {} };
    });
    const manySources = Array.from({ length: 25 }, (ignoredValue, index) => ({ fileName: `mail-${index}`, content: 'x' }));
    const relay = {
      collectNewSharePointSources: async () => ({ sources: manySources, listedCount: 25, unsupportedCount: 0 }),
      recycleConfirmedFiles: jest.fn(),
    };

    await scheduler.runSharePointIntakeNow(configuration, { relay, runSources, filterNewFileNames: async (names) => names });

    expect(seenPullIds.length).toBeGreaterThan(1);
    expect(new Set(seenPullIds).size).toBe(1);
  });

  it('clears the library only when the board asked it to', async () => {
    const clearingConfig = {
      scheduler: {
        githubEmailIntake: { ...configuration.scheduler.githubEmailIntake, shouldClearSharePointAfterIngest: true },
      },
    };
    const relay = {
      collectNewSharePointSources: async () => ({ sources: [{ fileName: 'mail', content: 'a' }], listedCount: 1, unsupportedCount: 0 }),
      recycleConfirmedFiles: jest.fn(async () => ({ deletedCount: 1, keptCount: 0 })),
    };

    const outcome = await scheduler.runSharePointIntakeNow(clearingConfig, {
      relay,
      runSources: async () => ({ ok: true, result: {} }),
      filterNewFileNames: async () => [],
    });

    expect(relay.recycleConfirmedFiles).toHaveBeenCalled();
    expect(outcome.deletedCount).toBe(1);
  });

  it('says the relay is the problem rather than throwing a stack trace at the tick', async () => {
    const relay = {
      collectNewSharePointSources: async () => { throw new Error('Relay bridge is not active for sharepoint.'); },
      recycleConfirmedFiles: jest.fn(),
    };

    const outcome = await scheduler.runSharePointIntakeNow(configuration, { relay, runSources: jest.fn(), filterNewFileNames: async () => [] });

    expect(outcome.ok).toBe(false);
    expect(outcome.message).toContain('Relay bridge is not active');
  });
});

describe('mergePullRunResults — the skipped-email records must survive batching', () => {
  // A SharePoint pull arrives in batches of 20 and every batch is merged into ONE log row. The merge
  // spread the newer result and concatenated `events`, so a field added later was silently taken
  // from the last batch alone — a 200-file pull would keep the skips of the final 20 and report
  // them as the whole pull. The report exists to answer "should this have been skipped?", and one
  // that quietly covers a tenth of the traffic answers it wrongly while looking complete.
  const { mergePullRunResults } = require('../../src/services/githubEmailIntakeScheduler');

  it('keeps the records from every batch, not just the last', () => {
    const merged = mergePullRunResults(
      { skippedEmails: [{ fileName: 'first.eml' }], events: [], skippedCount: 1 },
      { skippedEmails: [{ fileName: 'second.eml' }], events: [], skippedCount: 1 },
    );

    expect(merged.skippedEmails.map((record) => record.fileName)).toEqual(['first.eml', 'second.eml']);
  });

  it('survives a batch that recorded none', () => {
    const merged = mergePullRunResults(
      { skippedEmails: [{ fileName: 'first.eml' }], events: [] },
      { events: [] },
    );

    expect(merged.skippedEmails).toHaveLength(1);
  });
});
