import { MAX_WEIGHT_KG, MIN_WEIGHT_KG } from './machine';
import type { ActionCard } from './types';

/**
 * 载重校准结果。
 * - ok：整批通过，cards 为候选卡组（只改装载重量，保留卡片标识与顺序），
 *   adjustedCount 为实际调整的装载卡张数，由调用方原子替换并交裁决链复算；
 * - invalid-delta：差额不是整数千克；
 * - no-load-cards：当前序列没有装载卡；
 * - missing-weight：首张未填写重量的装载卡下标（无法计算校准结果）；
 * - out-of-range：首张校准后越出 1–500 千克边界的装载卡下标与计算后重量。
 * 后三种失败都拒绝整批：调用方保持原序列与原结论不变。
 */
export type CalibrationResult =
  | { ok: true; cards: ActionCard[]; adjustedCount: number }
  | { ok: false; kind: 'invalid-delta' }
  | { ok: false; kind: 'no-load-cards' }
  | { ok: false; kind: 'missing-weight'; index: number }
  | { ok: false; kind: 'out-of-range'; index: number; computedWeightKg: number };

/**
 * 载重校准：对序列中所有装载卡统一增减整数千克差额。
 *
 * 基于当前序列生成完整候选卡组：只改写装载卡的 weightKg，卡片 id、
 * 类型与先后顺序全部保留（非装载卡保持原引用）。边界复用装载重量的
 * 1–500 千克整数契约：任一装载卡的计算结果越界（或未填写重量）即
 * 拒绝整批，返回首张受影响卡的位置与计算后重量；全部通过才返回
 * 候选卡组。纯函数，不修改入参。
 */
export function planCalibration(
  cards: readonly ActionCard[],
  deltaKg: number,
): CalibrationResult {
  if (!Number.isInteger(deltaKg)) {
    return { ok: false, kind: 'invalid-delta' };
  }

  let adjustedCount = 0;
  const next: ActionCard[] = new Array(cards.length);

  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index];
    if (card.type !== 'load') {
      next[index] = card;
      continue;
    }
    if (card.weightKg === undefined) {
      return { ok: false, kind: 'missing-weight', index };
    }
    const computedWeightKg = card.weightKg + deltaKg;
    if (
      !Number.isInteger(computedWeightKg) ||
      computedWeightKg < MIN_WEIGHT_KG ||
      computedWeightKg > MAX_WEIGHT_KG
    ) {
      return { ok: false, kind: 'out-of-range', index, computedWeightKg };
    }
    next[index] = { ...card, weightKg: computedWeightKg };
    adjustedCount += 1;
  }

  if (adjustedCount === 0) {
    return { ok: false, kind: 'no-load-cards' };
  }
  return { ok: true, cards: next, adjustedCount };
}
