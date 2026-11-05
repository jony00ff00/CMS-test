import { useEffect } from 'react';
import { editorStore, useEditor } from '../store/editor-store';

export function NoticeToast() {
  const notice = useEditor((s) => s.notice);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => editorStore.getState().dismissNotice(), 5000);
    return () => clearTimeout(t);
  }, [notice]);
  if (!notice) return null;
  return (
    <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
      <span>{notice.text}</span>
      <button type="button" aria-label="Dismiss" onClick={() => editorStore.getState().dismissNotice()}>
        ✕
      </button>
    </div>
  );
}
