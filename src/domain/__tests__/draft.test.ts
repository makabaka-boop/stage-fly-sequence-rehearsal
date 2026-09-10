import { describe, expect, it, vi } from 'vitest';
import type { ActionCard, CardType } from '../types';
import {
  buildDraft,
  DRAFT_STORAGE_KEY,
  DRAFT_VERSION,
  parseDraft,
  readStoredDraft,
  saveDraft,
  validateCard,
} from '../draft';

let seq = 0;
const card = (type: CardType, weightKg?: number): ActionCard => ({
  id: `d-${seq++}`,
  type,
  ...(type === 'load' ? { weightKg } : {}),
});

const fullCycle = (weightKg = 100): ActionCard[] => [
  card('load', weightKg),
  card('lock'),
  card('move'),
  card('return'),
  card('unlock'),
  card('unload'),
];

const makeMemoryStorage = (initial?: Record<string, string>): Storage => {
  const map = new Map(Object.entries(initial ?? {}));
  return {
    getItem: vi.fn((key: string) => (map.has(key) ? map.get(key)! : null)),
    setItem: vi.fn((key: string, value: string) => {
      map.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      map.delete(key);
    }),
    clear: vi.fn(() => map.clear()),
    key: vi.fn((i: number) => Array.from(map.keys())[i] ?? null),
    get length() {
      return map.size;
    },
  };
};

describe('草稿契约', () => {
  it('携带版本字段，结构为 version / cards / savedAt', () => {
    const draft = buildDraft(fullCycle(), new Date('2026-09-10T08:00:00.000Z'));
    expect(draft.version).toBe(1);
    expect(draft.version).toBe(DRAFT_VERSION);
    expect(draft.savedAt).toBe('2026-09-10T08:00:00.000Z');
    expect(draft.cards).toHaveLength(6);
  });

  it('序列化后可被 parseDraft 原样解析，卡片顺序、标识与重量保持不变', () => {
    const cards = fullCycle(250);
    const draft = buildDraft(cards, new Date('2026-09-10T08:00:00.000Z'));
    const result = parseDraft(JSON.stringify(draft));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.draft.cards.map((c) => c.id)).toEqual(cards.map((c) => c.id));
      expect(result.draft.cards).toEqual(cards);
      expect(result.draft.cards[0].weightKg).toBe(250);
    }
  });

  it('空序列也是合法草稿（空草稿启动兼容）', () => {
    const draft = buildDraft([], new Date('2026-09-10T08:00:00.000Z'));
    const result = parseDraft(JSON.stringify(draft));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.cards).toEqual([]);
  });

  it('装载重量缺省合法：未填写重量的装载卡可恢复', () => {
    const result = validateCard({ id: 'x', type: 'load' });
    expect(result.ok).toBe(true);
  });

  it.each([1, 500])('接受重量边界 %s 千克', (w) => {
    expect(validateCard({ id: 'x', type: 'load', weightKg: w }).ok).toBe(true);
  });
});

describe('逐卡校验：类型、标识与载荷', () => {
  it.each([
    ['重量为 0', { id: 'a', type: 'load', weightKg: 0 }],
    ['重量为 501', { id: 'a', type: 'load', weightKg: 501 }],
    ['重量为负数', { id: 'a', type: 'load', weightKg: -3 }],
    ['重量为小数', { id: 'a', type: 'load', weightKg: 2.5 }],
    ['重量为字符串', { id: 'a', type: 'load', weightKg: '100' }],
    ['未知卡类型', { id: 'a', type: 'fly' }],
    ['类型缺失', { id: 'a' }],
    ['标识缺失', { type: 'lock' }],
    ['标识为空串', { id: '  ', type: 'lock' }],
    ['非装载卡携带重量', { id: 'a', type: 'lock', weightKg: 10 }],
    ['卡片为数组', ['load']],
    ['卡片为字符串', 'load'],
  ])('拒绝不合法卡片：%s', (_label, value) => {
    expect(validateCard(value).ok).toBe(false);
  });
});

