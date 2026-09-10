import { MAX_WEIGHT_KG, MIN_WEIGHT_KG } from './machine';
import type { ActionCard, CardType } from './types';

/** 草稿契约版本：结构或语义不兼容时递增 */
export const DRAFT_VERSION = 1;

/** 本地排练草稿的浏览器存储键（单槽位） */
export const DRAFT_STORAGE_KEY = 'flybar-rehearsal:draft:v1';

const CARD_TYPES: readonly CardType[] = ['load', 'lock', 'move', 'return', 'unlock', 'unload'];

/**
 * 本地排练草稿：带版本字段的 JSON 结构。
 * 契约复用 ActionCard 及重量边界（MIN_WEIGHT_KG–MAX_WEIGHT_KG 的整数）。
 */
export interface RehearsalDraft {
  version: typeof DRAFT_VERSION;
  /** 当前确认的动作卡序列，卡片 id 为跨刷新保持顺序用的稳定标识 */
  cards: ActionCard[];
  /** 保存时间（ISO 8601 字符串） */
  savedAt: string;
}

/** 已保存草稿的摘要（不含卡片本身，用于操作区展示） */
export interface DraftMeta {
  savedAt: string;
  cardCount: number;
}

export type SaveDraftResult = { ok: true; meta: DraftMeta } | { ok: false; reason: string };
export type LoadDraftResult =
  | { ok: true; draft: RehearsalDraft }
  | { ok: false; reason: string; corrupt: boolean };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 单卡契约校验：类型、稳定标识与载荷逐项检查。
 * - id 必须为非空字符串，且序列内唯一（唯一性由 parseDraft 检查）；
 * - type 必须为受支持的口令类型；
 * - 重量载荷仅装载卡可携带，缺省合法，存在时必须是 1–500 千克的整数；
 *   非装载卡一律不得携带重量。
 * 返回清洗后的 ActionCard（仅保留契约字段），不合法时返回原因。
 */
export function validateCard(value: unknown): { ok: true; card: ActionCard } | { ok: false; reason: string } {
  if (!isPlainObject(value)) return { ok: false, reason: '存在不是对象的卡片' };

  const { id, type, weightKg } = value;

  if (typeof id !== 'string' || id.trim() === '') {
    return { ok: false, reason: '卡片缺少稳定标识' };
  }

  if (typeof type !== 'string' || !CARD_TYPES.includes(type as CardType)) {
    return { ok: false, reason: `卡片类型不受支持（标识「${id}」）` };
  }
  const cardType = type as CardType;

  if (cardType !== 'load' && weightKg !== undefined) {
    return { ok: false, reason: `非装载卡携带了重量载荷（标识「${id}」）` };
  }

  if (weightKg !== undefined) {
    if (typeof weightKg !== 'number' || !Number.isInteger(weightKg) || weightKg < MIN_WEIGHT_KG || weightKg > MAX_WEIGHT_KG) {
      return {
        ok: false,
        reason: `装载重量必须为 ${MIN_WEIGHT_KG}–${MAX_WEIGHT_KG} 千克的整数（标识「${id}」）`,
      };
    }
    return { ok: true, card: { id, type: cardType, weightKg } };
  }

  return { ok: true, card: { id, type: cardType } };
}

/**
 * 逐卡校验一个已构造的 ActionCard 序列（保存路径用）。
 * 与读取路径共用 validateCard 的类型/标识/载荷规则，并额外检查 id 唯一。
 * 注：运行中的序列允许存在非法重量（由实时裁决给出首错），但这样的序列
 * 不满足草稿契约，不能保存。
 */
export function validateDraftCards(cards: readonly ActionCard[]): { ok: true } | { ok: false; reason: string } {
  if (!Array.isArray(cards)) return { ok: false, reason: '草稿缺少卡片序列' };
  const seenIds = new Set<string>();
  for (const card of cards) {
    const result = validateCard(card);
    if (!result.ok) return result;
    if (seenIds.has(result.card.id)) {
      return { ok: false, reason: `卡片稳定标识重复（标识「${result.card.id}」）` };
    }
    seenIds.add(result.card.id);
  }
  return { ok: true };
}

