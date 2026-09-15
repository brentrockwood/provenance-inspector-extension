/**
 * Rendering evidence.
 *
 * Built with explicit DOM calls rather than string templates: the panel displays text taken
 * from arbitrary web pages and from detector output, and building nodes with textContent
 * makes injection structurally impossible instead of merely unlikely.
 */

import {
  GLOBAL_INTERPRETATION_NOTE,
  summaryHeading,
  type Evidence,
  type InspectionReport,
} from '@provenance/evidence';

import type { InspectionState } from './inspection.ts';

const RESULT_LABEL: Record<Evidence['result'], string> = {
  positive: 'Detected',
  negative: 'Not detected',
  indeterminate: 'Inconclusive',
  unavailable: 'Unavailable',
  error: 'Failed',
};

const STRENGTH_LABEL: Record<Evidence['strength'], string> = {
  cryptographic: 'Cryptographic verification',
  statistical: 'Statistical signal',
  descriptive: 'Self-asserted metadata',
};

const SCOPE_LABEL: Record<Evidence['scope'], string> = {
  'selected-content': 'Applies to the selected content',
  asset: 'Applies to the inspected asset only, not to surrounding text',
  page: 'Applies to the page',
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function fact(list: HTMLElement, label: string, value: string, mono = false): void {
  list.append(el('dt', undefined, label));
  const dd = el('dd', mono ? 'mono' : undefined, value);
  list.append(dd);
}

function renderSummary(report: InspectionReport): HTMLElement {
  const box = el('section', `summary summary--${report.summary.label}`);
  box.append(el('h2', 'summary__heading', summaryHeading(report.summary.label)));
  box.append(el('p', 'summary__body', report.summary.text));
  return box;
}

function renderFacts(state: InspectionState): HTMLElement {
  const list = el('dl', 'facts');
  if (state.input.kind === 'text') {
    fact(list, 'Inspected', `${state.counts.words} words · ${state.counts.characters} characters`);
  } else {
    fact(list, 'Inspected', 'Image asset');
  }
  if (state.input.source.assetUrl) fact(list, 'Asset', state.input.source.assetUrl);
  fact(list, 'SHA-256', state.input.digest.value, true);
  fact(list, 'Page', state.input.source.pageTitle || state.input.source.pageUrl);
  return list;
}

function renderMetrics(evidence: Evidence): HTMLElement | null {
  const rows: Array<[string, string]> = [];
  if (evidence.score !== undefined) rows.push(['Score', evidence.score.toFixed(4)]);
  if (evidence.threshold !== undefined) rows.push(['Threshold', evidence.threshold.toFixed(4)]);
  if (evidence.sampleSize !== undefined) rows.push(['Sample', `${evidence.sampleSize} positions`]);
  const details = evidence.details as Record<string, unknown> | undefined;
  if (details?.configurationId) rows.push(['Config', String(details.configurationId)]);
  if (typeof details?.log10PValue === 'number' && Number.isFinite(details.log10PValue)) {
    rows.push(['log10 p', details.log10PValue.toFixed(1)]);
  }
  if (evidence.issuer) rows.push(['Issuer', evidence.issuer]);
  if (rows.length === 0) return null;

  const dl = el('dl', 'metrics');
  for (const [k, v] of rows) {
    dl.append(el('dt', undefined, k));
    dl.append(el('dd', undefined, v));
  }
  return dl;
}

function renderCard(evidence: Evidence): HTMLElement {
  const card = el(
    'article',
    `card${evidence.result === 'unavailable' ? ' card--unavailable' : ''}`,
  );

  const head = el('div', 'card__head');
  const name = el('h3', 'card__name', evidence.detector.name);
  head.append(name);
  head.append(el('span', `result result--${evidence.result}`, RESULT_LABEL[evidence.result]));
  card.append(head);

  card.append(el('div', 'card__version', `${evidence.detector.id} · v${evidence.detector.version}`));
  card.append(el('p', 'card__summary', evidence.summary));

  if (evidence.result !== 'unavailable') {
    card.append(el('p', 'card__scope', `${STRENGTH_LABEL[evidence.strength]} · ${SCOPE_LABEL[evidence.scope]}`));
  }

  const metrics = renderMetrics(evidence);
  if (metrics) card.append(metrics);

  if (evidence.limitations.length > 0) {
    const details = el('details', 'limits');
    details.append(el('summary', undefined, `Limitations (${evidence.limitations.length})`));
    const ul = el('ul');
    for (const limitation of evidence.limitations) ul.append(el('li', undefined, limitation));
    details.append(ul);
    card.append(details);
  }

  return card;
}

export interface RenderHandlers {
  onCopyJson(): void;
}

export function renderState(
  container: HTMLElement,
  footer: HTMLElement,
  state: InspectionState,
  handlers: RenderHandlers,
): void {
  container.replaceChildren();

  container.append(renderSummary(state.report));
  container.append(renderFacts(state));

  const cards = el('div', 'cards');
  for (const evidence of state.report.evidence) cards.append(renderCard(evidence));
  container.append(cards);

  if (state.pendingDetectors > 0) {
    container.append(
      el(
        'p',
        'spinner',
        `Running ${state.pendingDetectors} more detector${state.pendingDetectors === 1 ? '' : 's'}…`,
      ),
    );
  }

  const actions = el('div', 'actions');
  const copy = el('button', undefined, 'Copy evidence JSON');
  copy.type = 'button';
  copy.disabled = state.pendingDetectors > 0;
  copy.addEventListener('click', () => handlers.onCopyJson());
  actions.append(copy);
  container.append(actions);

  footer.textContent = GLOBAL_INTERPRETATION_NOTE;
}

export function renderMessage(
  container: HTMLElement,
  footer: HTMLElement,
  heading: string,
  body: string,
): void {
  container.replaceChildren();
  const box = el('section', 'summary summary--indeterminate');
  box.append(el('h2', 'summary__heading', heading));
  box.append(el('p', 'summary__body', body));
  container.append(box);
  footer.textContent = GLOBAL_INTERPRETATION_NOTE;
}
