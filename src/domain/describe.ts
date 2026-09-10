import type { RigState } from './types';

/** 把设备状态压缩成一行中文描述，如「载重 100 千克 · 归位 · 未锁定」 */
export function describeState(s: RigState): string {
  const load = s.loadKg === null ? '空载' : `载重 ${s.loadKg} 千克`;
  const pos = s.position === 'home' ? '归位' : '舞台位';
  const lock = s.locked ? '已锁定' : '未锁定';
  return `${load} · ${pos} · ${lock}`;
}
