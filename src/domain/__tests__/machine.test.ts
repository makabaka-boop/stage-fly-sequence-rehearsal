import { describe, expect, it } from 'vitest';
import {
  adjudicate,
  applyCard,
  INITIAL_STATE,
  isInitialState,
  MAX_WEIGHT_KG,
  MIN_WEIGHT_KG,
} from '../machine';
import type { ActionCard, CardType, RigState } from '../types';

let seq = 0;
const card = (type: CardType, weightKg?: number): ActionCard => ({
  id: `t-${seq++}`,
  type,
  ...(type === 'load' ? { weightKg } : {}),
});

const loaded = (weightKg: number, extra?: Partial<RigState>): RigState => ({
  loadKg: weightKg,
  position: 'home',
  locked: false,
  unlockedSinceLoad: false,
  ...extra,
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

describe('初始状态', () => {
  it('为空载、归位、未锁定，且无解锁记录', () => {
    expect(INITIAL_STATE).toEqual({
      loadKg: null,
      position: 'home',
      locked: false,
      unlockedSinceLoad: false,
    });
    expect(isInitialState(INITIAL_STATE)).toBe(true);
  });
});

describe('装载', () => {
  it('空载时可装载合法重量', () => {
    const r = applyCard(INITIAL_STATE, card('load', 120));
    expect(r.ok).toBe(true);
    expect(r.state.loadKg).toBe(120);
  });

  it(`接受边界重量 ${MIN_WEIGHT_KG} 与 ${MAX_WEIGHT_KG}`, () => {
    expect(applyCard(INITIAL_STATE, card('load', MIN_WEIGHT_KG)).ok).toBe(true);
    expect(applyCard(INITIAL_STATE, card('load', MAX_WEIGHT_KG)).ok).toBe(true);
  });

  it.each([
    ['0', 0],
    ['负数', -5],
    ['超过 500', 501],
    ['非整数', 2.5],
    ['NaN', Number.NaN],
    ['未填写', undefined],
  ])('拒绝非法重量：%s', (_label, w) => {
    const r = applyCard(INITIAL_STATE, card('load', w));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('1–500 千克的整数');
    expect(r.state).toEqual(INITIAL_STATE);
  });

  it('已装载时不能重复装载', () => {
    const r = applyCard(loaded(80), card('load', 60));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('不能重复装载');
  });

  it('不修改传入的状态对象', () => {
    const before: RigState = { ...INITIAL_STATE };
    applyCard(before, card('load', 50));
    expect(before).toEqual(INITIAL_STATE);
  });
});

describe('锁定', () => {
  it('空载时不能锁定', () => {
    const r = applyCard(INITIAL_STATE, card('lock'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('空载');
  });

  it('装载后可以锁定', () => {
    const r = applyCard(loaded(80), card('lock'));
    expect(r.ok).toBe(true);
    expect(r.state.locked).toBe(true);
  });

  it('已锁定不能重复锁定', () => {
    const r = applyCard(loaded(80, { locked: true }), card('lock'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('已锁定');
  });
});

describe('移动', () => {
  it('未锁定先移动是非法的', () => {
    const r = applyCard(loaded(80), card('move'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('未锁定先移动');
  });

  it('锁定后可从归位移到舞台位', () => {
    const r = applyCard(loaded(80, { locked: true }), card('move'));
    expect(r.ok).toBe(true);
    expect(r.state.position).toBe('stage');
  });

  it('已在舞台位时不能再次移动', () => {
    const r = applyCard(loaded(80, { locked: true, position: 'stage' }), card('move'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('不在归位');
  });
});

describe('归位', () => {
  it('舞台位可以归位', () => {
    const r = applyCard(loaded(80, { locked: true, position: 'stage' }), card('return'));
    expect(r.ok).toBe(true);
    expect(r.state.position).toBe('home');
  });

  it('不在舞台位时归位是非法的', () => {
    const r = applyCard(loaded(80, { locked: true }), card('return'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('不在舞台位');
  });
});

describe('解锁', () => {
  it('未锁定时不能解锁', () => {
    const r = applyCard(loaded(80), card('unlock'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('未锁定');
  });

  it('未归位先解锁是非法的', () => {
    const r = applyCard(loaded(80, { locked: true, position: 'stage' }), card('unlock'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('未归位先解锁');
  });

  it('归位且仍锁定时可解锁，并记录本次装载已解锁', () => {
    const r = applyCard(loaded(80, { locked: true }), card('unlock'));
    expect(r.ok).toBe(true);
    expect(r.state.locked).toBe(false);
    expect(r.state.unlockedSinceLoad).toBe(true);
  });
});

describe('卸载', () => {
  it('空载时不能卸载', () => {
    const r = applyCard(INITIAL_STATE, card('unload'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('空载');
  });

  it('仍锁定时不能卸载', () => {
    const r = applyCard(loaded(80, { locked: true }), card('unload'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('先解锁');
  });

  it('装载后未经过锁定不能直接卸载（装载后只能锁定）', () => {
    const r = applyCard(loaded(80), card('unload'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('先锁定再解锁');
    expect(r.state).toEqual(loaded(80));
  });

  it('锁定并解锁后才能卸载，且回到初始状态', () => {
    const r = applyCard(loaded(80, { unlockedSinceLoad: true }), card('unload'));
    expect(r.ok).toBe(true);
    expect(isInitialState(r.state)).toBe(true);
  });
});

describe('整套裁决', () => {
  it('标准闭环全部通过并闭合回空载归位', () => {
    const v = adjudicate(fullCycle());
    expect(v.firstErrorIndex).toBeNull();
    expect(v.steps.every((s) => s.status === 'ok')).toBe(true);
    expect(v.closed).toBe(true);
    expect(v.finalState).toEqual(INITIAL_STATE);
  });

  it('空序列不视为闭合', () => {
    const v = adjudicate([]);
    expect(v.steps).toHaveLength(0);
    expect(v.firstErrorIndex).toBeNull();
    expect(v.closed).toBe(false);
    expect(v.finalState).toEqual(INITIAL_STATE);
  });

  it('全部合法但未回到初始状态时不闭合', () => {
    const v = adjudicate([card('load', 50), card('lock')]);
    expect(v.firstErrorIndex).toBeNull();
    expect(v.closed).toBe(false);
    expect(v.finalState).toEqual(loaded(50, { locked: true }));
  });

  it('装载后直接卸载不闭合：判定为首错，须先锁定再解锁', () => {
    const v = adjudicate([card('load', 100), card('unload')]);
    expect(v.closed).toBe(false);
    expect(v.firstErrorIndex).toBe(1);
    expect(v.steps[1].card.type).toBe('unload');
    expect(v.steps[1].reason).toContain('先锁定再解锁');
    expect(v.finalState).toEqual(loaded(100));
  });

  it('装载→锁定→解锁→卸载（不经舞台位）同样闭合', () => {
    const v = adjudicate([card('load', 100), card('lock'), card('unlock'), card('unload')]);
    expect(v.firstErrorIndex).toBeNull();
    expect(v.closed).toBe(true);
    expect(v.finalState).toEqual(INITIAL_STATE);
  });

  it('再次装载后解锁记录复位：仍须先锁定再解锁', () => {
    const v = adjudicate([
      card('load', 100),
      card('lock'),
      card('unlock'),
      card('unload'),
      card('load', 50),
      card('unload'),
    ]);
    expect(v.firstErrorIndex).toBe(5);
    expect(v.steps[5].reason).toContain('先锁定再解锁');
    expect(v.finalState).toEqual(loaded(50));
  });

  it('首错即停：后续卡被跳过且不再改变状态', () => {
    // 移动时未锁定 → 首错；其后的解锁/卸载本可能合法，但必须被跳过
    const v = adjudicate([card('load', 100), card('move'), card('unlock'), card('unload')]);
    expect(v.firstErrorIndex).toBe(1);
    expect(v.steps.map((s) => s.status)).toEqual(['ok', 'error', 'skipped', 'skipped']);
    // 状态停在首错前一刻：载重 100、归位、未锁定
    expect(v.finalState).toEqual(loaded(100));
    expect(v.closed).toBe(false);
  });

  it('首错卡自身不改变状态', () => {
    const v = adjudicate([card('load', 100), card('move')]);
    const errStep = v.steps[1];
    expect(errStep.status).toBe('error');
    expect(errStep.after).toEqual(errStep.before);
    expect(errStep.reason).toContain('未锁定先移动');
  });

  it('首错发生在第一张时，后续合法卡也不执行', () => {
    const v = adjudicate([card('move'), card('load', 100)]);
    expect(v.firstErrorIndex).toBe(0);
    expect(v.steps[1].status).toBe('skipped');
    expect(v.finalState).toEqual(INITIAL_STATE);
  });

  it('未归位先解锁被定位为首错', () => {
    const cards = [card('load', 60), card('lock'), card('move'), card('unlock')];
    const v = adjudicate(cards);
    expect(v.firstErrorIndex).toBe(3);
    expect(v.steps[3].reason).toContain('未归位先解锁');
    expect(v.finalState).toEqual(loaded(60, { locked: true, position: 'stage' }));
  });

  it('重排会改变裁决结果（纯函数复算）', () => {
    const cycle = fullCycle();
    // 把「移动」插到「锁定」之前：合法闭环变成首错
    const reordered = [cycle[0], cycle[2], cycle[1], cycle[3], cycle[4], cycle[5]];
    const v = adjudicate(reordered);
    expect(v.firstErrorIndex).toBe(1);
    expect(v.steps[1].card.type).toBe('move');
    expect(adjudicate(cycle).closed).toBe(true);
  });

  it('同样的输入重复裁决结果一致（无残留状态）', () => {
    const cards = [card('load', 0), card('lock')];
    const a = adjudicate(cards);
    const b = adjudicate(cards);
    expect(a).toEqual(b);
    expect(a.firstErrorIndex).toBe(0);
  });
});
