import { useEffect, useRef } from 'react';

interface HistoryControlsProps {
  /** 过去记录非空：存在可撤销的编辑 */
  canUndo: boolean;
  /** 未来记录非空：存在可重做的撤销 */
  canRedo: boolean;
  /** 不可用时的就地说明（短暂状态） */
  feedback: string | null;
  /** 走台进行中置位：两个入口随编辑区一起锁定 */
  disabled?: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onFeedbackDone: () => void;
}

const FEEDBACK_TTL_MS = 4000;

/**
 * 序列区的撤销/重做入口：仅限本次页面会话。
 * 走台进行中随编辑区锁定；无记录可撤销/重做时点击不改序列，只给就地说明。
 */
export function HistoryControls({
  canUndo,
  canRedo,
  feedback,
  disabled = false,
  onUndo,
  onRedo,
  onFeedbackDone,
}: HistoryControlsProps) {
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
    <div className="history-controls" data-testid="history-controls">
      <button
        type="button"
        data-testid="undo-edit"
        title="撤销最近一次成功编辑，回到编辑前的整套序列"
        disabled={disabled}
        data-empty={!canUndo || undefined}
        onClick={onUndo}
      >
        ↩ 撤销
      </button>
      <button
        type="button"
        data-testid="redo-edit"
        title="重做最近一次撤销掉的编辑"
        disabled={disabled}
        data-empty={!canRedo || undefined}
        onClick={onRedo}
      >
        ↪ 重做
      </button>
      {feedback && (
        <p className="history-feedback feedback-closed" data-testid="history-feedback" role="status">
          {feedback}
        </p>
      )}
    </div>
  );
}
