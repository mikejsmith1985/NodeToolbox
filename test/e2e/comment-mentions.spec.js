// comment-mentions.spec.js — E2E proof of Jira-native @-mentions in comments, in a real browser:
// a mention in a comment reads as a person's name (never a raw identifier), a mention carried in a
// rich-editor (ADF) comment is not silently dropped, an unidentifiable person degrades honestly,
// typing "@" opens a person picker whose selection posts a real notifying mention, and typing an
// email address never opens it.
//
// Every Jira call is intercepted so no live Jira is needed (see stubJiraProxy). The one thing this
// spec CANNOT prove is that Jira actually delivers the notification — that requires a real instance
// and a real colleague, and is covered by quickstart.md Tests 0 and 4.

'use strict';

const { test, expect } = require('@playwright/test');

const HOME_HEADING = 'Your personal utility belt';
const ISSUE_KEY = 'ENCUC-1';

// The person who gets mentioned throughout. Cloud-shaped (accountId), which is the form that reads
// as an opaque identifier today — exactly the complaint this feature fixes.
const MENTIONED_ACCOUNT_ID = '557058:ab-12';
const MENTIONED_DISPLAY_NAME = 'Jane Doe';

/** A comment whose body carries a mention in wiki markup, as Jira REST v2 returns it. */
function wikiMentionComment() {
  return {
    id: '9001',
    author: { displayName: 'Ada Reporter', accountId: 'acc-ada' },
    body: `Hey [~accountid:${MENTIONED_ACCOUNT_ID}] can you review this?`,
    created: '2026-01-05T09:00:00.000Z',
  };
}

/** A comment whose body is an ADF document — the shape whose mentions vanish entirely today. */
function adfMentionComment() {
  return {
    id: '9002',
    author: { displayName: 'Ben Author', accountId: 'acc-ben' },
    created: '2026-01-04T09:00:00.000Z',
    body: {
      type: 'doc',
      content: [{
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Handing over to ' },
          { type: 'mention', attrs: { id: MENTIONED_ACCOUNT_ID, text: `@${MENTIONED_DISPLAY_NAME}` } },
          { type: 'text', text: ' for sign-off' },
        ],
      }],
    },
  };
}

/** A comment mentioning somebody the directory cannot identify (deactivated, or not visible). */
function unresolvableMentionComment() {
  return {
    id: '9003',
    author: { displayName: 'Ada Reporter', accountId: 'acc-ada' },
    body: 'Originally raised by [~accountid:ghost-user] last quarter',
    created: '2026-01-03T09:00:00.000Z',
  };
}

function issuePayload() {
  return {
    id: ISSUE_KEY,
    key: ISSUE_KEY,
    fields: {
      summary: 'Mentions should read as names',
      status: { name: 'In Progress', statusCategory: { key: 'indeterminate' } },
      priority: { name: 'High', iconUrl: '' },
      assignee: { displayName: 'Taylor Dev', accountId: 'acc-taylor' },
      issuetype: { name: 'Story', iconUrl: '' },
      created: '2026-01-01T00:00:00.000Z',
      updated: '2026-01-02T00:00:00.000Z',
      description: 'Body text',
      issuelinks: [],
      labels: [],
    },
  };
}

/**
 * Intercepts every Jira call the mention flow makes. `postedComments` collects comment POST bodies so
 * a test can assert the mention token that actually reached Jira.
 */
async function stubJiraProxy(page, { comments, postedComments }) {
  await page.route('**/jira-proxy/**', (route) => {
    const requestUrl = route.request().url();
    const request = route.request();
    const fulfillJson = (status, body) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

    if (requestUrl.includes('/comment') && request.method() === 'POST') {
      postedComments.push(JSON.parse(request.postData() || '{}'));
      return fulfillJson(201, { id: '9999' });
    }
    if (requestUrl.includes('/comment')) {
      return fulfillJson(200, { comments, total: comments.length });
    }
    if (requestUrl.includes('/transitions')) {
      return fulfillJson(200, { transitions: [] });
    }
    if (requestUrl.includes('/editmeta')) {
      return fulfillJson(200, { fields: {} });
    }
    if (requestUrl.includes('/user/search')) {
      return fulfillJson(200, [
        { accountId: MENTIONED_ACCOUNT_ID, displayName: MENTIONED_DISPLAY_NAME, emailAddress: 'jane.doe@example.com' },
      ]);
    }
    // A single-person lookup: the mentioned account resolves, anyone else is unknown to us.
    if (requestUrl.includes('/user?')) {
      return requestUrl.includes(encodeURIComponent(MENTIONED_ACCOUNT_ID))
        ? fulfillJson(200, { accountId: MENTIONED_ACCOUNT_ID, displayName: MENTIONED_DISPLAY_NAME })
        : fulfillJson(404, { errorMessages: ['User not found'] });
    }
    if (requestUrl.includes('/myself')) {
      return fulfillJson(200, { accountId: 'acc-me', displayName: 'Current Reader', name: 'me' });
    }
    if (requestUrl.includes('/search')) {
      return fulfillJson(200, { issues: [issuePayload()], total: 1 });
    }
    return fulfillJson(200, issuePayload());
  });
}

