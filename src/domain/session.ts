import { applyCard, INITIAL_STATE } from './machine';
import type { ActionCard, RigState } from './types';

/** 走台会话状态：待命 / 进行中 / 完成 / 受阻 */
export type SessionStatus = 'idle' | 'running' | 'completed' | 'blocked';

/** 受阻详情：记录受阻卡的位置、卡片与非法原因 */
export interface BlockedInfo {
  /** 受阻卡在快照中的下标（从 0 开始），即受阻时的游标位置 */
  index: number;
  card: ActionCard;
  reason: string;
}

/**
 * 走台会话：把整套口令的纸面预演转成逐张报令的执行会话。
 * 会话期间操作者只看到当前应执行的口令、执行后的吊杆状态与剩余张数。
 */
export interface WalkSession {
  status: SessionStatus;
  /** 会话快照：开始走台时复制的卡序与重量，会话期间不随牌面编辑变化 */
  snapshot: ActionCard[];
  /** 游标：下一张待执行卡在快照中的下标，等于已执行张数 */
  cursor: number;
  /** 当前吊杆状态：已执行口令推演后的结果（受阻时停在执行前状态） */
  state: RigState;
  /** 受阻详情，仅 status 为 blocked 时存在 */
  blocked: BlockedInfo | null;
}

/** 待命会话：无快照、游标归零、吊杆处于初始状态 */
export function idleSession(): WalkSession {
  return { status: 'idle', snapshot: [], cursor: 0, state: INITIAL_STATE, blocked: null };
}

/**
 * 开始走台：复制当时的卡序与重量作为会话快照，从初始状态待命执行。
 * 空序列无法开始，返回待命会话（由调用方给出可理解的反馈）。
 */
export function startSession(cards: readonly ActionCard[]): WalkSession {
  if (cards.length === 0) return idleSession();
  return {
    status: 'running',
    snapshot: cards.map((c) => ({ ...c })),
    cursor: 0,
    state: INITIAL_STATE,
    blocked: null,
  };
}

/**
 * 执行下一张：通过现有单卡裁决推进游标。纯函数，不修改入参。
 * - 合法：吊杆状态前进，游标加一；执行完末张即完成；
 * - 非法：会话受阻，停在执行前状态并记录卡号与原因；
 * - 非进行中（待命 / 完成 / 受阻）：原样返回同一引用，
 *   重复点击不会越过末张或受阻卡。
 */
export function executeNext(session: WalkSession): WalkSession {
  if (session.status !== 'running') return session;
  const card = session.snapshot[session.cursor];
  if (!card) return session;

  const result = applyCard(session.state, card);
  if (!result.ok) {
    return {
      ...session,
      status: 'blocked',
      blocked: { index: session.cursor, card, reason: result.reason },
    };
  }

  const cursor = session.cursor + 1;
  return {
    ...session,
    status: cursor >= session.snapshot.length ? 'completed' : 'running',
    cursor,
    state: result.state,
  };
}

/** 剩余张数：尚未执行的口令卡数量（含当前待执行的一张） */
export function remainingCount(session: WalkSession): number {
  return session.snapshot.length - session.cursor;
}
