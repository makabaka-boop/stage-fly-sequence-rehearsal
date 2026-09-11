import { useEffect, useRef, useState } from 'react';
import { CARD_DEFS, CARD_ORDER } from '../domain/cards';
import type { CardType } from '../domain/types';

/** 补全收尾反馈：已追加 / 无需补全（已闭合或空序列）/ 存在首错需先修正，均为短暂状态 */
export type CompletionFeedback =
  | { kind: 'appended'; text: string }
  | { kind: 'closed'; text: string }
  | { kind: 'error'; text: string };

interface PaletteProps {
  onAdd: (type: CardType, weightKg?: number) => void;
  onAddCycle: (weightKg?: number) => void;
  onClear: () => void;
  /** 补全收尾：按当前裁决终态一次性追加最短安全收尾 */
  onComplete: () => void;
  completionFeedback: CompletionFeedback | null;
  onCompletionFeedbackDone: () => void;
  hasCards: boolean;
  /** 走台进行中置位：牌库整体锁定，不可添加、清空或补全收尾 */
  disabled?: boolean;
}

const FEEDBACK_TTL_MS = 4000;

const COMPLETION_FEEDBACK_LABEL: Record<CompletionFeedback['kind'], string> = {
  appended: '补全完成',
  closed: '无需补全',
  error: '无法补全',
};

/** 左侧牌库：添加单卡、生成标准闭环、补全收尾、清空 */
export function Palette({
  onAdd,
  onAddCycle,
  onClear,
  onComplete,
  completionFeedback,
  onCompletionFeedbackDone,
  hasCards,
  disabled = false,
}: PaletteProps) {
  const [weightText, setWeightText] = useState('100');
  const parsed = Number(weightText);
  const weight = weightText.trim() === '' || !Number.isFinite(parsed) ? undefined : parsed;

  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!completionFeedback) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(onCompletionFeedbackDone, FEEDBACK_TTL_MS);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [completionFeedback, onCompletionFeedbackDone]);

  return (
    <section className="panel palette" aria-label="口令卡牌库">
      <h2>牌库</h2>
      <label className="weight-field">
        装载重量（千克）
        <input
          data-testid="palette-weight"
          type="number"
          value={weightText}
          onChange={(e) => setWeightText(e.target.value)}
          placeholder="1–500 的整数"
          disabled={disabled}
        />
      </label>
      <div className="palette-buttons">
        {CARD_ORDER.map((type) => {
          const def = CARD_DEFS[type];
          return (
            <button
              key={type}
              type="button"
              data-testid={`add-${type}`}
              className="palette-btn"
              title={def.hint}
              disabled={disabled}
              onClick={() => onAdd(type, type === 'load' ? weight : undefined)}
            >
              <strong>＋ {def.name}</strong>
              <small>{def.hint}</small>
            </button>
          );
        })}
      </div>
      <div className="palette-actions">
        <button type="button" data-testid="add-cycle" disabled={disabled} onClick={() => onAddCycle(weight)}>
          生成标准闭环
        </button>
        <button
          type="button"
          data-testid="complete-ending"
          title="按当前推演状态补出回到空载归位的最短安全收尾"
          disabled={disabled}
          onClick={onComplete}
        >
          补全收尾
        </button>
        <button type="button" data-testid="clear-all" onClick={onClear} disabled={!hasCards || disabled}>
          清空
        </button>
      </div>
      {completionFeedback && (
        <p
          className={`completion-feedback feedback-${completionFeedback.kind}`}
          data-testid="completion-feedback"
          data-kind={completionFeedback.kind}
          role={completionFeedback.kind === 'error' ? 'alert' : 'status'}
        >
          <strong>{COMPLETION_FEEDBACK_LABEL[completionFeedback.kind]}：</strong>
          {completionFeedback.text}
        </p>
      )}
    </section>
  );
}