/** Opens the shared issue detail panel via the F2 quick lookup, which every surface reuses. */
async function openIssueDetail(page) {
  await page.goto('/');
  await expect(page.getByText(HOME_HEADING)).toBeVisible();
  await page.keyboard.press('F2');
  await page.getByRole('textbox', { name: /issue key/i }).fill(ISSUE_KEY);
  await page.keyboard.press('Enter');
  await expect(page.getByText('Mentions should read as names')).toBeVisible();
}

test.describe('reading a comment (US1)', () => {
  test('shows a mentioned person by name, never as a raw identifier', async ({ page }) => {
    await stubJiraProxy(page, { comments: [wikiMentionComment()], postedComments: [] });
    await openIssueDetail(page);

    await expect(page.getByText(`@${MENTIONED_DISPLAY_NAME}`)).toBeVisible();
    await expect(page.getByText(/accountid:/)).toHaveCount(0);
  });

  test('does not drop a mention carried in a rich-editor comment', async ({ page }) => {
    // Today this sentence renders as "Handing over to  for sign-off" — the person disappears.
    await stubJiraProxy(page, { comments: [adfMentionComment()], postedComments: [] });
    await openIssueDetail(page);

    await expect(page.getByText(`Handing over to @${MENTIONED_DISPLAY_NAME} for sign-off`)).toBeVisible();
  });

  test('degrades honestly when a mentioned person cannot be identified', async ({ page }) => {
    await stubJiraProxy(page, { comments: [unresolvableMentionComment()], postedComments: [] });
    await openIssueDetail(page);

    await expect(page.getByText('@unknown user')).toBeVisible();
    // The sentence still reads, and the raw identifier is deliberately not shown.
    await expect(page.getByText(/ghost-user/)).toHaveCount(0);
  });
});

test.describe('writing a comment (US2)', () => {
  test('typing @ offers people and posts a real mention token', async ({ page }) => {
    const postedComments = [];
    await stubJiraProxy(page, { comments: [], postedComments });
    await openIssueDetail(page);

    const commentBox = page.getByLabel(/add comment/i);
    await commentBox.fill('Thanks ');
    await commentBox.pressSequentially('@jan');

    await expect(page.getByRole('listbox', { name: /people matching/i })).toBeVisible();
    await page.getByRole('option', { name: new RegExp(MENTIONED_DISPLAY_NAME) }).click();

    // The composer says who was tagged, even though the box itself holds the raw token.
    await expect(page.getByText(new RegExp(`Tagging:.*${MENTIONED_DISPLAY_NAME}`))).toBeVisible();

    await page.getByRole('button', { name: /post comment/i }).click();
    await expect.poll(() => postedComments.length).toBeGreaterThan(0);
    expect(postedComments[0].body).toContain(`[~accountid:${MENTIONED_ACCOUNT_ID}]`);
  });

  test('never opens the picker while typing an email address', async ({ page }) => {
    await stubJiraProxy(page, { comments: [], postedComments: [] });
    await openIssueDetail(page);

    await page.getByLabel(/add comment/i).pressSequentially('mail me at mike@example.com');

    await expect(page.getByRole('listbox', { name: /people matching/i })).toHaveCount(0);
  });

  test('leaves a dismissed @ as ordinary text', async ({ page }) => {
    await stubJiraProxy(page, { comments: [], postedComments: [] });
    await openIssueDetail(page);

    const commentBox = page.getByLabel(/add comment/i);
    await commentBox.pressSequentially('@jan');
    await expect(page.getByRole('listbox', { name: /people matching/i })).toBeVisible();
    await page.keyboard.press('Escape');

    await expect(page.getByRole('listbox', { name: /people matching/i })).toHaveCount(0);
    await expect(commentBox).toHaveValue('@jan');
  });
});
