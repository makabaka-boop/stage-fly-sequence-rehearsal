import { describe, expect, it } from 'vitest';
import { INITIAL_STATE, isInitialState } from '../machine';
import { executeNext, idleSession, remainingCount, startSession } from '../session';
import type { ActionCard, CardType } from '../types';

let seq = 0;
const card = (type: CardType, weightKg?: number): ActionCard => ({
  id: `s-${seq++}`,
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

/** 连续执行 n 张（或直到会话离开进行中） */
const run = (session: ReturnType<typeof startSession>, n: number) => {
  let s = session;
  for (let i = 0; i < n; i += 1) s = executeNext(s);
  return s;
};

describe('待命', () => {
  it('初始为待命：无快照、游标归零、吊杆处于初始状态', () => {
    const s = idleSession();
    expect(s.status).toBe('idle');
    expect(s.snapshot).toEqual([]);
    expect(s.cursor).toBe(0);
    expect(s.state).toEqual(INITIAL_STATE);
    expect(s.blocked).toBeNull();
  });

  it('空序列开始走台：留在待命', () => {
    expect(startSession([])).toEqual(idleSession());
  });

  it('待命时执行下一张是空操作（同一引用）', () => {
    const s = idleSession();
    expect(executeNext(s)).toBe(s);
  });
});

describe('开始走台', () => {
  it('复制当时的卡序与重量作为会话快照', () => {
    const cards = fullCycle(250);
    const s = startSession(cards);
    expect(s.status).toBe('running');
    expect(s.snapshot).toEqual(cards);
    expect(s.snapshot).not.toBe(cards);
    expect(s.snapshot[0]).not.toBe(cards[0]);
    expect(s.cursor).toBe(0);
    expect(s.state).toEqual(INITIAL_STATE);
  });

  it('快照不随原序列的后续改动变化', () => {
    const cards = fullCycle(100);
    const s = startSession(cards);
    // 模拟开始走台后牌面被继续编辑
    cards[0].weightKg = 500;
    cards.push(card('lock'));
    expect(s.snapshot).toHaveLength(6);
    expect(s.snapshot[0].weightKg).toBe(100);
  });
});

describe('合法推进', () => {
  it('每次执行通过单卡裁决推进游标并更新吊杆状态', () => {
    let s = startSession(fullCycle(120));

    s = executeNext(s); // 装载 120
    expect(s.status).toBe('running');
    expect(s.cursor).toBe(1);
    expect(s.state).toEqual({ loadKg: 120, position: 'home', locked: false, unlockedSinceLoad: false });

    s = executeNext(s); // 锁定
    expect(s.state.locked).toBe(true);

    s = executeNext(s); // 移动
    expect(s.state.position).toBe('stage');

    s = executeNext(s); // 归位
    expect(s.state.position).toBe('home');

    s = executeNext(s); // 解锁
    expect(s.state.locked).toBe(false);
    expect(s.state.unlockedSinceLoad).toBe(true);
    expect(s.cursor).toBe(5);
    expect(remainingCount(s)).toBe(1);
  });

  it('执行完末张即完成，标准闭环回到空载归位', () => {
    const s = run(startSession(fullCycle()), 6);
    expect(s.status).toBe('completed');
    expect(s.cursor).toBe(6);
    expect(remainingCount(s)).toBe(0);
    expect(isInitialState(s.state)).toBe(true);
    expect(s.blocked).toBeNull();
  });

  it('全部合法但未回到初始状态时同样完成，并停在中途状态', () => {
    const s = run(startSession([card('load', 50), card('lock')]), 2);
    expect(s.status).toBe('completed');
    expect(s.state).toEqual({ loadKg: 50, position: 'home', locked: true, unlockedSinceLoad: false });
  });

  it('推进不修改传入的会话对象', () => {
    const before = startSession(fullCycle());
    const snapshot = JSON.parse(JSON.stringify(before));
    executeNext(before);
    expect(before).toEqual(snapshot);
  });
});

describe('首错停步', () => {
  it('遇到非法卡即受阻：停在执行前状态并给出卡号与原因', () => {
    // 装载 → 移动（未锁定先移动，非法）→ 解锁 → 卸载
    const s = run(startSession([card('load', 100), card('move'), card('unlock'), card('unload')]), 2);
    expect(s.status).toBe('blocked');
    expect(s.blocked).not.toBeNull();
    expect(s.blocked!.index).toBe(1);
    expect(s.blocked!.card.type).toBe('move');
    expect(s.blocked!.reason).toContain('未锁定先移动');
    // 停在执行前状态：载重 100、归位、未锁定；游标停在受阻卡
    expect(s.state).toEqual({ loadKg: 100, position: 'home', locked: false, unlockedSinceLoad: false });
    expect(s.cursor).toBe(1);
    expect(remainingCount(s)).toBe(3);
  });

  it('第一张即非法时，停在初始状态', () => {
    const s = executeNext(startSession([card('move'), card('load', 100)]));
    expect(s.status).toBe('blocked');
    expect(s.blocked!.index).toBe(0);
    expect(s.state).toEqual(INITIAL_STATE);
    expect(s.cursor).toBe(0);
  });

  it('受阻后重复点击不会越过受阻卡（同一引用）', () => {
    const blocked = run(startSession([card('load', 100), card('move'), card('unload')]), 2);
    expect(blocked.status).toBe('blocked');
    const again = executeNext(blocked);
    expect(again).toBe(blocked);
    expect(executeNext(again)).toBe(blocked);
    expect(blocked.cursor).toBe(1);
    expect(blocked.state.loadKg).toBe(100);
  });

  it('受阻卡自身不改变吊杆状态', () => {
    const before = run(startSession([card('load', 80), card('unload')]), 1);
    const blocked = executeNext(before);
    expect(blocked.status).toBe('blocked');
    expect(blocked.state).toEqual(before.state);
    expect(blocked.blocked!.reason).toContain('先锁定再解锁');
  });
});

describe('末张幂等', () => {
  it('完成后重复点击不会越过末张（同一引用）', () => {
    const done = run(startSession(fullCycle()), 6);
    expect(done.status).toBe('completed');
    const again = executeNext(done);
    expect(again).toBe(done);
    expect(executeNext(again)).toBe(done);
    expect(done.cursor).toBe(6);
    expect(isInitialState(done.state)).toBe(true);
  });

  it('完成后的会话可重新走台：新会话从快照之外重新开始', () => {
    const cards = fullCycle(60);
    const done = run(startSession(cards), 6);
    const restarted = startSession(cards);
    expect(restarted.status).toBe('running');
    expect(restarted.cursor).toBe(0);
    expect(restarted.state).toEqual(INITIAL_STATE);
    // 旧会话不受影响
    expect(done.status).toBe('completed');
    expect(done.cursor).toBe(6);
  });
});
