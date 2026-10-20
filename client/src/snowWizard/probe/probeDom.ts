// probeDom.ts — A tiny element builder for the probe pages, which ship without React to stay small and dependency-free.

import { formatProbeResult, type ProbeId, type ProbeOutcome } from './probeResult.ts';

type NodeAttributeValue = string | ((domEvent: Event) => void);

/** Builds an element; `on*` attributes become listeners and string children become text (never parsed as markup). */
export function createNode<TagName extends keyof HTMLElementTagNameMap>(
  tagName: TagName,
  attributes: Record<string, NodeAttributeValue>,
  ...children: Array<Node | string>
): HTMLElementTagNameMap[TagName] {
  const element = document.createElement(tagName);
  Object.entries(attributes).forEach(([attributeName, attributeValue]) => {
    if (typeof attributeValue === 'function') {
      element.addEventListener(attributeName.replace(/^on/, ''), attributeValue);
    } else {
      element.setAttribute(attributeName, attributeValue);
    }
  });
  children.forEach((childNode) => element.append(childNode));
  return element;
}

/** One numbered probe step: a card with a "Step N — title" heading, matching the Wizard's step wording. */
export function createStep(stepNumber: number, stepTitle: string, ...children: Array<Node | string>): HTMLElement {
  return createNode('section', { class: 'probe-step' }, createNode('h2', {}, `Step ${stepNumber} — ${stepTitle}`), ...children);
}

/** The live result block of one probe page: always shows every probe, re-rendered whenever an outcome arrives. */
export interface ResultPanel {
  element: HTMLElement;
  recordOutcome: (probeId: ProbeId, outcome: ProbeOutcome) => void;
}

/** Builds the copyable result block for one context (the probe file, or the window inside ServiceNow). */
export function createResultPanel(contextLabel: string, browserLabel: string, probeIds: readonly ProbeId[]): ResultPanel {
  const outcomes: Partial<Record<ProbeId, ProbeOutcome>> = {};
  const resultField = createNode('textarea', { 'data-probe-result': '', readonly: '', rows: '4', class: 'probe-result', 'aria-label': 'Probe result' });
  const renderResult = () => { resultField.value = formatProbeResult(contextLabel, browserLabel, probeIds, outcomes); };
  const copyButton = createNode('button', {
    type: 'button',
    class: 'probe-button',
    onclick: () => { void navigator.clipboard?.writeText(resultField.value); },
  }, 'Copy result');
  renderResult();
  return {
    element: createNode('div', { class: 'probe-result-panel' }, resultField, copyButton),
    recordOutcome: (probeId, outcome) => {
      outcomes[probeId] = outcome;
      renderResult();
    },
  };
}
