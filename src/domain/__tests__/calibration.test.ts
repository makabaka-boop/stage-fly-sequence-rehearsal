import { describe, expect, it } from 'vitest';
import { planCalibration } from '../calibration';
import { adjudicate, MAX_WEIGHT_KG, MIN_WEIGHT_KG } from '../machine';
import type { ActionCard, CardType } from '../types';

let seq = 0;
const card = (type: CardType, weightKg?: number): ActionCard => ({
  id: `c-${seq++}`,
  type,
  ...(type === 'load' ? { weightKg } : {}),
});

/** 标准闭环：装载 → 锁定 → 移动 → 归位 → 解锁 → 卸载 */
const fullCycle = (weightKg = 100): ActionCard[] => [
  card('load', weightKg),
  card('lock'),
  card('move'),
  card('return'),
  card('unlock'),
  card('unload'),
];

const loadWeights = (cards: readonly ActionCard[]): Array<number | undefined> =>
  cards.filter((c) => c.type === 'load').map((c) => c.weightKg);

describe('载重校准', () => {
  it('多次装载统一增减：只改重量，保留卡片标识、类型与顺序', () => {
    const original = [...fullCycle(100), ...fullCycle(200)];
    const idsBefore = original.map((c) => c.id);

    const result = planCalibration(original, 50);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.adjustedCount).toBe(2);
    expect(loadWeights(result.cards)).toEqual([150, 250]);
    // 标识与顺序不变：逐卡 id 与类型完全一致
    expect(result.cards.map((c) => c.id)).toEqual(idsBefore);
    expect(result.cards.map((c) => c.type)).toEqual(original.map((c) => c.type));
    // 非装载卡保持原引用，装载卡仅重量字段变化
    result.cards.forEach((c, i) => {
      if (c.type === 'load') {
        expect(c).not.toBe(original[i]);
        expect(c.id).toBe(original[i].id);
      } else {
        expect(c).toBe(original[i]);
      }
    });
    // 入参不被修改
    expect(loadWeights(original)).toEqual([100, 200]);

    // 校准后的序列交给现有裁决链：仍然闭合
    const v = adjudicate(result.cards);
    expect(v.firstErrorIndex).toBeNull();
    expect(v.closed).toBe(true);
  });

  it('支持负差额统一减少，且可重复校准', () => {
    const original = [...fullCycle(150), ...fullCycle(250)];
    const first = planCalibration(original, -100);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(loadWeights(first.cards)).toEqual([50, 150]);

    const second = planCalibration(first.cards, 49);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(loadWeights(second.cards)).toEqual([99, 199]);
    expect(second.cards.map((c) => c.id)).toEqual(original.map((c) => c.id));
  });

  it('单卡越界导致全批回滚：指出首张受影响卡及计算后重量', () => {
    // 两段闭环：第二段装载 480 千克，+50 后计算为 530，越出 500 上限
    const original = [...fullCycle(100), ...fullCycle(480)];
    const snapshot = original.map((c) => ({ ...c }));

    const result = planCalibration(original, 50);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('out-of-range');
    if (result.kind !== 'out-of-range') return;
    // 首张受影响卡是第二段闭环的装载卡（下标 6，即第 7 张）
    expect(result.index).toBe(6);
    expect(original[result.index].type).toBe('load');
    expect(result.computedWeightKg).toBe(530);

    // 整批拒绝：入参序列原封不动（第一张本可校准的 100→150 也不生效）
    expect(original).toEqual(snapshot);
  });

  it('向下越界同样整批拒绝，并给出计算后重量', () => {
    const original = [card('load', 10), card('lock')];
    const result = planCalibration(original, -20);
    expect(result).toEqual({ ok: false, kind: 'out-of-range', index: 0, computedWeightKg: -10 });
  });

  it('多张越界时只指出首张受影响卡', () => {
    const original = [card('load', 490), card('unload'), card('load', 495)];
    const result = planCalibration(original, 20);
    expect(result).toEqual({ ok: false, kind: 'out-of-range', index: 0, computedWeightKg: 510 });
  });

  it('边界值：校准结果恰好为 1 与 500 千克时整批通过', () => {
    const original = [card('load', 2), card('lock'), card('load', 499)];
    const up = planCalibration(original, 1);
    expect(up.ok).toBe(true);
    if (up.ok) expect(loadWeights(up.cards)).toEqual([3, MAX_WEIGHT_KG]);

    const down = planCalibration(original, -1);
    expect(down.ok).toBe(true);
    if (down.ok) expect(loadWeights(down.cards)).toEqual([MIN_WEIGHT_KG, 498]);
  });

  it('计算结果越出边界一千克即拒绝（0 与 501）', () => {
    expect(planCalibration([card('load', 1)], -1)).toEqual({
      ok: false,
      kind: 'out-of-range',
      index: 0,
      computedWeightKg: 0,
    });
    expect(planCalibration([card('load', 500)], 1)).toEqual({
      ok: false,
      kind: 'out-of-range',
      index: 0,
      computedWeightKg: 501,
    });
  });

  it('没有装载卡时保持不变：空序列与纯动作序列都不产生候选卡组', () => {
    expect(planCalibration([], 50)).toEqual({ ok: false, kind: 'no-load-cards' });
    const noLoads = [card('lock'), card('move'), card('unlock')];
    expect(planCalibration(noLoads, 50)).toEqual({ ok: false, kind: 'no-load-cards' });
  });

  it('差额不是整数千克时拒绝', () => {
    const original = [card('load', 100)];
    expect(planCalibration(original, 12.5)).toEqual({ ok: false, kind: 'invalid-delta' });
    expect(planCalibration(original, Number.NaN)).toEqual({ ok: false, kind: 'invalid-delta' });
    expect(planCalibration(original, Number.POSITIVE_INFINITY)).toEqual({
      ok: false,
      kind: 'invalid-delta',
    });
  });

  it('装载卡未填写重量时无法校准，指出该卡位置', () => {
    const original = [card('load', 100), card('lock'), card('load')];
    const result = planCalibration(original, 50);
    expect(result).toEqual({ ok: false, kind: 'missing-weight', index: 2 });
    expect(loadWeights(original)).toEqual([100, undefined]);
  });

  it('原有重量非整数时计算结果同样非整数，按越界拒绝整批', () => {
    const original = [card('load', 100.5)];
    const result = planCalibration(original, 10);
    expect(result).toEqual({ ok: false, kind: 'out-of-range', index: 0, computedWeightKg: 110.5 });
  });

  it('零差额合法：重量不变，仍按整批通过处理', () => {
    const original = fullCycle(100);
    const result = planCalibration(original, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.adjustedCount).toBe(1);
    expect(loadWeights(result.cards)).toEqual([100]);
    expect(result.cards.map((c) => c.id)).toEqual(original.map((c) => c.id));
  });

  it('纯函数：同一输入重复规划结果一致，且不修改传入序列', () => {
    const original = [...fullCycle(100), ...fullCycle(200)];
    const snapshot = original.map((c) => ({ ...c }));
    const a = planCalibration(original, 30);
    const b = planCalibration(original, 30);
    expect(a).toEqual(b);
    expect(original).toEqual(snapshot);
  });
});
