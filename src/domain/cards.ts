import type { CardType } from './types';

export interface CardDef {
  type: CardType;
  name: string;
  hint: string;
}

export const CARD_DEFS: Record<CardType, CardDef> = {
  load: { type: 'load', name: '装载', hint: '仅空载可装载，重量须为 1–500 千克整数' },
  lock: { type: 'lock', name: '锁定', hint: '装载后才能锁定' },
  move: { type: 'move', name: '移动', hint: '锁定后可移动到舞台位' },
  return: { type: 'return', name: '归位', hint: '舞台位只能归位' },
  unlock: { type: 'unlock', name: '解锁', hint: '归位且仍锁定时才可解锁' },
  unload: { type: 'unload', name: '卸载', hint: '解锁后才能卸载，回到空载归位' },
};

/** 牌库展示顺序，也是标准闭环的动作顺序 */
export const CARD_ORDER: CardType[] = ['load', 'lock', 'move', 'return', 'unlock', 'unload'];
