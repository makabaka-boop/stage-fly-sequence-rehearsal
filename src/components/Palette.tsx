import { useEffect, useRef, useState } from 'react';
import { CARD_DEFS, CARD_ORDER } from '../domain/cards';
import type { CardType } from '../domain/types';

/** 补全收尾反馈：已追加 / 无需补全（已闭合或空序列）/ 存在首错需先修正，均为短暂状态 */
export type CompletionFeedback =
  | { kind: 'appended'; text: string }
  | { kind: 'closed'; text: string }
  | { kind: 'error'; text: string };

/** 载重校准反馈：已应用 / 无装载卡 / 整批拒绝（差额非法或结果越界），均为短暂状态 */
export type CalibrationFeedback =
  | { kind: 'applied'; text: string }
  | { kind: 'no-load'; text: string }
  | { kind: 'error'; text: string };

interface PaletteProps {
  onAdd: (type: CardType, weightKg?: number) => void;
  onAddCycle: (weightKg?: number) => void;
  onClear: () => void;
  /** 补全收尾：按当前裁决终态一次性追加最短安全收尾 */
  onComplete: () => void;
  completionFeedback: CompletionFeedback | null;
  onCompletionFeedbackDone: () => void;
  /** 载重校准：对当前序列所有装载卡统一增减整数千克差额 */
  onCalibrate: (deltaKg: number) => void;
  calibrationFeedback: CalibrationFeedback | null;
  onCalibrationFeedbackDone: () => void;
  hasCards: boolean;
  /** 走台进行中置位：牌库整体锁定，不可添加、清空、补全收尾或载重校准 */
  disabled?: boolean;
}

const FEEDBACK_TTL_MS = 4000;

const COMPLETION_FEEDBACK_LABEL: Record<CompletionFeedback['kind'], string> = {
  appended: '补全完成',
  closed: '无需补全',
  error: '无法补全',
};

const CALIBRATION_FEEDBACK_LABEL: Record<CalibrationFeedback['kind'], string> = {
  applied: '校准完成',
  'no-load': '无需校准',
  error: '无法校准',
};

/** 左侧牌库：添加单卡、生成标准闭环、补全收尾、载重校准、清空 */
export function Palette({
  onAdd,
  onAddCycle,
  onClear,
  onComplete,
  completionFeedback,
  onCompletionFeedbackDone,
  onCalibrate,
  calibrationFeedback,
  onCalibrationFeedbackDone,
  hasCards,
  disabled = false,
}: PaletteProps) {
  const [weightText, setWeightText] = useState('100');
  const parsed = Number(weightText);
  const weight = weightText.trim() === '' || !Number.isFinite(parsed) ? undefined : parsed;

  // 校准差额：空输入按非法差额处理，由领域纯函数统一拒绝
  const [deltaText, setDeltaText] = useState('50');
  const parsedDelta = Number(deltaText);
  const delta = deltaText.trim() === '' || !Number.isFinite(parsedDelta) ? Number.NaN : parsedDelta;

  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!completionFeedback) return;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(onCompletionFeedbackDone, FEEDBACK_TTL_MS);
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, [completionFeedback, onCompletionFeedbackDone]);

  const calibrationTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!calibrationFeedback) return;
    if (calibrationTimer.current !== null) window.clearTimeout(calibrationTimer.current);
    calibrationTimer.current = window.setTimeout(onCalibrationFeedbackDone, FEEDBACK_TTL_MS);
    return () => {
      if (calibrationTimer.current !== null) window.clearTimeout(calibrationTimer.current);
    };
  }, [calibrationFeedback, onCalibrationFeedbackDone]);

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
      <div className="calibration">
        <label className="weight-field">
          载重校准差额（千克）
          <input
            data-testid="calibration-delta"
            type="number"
            value={deltaText}
            onChange={(e) => setDeltaText(e.target.value)}
            placeholder="整数千克，可正可负"
            disabled={disabled}
          />
        </label>
        <button
          type="button"
          data-testid="apply-calibration"
          title="对当前序列所有装载卡统一增减该差额；任一结果越出 1–500 千克即整批拒绝"
          disabled={disabled}
          onClick={() => onCalibrate(delta)}
        >
          应用载重校准
        </button>
      </div>
      {calibrationFeedback && (
        <p
          className={`calibration-feedback feedback-${calibrationFeedback.kind}`}
          data-testid="calibration-feedback"
          data-kind={calibrationFeedback.kind}
          role={calibrationFeedback.kind === 'error' ? 'alert' : 'status'}
        >
          <strong>{CALIBRATION_FEEDBACK_LABEL[calibrationFeedback.kind]}：</strong>
          {calibrationFeedback.text}
        </p>
      )}
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
