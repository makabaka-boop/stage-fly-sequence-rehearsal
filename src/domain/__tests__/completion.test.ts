import { describe, expect, it } from 'vitest';
import { planCompletion } from '../completion';
import { adjudicate, INITIAL_STATE } from '../machine';
import type { ActionCard, CardType, RigState } from '../types';

let seq = 0;
const card = (type: CardType, weightKg?: number): ActionCard => ({
  id: `c-${seq++}`,
  type,
  ...(type === 'load' ? { weightKg } : {}),
});

/** 把卡型后缀落成带标识的动作卡 */
const realize = (types: CardType[]): ActionCard[] => types.map((t) => card(t));

/** 标准闭环：装载 → 锁定 → 移动 → 归位 → 解锁 → 卸载 */
const fullCycle = (weightKg = 100): ActionCard[] => [
  card('load', weightKg),
  card('lock'),
  card('move'),
  card('return'),
  card('unlock'),
  card('unload'),
];

/** 用前缀序列推演到半途终态，再规划收尾后缀 */
const planAfter = (prefix: ActionCard[]): CardType[] =>
  planCompletion(adjudicate(prefix).finalState);

describe('最短安全收尾', () => {
  it('载重未锁定（仅装载）：补齐「锁定→解锁」过程后卸载', () => {
    const prefix = [card('load', 100)];
    const finalState = adjudicate(prefix).finalState;
    expect(finalState).toEqual({
      loadKg: 100,
      position: 'home',
      locked: false,
      unlockedSinceLoad: false,
    });

    const suffix = planCompletion(finalState);
    expect(suffix).toEqual(['lock', 'unlock', 'unload']);

    // 追加后缀后整套序列闭合，回到空载归位
    const completed = [...prefix, ...realize(suffix)];
    const v = adjudicate(completed);
    expect(v.firstErrorIndex).toBeNull();
    expect(v.closed).toBe(true);
    expect(v.finalState).toEqual(INITIAL_STATE);

    // 最短性：少任何一张都不闭合
    expect(adjudicate(completed.slice(0, -1)).closed).toBe(false);
    expect(adjudicate([...prefix, ...realize(['lock', 'unload'])]).closed).toBe(false);
  });

  it('舞台位锁定（装载→锁定→移动）：先归位，再解锁，最后卸载', () => {
    const prefix = [card('load', 80), card('lock'), card('move')];
    const finalState = adjudicate(prefix).finalState;
    expect(finalState).toEqual({
      loadKg: 80,
      position: 'stage',
      locked: true,
      unlockedSinceLoad: false,
    });

    const suffix = planCompletion(finalState);
    expect(suffix).toEqual(['return', 'unlock', 'unload']);

    const completed = [...prefix, ...realize(suffix)];
    const v = adjudicate(completed);
    expect(v.firstErrorIndex).toBeNull();
    expect(v.closed).toBe(true);
    expect(v.finalState).toEqual(INITIAL_STATE);

    // 最短性：去掉末张（卸载）或首张（归位）都不闭合
    expect(adjudicate(completed.slice(0, -1)).closed).toBe(false);
    expect(adjudicate([...prefix, ...realize(['unlock', 'unload'])]).closed).toBe(false);
  });

  it('归位且仍锁定（装载→锁定）：解锁后卸载', () => {
    expect(planAfter([card('load', 50), card('lock')])).toEqual(['unlock', 'unload']);
  });

  it('已完成「锁定→解锁」的载重态：只需卸载', () => {
    expect(planAfter([card('load', 50), card('lock'), card('unlock')])).toEqual(['unload']);
  });

  it('归位途中（装载→锁定→移动→归位）：解锁后卸载', () => {
    expect(planAfter([card('load', 50), card('lock'), card('move'), card('return')])).toEqual([
      'unlock',
      'unload',
    ]);
  });

  it('已闭合（空载归位）不产生新卡', () => {
    expect(planCompletion(INITIAL_STATE)).toEqual([]);
    const closed = adjudicate(fullCycle());
    expect(closed.closed).toBe(true);
    expect(planCompletion(closed.finalState)).toEqual([]);
  });

  it('确定性：同一终态重复规划结果一致，且不修改传入状态', () => {
    const state: RigState = {
      loadKg: 80,
      position: 'stage',
      locked: true,
      unlockedSinceLoad: false,
    };
    const snapshot = { ...state };
    const a = planCompletion(state);
    const b = planCompletion(state);
    expect(a).toEqual(b);
    expect(state).toEqual(snapshot);
  });

  it('对任意合法半途前缀，追加规划后缀后必然闭合', () => {
    // 标准闭环的每个真前缀都是「全部合法但停在中途」的序列
    const cycle = fullCycle(120);
    for (let n = 1; n < cycle.length; n += 1) {
      const prefix = cycle.slice(0, n);
      const suffix = planCompletion(adjudicate(prefix).finalState);
      const v = adjudicate([...prefix, ...realize(suffix)]);
      expect(v.firstErrorIndex).toBeNull();
      expect(v.closed).toBe(true);
    }
  });
});
