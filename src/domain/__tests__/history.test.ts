import { describe, expect, it } from 'vitest';
import {
  canRedo,
  canUndo,
  commitEdit,
  emptyHistory,
  HISTORY_LIMIT,
  redoEdit,
  undoEdit,
} from '../history';
import type { ActionCard, CardType } from '../types';

let seq = 0;
const card = (type: CardType, weightKg?: number): ActionCard => ({
  id: `h-${seq++}`,
  type,
  ...(type === 'load' ? { weightKg } : {}),
});

/** 构造 n 张卡的序列（装载 100 千克起，交替类型保证互不等值） */
const makeSeq = (n: number, tag = 0): ActionCard[] =>
  Array.from({ length: n }, (_, i) =>
    i % 2 === 0 ? card('load', 100 + tag + i) : card('lock'),
  );

describe('事务入栈', () => {
  it('成功编辑把编辑前序列压入过去记录，并清空重做分支', () => {
    const a = makeSeq(2, 0);
    const b = makeSeq(3, 10);
    const h1 = commitEdit(emptyHistory(), a, b);
    expect(h1.past).toEqual([a]);
    expect(h1.future).toEqual([]);
    expect(canUndo(h1)).toBe(true);
    expect(canRedo(h1)).toBe(false);

    const c = makeSeq(1, 20);
    const h2 = commitEdit(h1, b, c);
    expect(h2.past).toEqual([a, b]);
  });

  it('新编辑清空已有重做分支', () => {
    const a = makeSeq(1, 0);
    const b = makeSeq(2, 10);
    const h1 = commitEdit(emptyHistory(), a, b);
    const undone = undoEdit(h1, b)!;
    expect(canRedo(undone.history)).toBe(true);

    // 撤销后执行新编辑：重做分支被清空
    const c = makeSeq(3, 30);
    const h2 = commitEdit(undone.history, a, c);
    expect(h2.future).toEqual([]);
    expect(canRedo(h2)).toBe(false);
    expect(h2.past).toEqual([a]);
  });

  it('无变化的编辑不生成记录（同一引用或逐卡等值），原样返回', () => {
    const a = makeSeq(2, 0);
    const h = emptyHistory();
    expect(commitEdit(h, a, a)).toBe(h);
    // 内容等值但非同引用：同样不生成记录
    const clone = a.map((c) => ({ ...c }));
    expect(commitEdit(h, a, clone)).toBe(h);
    expect(canUndo(h)).toBe(false);
  });

  it('提交不修改传入的履历与序列', () => {
    const a = makeSeq(2, 0);
    const b = makeSeq(3, 10);
    const h = commitEdit(emptyHistory(), a, b);
    const snapshot = JSON.parse(JSON.stringify(h));
    commitEdit(h, b, makeSeq(1, 20));
    undoEdit(h, b);
    redoEdit(h, a);
    expect(h).toEqual(snapshot);
  });
});

describe('撤销与重做', () => {
  it('撤销回到编辑前序列，重做恢复编辑后序列', () => {
    const a = makeSeq(1, 0);
    const b = makeSeq(2, 10);
    const c = makeSeq(3, 20);
    let h = commitEdit(emptyHistory(), a, b);
    h = commitEdit(h, b, c);

    const u1 = undoEdit(h, c)!;
    expect(u1.cards).toBe(b);
    const u2 = undoEdit(u1.history, u1.cards)!;
    expect(u2.cards).toBe(a);
    expect(canUndo(u2.history)).toBe(false);
    expect(canRedo(u2.history)).toBe(true);

    const r1 = redoEdit(u2.history, u2.cards)!;
    expect(r1.cards).toBe(b);
    const r2 = redoEdit(r1.history, r1.cards)!;
    expect(r2.cards).toBe(c);
    expect(canRedo(r2.history)).toBe(false);
    expect(canUndo(r2.history)).toBe(true);
  });

  it('过去记录为空时撤销返回 null，未来记录为空时重做返回 null', () => {
    const current = makeSeq(2, 0);
    expect(undoEdit(emptyHistory(), current)).toBeNull();
    expect(redoEdit(emptyHistory(), current)).toBeNull();
  });

  it('连续撤销可逐步回到最初序列', () => {
    const seqs = [makeSeq(1, 0), makeSeq(2, 10), makeSeq(3, 20), makeSeq(4, 30)];
    let h = emptyHistory();
    for (let i = 0; i < seqs.length - 1; i += 1) {
      h = commitEdit(h, seqs[i], seqs[i + 1]);
    }
    let current = seqs[3];
    for (let i = seqs.length - 2; i >= 0; i -= 1) {
      const r = undoEdit(h, current)!;
      expect(r.cards).toBe(seqs[i]);
      h = r.history;
      current = r.cards;
    }
    expect(undoEdit(h, current)).toBeNull();
  });
});

describe('二十步淘汰', () => {
  it('过去记录最多保留二十步，超出时淘汰最旧记录', () => {
    const seqs: ActionCard[][] = [];
    let h = emptyHistory();
    // 连续 25 次编辑：产生 25 条过去记录，只保留最近 20 条
    for (let i = 0; i <= 25; i += 1) seqs.push(makeSeq(1, i * 10));
    for (let i = 0; i < 25; i += 1) h = commitEdit(h, seqs[i], seqs[i + 1]);

    expect(h.past).toHaveLength(HISTORY_LIMIT);
    // 最旧的 5 条（seqs[0..4]）已被淘汰，最早保留的是 seqs[5]
    expect(h.past[0]).toBe(seqs[5]);
    expect(h.past[h.past.length - 1]).toBe(seqs[24]);

    // 只能撤销二十步：最终停在 seqs[5]，再撤销返回 null
    let current = seqs[25];
    for (let i = 0; i < HISTORY_LIMIT; i += 1) {
      const r = undoEdit(h, current)!;
      h = r.history;
      current = r.cards;
    }
    expect(current).toBe(seqs[5]);
    expect(undoEdit(h, current)).toBeNull();
  });

  it('未来记录同样以二十步为上限', () => {
    const seqs: ActionCard[][] = [];
    let h = emptyHistory();
    for (let i = 0; i <= 25; i += 1) seqs.push(makeSeq(1, i * 10));
    for (let i = 0; i < 25; i += 1) h = commitEdit(h, seqs[i], seqs[i + 1]);

    // 撤销全部二十步：未来记录恰好二十条
    let current = seqs[25];
    for (let i = 0; i < HISTORY_LIMIT; i += 1) {
      const r = undoEdit(h, current)!;
      h = r.history;
      current = r.cards;
    }
    expect(h.future).toHaveLength(HISTORY_LIMIT);

    // 重做二十步后回到最新序列，未来记录清空
    for (let i = 0; i < HISTORY_LIMIT; i += 1) {
      const r = redoEdit(h, current)!;
      h = r.history;
      current = r.cards;
    }
    expect(current).toBe(seqs[25]);
    expect(h.future).toEqual([]);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });
});