/**
 * 解析并逐卡校验草稿 JSON。
 * 任何结构损坏、版本不兼容或卡片不合法都会返回失败结果，
 * 由调用方保留屏幕上的当前序列，绝不让异常穿透到页面。
 */
export function parseDraft(raw: string): LoadDraftResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, corrupt: true, reason: '草稿不是有效的 JSON' };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, corrupt: true, reason: '草稿结构已损坏' };
  }

  if (parsed.version !== DRAFT_VERSION) {
    return { ok: false, corrupt: false, reason: '草稿版本不兼容，无法恢复' };
  }

  if (!Array.isArray(parsed.cards)) {
    return { ok: false, corrupt: true, reason: '草稿缺少卡片序列' };
  }

  if (typeof parsed.savedAt !== 'string' || Number.isNaN(Date.parse(parsed.savedAt))) {
    return { ok: false, corrupt: true, reason: '草稿保存时间无效' };
  }

  const cards: ActionCard[] = [];
  for (const item of parsed.cards) {
    const result = validateCard(item);
    if (!result.ok) return { ok: false, corrupt: true, reason: result.reason };
    cards.push(result.card);
  }
  const checked = validateDraftCards(cards);
  if (!checked.ok) return { ok: false, corrupt: true, reason: checked.reason };

  return { ok: true, draft: { version: DRAFT_VERSION, cards, savedAt: parsed.savedAt } };
}

/** 构造草稿对象（保存时间可注入，便于测试） */
export function buildDraft(cards: readonly ActionCard[], now: Date = new Date()): RehearsalDraft {
  return {
    version: DRAFT_VERSION,
    cards: cards.map((c) =>
      c.type === 'load' && c.weightKg !== undefined
        ? { id: c.id, type: c.type, weightKg: c.weightKg }
        : { id: c.id, type: c.type },
    ),
    savedAt: now.toISOString(),
  };
}

const safeStorage = (): Storage | null => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/**
 * 把草稿原子写入浏览器存储（单槽位覆盖写）。
 * 写入前先逐卡校验：当前序列不满足草稿契约（如装载重量越界）时直接失败，
 * 不触碰存储槽位，原已保存的草稿保持不变。
 * localStorage 不可用或写入被拒（隐私模式/配额）时同样返回失败，不抛出异常。
 */
export function saveDraft(cards: readonly ActionCard[], storage?: Storage | null, now?: Date): SaveDraftResult {
  const checked = validateDraftCards(cards);
  if (!checked.ok) return { ok: false, reason: `草稿未保存：${checked.reason}` };

  const store = storage === undefined ? safeStorage() : storage;
  if (!store) return { ok: false, reason: '浏览器存储不可用，草稿未保存' };

  const draft = buildDraft(cards, now);
  try {
    store.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    return { ok: false, reason: '写入浏览器存储失败，草稿未保存' };
  }
  return { ok: true, meta: { savedAt: draft.savedAt, cardCount: draft.cards.length } };
}

/**
 * 读取并校验单槽位草稿。
 * - 槽位为空：ok 且 meta 为 null（从未保存，不视为错误）；
 * - 损坏或不兼容：ok 为 false，当前序列由调用方保留。
 * 全程不抛出异常。
 */
export function readStoredDraft(storage?: Storage | null):
  | { ok: true; draft: RehearsalDraft | null }
  | { ok: false; reason: string; corrupt: boolean } {
  const store = storage === undefined ? safeStorage() : storage;
  if (!store) return { ok: false, corrupt: false, reason: '浏览器存储不可用' };

  let raw: string | null;
  try {
    raw = store.getItem(DRAFT_STORAGE_KEY);
  } catch {
    return { ok: false, corrupt: true, reason: '读取浏览器存储失败' };
  }
  if (raw === null) return { ok: true, draft: null };

  const result = parseDraft(raw);
  if (!result.ok) return result;
  return { ok: true, draft: result.draft };
}
