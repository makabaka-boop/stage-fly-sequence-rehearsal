import { applyCard } from './machine';
import type { ActionCard, CardType, RigState } from './types';

/** 规划用的探针卡：id 仅满足 ActionCard 结构，不会进入真实序列 */
const probe = (type: CardType): ActionCard => ({ id: `completion-probe-${type}`, type });

/**
 * 最短安全收尾：从裁决终态出发，确定性生成回到空载归位所需的口令卡类型后缀。
 *
 * 规划规则复用单卡前置条件（applyCard），顺序固定：
 * 1. 舞台位先归位；
 * 2. 锁定态再解锁；
 * 3. 尚未完成「锁定→解锁」过程的载重态补齐该过程（补锁定再解锁）；
 * 4. 最后卸载。
 *
 * 每张卡都是到达空载归位不可或缺的一步（归位 / 解锁 / 补齐锁定解锁过程 / 卸载
 * 各自完成其他卡无法替代的状态迁移），因此生成的后缀即最短后缀。
 * 已闭合（空载归位）时不产生新卡，返回空数组。纯函数，不修改入参。
 */
export function planCompletion(state: RigState): CardType[] {
  const suffix: CardType[] = [];
  let current = state;

  // 经单卡裁决确认合法才纳入后缀：生成的每张卡必然满足前置条件
  const take = (type: CardType): void => {
    const result = applyCard(current, probe(type));
    if (result.ok) {
      suffix.push(type);
      current = result.state;
    }
  };

  if (current.position === 'stage') take('return');
  if (current.locked) take('unlock');
  if (current.loadKg !== null && !current.unlockedSinceLoad) {
    take('lock');
    take('unlock');
  }
  if (current.loadKg !== null) take('unload');

  return suffix;
}
