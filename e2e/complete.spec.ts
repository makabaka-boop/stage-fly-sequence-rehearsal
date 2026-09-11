import { expect, test, type Page } from '@playwright/test';

async function cardTitles(page: Page): Promise<string[]> {
  return page
    .getByTestId('sequence-card')
    .evaluateAll((nodes) =>
      nodes.map((n) => n.querySelector('.card-title')?.textContent?.trim() ?? ''),
    );
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('半途序列（舞台位锁定）一键补全收尾：追加最短后缀并立即复算闭合', async ({ page }) => {
  await page.getByTestId('add-load').click();
  await page.getByTestId('add-lock').click();
  await page.getByTestId('add-move').click();

  // 口令全部合法但停在舞台位：未闭合
  const banner = page.getByTestId('verdict-banner');
  await expect(banner).toContainText('未闭合');
  await expect(page.getByTestId('state-load')).toHaveText('100 千克');
  await expect(page.getByTestId('state-position')).toHaveText('舞台位');
  await expect(page.getByTestId('state-lock')).toHaveText('已锁定');

  await page.getByTestId('complete-ending').click();

  // 一次性追加最短安全收尾：归位 → 解锁 → 卸载，原有卡序保持不变
  await expect(page.getByTestId('sequence-card')).toHaveCount(6);
  await expect(await cardTitles(page)).toEqual(['装载', '锁定', '移动', '归位', '解锁', '卸载']);

  // 牌库操作区给出补全说明
  const feedback = page.getByTestId('completion-feedback');
  await expect(feedback).toHaveAttribute('data-kind', 'appended');
  await expect(feedback).toContainText('追加 3 张收尾卡');
  await expect(feedback).toContainText('归位 → 解锁 → 卸载');

  // 追加后立即走原裁决链复算：整套闭合，吊杆回到空载归位
  await expect(banner).toContainText('闭合');
  await expect(page.getByTestId('state-load')).toHaveText('空载');
  await expect(page.getByTestId('state-position')).toHaveText('归位');
  await expect(page.getByTestId('state-lock')).toHaveText('未锁定');
  await expect(page.locator('[data-testid="trajectory-step"][data-status="ok"]')).toHaveCount(6);
});

test('载重未锁定的半途序列：补齐「锁定→解锁」过程后卸载', async ({ page }) => {
  await page.getByTestId('add-load').click();
  await expect(page.getByTestId('verdict-banner')).toContainText('未闭合');
  await expect(page.getByTestId('state-lock')).toHaveText('未锁定');

  await page.getByTestId('complete-ending').click();

  await expect(await cardTitles(page)).toEqual(['装载', '锁定', '解锁', '卸载']);
  await expect(page.getByTestId('completion-feedback')).toContainText('锁定 → 解锁 → 卸载');
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
  await expect(page.getByTestId('state-load')).toHaveText('空载');
});

test('存在首错时补全收尾不改动卡序，并在牌库操作区说明应先修正对应卡', async ({ page }) => {
  await page.getByTestId('add-load').click();
  await page.getByTestId('add-move').click();
  await page.getByTestId('add-unlock').click();

  const banner = page.getByTestId('verdict-banner');
  await expect(banner).toContainText('首错');
  await expect(banner).toContainText('第 2 张「移动」');
  const before = await cardTitles(page);

  await page.getByTestId('complete-ending').click();

  // 卡序保持不变，一张不增
  await expect(page.getByTestId('sequence-card')).toHaveCount(3);
  await expect(await cardTitles(page)).toEqual(before);

  // 牌库操作区说明应先修正对应卡
  const feedback = page.getByTestId('completion-feedback');
  await expect(feedback).toHaveAttribute('data-kind', 'error');
  await expect(feedback).toContainText('首错');
  await expect(feedback).toContainText('第 2 张「移动」');
  await expect(feedback).toContainText('修正');
  await expect(feedback).toContainText('卡序保持不变');

  // 裁决视图不受影响，仍是首错
  await expect(banner).toContainText('首错');
});

test('已闭合序列重复点击不追加新卡，并给出清楚提示', async ({ page }) => {
  await page.getByTestId('add-cycle').click();
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');

  await page.getByTestId('complete-ending').click();
  const feedback = page.getByTestId('completion-feedback');
  await expect(feedback).toHaveAttribute('data-kind', 'closed');
  await expect(feedback).toContainText('已闭合');
  await expect(feedback).toContainText('未追加新卡');
  await expect(page.getByTestId('sequence-card')).toHaveCount(6);

  // 重复点击：仍不追加，提示仍然清楚
  await page.getByTestId('complete-ending').click();
  await expect(page.getByTestId('sequence-card')).toHaveCount(6);
  await expect(feedback).toContainText('已闭合');
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
  await expect(await cardTitles(page)).toEqual(['装载', '锁定', '移动', '归位', '解锁', '卸载']);
});

test('走台进行中补全收尾入口禁用，未闭合终态结束后可一键补全', async ({ page }) => {
  await page.getByTestId('add-load').click();
  await page.getByTestId('add-lock').click();

  await page.getByTestId('start-walkthrough').click();
  // 走台进行中：补全收尾入口随牌库一起锁定
  await expect(page.getByTestId('complete-ending')).toBeDisabled();

  // 逐张执行完毕：全部合法但未归位 → 走台未闭合（终态），编辑入口恢复
  await page.getByTestId('execute-next').click();
  await page.getByTestId('execute-next').click();
  await expect(page.getByTestId('walkthrough-result')).toContainText('走台未闭合');
  await expect(page.getByTestId('complete-ending')).toBeEnabled();

  // 直接按当前推演状态补全：解锁 → 卸载，序列闭合
  await page.getByTestId('complete-ending').click();
  await expect(await cardTitles(page)).toEqual(['装载', '锁定', '解锁', '卸载']);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
  await expect(page.getByTestId('state-load')).toHaveText('空载');
});
