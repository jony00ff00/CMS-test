// A separate browser window for the preview. It is an about:blank window of the editor's own origin, so the
// editor renders into it with a React portal; the page itself is still a sandboxed iframe inside it.

export interface PreviewWindow {
  win: Window;
  /** Where the portal renders. */
  container: HTMLElement;
}

const NAME = 'node-cms-preview';

/** Open (or reuse) the preview window. Undefined when the browser blocked it. */
export function openPreviewWindow(): PreviewWindow | undefined {
  const win = window.open('', NAME, 'popup,width=960,height=760');
  if (!win) return undefined;
  const doc = win.document;
  doc.title = 'Preview · Node CMS';
  // Reusing a window: start from a clean page.
  doc.head.querySelectorAll('[data-cms-copied]').forEach((n) => n.remove());
  doc.body.replaceChildren();
  // The editor's styles, so the window looks the same.
  for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    const copy = node.cloneNode(true) as HTMLElement;
    if (copy instanceof HTMLLinkElement) copy.href = (node as HTMLLinkElement).href; // absolute URL
    copy.setAttribute('data-cms-copied', '');
    doc.head.appendChild(copy);
  }
  if (!doc.querySelector('meta[name="viewport"]')) {
    const meta = doc.createElement('meta');
    meta.name = 'viewport';
    meta.content = 'width=device-width, initial-scale=1';
    doc.head.appendChild(meta);
  }
  doc.body.className = 'preview-window';
  const container = doc.createElement('div');
  container.className = 'preview-window-root';
  doc.body.appendChild(container);
  win.focus();
  return { win, container };
}
