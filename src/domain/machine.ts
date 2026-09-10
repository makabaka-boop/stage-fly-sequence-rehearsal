import type { ActionCard, RigState, StepRecord, Verdict } from './types';

/** 初始状态：空载且归位（未锁定） */
export const INITIAL_STATE: RigState = Object.freeze({
  loadKg: null,
  position: 'home',
  locked: false,
});

export const MIN_WEIGHT_KG = 1;
export const MAX_WEIGHT_KG = 500;

export function isInitialState(s: RigState): boolean {
  return s.loadKg === null && s.position === 'home' && !s.locked;
}

export type ApplyResult =
  | { ok: true; state: RigState }
  | { ok: false; state: RigState; reason: string };

const ok = (state: RigState): ApplyResult => ({ ok: true, state });
const err = (state: RigState, reason: string): ApplyResult => ({ ok: false, state, reason });

/**
 * 单卡裁决：校验前置条件，合法则返回新状态，非法则原样返回旧状态并给出原因。
 * 纯函数，不修改入参。
 */
export function applyCard(state: RigState, card: ActionCard): ApplyResult {
  switch (card.type) {
    case 'load': {
      if (state.loadKg !== null) {
        return err(state, `吊杆已装载 ${state.loadKg} 千克，不能重复装载`);
      }
      const w = card.weightKg;
      if (w === undefined || !Number.isInteger(w) || w < MIN_WEIGHT_KG || w > MAX_WEIGHT_KG) {
        const shown = w === undefined ? '未填写' : String(w);
        return err(state, `装载重量必须为 ${MIN_WEIGHT_KG}–${MAX_WEIGHT_KG} 千克的整数，当前为「${shown}」`);
      }
      return ok({ ...state, loadKg: w });
    }
    case 'lock': {
      if (state.loadKg === null) return err(state, '空载时不能锁定，请先装载');
      if (state.locked) return err(state, '吊杆已锁定，不能重复锁定');
      return ok({ ...state, locked: true });
    }
    case 'move': {
      if (!state.locked) return err(state, '未锁定先移动：必须先锁定才能移动到舞台位');
      if (state.position !== 'home') return err(state, '吊杆不在归位位置，无法向舞台位移动');
      return ok({ ...state, position: 'stage' });
    }
    case 'return': {
      if (state.position !== 'stage') return err(state, '吊杆不在舞台位，无需归位');
      return ok({ ...state, position: 'home' });
    }
    case 'unlock': {
      if (!state.locked) return err(state, '吊杆未锁定，不能解锁');
      if (state.position !== 'home') return err(state, '未归位先解锁：必须归位后才能解锁');
      return ok({ ...state, locked: false });
    }
    case 'unload': {
      if (state.loadKg === null) return err(state, '空载时不能卸载');
      if (state.locked) return err(state, '吊杆仍锁定，请先解锁再卸载');
      return ok({ ...state, loadKg: null });
    }
  }
}

/**
 * 整套口令裁决：从初始状态逐卡推演，遇到第一张非法卡即停止，
 * 后续卡片标记为 skipped 且不再改变设备状态。
 */
export function adjudicate(cards: readonly ActionCard[]): Verdict {
  let state: RigState = INITIAL_STATE;
  const steps: StepRecord[] = [];
  let firstErrorIndex: number | null = null;

  cards.forEach((card, index) => {
    if (firstErrorIndex !== null) {
      // 首错之后：不再执行，状态保持首错前一刻
      steps.push({ index, card, status: 'skipped', before: state, after: state });
      return;
    }
    const result = applyCard(state, card);
    steps.push({
      index,
      card,
      status: result.ok ? 'ok' : 'error',
      before: state,
      after: result.state,
      reason: result.ok ? undefined : result.reason,
    });
    state = result.state;
    if (!result.ok) firstErrorIndex = index;
  });

  const closed = firstErrorIndex === null && cards.length > 0 && isInitialState(state);
  return { steps, firstErrorIndex, finalState: state, closed };
}
