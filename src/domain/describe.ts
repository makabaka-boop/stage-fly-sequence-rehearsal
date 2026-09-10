import type { RigState } from './types';

/** 锁定维度描述：已锁定 / 未锁定（装载后待锁定）/ 已解锁（完成过锁定→解锁） */
export function describeLock(s: RigState): string {
  if (s.locked) return '已锁定';
  if (s.loadKg !== null && s.unlockedSinceLoad) return '已解锁';
  return '未锁定';
}

/** 把设备状态压缩成一行中文描述，如「载重 100 千克 · 归位 · 未锁定」 */
export function describeState(s: RigState): string {
  const load = s.loadKg === null ? '空载' : `载重 ${s.loadKg} 千克`;
  const pos = s.position === 'home' ? '归位' : '舞台位';
  return `${load} · ${pos} · ${describeLock(s)}`;
}
