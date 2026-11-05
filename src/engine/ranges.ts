// A mutable working copy of a document tree, used while snippets are applied.
//
// Matches are turned into node references before anything changes, so they stay valid while
// other matches are applied: wrapping moves nodes but keeps them the same objects, and when a
// text node or an element is split, the split is recorded so later lookups can follow it.
import type { Element, ElementContent, Nodes, Parent, Root, Text } from 'hast';
import { BLOCK_TAGS } from './document';

type Child = ElementContent;
type Container = Root | Element;

export const isProtected = (node: Nodes | undefined): node is Element =>
  node?.type === 'element' && typeof node.properties.dataJsonPath === 'string';

export const isBlockElement = (node: Nodes | undefined): node is Element =>
  node?.type === 'element' && BLOCK_TAGS.has(node.tagName);

/** A run of siblings, by reference: every node from `first` to `last` under their common parent. */
export interface NodeRef {
  kind: 'nodes';
  first: Child;
  last: Child;
}

/** A text range, by reference: from (`startNode`, `startOffset`) to (`endNode`, `endOffset`). */
export interface TextRef {
  kind: 'text';
  startNode: Text;
  startOffset: number;
  endNode: Text;
  endOffset: number;
}

export interface Run {
  parent: Container;
  start: number;
  end: number;
  /** True when the run was cut out of a text selection (attributes mode then needs a <span>). */
  fromText: boolean;
}

export class Workspace {
  readonly parents = new Map<Nodes, Container>();
  /** When a node was split, the part that came after it. */
  private readonly nextPart = new Map<Nodes, Nodes>();

  constructor(readonly tree: Root) {
    this.adopt(tree);
  }

  private adopt(parent: Container) {
    for (const child of parent.children) {
      this.parents.set(child, parent);
      if (child.type === 'element') this.adopt(child);
    }
  }

  parentOf(node: Nodes): Container | undefined {
    return this.parents.get(node);
  }

  /** Replace children [start, end) of `parent` with `nodes`. */
  splice(parent: Container, start: number, end: number, nodes: Child[]) {
    parent.children.splice(start, end - start, ...(nodes as Parent['children']));
    for (const n of nodes) {
      this.parents.set(n, parent);
      if (n.type === 'element') this.adopt(n);
    }
  }

  setChildren(parent: Container, nodes: Child[]) {
    this.splice(parent, 0, parent.children.length, nodes);
  }

  indexIn(parent: Container, node: Nodes) {
    return (parent.children as Nodes[]).indexOf(node);
  }

  ancestors(node: Nodes): Container[] {
    const out: Container[] = [];
    for (let p = this.parentOf(node); p; p = this.parentOf(p)) out.push(p);
    return out;
  }

  /** Follow splits to the very last part of a node. */
  lastPart(node: Nodes): Nodes {
    let n = node;
    while (this.nextPart.has(n)) n = this.nextPart.get(n)!;
    return n;
  }

  /** Split a text node at `at`; the original keeps the left part. Returns the right part. */
  splitText(node: Text, at: number): Text {
    const right: Text = { type: 'text', value: node.value.slice(at) };
    node.value = node.value.slice(0, at);
    const parent = this.parentOf(node)!;
    this.splice(parent, this.indexIn(parent, node) + 1, this.indexIn(parent, node) + 1, [right]);
    this.chain(node, right);
    return right;
  }

  /** Split an element before child `index`; the original keeps the children before it. Returns the new element. */
  splitElement(el: Element, index: number): Element {
    const properties = structuredClone(el.properties);
    delete properties.id; // ids must stay unique
    const right: Element = { type: 'element', tagName: el.tagName, properties, children: [] };
    const moved = el.children.splice(index);
    const parent = this.parentOf(el)!;
    const at = this.indexIn(parent, el) + 1;
    this.splice(parent, at, at, [right]);
    this.setChildren(right, moved);
    this.chain(el, right);
    return right;
  }

  private chain(left: Nodes, right: Nodes) {
    const after = this.nextPart.get(left);
    this.nextPart.set(left, right);
    if (after) this.nextPart.set(right, after);
  }

  /** Where a text position is now, following any splits. Starts move forward past the end of a part. */
  findText(node: Text, offset: number, edge: 'start' | 'end'): { node: Text; offset: number } {
    let n = node;
    let o = offset;
    for (;;) {
      const next = this.nextPart.get(n) as Text | undefined;
      const len = n.value.length;
      if (!next || (edge === 'start' ? o < len : o <= len)) return { node: n, offset: o };
      o -= len;
      n = next;
    }
  }

  /** The current sibling run for a node reference: both ends lifted to children of their common parent. */
  resolveNodes(ref: NodeRef): Run | undefined {
    const last = this.lastPart(ref.last) as Child;
    return this.runBetween(ref.first, last, false);
  }

