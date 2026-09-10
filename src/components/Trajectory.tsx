import { CARD_DEFS } from '../domain/cards';
import { describeState } from '../domain/describe';
import type { StepRecord } from '../domain/types';

/** 推演轨迹：逐卡记录执行结果，首错前的轨迹保留，首错后的卡标记跳过 */
export function Trajectory({ steps }: { steps: StepRecord[] }) {
  if (steps.length === 0) return null;

  return (
    <section className="panel trajectory-panel" aria-label="推演轨迹">
      <h2>推演轨迹</h2>
      <ol data-testid="trajectory" className="trajectory">
        {steps.map((step) => {
          const def = CARD_DEFS[step.card.type];
          const weight =
            step.card.type === 'load' ? `（${step.card.weightKg ?? '未填写'} 千克）` : '';
          return (
            <li
              key={step.card.id}
              data-testid="trajectory-step"
              data-status={step.status}
              className={`step step-${step.status}`}
            >
              <span className="step-head">
                #{step.index + 1} {def.name}
                {weight}
              </span>
              {step.status === 'ok' && <span className="step-detail">✓ → {describeState(step.after)}</span>}
              {step.status === 'error' && <span className="step-detail reason">✗ {step.reason}</span>}
              {step.status === 'skipped' && <span className="step-detail">⊘ 首错后停止裁决，未执行</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
