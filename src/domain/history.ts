import type { ActionCard } from './types';

/** 过去与未来记录各自最多保留的步数 */
export const HISTORY_LIMIT = 20;

/**
 * 编辑履历：仅限本次页面会话的撤销/重做记录。
 * 载荷为完整 ActionCard 序列（编辑事务提交前的整组卡组），
 * 不写入任何浏览器存储，刷新即为空。
 */
export interface EditHistory {
  /** 过去记录：末尾为最近一次成功编辑前的序列，最多 HISTORY_LIMIT 步 */
  past: ActionCard[][];
  /** 未来记录：开头为最近一次撤销掉的序列（重做时先取它），最多 HISTORY_LIMIT 步 */
  future: ActionCard[][];
}

/** 空履历：无过去、无未来 */
export function emptyHistory(): EditHistory {
  return { past: [], future: [] };
}

export const canUndo = (history: EditHistory): boolean => history.past.length > 0;
export const canRedo = (history: EditHistory): boolean => history.future.length > 0;

/** 两组卡组逐卡等值（标识、类型、重量全同）即视为无变化 */
const sameCards = (a: readonly ActionCard[], b: readonly ActionCard[]): boolean =>
  a.length === b.length &&
  a.every(
    (card, i) =>
      card.id === b[i].id && card.type === b[i].type && card.weightKg === b[i].weightKg,
  );

const pushPast = (past: ActionCard[][], cards: ActionCard[]): ActionCard[][] => {
  const next = [...past, cards];
  // 二十步淘汰：超出上限时丢弃最旧的一步
  if (next.length > HISTORY_LIMIT) next.shift();
  return next;
};

/**
 * 提交一次成功编辑：prev 为编辑前序列，next 为编辑后序列。
 * 纯函数，不修改入参。
 * - prev 入过去记录末尾，超出二十步淘汰最旧记录；
 * - 任何新编辑都清空重做分支；
 * - 无变化（同一引用或逐卡等值）不生成记录，原样返回同一引用。
 */
export function commitEdit(
  history: EditHistory,
  prev: ActionCard[],
  next: ActionCard[],
): EditHistory {
  if (prev === next || sameCards(prev, next)) return history;
  return { past: pushPast(history.past, prev), future: [] };
}

/**
 * 撤销：回到最近一次编辑前的序列。
 * current 为当前屏幕序列，转入未来记录开头供重做；
 * 过去记录为空时返回 null（调用方保持序列不变并就地说明）。
 */
export function undoEdit(
  history: EditHistory,
  current: ActionCard[],
): { history: EditHistory; cards: ActionCard[] } | null {
  if (history.past.length === 0) return null;
  const cards = history.past[history.past.length - 1];
  const past = history.past.slice(0, -1);
  const future = [current, ...history.future].slice(0, HISTORY_LIMIT);
  return { history: { past, future }, cards };
}

/**
 * 重做：恢复最近一次撤销掉的序列。
 * current 为当前屏幕序列，转回过去记录；
 * 未来记录为空时返回 null（调用方保持序列不变并就地说明）。
 */
export function redoEdit(
  history: EditHistory,
  current: ActionCard[],
): { history: EditHistory; cards: ActionCard[] } | null {
  if (history.future.length === 0) return null;
  const cards = history.future[0];
  const future = history.future.slice(1);
  return { history: { past: pushPast(history.past, current), future }, cards };
}
