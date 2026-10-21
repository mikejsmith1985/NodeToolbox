// missingField.test.ts — Proves "Show me" finds the first empty field marked "needed", falls back to an empty date part,
// and highlights the field it points to.

import { describe, expect, it } from 'vitest';

import { findFirstMissingField, MISSING_FIELD_ATTRIBUTE, pointToFirstMissingField } from './missingField.ts';

/** A container holding the given markup. */
function buildContainer(markup: string): HTMLElement {
  const container = document.createElement('div');
  container.innerHTML = markup;
  document.body.append(container);
  return container;
}

describe('findFirstMissingField', () => {
  it('skips filled and optional fields and finds the first empty "needed" one', () => {
    const container = buildContainer(`
      <label for="a">Title (needed)</label><input id="a" value="Payments" />
      <label for="b">Requested by</label><input id="b" value="" />
      <div><label>Owner (needed)</label><input id="c" value="" /></div>
    `);
    expect(findFirstMissingField(container)?.id).toBe('c');
  });

  it('falls back to an empty date part when no "needed" field is empty', () => {
    const container = buildContainer('<input aria-label="REL start day" value="2026-10-22" /><select aria-label="PRD start hour"><option value=""></option></select>');
    expect(findFirstMissingField(container)?.getAttribute('aria-label')).toBe('PRD start hour');
  });

  it('finds nothing when every needed field is filled', () => {
    expect(findFirstMissingField(buildContainer('<label for="x">Title (needed)</label><input id="x" value="Done" />'))).toBeNull();
  });
});

describe('pointToFirstMissingField', () => {
  it('focuses and highlights the field, and says when there is nothing to point to', () => {
    const container = buildContainer('<label for="m">Category (needed)</label><select id="m"><option value=""></option></select>');
    expect(pointToFirstMissingField(container)).toBe(true);
    const field = container.querySelector('#m') as HTMLElement;
    expect(document.activeElement).toBe(field);
    expect(field.getAttribute(MISSING_FIELD_ATTRIBUTE)).toBe('true');
    expect(pointToFirstMissingField(null)).toBe(false);
  });
});
