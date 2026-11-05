import type { GraphNode, NodeResult, OutputConfig } from '../../engine';
import { editorStore, useEditor } from '../../store/editor-store';
import { CheckboxField } from './fields';

export function OutputEditor({ node }: { node: GraphNode }) {
  const config = node.config as OutputConfig;
  const result: NodeResult | undefined = useEditor((s) => s.results[node.id]);
  const update = (patch: Partial<OutputConfig>) => editorStore.getState().updateConfig<OutputConfig>(node.id, (c) => ({ ...c, ...patch }));
  const html = result?.status === 'ok' ? (result.outputs.html as string) : undefined;

  const download = () => {
    if (!html) return;
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'output.html';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <>
      <CheckboxField
        label="Complete page"
        checked={config.fullDocument ?? true}
        hint="With title, styles and snippet scripts. Off: only the body content."
        onChange={(fullDocument) => update({ fullDocument })}
      />
      <CheckboxField
        label="Put images into the HTML"
        checked={config.inlineAssets ?? true}
        hint="Images from .docx files become part of the page, so it works on its own."
        onChange={(inlineAssets) => update({ inlineAssets })}
      />
      <button type="button" onClick={download} disabled={!html}>
        Download HTML
      </button>
    </>
  );
}
