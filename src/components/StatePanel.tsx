import { describeLock } from '../domain/describe';
import type { RigState } from '../domain/types';

interface StatePanelProps {
  state: RigState;
  label: string;
}

/** 吊杆设备状态面板：载荷 / 位置 / 锁定 */
export function StatePanel({ state, label }: StatePanelProps) {
  return (
    <section data-testid="state-panel" className="panel state-panel" aria-label="吊杆状态">
      <h2>{label}</h2>
      <div className="chips">
        <div className="chip">
          <span className="chip-label">载荷</span>
          <strong data-testid="state-load">{state.loadKg === null ? '空载' : `${state.loadKg} 千克`}</strong>
        </div>
        <div className="chip">
          <span className="chip-label">位置</span>
          <strong data-testid="state-position">{state.position === 'home' ? '归位' : '舞台位'}</strong>
        </div>
        <div className="chip">
          <span className="chip-label">锁定</span>
          <strong data-testid="state-lock">{describeLock(state)}</strong>
        </div>
      </div>
    </section>
  );
}