describe('parseDraft：损坏与不兼容', () => {
  it.each([
    ['不是 JSON', '{not json'],
    ['顶层为数组', '[]'],
    ['顶层为字符串', '"draft"'],
    ['缺少版本', JSON.stringify({ cards: [], savedAt: new Date().toISOString() })],
    ['缺少 cards', JSON.stringify({ version: DRAFT_VERSION, savedAt: new Date().toISOString() })],
    ['cards 不是数组', JSON.stringify({ version: DRAFT_VERSION, cards: {}, savedAt: new Date().toISOString() })],
    ['savedAt 缺失', JSON.stringify({ version: DRAFT_VERSION, cards: [] })],
    ['savedAt 非法', JSON.stringify({ version: DRAFT_VERSION, cards: [], savedAt: 'yesterday' })],
    [
      '卡片重量越界',
      JSON.stringify({
        version: DRAFT_VERSION,
        cards: [{ id: 'a', type: 'load', weightKg: 999 }],
        savedAt: new Date().toISOString(),
      }),
    ],
    [
      '卡片标识重复',
      JSON.stringify({
        version: DRAFT_VERSION,
        cards: [
          { id: 'a', type: 'load', weightKg: 10 },
          { id: 'a', type: 'lock' },
        ],
        savedAt: new Date().toISOString(),
      }),
    ],
  ])('%s 时返回失败，不抛出', (_label, raw) => {
    const result = parseDraft(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });

  it('版本不兼容时明确报告原因，且不视为存储损坏', () => {
    const result = parseDraft(JSON.stringify({ version: 999, cards: [], savedAt: new Date().toISOString() }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.corrupt).toBe(false);
      expect(result.reason).toContain('版本不兼容');
    }
  });

  it('JSON 损坏时标记为 corrupt', () => {
    const result = parseDraft('<<<broken');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.corrupt).toBe(true);
  });

  it('拒绝不存在的日历日期作为保存时间：2 月 30 日会被 Date.parse 静默归一，必须显式拒绝', () => {
    // 回归：Date.parse('2026-02-30T08:00:00.000Z') 在 V8 中归一为 3 月 2 日而非 NaN
    const result = parseDraft(
      JSON.stringify({
        version: DRAFT_VERSION,
        cards: [{ id: 'a', type: 'lock' }],
        savedAt: '2026-02-30T08:00:00.000Z',
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.corrupt).toBe(true);
      expect(result.reason).toContain('保存时间无效');
    }
  });

  it.each([
    ['平年 2 月 29 日', '2025-02-29T00:00:00.000Z'],
    ['不存在的 13 月', '2026-13-01T00:00:00.000Z'],
    ['越界的 25 时', '2026-09-10T25:00:00.000Z'],
    ['越界的 60 分', '2026-09-10T08:60:00.000Z'],
  ])('拒绝无效保存时间：%s', (_label, savedAt) => {
    const result = parseDraft(JSON.stringify({ version: DRAFT_VERSION, cards: [], savedAt }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('保存时间无效');
  });

  it.each([
    ['闰年 2 月 29 日', '2024-02-29T23:59:59.000Z'],
    ['普通日历时间', '2026-09-10T08:00:00.000Z'],
    ['带偏移的时区', '2026-09-10T08:00:00+08:00'],
  ])('接受真实存在的保存时间：%s', (_label, savedAt) => {
    const result = parseDraft(JSON.stringify({ version: DRAFT_VERSION, cards: [], savedAt }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.savedAt).toBe(savedAt);
  });

  it('清洗多余字段：仅保留契约内字段', () => {
    const raw = JSON.stringify({
      version: DRAFT_VERSION,
      cards: [{ id: 'a', type: 'lock', extra: 'ignored' }],
      savedAt: new Date().toISOString(),
      unknownField: 1,
    });
    const result = parseDraft(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.draft.cards[0]).toEqual({ id: 'a', type: 'lock' });
  });
});

describe('浏览器存储读写', () => {
  it('保存后读回，卡序、标识与重量保持一致', () => {
    const storage = makeMemoryStorage();
    const cards = fullCycle(42);
    const savedAt = new Date('2026-09-10T08:00:00.000Z');

    const write = saveDraft(cards, storage, savedAt);
    expect(write.ok).toBe(true);
    if (write.ok) {
      expect(write.meta.cardCount).toBe(6);
      expect(write.meta.savedAt).toBe('2026-09-10T08:00:00.000Z');
    }

    const read = readStoredDraft(storage);
    expect(read.ok).toBe(true);
    if (read.ok && read.draft) {
      expect(read.draft.cards.map((c) => c.id)).toEqual(cards.map((c) => c.id));
      expect(read.draft.cards[0]).toEqual(cards[0]);
      expect(read.draft.savedAt).toBe('2026-09-10T08:00:00.000Z');
    }
  });

  it('槽位为空时返回 draft=null（空草稿启动，不报错）', () => {
    const read = readStoredDraft(makeMemoryStorage());
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.draft).toBeNull();
  });

  it('写入抛异常（配额/隐私模式）时返回失败原因，不抛出', () => {
    const storage = makeMemoryStorage();
    vi.mocked(storage.setItem).mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const result = saveDraft(fullCycle(), storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('未保存');
  });

  it('读取抛异常时返回失败，不抛出', () => {
    const storage = makeMemoryStorage();
    vi.mocked(storage.getItem).mockImplementation(() => {
      throw new Error('blocked');
    });
    const result = readStoredDraft(storage);
    expect(result.ok).toBe(false);
  });

  it('存储不可用（null）时读写都失败但不抛出', () => {
    expect(saveDraft(fullCycle(), null).ok).toBe(false);
    const read = readStoredDraft(null);
    expect(read.ok).toBe(false);
  });

  it.each([
    ['重量为 0', 0],
    ['重量为 501', 501],
    ['重量为小数', 2.5],
  ])('当前序列装载重量不合法（%s）时拒绝保存', (_label, w) => {
    const storage = makeMemoryStorage();
    const result = saveDraft([card('load', w), card('lock')], storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('草稿未保存');
    // 未触碰存储槽位
    expect(storage.setItem).not.toHaveBeenCalled();
    const read = readStoredDraft(storage);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.draft).toBeNull();
  });

  it('保存非法序列失败时不覆盖此前已保存的合法草稿', () => {
    const storage = makeMemoryStorage();
    const good = fullCycle(120);
    const goodAt = new Date('2026-09-10T08:00:00.000Z');
    expect(saveDraft(good, storage, goodAt).ok).toBe(true);

    // 监督继续试改出非法重量后尝试保存
    const bad = [card('load', 600)];
    const result = saveDraft(bad, storage, new Date('2026-09-10T09:00:00.000Z'));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('1–500');

    // 槽位仍是原合法草稿：可恢复且卡序、标识、重量、保存时间不变
    const read = readStoredDraft(storage);
    expect(read.ok).toBe(true);
    if (read.ok && read.draft) {
      expect(read.draft.cards.map((c) => c.id)).toEqual(good.map((c) => c.id));
      expect(read.draft.cards[0].weightKg).toBe(120);
      expect(read.draft.savedAt).toBe('2026-09-10T08:00:00.000Z');
    }
  });

  it('保存时拒绝重复稳定标识', () => {
    const storage = makeMemoryStorage();
    const dup: ActionCard[] = [
      { id: 'same', type: 'load', weightKg: 10 },
      { id: 'same', type: 'lock' },
    ];
    const result = saveDraft(dup, storage);
    expect(result.ok).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('空序列可以保存（合法空草稿）', () => {
    const storage = makeMemoryStorage();
    const result = saveDraft([], storage);
    expect(result.ok).toBe(true);
    const read = readStoredDraft(storage);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.draft?.cards).toEqual([]);
  });

  it('槽位中是伪造的损坏 JSON 时返回 corrupt，调用方据此保留当前序列', () => {
    const storage = makeMemoryStorage({ [DRAFT_STORAGE_KEY]: 'forged{garbage' });
    const result = readStoredDraft(storage);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.corrupt).toBe(true);
  });

  it('槽位中草稿的保存时间不存在（2 月 30 日）时读取失败并标记 corrupt，不返回草稿', () => {
    // 回归：写入二月三十日的草稿必须被拒绝，不能像合法草稿一样读回
    const storage = makeMemoryStorage({
      [DRAFT_STORAGE_KEY]: JSON.stringify({
        version: DRAFT_VERSION,
        cards: [{ id: 'a', type: 'load', weightKg: 100 }],
        savedAt: '2026-02-30T08:00:00.000Z',
      }),
    });
    const result = readStoredDraft(storage);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.corrupt).toBe(true);
      expect(result.reason).toContain('保存时间无效');
    }
  });
});
