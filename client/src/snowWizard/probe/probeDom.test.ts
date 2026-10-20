// probeDom.test.ts — Proves the tiny element builder the probe pages use sets text safely and wires events.

import { describe, expect, it, vi } from 'vitest';

import { createNode, createResultPanel, createStep } from './probeDom.ts';

describe('createNode', () => {
  it('builds an element with attributes, text children and element children', () => {
    const childNode = createNode('strong', {}, 'bold');
    const parentNode = createNode('p', { class: 'note', 'data-x': '1' }, 'plain ', childNode);

    expect(parentNode.outerHTML).toBe('<p class="note" data-x="1">plain <strong>bold</strong></p>');
  });

  it('treats text as text, never as markup', () => {
    expect(createNode('span', {}, '<img src=x>').innerHTML).toBe('&lt;img src=x&gt;');
  });

  it('wires on* attributes as event listeners', () => {
    const clickHandler = vi.fn();
    const buttonNode = createNode('button', { onclick: clickHandler }, 'Go');
    buttonNode.click();
    expect(clickHandler).toHaveBeenCalled();
  });
});

describe('createStep', () => {
  it('numbers the step and titles it', () => {
    const stepNode = createStep(3, 'Open Jira', createNode('p', {}, 'body'));
    expect(stepNode.querySelector('h2')?.textContent).toBe('Step 3 — Open Jira');
    expect(stepNode.textContent).toContain('body');
  });
});

describe('createResultPanel', () => {
  it('shows every probe as not run, then updates as outcomes arrive', () => {
    const resultPanel = createResultPanel('file-page', 'Chrome 141', ['P-HEADERS', 'P-BOOKMARK-SIZE']);
    const resultField = resultPanel.element.querySelector('[data-probe-result]') as HTMLTextAreaElement;
    expect(resultField.value).toBe('PROBE v1 | file-page | Chrome 141 | P-HEADERS=fail(not run) | P-BOOKMARK-SIZE=fail(not run)');

    resultPanel.recordOutcome('P-HEADERS', { isPassed: true, detail: 'recorded' });

    expect(resultField.value).toContain('P-HEADERS=pass(recorded)');
  });
});