  private runBetween(first: Nodes, last: Nodes, fromText: boolean): Run | undefined {
    const firstChain = [first, ...this.ancestors(first)];
    const lastChain = [last, ...this.ancestors(last)];
    const lastSet = new Set<Nodes>(lastChain);
    const common = firstChain.find((n) => lastSet.has(n) && n !== first && n !== last) as Container | undefined;
    // When one end contains the other, the run is that end alone.
    if (lastSet.has(first)) return this.single(first, fromText);
    if (firstChain.includes(last)) return this.single(last, fromText);
    if (!common) return undefined;
    const a = firstChain[firstChain.indexOf(common) - 1];
    const b = lastChain[lastChain.indexOf(common) - 1];
    const start = this.indexIn(common, a);
    const end = this.indexIn(common, b) + 1;
    return start >= 0 && end > start ? { parent: common, start, end, fromText } : undefined;
  }

  private single(node: Nodes, fromText: boolean): Run | undefined {
    const parent = this.parentOf(node);
    if (!parent) return undefined;
    const i = this.indexIn(parent, node);
    return { parent, start: i, end: i + 1, fromText };
  }

  /**
   * Turn a text range into sibling runs. Text nodes are split at the range edges; inline elements
   * that the range only partly covers are split so the range becomes whole siblings.
   * Ranges never split block elements or JSON field blocks: a range across several blocks gives one run per block.
   * With `snapToBlock`, the range grows to the whole blocks it touches and gives one run.
   */
  isolateText(ref: TextRef, snapToBlock: boolean): Run[] {
    const startPos = this.findText(ref.startNode, ref.startOffset, 'start');
    const endPos = this.findText(ref.endNode, ref.endOffset, 'end');
    let first = startPos.node;
    let last = endPos.node;
    let endOffset = endPos.offset;
    if (startPos.offset > 0) {
      const right = this.splitText(first, startPos.offset);
      if (last === first) {
        last = right;
        endOffset -= startPos.offset;
      }
      first = right;
    }
    if (endOffset < last.value.length) this.splitText(last, endOffset);

    const texts = this.textNodesBetween(first, last);
    if (texts.length === 0) return [];

    if (snapToBlock) {
      const blockOf = (t: Text) => this.ancestors(t).find((a) => isBlockElement(a) || isProtected(a)) ?? t;
      const run = this.runBetween(blockOf(texts[0]), blockOf(texts[texts.length - 1]), false);
      return run ? [run] : [];
    }

    // Group the text nodes by the block (or JSON field) they sit in, then isolate each group.
    const groups: { box: Container; texts: Text[] }[] = [];
    for (const t of texts) {
      const box = this.ancestors(t).find((a) => a.type === 'root' || isBlockElement(a) || isProtected(a))!;
      const g = groups[groups.length - 1];
      if (g && g.box === box) g.texts.push(t);
      else groups.push({ box, texts: [t] });
    }
    const runs: Run[] = [];
    for (const g of groups) {
      const run = this.isolateInline(g.texts[0], g.texts[g.texts.length - 1]);
      if (run) runs.push(run);
    }
    return runs;
  }

  /** Split inline ancestors so that `first`..`last` become whole siblings of their common parent. */
  private isolateInline(first: Text, last: Text): Run | undefined {
    const run = this.runBetween(first, last, true);
    if (!run) return undefined;
    const common = run.parent;
    // Lift `first`: split every ancestor below the common parent so it starts the ancestor's children.
    let a: Nodes = first;
    for (let p = this.parentOf(a)!; p !== common; p = this.parentOf(a)!) {
      const i = this.indexIn(p, a);
      a = i > 0 ? this.splitElement(p as Element, i) : p;
    }
    // Lift `last`: split so it ends the ancestor's children.
    let b: Nodes = last;
    for (let p = this.parentOf(b)!; p !== common; p = this.parentOf(b)!) {
      const i = this.indexIn(p, b);
      if (i < p.children.length - 1) this.splitElement(p as Element, i + 1);
      b = p;
    }
    const start = this.indexIn(common, a);
    const end = this.indexIn(common, b) + 1;
    return start >= 0 && end > start ? { parent: common, start, end, fromText: true } : undefined;
  }

  /** Text nodes in document order from `first` to `last` (inclusive). */
  private textNodesBetween(first: Text, last: Text): Text[] {
    const all: Text[] = [];
    const walk = (n: Nodes) => {
      if (n.type === 'text') all.push(n);
      else if ('children' in n) n.children.forEach(walk);
    };
    walk(this.tree);
    const i = all.indexOf(first);
    const j = all.indexOf(last);
    return i >= 0 && j >= i ? all.slice(i, j + 1).filter((t) => t.value !== '') : [];
  }
}
