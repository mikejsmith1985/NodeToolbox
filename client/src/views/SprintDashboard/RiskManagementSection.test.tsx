// RiskManagementSection.test.tsx — Tests for the Risk Management section utility functions.

import { describe, expect, it } from 'vitest';

// ── Inline test utilities (mirror the module-private helpers) ──

interface AiAssistRiskItem {
  key: string;
  description: string;
  riskResponse?: string;
  priority?: string;
}

function parseAiAssistRiskResponse(
  responseText: string,
  validRiskKeys: ReadonlySet<string>,
): { items: AiAssistRiskItem[]; errorMessage: string | null } {
  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return { items: [], errorMessage: 'No JSON array found in the response. Paste the full AI Assist output.' };
  }

  let parsedItems: unknown;
  try {
    parsedItems = JSON.parse(jsonMatch[0]);
  } catch {
    return { items: [], errorMessage: 'Response contains invalid JSON. Check the pasted text.' };
  }

  if (!Array.isArray(parsedItems)) {
    return { items: [], errorMessage: 'Expected a JSON array at the top level.' };
  }

  const validItems: AiAssistRiskItem[] = [];
  for (const parsedItem of parsedItems) {
    if (typeof parsedItem !== 'object' || parsedItem === null) continue;
    const candidate = parsedItem as Record<string, unknown>;
    const issueKey = typeof candidate.key === 'string' ? candidate.key.trim().toUpperCase() : '';
    const description = typeof candidate.description === 'string' ? candidate.description.trim() : '';
    if (!issueKey || !validRiskKeys.has(issueKey) || !description) continue;

    validItems.push({
      key: issueKey,
      description,
      riskResponse: typeof candidate.riskResponse === 'string' ? candidate.riskResponse.trim() : undefined,
      priority: typeof candidate.priority === 'string' ? candidate.priority.trim() : undefined,
    });
  }

  if (validItems.length === 0) {
    return { items: [], errorMessage: 'No valid risk updates found. Check that the issue keys match this PI.' };
  }

  return { items: validItems, errorMessage: null };
}

// ── Tests ──

describe('parseAiAssistRiskResponse', () => {
  it('extracts a valid risk update from a clean JSON array', () => {
    const json = JSON.stringify([
      { key: 'PROJ-1', description: 'There is a risk that: ...', riskResponse: 'Mitigate', priority: 'High' },
    ]);
    const { items, errorMessage } = parseAiAssistRiskResponse(json, new Set(['PROJ-1']));

    expect(errorMessage).toBeNull();
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe('PROJ-1');
    expect(items[0].riskResponse).toBe('Mitigate');
    expect(items[0].priority).toBe('High');
  });

  it('normalises issue keys to upper case', () => {
    const json = JSON.stringify([
      { key: 'proj-2', description: 'There is a risk that: ...' },
    ]);
    const { items } = parseAiAssistRiskResponse(json, new Set(['PROJ-2']));

    expect(items[0].key).toBe('PROJ-2');
  });

  it('strips prose wrapping and extracts the JSON array', () => {
    const json = `Here are the refined risks:\n${JSON.stringify([
      { key: 'PROJ-3', description: 'There is a risk that: ...' },
    ])}\nHope this helps!`;
    const { items, errorMessage } = parseAiAssistRiskResponse(json, new Set(['PROJ-3']));

    expect(errorMessage).toBeNull();
    expect(items).toHaveLength(1);
  });

  it('returns an error when the response contains no JSON array', () => {
    const { items, errorMessage } = parseAiAssistRiskResponse('No JSON here.', new Set(['PROJ-1']));

    expect(items).toHaveLength(0);
    expect(errorMessage).toContain('No JSON array found');
  });

  it('returns an error for malformed JSON', () => {
    const { items, errorMessage } = parseAiAssistRiskResponse('[{ broken }]', new Set(['PROJ-1']));

    expect(items).toHaveLength(0);
    expect(errorMessage).toContain('invalid JSON');
  });

  it('silently skips entries whose keys are not in the valid set', () => {
    const json = JSON.stringify([
      { key: 'OTHER-99', description: 'There is a risk that: ...' },
    ]);
    const { items, errorMessage } = parseAiAssistRiskResponse(json, new Set(['PROJ-1']));

    expect(items).toHaveLength(0);
    expect(errorMessage).toContain('No valid risk updates found');
  });

  it('silently skips entries that are missing a description', () => {
    const json = JSON.stringify([
      { key: 'PROJ-1', riskResponse: 'Accept' },
    ]);
    const { items, errorMessage } = parseAiAssistRiskResponse(json, new Set(['PROJ-1']));

    expect(items).toHaveLength(0);
    expect(errorMessage).toContain('No valid risk updates found');
  });

  it('accepts items without optional riskResponse and priority fields', () => {
    const json = JSON.stringify([
      { key: 'PROJ-4', description: 'There is a risk that: ...' },
    ]);
    const { items, errorMessage } = parseAiAssistRiskResponse(json, new Set(['PROJ-4']));

    expect(errorMessage).toBeNull();
    expect(items[0].riskResponse).toBeUndefined();
    expect(items[0].priority).toBeUndefined();
  });
});
