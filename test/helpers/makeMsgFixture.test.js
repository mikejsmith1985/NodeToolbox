// test/helpers/makeMsgFixture.test.js — Round-trips the synthetic .msg writer through the real CFBF reader
// (the bundled engine) so the fixture generator itself is verified, not just trusted.

'use strict';

const { buildMsgBytes, buildGithubNotificationMsg } = require('./makeMsgFixture');
const engine = require('../../src/services/generated/githubEmailEngine.cjs');

describe('makeMsgFixture', () => {
  it('produces .msg bytes the reader can parse back into headers and body', () => {
    const bytes = buildMsgBytes('X-GitHub-Sender: OCTOCAT_TEST\r\nSubject: hello', 'a plain text body');
    const parsed = engine.parseMsg(bytes);

    expect(parsed.transportHeaders).toContain('X-GitHub-Sender: OCTOCAT_TEST');
    expect(parsed.bodyText).toContain('a plain text body');
  });

  it('builds a GitHub-notification .msg that classifies end to end', () => {
    const bytes = buildGithubNotificationMsg({
      subject: 'Re: [testorg/testrepo] [TEST-9] Do it (PR #3)',
      listId: 'testorg/testrepo <testrepo.testorg.github.com>',
      sender: 'OCTOCAT_TEST',
      reason: 'review_requested',
      messageId: '<testorg/testrepo/pull/3/issue_event/1@github.com>',
      body: 'OCTOCAT_TEST requested review on testorg/testrepo#3 [TEST-9].',
    });

    const event = engine.parseGithubEmail(engine.msgBytesToEmailSource(bytes));
    expect(event.eventType).toBe('review_requested');
    expect(event.jiraKey).toBe('TEST-9');
    expect(event.repo).toBe('testorg/testrepo');
    expect(event.prNumber).toBe(3);
  });
});
