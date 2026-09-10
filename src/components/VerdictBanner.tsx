import { CARD_DEFS } from '../domain/cards';
import { describeState } from '../domain/describe';
import type { Verdict } from '../domain/types';

interface VerdictBannerProps {
  verdict: Verdict;
  cardCount: number;
}

/** 裁决结论横幅：空序列 / 首错定位 / 闭合 / 合法但未闭合 */
export function VerdictBanner({ verdict, cardCount }: VerdictBannerProps) {
  if (cardCount === 0) {
    return (
      <div data-testid="verdict-banner" className="verdict verdict-empty">
        尚未加入口令卡：从牌库添加，或点击「生成标准闭环」。
      </div>
    );
  }

  if (verdict.firstErrorIndex !== null) {
    const step = verdict.steps[verdict.firstErrorIndex];
    const name = CARD_DEFS[step.card.type].name;
    const rest = cardCount - verdict.firstErrorIndex - 1;
    return (
      <div data-testid="verdict-banner" className="verdict verdict-error" role="alert">
        <strong>
          首错：第 {verdict.firstErrorIndex + 1} 张「{name}」
        </strong>
        <span>{step.reason}</span>
        <span>当时吊杆状态：{describeState(step.before)}</span>
        <span>裁决已停止{rest > 0 ? `，后续 ${rest} 张卡不再生效` : ''}。</span>
      </div>
    );
  }

  if (verdict.closed) {
    return (
      <div data-testid="verdict-banner" className="verdict verdict-ok">
        ✔ 整套口令闭合：已回到空载归位。
      </div>
    );
  }

  return (
    <div data-testid="verdict-banner" className="verdict verdict-warn">
      推演通过，但未闭合：吊杆停在「{describeState(verdict.finalState)}」，尚未回到空载归位。
    </div>
  );
}
