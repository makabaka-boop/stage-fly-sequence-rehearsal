import { expect, test, type Page } from '@playwright/test';
import { DRAFT_STORAGE_KEY, DRAFT_VERSION } from '../src/domain/draft';

const CARD = '[data-testid="sequence-card"]';

async function addCycle(page: Page) {
  await page.getByTestId('add-cycle').click();
}

async function cardTypes(page: Page): Promise<string[]> {
  return page
    .getByTestId('sequence-card')
    .evaluateAll((nodes) =>
      nodes.map((n) => {
        const title = n.querySelector('.card-title')?.textContent?.trim();
        const input = n.querySelector<HTMLInputElement>('[data-testid="card-weight"]');
        return input ? `${title}:${input.value}` : title ?? '';
      }),
    );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('标准闭环保存后被改乱，恢复草稿可原子还原为闭合并重新裁决', async ({ page }) => {
  await addCycle(page);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');

  // 保存当前确认的整套编排
  await page.getByTestId('save-draft').click();
  const feedback = page.getByTestId('draft-feedback');
  await expect(feedback).toHaveAttribute('data-kind', 'saved');
  await expect(feedback).toContainText('已保存 6 张');
  await expect(page.getByTestId('draft-saved-at')).toBeVisible();

  // 继续试改：删卡 + 把「移动」拖到「锁定」之前，序列已乱且首错
  await page.getByTestId('sequence-card').first().getByTestId('card-delete').click();
  await page.dragAndDrop(`${CARD} >> nth=1`, `${CARD} >> nth=0`);
  await expect(page.getByTestId('verdict-banner')).toContainText('首错');
  await expect(page.getByTestId('sequence-card')).toHaveCount(5);

  // 恢复草稿：整套序列原子替换并立即重新裁决
  await page.getByTestId('restore-draft').click();
  await expect(feedback).toHaveAttribute('data-kind', 'restored');
  await expect(feedback).toContainText('已恢复 6 张');
  await expect(page.getByTestId('sequence-card')).toHaveCount(6);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
  await expect(page.getByTestId('state-load')).toHaveText('空载');
  await expect(page.getByTestId('state-position')).toHaveText('归位');
  await expect(page.getByTestId('state-lock')).toHaveText('未锁定');
  await expect(page.locator('[data-testid="trajectory-step"][data-status="ok"]')).toHaveCount(6);

  await expect(await cardTypes(page)).toEqual([
    '装载:100',
    '锁定',
    '移动',
    '归位',
    '解锁',
    '卸载',
  ]);

  // 短暂反馈：稍后自动消失
  await expect(feedback).toBeHidden({ timeout: 6000 });
});

test('刷新后恢复草稿：卡片顺序与重量保持，恢复后立即裁决', async ({ page }) => {
  await addCycle(page);
  await page.getByTestId('card-weight').first().fill('320');
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
  await page.getByTestId('save-draft').click();
  await expect(page.getByTestId('draft-feedback')).toHaveAttribute('data-kind', 'saved');

  // 刷新：空草稿启动，屏幕序列仍为空，但操作区显示已有草稿可恢复
  await page.reload();
  await expect(page.getByTestId('sequence-list')).toHaveCount(0);
  await expect(page.getByTestId('draft-empty')).toHaveCount(0);
  await expect(page.getByTestId('draft-meta')).toContainText('共 6 张卡');
  await expect(page.getByTestId('restore-draft')).toBeEnabled();

  await page.getByTestId('restore-draft').click();
  await expect(page.getByTestId('draft-feedback')).toHaveAttribute('data-kind', 'restored');

  await expect(await cardTypes(page)).toEqual([
    '装载:320',
    '锁定',
    '移动',
    '归位',
    '解锁',
    '卸载',
  ]);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
  // 再刷新再恢复，结果仍然一致（单槽位覆盖写）
  await page.reload();
  await page.getByTestId('restore-draft').click();
  await expect(await cardTypes(page)).toEqual([
    '装载:320',
    '锁定',
    '移动',
    '归位',
    '解锁',
    '卸载',
  ]);
});

test('存储中的草稿被伪造损坏：现有序列与裁决不变，并出现明确失败反馈', async ({ page }) => {
  // 屏幕上先有一个合法闭环
  await addCycle(page);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
  const savedTypes = await cardTypes(page);

  // 向存储槽位写入损坏 JSON（模拟本地数据被破坏）
  await page.evaluate((key) => window.localStorage.setItem(key, '{这不是合法JSON'), DRAFT_STORAGE_KEY);
  await page.getByTestId('restore-draft').click();

  const feedback = page.getByTestId('draft-feedback');
  await expect(feedback).toHaveAttribute('data-kind', 'error');
  await expect(feedback).toContainText('无法恢复');
  await expect(feedback).toContainText('当前序列保持不变');
  await expect(page.getByTestId('draft-corrupt')).toContainText('已损坏');

  // 屏幕上的当前序列与裁决均未被破坏
  await expect(page.getByTestId('sequence-card')).toHaveCount(6);
  await expect(await cardTypes(page)).toEqual(savedTypes);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
  await expect(page.locator('[data-testid="trajectory-step"][data-status="ok"]')).toHaveCount(6);

  // 页面无异常穿透：反馈为短暂状态，之后仍可通过重新保存修复槽位
  await expect(feedback).toBeHidden({ timeout: 6000 });
  await page.getByTestId('save-draft').click();
  await expect(page.getByTestId('draft-feedback')).toHaveAttribute('data-kind', 'saved');
  await expect(page.getByTestId('draft-corrupt')).toBeEmpty();
  await page.getByTestId('restore-draft').click();
  await expect(page.getByTestId('draft-feedback')).toHaveAttribute('data-kind', 'restored');
});

test('刷新时槽位已损坏：页面正常空启动，操作区说明无法恢复', async ({ page }) => {
  await page.evaluate((key) => window.localStorage.setItem(key, 'NOT-JSON'), DRAFT_STORAGE_KEY);
  await page.goto('/');

  await expect(page.getByTestId('sequence-card')).toHaveCount(0);
  await expect(page.getByTestId('draft-corrupt')).toContainText('无法恢复');
  // 恢复尝试给出短暂失败反馈，仍不影响页面
  await page.getByTestId('restore-draft').click();
  await expect(page.getByTestId('draft-feedback')).toHaveAttribute('data-kind', 'error');
});

test('版本不兼容的草稿不能恢复，当前序列保留', async ({ page }) => {
  await addCycle(page);
  await page.evaluate(
    ({ key }) =>
      window.localStorage.setItem(
        key,
        JSON.stringify({
          version: 999,
          cards: [{ id: 'future', type: 'warp' }],
          savedAt: new Date().toISOString(),
        }),
      ),
    { key: DRAFT_STORAGE_KEY },
  );
  await page.getByTestId('restore-draft').click();
  const feedback = page.getByTestId('draft-feedback');
  await expect(feedback).toHaveAttribute('data-kind', 'error');
  await expect(feedback).toContainText('版本不兼容');
  await expect(page.getByTestId('sequence-card')).toHaveCount(6);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
});

test('当前序列含非法装载重量时拒绝保存：提示失败且不覆盖原草稿', async ({ page }) => {
  await addCycle(page);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
  await page.getByTestId('save-draft').click();
  await expect(page.getByTestId('draft-feedback')).toHaveAttribute('data-kind', 'saved');

  // 继续试改：把装载重量改成越界的 600，实时裁决判为首错
  await page.getByTestId('card-weight').first().fill('600');
  await expect(page.getByTestId('verdict-banner')).toContainText('首错');

  // 尝试保存非法序列：操作失败反馈，不能提示已保存
  await page.getByTestId('save-draft').click();
  const feedback = page.getByTestId('draft-feedback');
  await expect(feedback).toHaveAttribute('data-kind', 'error');
  await expect(feedback).toContainText('草稿未保存');
  await expect(feedback).toContainText('1–500');

  // 槽位中的原合法草稿未被覆盖：保存时间仍是原来的 100 千克闭环
  const stored = await page.evaluate(
    (key) => {
      const d = JSON.parse(window.localStorage.getItem(key) ?? 'null');
      return { weight: d?.cards?.[0]?.weightKg, count: d?.cards?.length };
    },
    DRAFT_STORAGE_KEY,
  );
  expect(stored).toEqual({ weight: 100, count: 6 });

  // 恢复草稿仍然成功：原子还原为合法闭环
  await page.getByTestId('restore-draft').click();
  await expect(page.getByTestId('draft-feedback')).toHaveAttribute('data-kind', 'restored');
  await expect(await cardTypes(page)).toEqual([
    '装载:100',
    '锁定',
    '移动',
    '归位',
    '解锁',
    '卸载',
  ]);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
});

test('未保存草稿的用户仍按原流程完成拖放复算（草稿功能零干扰）', async ({ page }) => {
  await addCycle(page);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');

  // 把「移动」拖到「锁定」之前 → 首错
  await page.dragAndDrop(`${CARD} >> nth=2`, `${CARD} >> nth=1`);
  const banner = page.getByTestId('verdict-banner');
  await expect(banner).toContainText('首错');
  await expect(banner).toContainText('第 2 张「移动」');
  await expect(page.getByTestId('state-load')).toHaveText('100 千克');
  await expect(page.locator('[data-testid="trajectory-step"][data-status="skipped"]')).toHaveCount(4);

  // 拖回后实时复算恢复闭合
  await page.dragAndDrop(`${CARD} >> nth=1`, `${CARD} >> nth=2`);
  await expect(banner).toContainText('闭合');

  // 全程未保存：刷新后空启动，无草稿可恢复
  await page.reload();
  await expect(page.getByTestId('sequence-card')).toHaveCount(0);
  await expect(page.getByTestId('draft-empty')).toBeVisible();
  // 尝试恢复时给出短暂失败反馈，空序列不受影响
  await page.getByTestId('restore-draft').click();
  const feedback = page.getByTestId('draft-feedback');
  await expect(feedback).toHaveAttribute('data-kind', 'error');
  await expect(feedback).toContainText('没有可恢复的草稿');
  await expect(page.getByTestId('sequence-card')).toHaveCount(0);
  await expect(page.getByTestId('verdict-banner')).toContainText('尚未加入口令卡');
});

test('回归：已有草稿时清空存储槽位再恢复，摘要变为「尚无已保存草稿」', async ({ page }) => {
  await addCycle(page);
  await page.getByTestId('save-draft').click();
  await expect(page.getByTestId('draft-feedback')).toHaveAttribute('data-kind', 'saved');
  await expect(page.getByTestId('draft-saved-at')).toBeVisible();
  await expect(page.getByTestId('draft-meta')).toContainText('共 6 张卡');

  // 存储槽位被清空（模拟本地数据被清除），屏幕上的序列不变
  await page.evaluate((key) => window.localStorage.removeItem(key), DRAFT_STORAGE_KEY);
  await page.getByTestId('restore-draft').click();

  const feedback = page.getByTestId('draft-feedback');
  await expect(feedback).toHaveAttribute('data-kind', 'error');
  await expect(feedback).toContainText('没有可恢复的草稿');
  // 摘要不再展示已失效的保存时间与卡数
  await expect(page.getByTestId('draft-empty')).toHaveText('尚无已保存草稿');
  await expect(page.getByTestId('draft-saved-at')).toHaveCount(0);
  await expect(page.getByTestId('draft-meta')).not.toContainText('张卡');
  // 屏幕上的当前序列不受影响
  await expect(page.getByTestId('sequence-card')).toHaveCount(6);
});

test('回归：已有草稿被覆盖为损坏文本后恢复，不再展示旧草稿摘要', async ({ page }) => {
  await addCycle(page);
  await page.getByTestId('save-draft').click();
  await expect(page.getByTestId('draft-feedback')).toHaveAttribute('data-kind', 'saved');
  await expect(page.getByTestId('draft-meta')).toContainText('共 6 张卡');

  // 覆盖为损坏文本后恢复：损坏警告出现，旧摘要同步消失
  await page.evaluate((key) => window.localStorage.setItem(key, '{corrupted!!!'), DRAFT_STORAGE_KEY);
  await page.getByTestId('restore-draft').click();

  await expect(page.getByTestId('draft-feedback')).toHaveAttribute('data-kind', 'error');
  await expect(page.getByTestId('draft-corrupt')).toContainText('已损坏');
  await expect(page.getByTestId('draft-saved-at')).toHaveCount(0);
  await expect(page.getByTestId('draft-empty')).toHaveText('尚无已保存草稿');
  // 屏幕上的当前序列与裁决保持不变
  await expect(page.getByTestId('sequence-card')).toHaveCount(6);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
});

test('回归：损坏警告出现后清空槽位再恢复，同步清除损坏警告', async ({ page }) => {
  // 先制造损坏警告
  await page.evaluate((key) => window.localStorage.setItem(key, 'BROKEN{json'), DRAFT_STORAGE_KEY);
  await page.getByTestId('restore-draft').click();
  await expect(page.getByTestId('draft-corrupt')).toContainText('已损坏');

  // 清空槽位再恢复：无草稿提示出现，损坏警告同步清除
  await page.evaluate((key) => window.localStorage.removeItem(key), DRAFT_STORAGE_KEY);
  await page.getByTestId('restore-draft').click();

  const feedback = page.getByTestId('draft-feedback');
  await expect(feedback).toHaveAttribute('data-kind', 'error');
  await expect(feedback).toContainText('没有可恢复的草稿');
  await expect(page.getByTestId('draft-corrupt')).toBeEmpty();
  await expect(page.getByTestId('draft-empty')).toHaveText('尚无已保存草稿');
});

test('回归：保存时间为不存在的 2 月 30 日时拒绝恢复并保留序列', async ({ page }) => {
  await addCycle(page);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');

  // 写入结构合法但保存时间不存在的草稿（Date.parse 会把 2 月 30 日静默吞成 3 月 2 日）
  await page.evaluate(
    ({ key, version }) =>
      window.localStorage.setItem(
        key,
        JSON.stringify({
          version,
          cards: [{ id: 'forged', type: 'lock' }],
          savedAt: '2026-02-30T08:00:00.000Z',
        }),
      ),
    { key: DRAFT_STORAGE_KEY, version: DRAFT_VERSION },
  );
  await page.getByTestId('restore-draft').click();

  const feedback = page.getByTestId('draft-feedback');
  await expect(feedback).toHaveAttribute('data-kind', 'error');
  await expect(feedback).toContainText('无法恢复');
  await expect(feedback).toContainText('保存时间无效');
  // 屏幕上的当前序列与裁决保持不变，未被伪造草稿替换
  await expect(page.getByTestId('sequence-card')).toHaveCount(6);
  await expect(await cardTypes(page)).toEqual([
    '装载:100',
    '锁定',
    '移动',
    '归位',
    '解锁',
    '卸载',
  ]);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
});
