// Filling a template (e.g. a page's code) with content (e.g. a Word file), slot by slot.
//
// Each row names a slot in the template (CSS) and where its content comes from in the content document (any
// Selector mode). A repeat row clones a template element once per item of the content (e.g. one step card per
// "Step" heading section), and fills each clone from its own item with the rows inside it. So the template follows
// the content: a writer who adds a step gets another card. Item i fills template element i when there is one (so
// each keeps its own attributes); extra items copy the last one; template elements without an item are removed.
import type { ElementContent, Nodes, Root } from 'hast';
import { documentFromSelection } from './convert';
import { replaceSelection } from './insert';
import { runSelector, type SelectorConfig } from './selectors';
import type { CmsDocument } from './types';

export interface FillSlotRow {
  id: string;
  /** CSS for the slot(s) in the template (inside the repeated element, for rows of a repeat). */
  slot: string;
  /** Where the content comes from (in the content document, or in the item for rows of a repeat). */
  from: SelectorConfig;
  /** "inside" (default): the slot keeps its tag and attributes, its content is replaced. "element": the slot itself is. */
  target?: 'inside' | 'element';
  /** The page is wrong without it: a missing slot or no content is a problem, not just a warning. */
  required?: boolean;
}

export interface FillRepeatRow {
  id: string;
  /** CSS for the template element to repeat (e.g. ".step"). */
  repeat: string;
  /** What makes one item in the content (each match is an item, e.g. each "Step" heading section). */
  items: SelectorConfig;
  /** How each clone is filled from its item. */
  rows: FillRow[];
  /** Expected number of items (inclusive): fewer or more is a problem. */
  min?: number;
  max?: number;
}

export type FillRow = FillSlotRow | FillRepeatRow;

export const isRepeatRow = (row: FillRow): row is FillRepeatRow => 'repeat' in row;

export interface FillTemplateOptions {
  rows: FillRow[];
  /** Add the content document's own CSS to the page (default false: the template has its own look). */
  styles?: boolean;
}

/** What happened to one row (for the inspector), with the rows of a repeat for its first item. */
export interface FillReport {
  id: string;
  /** How many slots (or template elements, for a repeat) were found. */
  slots: number;
  /** How many content matches (or items, for a repeat) were found. */
  matches: number;
  filled: number;
  problem?: string;
  warning?: string;
  rows?: FillReport[];
}

export interface FillResult {
  document: CmsDocument;
  warnings: string[];
  /** Things that make the page wrong (required rows, item counts): see FillSlotRow.required. */
  problems: string[];
  report: FillReport[];
}

const describeRow = (row: FillRow) => (isRepeatRow(row) ? `Repeat “${row.repeat}”` : `Slot “${row.slot}”`);

export async function fillTemplate(template: CmsDocument, content: CmsDocument, options: FillTemplateOptions): Promise<FillResult> {
  const warnings: string[] = [];
  const problems: string[] = [];
  const report: FillReport[] = [];
  let doc = template;
  for (const row of options.rows) {
    const r = isRepeatRow(row) ? await fillRepeat(doc, content, row, options) : await fillSlot(doc, content, row, options);
    doc = r.document;
    report.push(r.report);
    warnings.push(...r.warnings.filter((w) => !warnings.includes(w)));
    problems.push(...r.problems);
  }
  return { document: doc, warnings, problems, report };
}

interface RowResult {
  document: CmsDocument;
  warnings: string[];
  problems: string[];
  report: FillReport;
}

async function fillSlot(doc: CmsDocument, content: CmsDocument, row: FillSlotRow, options: FillTemplateOptions): Promise<RowResult> {
  const name = describeRow(row);
  const result = (report: Omit<FillReport, 'id'>, document = doc, warnings: string[] = []): RowResult => {
    const msg = report.problem ?? report.warning;
    const isProblem = !!report.problem;
    return {
      document,
      warnings: [...warnings, ...(!isProblem && msg ? [`${name}: ${msg}`] : [])],
      problems: isProblem ? [`${name}: ${report.problem}`] : [],
      report: { id: row.id, ...report },
    };
  };
  if (!row.slot.trim()) return result({ slots: 0, matches: 0, filled: 0, warning: 'no slot given' });
  const slots = runSelector(doc, { mode: 'css', selector: row.slot });
  const source = runSelector(content, row.from);
  const missing = (what: string) => (row.required ? { problem: what } : { warning: what });
  if (!slots.matches.length) return result({ slots: 0, matches: source.matches.length, filled: 0, ...missing('no such slot in the template') });
  if (!source.matches.length) {
    return result({ slots: slots.matches.length, matches: 0, filled: 0, ...missing('nothing in the content matches, so the slot keeps the template’s text') });
  }
  // One slot takes everything; several slots take one match each, in order.
  const pairs = slots.matches.length > 1;
  const r = await replaceSelection(slots, source, { target: row.target ?? 'inside', pairs, styles: options.styles ?? false });
  const mismatch = pairs && slots.matches.length !== source.matches.length
    ? `${slots.matches.length} slots for ${source.matches.length} matches`
    : undefined;
  return result(
    { slots: slots.matches.length, matches: source.matches.length, filled: r.replaced, ...(mismatch && (row.required ? { problem: mismatch } : { warning: mismatch })) },
    r.document,
    r.warnings.filter((w) => !/^The content has \d+ part/.test(w)),
  );
}

