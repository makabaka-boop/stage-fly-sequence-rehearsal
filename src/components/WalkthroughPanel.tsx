import { CARD_DEFS } from '../domain/cards';
import { describeState } from '../domain/describe';
import { isInitialState } from '../domain/machine';
import { remainingCount, type WalkSession } from '../domain/session';

interface WalkthroughPanelProps {
  session: WalkSession;
  /** 空序列点击「开始走台」时的可理解反馈 */
  feedback: string | null;
  onStart: () => void;
  onExecuteNext: () => void;
}

/** 装载卡口令带上重量，其余口令只报名称 */
function commandText(card: WalkSession['snapshot'][number]): string {
  const name = CARD_DEFS[card.type].name;
  return card.type === 'load' ? `${name}（${card.weightKg ?? '未填写'} 千克）` : name;
}

/**
 * 独立走台面板：逐张报令的执行视图。
 * 操作者只看到当前应执行的口令、执行后的吊杆状态与剩余张数，
 * 而不是一次读完整条轨迹。
 */
export function WalkthroughPanel({ session, feedback, onStart, onExecuteNext }: WalkthroughPanelProps) {
  const { status, snapshot, cursor, state, blocked } = session;
  const total = snapshot.length;
  const remaining = remainingCount(session);

  return (
    <section className="panel walkthrough-panel" data-testid="walkthrough-panel" aria-label="走台会话">
      <h2>走台会话</h2>

      {status === 'idle' && (
        <div className="walkthrough-body">
          <p className="walkthrough-hint">
            整理好口令序列后点击「开始走台」，系统复制当时的卡序与重量作为会话快照，随后逐张报令执行。
          </p>
          <button type="button" data-testid="start-walkthrough" onClick={onStart}>
            开始走台
          </button>
          {feedback && (
            <p className="walkthrough-feedback" data-testid="walkthrough-feedback" role="alert">
              {feedback}
            </p>
          )}
        </div>
      )}

      {status === 'running' && (
        <div className="walkthrough-body">
          <p className="walkthrough-progress" data-testid="walkthrough-progress">
            已执行 {cursor} / 共 {total} 张 · 剩余 {remaining} 张
          </p>
          <div className="walkthrough-current" data-testid="walkthrough-current">
            <span className="walkthrough-current-label">当前口令</span>
            <strong>
              #{cursor + 1} {commandText(snapshot[cursor])}
            </strong>
          </div>
          <p className="walkthrough-state" data-testid="walkthrough-state">
            当前吊杆状态：{describeState(state)}
          </p>
          <button type="button" data-testid="execute-next" onClick={onExecuteNext}>
            执行下一张
          </button>
        </div>
      )}

      {status === 'completed' && (
        <div className="walkthrough-body">
          <p className="walkthrough-result walkthrough-completed" data-testid="walkthrough-result">
            ✔ 走台完成：{total} 张口令全部执行。
          </p>
          <p className="walkthrough-state" data-testid="walkthrough-state">
            {isInitialState(state)
              ? '吊杆已回到空载归位。'
              : `吊杆停在「${describeState(state)}」，未回到空载归位。`}
          </p>
          <div className="walkthrough-actions">
            <button type="button" data-testid="execute-next" onClick={onExecuteNext}>
              执行下一张
            </button>
            <button type="button" data-testid="start-walkthrough" onClick={onStart}>
              开始走台
            </button>
          </div>
        </div>
      )}

      {status === 'blocked' && blocked && (
        <div className="walkthrough-body">
          <p className="walkthrough-result walkthrough-blocked" data-testid="walkthrough-result" role="alert">
            ✗ 走台受阻：第 {blocked.index + 1} 张「{CARD_DEFS[blocked.card.type].name}」
          </p>
          <p className="walkthrough-reason" data-testid="walkthrough-reason">
            {blocked.reason}
          </p>
          <p className="walkthrough-state" data-testid="walkthrough-state">
            停在执行前状态：{describeState(state)}
          </p>
          <p className="walkthrough-progress" data-testid="walkthrough-progress">
            已执行 {cursor} / 共 {total} 张 · 剩余 {remaining} 张未执行
          </p>
          <div className="walkthrough-actions">
            <button type="button" data-testid="execute-next" onClick={onExecuteNext}>
              执行下一张
            </button>
            <button type="button" data-testid="start-walkthrough" onClick={onStart}>
              开始走台
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
