import { useEffect, useRef } from 'react';
import type { DraftMeta } from '../domain/draft';

/** 操作反馈：保存成功 / 恢复成功 / 操作失败，均为短暂状态 */
export type DraftFeedback =
  | { kind: 'saved'; text: string }
  | { kind: 'restored'; text: string }
  | { kind: 'error'; text: string };

interface DraftControlsProps {
  meta: DraftMeta | null;
  /** 存储槽位中的草稿损坏或版本不兼容时置位 */
  storageCorrupt: boolean;
  feedback: DraftFeedback | null;
  /** 走台进行中置位：草稿操作锁定，结束后恢复 */
  disabled?: boolean;
  onSave: () => void;
  onRestore: () => void;
  onFeedbackDone: () => void;
}

const FEEDBACK_TTL_MS = 4000;

const FEEDBACK_LABEL: Record<DraftFeedback['kind'], string> = {
  saved: '保存成功',
  restored: '恢复成功',
  error: '操作失败',
};

/** 把 ISO 时间格式化为本地可读时间 */
export function formatSavedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 操作区：单槽位本地排练草稿的保存 / 恢复与短暂反馈 */
export function DraftControls({
  meta,
  storageCorrupt,
  feedback,
  disabled = false,
  onSave,
  onRestore,
  onFeedbackDone,
}: DraftControlsProps) {
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!feedback) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(onFeedbackDone, FEEDBACK_TTL_MS);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [feedback, onFeedbackDone]);

  return (
    <section className="panel draft-panel" aria-label="本地排练草稿">
      <h2>本地排练草稿</h2>
      <p className="draft-hint">
        保存当前确认的整套口令到浏览器；刷新页面后仍可一键恢复并立即重新裁决。
      </p>
      <div className="draft-meta" data-testid="draft-meta">
        {meta ? (
          <>
            <span className="draft-saved">
              草稿保存于 <time data-testid="draft-saved-at">{formatSavedAt(meta.savedAt)}</time>
            </span>
            <span className="draft-count">共 {meta.cardCount} 张卡</span>
          </>
        ) : (
          <span className="draft-none" data-testid="draft-empty">
            尚无已保存草稿
          </span>
        )}
      </div>
      <div className="draft-actions">
        <button type="button" data-testid="save-draft" disabled={disabled} onClick={onSave}>
          保存草稿
        </button>
        <button type="button" data-testid="restore-draft" disabled={disabled} onClick={onRestore}>
          恢复草稿
        </button>
      </div>
      <p className="draft-corrupt" data-testid="draft-corrupt" role={storageCorrupt ? 'alert' : undefined}>
        {storageCorrupt
          ? '存储中的草稿已损坏或版本不兼容，无法恢复；屏幕上的当前序列保持不变，可重新保存草稿。'
          : ''}
      </p>
      {feedback && (
        <p
          className={`draft-feedback feedback-${feedback.kind}`}
          data-testid="draft-feedback"
          data-kind={feedback.kind}
          role={feedback.kind === 'error' ? 'alert' : 'status'}
        >
          <strong>{FEEDBACK_LABEL[feedback.kind]}：</strong>
          {feedback.text}
        </p>
      )}
    </section>
  );
}