async function fillRepeat(doc: CmsDocument, content: CmsDocument, row: FillRepeatRow, options: FillTemplateOptions): Promise<RowResult> {
  const name = describeRow(row);
  const warnings: string[] = [];
  const problems: string[] = [];
  const templates = runSelector(doc, { mode: 'css', selector: row.repeat }).matches.flatMap((m) =>
    m.match.kind === 'nodes' && m.match.end - m.match.start === 1 ? [{ parent: m.match.parent, index: m.match.start }] : [],
  );
  const items = runSelector(content, row.items);
  const count = items.matches.length;
  const out = (report: Omit<FillReport, 'id'>, document = doc): RowResult => ({ document, warnings, problems, report: { id: row.id, ...report } });
  if (!templates.length) {
    problems.push(`${name}: no such element in the template`);
    return out({ slots: 0, matches: count, filled: 0, problem: 'no such element in the template' });
  }
  const expected = expectation(count, row.min, row.max, 'item');
  if (expected) problems.push(`${name}: ${expected}`);
  if (!count) warnings.push(`${name}: nothing in the content matches, so the repeated elements are removed`);

  const tree = structuredClone(doc.tree);
  const elements = templates.map((t) => childAt(tree, t.parent)?.[t.index]).filter((n): n is ElementContent => !!n && n.type === 'element');
  let meta = doc.meta;
  let assets = doc.assets;
  const clones: ElementContent[] = [];
  let firstReport: FillReport[] | undefined;
  for (let i = 0; i < count; i++) {
    const base = structuredClone(elements[Math.min(i, elements.length - 1)]);
    const item = await documentFromSelection({ ...items, matches: [items.matches[i]], warnings: [] });
    // The clone as a document of its own, filled from its item.
    const piece: CmsDocument = { ...doc, meta, assets, tree: { type: 'root', children: [base] } };
    const filled = await fillTemplate(piece, item.document, { ...options, rows: row.rows });
    clones.push(...(filled.document.tree.children as ElementContent[]));
    meta = { ...filled.document.meta };
    assets = filled.document.assets;
    for (const w of filled.warnings) {
      const msg = `${name}, item ${i + 1}: ${w}`;
      if (!warnings.includes(msg)) warnings.push(msg);
    }
    problems.push(...filled.problems.map((p) => `${name}, item ${i + 1}: ${p}`));
    firstReport ??= filled.report;
  }

  // The clones take the first template element's place; the other template elements go.
  const [first, ...rest] = templates;
  for (const t of [...rest].reverse()) childAt(tree, t.parent)?.splice(t.index, 1);
  childAt(tree, first.parent)?.splice(first.index, 1, ...clones);
  if (rest.some((t) => t.parent.join() !== first.parent.join())) {
    warnings.push(`${name}: the repeated elements were in different places; all items now follow the first one`);
  }
  const document: CmsDocument = { ...doc, tree, meta, assets };
  return out({ slots: templates.length, matches: count, filled: count, ...(expected && { problem: expected }), ...(firstReport && { rows: firstReport }) }, document);
}

/** A message when `count` is outside min..max. */
export function expectation(count: number, min: number | undefined, max: number | undefined, noun: string): string | undefined {
  const s = (n: number) => `${n} ${noun}${n === 1 ? '' : 's'}`;
  if (min !== undefined && count < min) return `found ${s(count)}, expected at least ${min}`;
  if (max !== undefined && count > max) return `found ${s(count)}, expected at most ${max}`;
  return undefined;
}

/** The children array at a path (the root's for []). Paths come from the same tree's index. */
function childAt(tree: Root, path: number[]): Nodes[] | undefined {
  let node: Nodes = tree;
  for (const i of path) {
    if (!('children' in node)) return undefined;
    node = node.children[i];
  }
  return node && 'children' in node ? (node.children as Nodes[]) : undefined;
}

/**
 * Rows suggested by name: a template element whose class is a content class, or ends with "-<class>" (gs-kicker ←
 * kicker), or whose `data-slot` names a content class. Each content class once; slots already in `existing` are skipped.
 */
export function suggestFillRows(template: CmsDocument, content: CmsDocument, existing: FillRow[] = []): FillSlotRow[] {
  const contentClasses = classesIn(content.tree);
  const used = new Set(existing.flatMap((r) => (isRepeatRow(r) ? [] : [r.slot])));
  const out: FillSlotRow[] = [];
  const visit = (node: Nodes) => {
    if (node.type === 'element') {
      const own = classList(node.properties?.className);
      const slotName = node.properties?.dataSlot;
      for (const c of contentClasses) {
        const tplClass = own.find((k) => k === c || k.endsWith(`-${c}`));
        const slot = tplClass ? `.${tplClass}` : slotName === c ? `[data-slot="${c}"]` : undefined;
        if (!slot || used.has(slot) || out.some((r) => r.from.mode === 'css' && r.from.selector === `.${c}`)) continue;
        used.add(slot);
        out.push({ id: `row-${c}`, slot, from: { mode: 'css', selector: `.${c}` } });
      }
    }
    if ('children' in node) for (const c of node.children) visit(c as Nodes);
  };
  visit(template.tree);
  return out;
}

function classList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(/\s+/).filter(Boolean) : [];
}

function classesIn(tree: Root): string[] {
  const out = new Set<string>();
  const visit = (node: Nodes) => {
    if (node.type === 'element') for (const c of classList(node.properties?.className)) out.add(c);
    if ('children' in node) for (const c of node.children) visit(c as Nodes);
  };
  visit(tree);
  return [...out];
}

/** A selection of everything in a document (for rows whose content is the whole item). */
export const everything: SelectorConfig = { mode: 'all', scope: 'document' };
