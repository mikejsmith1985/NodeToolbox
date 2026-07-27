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

  it('interval mode fires only after intervalMin has elapsed', () => {
    const runIntake = jest.fn().mockResolvedValue({ ok: true });
    const config = baseConfig({ intervalMin: 30 });
    const nowMs = 1000 * 60 * 60; // 1h
    // Last fire 10 minutes ago → not due.
    expect(scheduler.checkAndFireGithubEmailIntake(config, { nowMs, lastIntervalFireMs: nowMs - 10 * 60000, runIntake, isRunBusy: () => false })).toBe(false);
    // Last fire 40 minutes ago → due.
    expect(scheduler.checkAndFireGithubEmailIntake(config, { nowMs, lastIntervalFireMs: nowMs - 40 * 60000, runIntake, isRunBusy: () => false })).toBe(true);
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
