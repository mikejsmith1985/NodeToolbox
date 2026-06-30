// templateStore.test.ts — Unit tests for the shared template store wrappers + 3-way merge.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  JIRA_TEMPLATES_PROPERTY_KEY,
  loadJiraTemplates,
  mergeJiraTemplateStores,
  saveJiraTemplates,
} from '../../../services/confluenceApi.ts';
import type { JiraTemplate, JiraTemplateStore } from '../lib/templateTypes.ts';
import { JIRA_TEMPLATE_STORE_SCHEMA_VERSION } from '../lib/templateTypes.ts';

const DATABASE_ID = 'db-1';

function makeTemplate(id: string, name: string): JiraTemplate {
  return {
    id, name, description: '', projectKey: 'ABC', projectId: '1', issueTypeId: '10',
    issueTypeName: 'Task', fields: [], authorName: 'Tester',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  };
}

function makeStore(templates: JiraTemplate[]): JiraTemplateStore {
  return { schemaVersion: JIRA_TEMPLATE_STORE_SCHEMA_VERSION, updatedAt: '2026-01-01T00:00:00Z', templates };
}

/** Queues sequential fetch responses for the Confluence proxy calls. */
function queueFetchResponses(responses: Array<{ body: unknown; status?: number }>): void {
  const queue = [...responses];
  vi.stubGlobal('fetch', vi.fn(async () => {
    const next = queue.shift() ?? { body: {}, status: 200 };
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }));
}

describe('template store wrappers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns an empty store when the property does not exist yet (first run)', async () => {
    queueFetchResponses([{ body: { results: [] } }]); // property lookup returns nothing
    const store = await loadJiraTemplates(DATABASE_ID);
    expect(store.templates).toEqual([]);
    expect(store.schemaVersion).toBe(JIRA_TEMPLATE_STORE_SCHEMA_VERSION);
  });

  it('rejects an unknown schemaVersion rather than mis-parsing', async () => {
    queueFetchResponses([
      { body: { results: [{ id: 'p1', key: JIRA_TEMPLATES_PROPERTY_KEY }] } },
      { body: { id: 'p1', key: JIRA_TEMPLATES_PROPERTY_KEY, version: { number: 3 }, value: { schemaVersion: 999, updatedAt: '', templates: [] } } },
    ]);
    await expect(loadJiraTemplates(DATABASE_ID)).rejects.toThrow(/schema version/i);
  });

  it('saves by upserting the property with the stamped schema version', async () => {
    // upsert first looks up existing (none), then POSTs.
    queueFetchResponses([
      { body: { results: [] } },
      { body: { id: 'p1', key: JIRA_TEMPLATES_PROPERTY_KEY, version: { number: 1 }, value: {} } },
    ]);
    const saved = await saveJiraTemplates(DATABASE_ID, makeStore([makeTemplate('t1', 'Weekly')]));
    expect(saved.templates[0].name).toBe('Weekly');
    expect(saved.schemaVersion).toBe(JIRA_TEMPLATE_STORE_SCHEMA_VERSION);
  });
});

describe('mergeJiraTemplateStores (3-way)', () => {
  it('keeps independent edits to different templates from two editors', () => {
    const base = makeStore([makeTemplate('a', 'A'), makeTemplate('b', 'B')]);
    const remote = makeStore([{ ...makeTemplate('a', 'A'), description: 'remote-edit' }, makeTemplate('b', 'B')]);
    const working = makeStore([makeTemplate('a', 'A'), { ...makeTemplate('b', 'B'), description: 'local-edit' }]);

    const { merged, conflicts } = mergeJiraTemplateStores(base, remote, working);

    expect(conflicts).toEqual([]);
    expect(merged.templates.find((t) => t.id === 'a')?.description).toBe('remote-edit');
    expect(merged.templates.find((t) => t.id === 'b')?.description).toBe('local-edit');
  });

  it('adds a brand-new local template', () => {
    const base = makeStore([makeTemplate('a', 'A')]);
    const remote = makeStore([makeTemplate('a', 'A')]);
    const working = makeStore([makeTemplate('a', 'A'), makeTemplate('c', 'C')]);
    const { merged, conflicts } = mergeJiraTemplateStores(base, remote, working);
    expect(conflicts).toEqual([]);
    expect(merged.templates.map((t) => t.id).sort()).toEqual(['a', 'c']);
  });

  it('flags a conflict when both sides edit the same template differently', () => {
    const base = makeStore([makeTemplate('a', 'A')]);
    const remote = makeStore([{ ...makeTemplate('a', 'A'), description: 'remote' }]);
    const working = makeStore([{ ...makeTemplate('a', 'A'), description: 'local' }]);
    const { conflicts } = mergeJiraTemplateStores(base, remote, working);
    expect(conflicts).toContain('a');
  });

  it('removes a template deleted locally when remote left it unchanged', () => {
    const base = makeStore([makeTemplate('a', 'A'), makeTemplate('b', 'B')]);
    const remote = makeStore([makeTemplate('a', 'A'), makeTemplate('b', 'B')]);
    const working = makeStore([makeTemplate('a', 'A')]);
    const { merged } = mergeJiraTemplateStores(base, remote, working);
    expect(merged.templates.map((t) => t.id)).toEqual(['a']);
  });
});
