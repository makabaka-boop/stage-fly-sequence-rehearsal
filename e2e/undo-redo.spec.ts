import { expect, test, type Page } from '@playwright/test';

const CARD = '[data-testid="sequence-card"]';

async function addCycle(page: Page) {
  await page.getByTestId('add-cycle').click();
}

async function cardTitles(page: Page): Promise<string[]> {
  return page
    .getByTestId('sequence-card')
    .evaluateAll((nodes) =>
      nodes.map((n) => n.querySelector('.card-title')?.textContent?.trim() ?? ''),
    );
}

async function executeAll(page: Page, count: number) {
  for (let i = 0; i < count; i += 1) {
    await page.getByTestId('execute-next').click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('拖放重排后可撤销重做：每次切换都原子替换卡组并重新裁决', async ({ page }) => {
  await addCycle(page);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');

  // 把「移动」拖到「锁定」之前 → 首错
  await page.dragAndDrop(`${CARD} >> nth=2`, `${CARD} >> nth=1`);
  await expect(await cardTitles(page)).toEqual(['装载', '移动', '锁定', '归位', '解锁', '卸载']);
  await expect(page.getByTestId('verdict-banner')).toContainText('首错');

  // 撤销：原子回到拖放前的整组卡组，裁决链复算恢复闭合
  await page.getByTestId('undo-edit').click();
  await expect(await cardTitles(page)).toEqual(['装载', '锁定', '移动', '归位', '解锁', '卸载']);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
  await expect(page.locator('[data-testid="trajectory-step"][data-status="ok"]')).toHaveCount(6);

  // 重做：恢复拖放后的顺序与首错结论
  await page.getByTestId('redo-edit').click();
  await expect(await cardTitles(page)).toEqual(['装载', '移动', '锁定', '归位', '解锁', '卸载']);
  await expect(page.getByTestId('verdict-banner')).toContainText('首错');
  await expect(page.getByTestId('verdict-banner')).toContainText('第 2 张「移动」');
});

test('撤销后执行新编辑：重做分支被清空，点击重做只给就地说明', async ({ page }) => {
  await addCycle(page);
  await page.dragAndDrop(`${CARD} >> nth=2`, `${CARD} >> nth=1`);
  await page.getByTestId('undo-edit').click();
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');

  // 撤销后追加一张新卡：重做分支清空
  await page.getByTestId('add-lock').click();
  await expect(page.getByTestId('sequence-card')).toHaveCount(7);

  await page.getByTestId('redo-edit').click();
  const feedback = page.getByTestId('history-feedback');
  await expect(feedback).toContainText('没有可重做');
  await expect(feedback).toContainText('序列保持不变');
  // 序列不因不可用按钮变化
  await expect(page.getByTestId('sequence-card')).toHaveCount(7);
});

test('载重校准后撤销恢复原重量，重做恢复校准结果', async ({ page }) => {
  await addCycle(page);
  await page.getByTestId('calibration-delta').fill('50');
  await page.getByTestId('apply-calibration').click();
  await expect(page.getByTestId('calibration-feedback')).toHaveAttribute('data-kind', 'applied');
  await expect(page.getByTestId('card-weight')).toHaveValue('150');
  await expect(page.getByTestId('trajectory-step').nth(0)).toContainText('#1 装载（150 千克）');

  // 撤销校准：恢复原重量并重新裁决
  await page.getByTestId('undo-edit').click();
  await expect(page.getByTestId('card-weight')).toHaveValue('100');
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
  await expect(page.getByTestId('trajectory-step').nth(0)).toContainText('#1 装载（100 千克）');

  // 重做校准：恢复 150 千克
  await page.getByTestId('redo-edit').click();
  await expect(page.getByTestId('card-weight')).toHaveValue('150');
  await expect(page.getByTestId('trajectory-step').nth(0)).toContainText('#1 装载（150 千克）');
});

test('草稿恢复可撤销：只回到恢复前的屏幕序列，槽位仍可再次恢复', async ({ page }) => {
  await addCycle(page);
  await page.getByTestId('save-draft').click();
  await expect(page.getByTestId('draft-feedback')).toHaveAttribute('data-kind', 'saved');

  // 恢复前在屏幕上继续编辑：删除首张「装载」
  await page.getByTestId('sequence-card').first().getByTestId('card-delete').click();
  await expect(page.getByTestId('sequence-card')).toHaveCount(5);
  await expect(page.getByTestId('verdict-banner')).toContainText('首错');

  // 恢复草稿：屏幕序列被替换为 6 张闭环
  await page.getByTestId('restore-draft').click();
  await expect(page.getByTestId('draft-feedback')).toHaveAttribute('data-kind', 'restored');
  await expect(page.getByTestId('sequence-card')).toHaveCount(6);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');

  // 撤销草稿恢复：只回到恢复前的屏幕序列（5 张首错），不改写本地槽位
  await page.getByTestId('undo-edit').click();
  await expect(page.getByTestId('sequence-card')).toHaveCount(5);
  await expect(page.getByTestId('verdict-banner')).toContainText('首错');
  await expect(page.getByTestId('draft-meta')).toContainText('共 6 张卡');

  // 槽位未受影响：可再次恢复同一份草稿
  await page.getByTestId('restore-draft').click();
  await expect(page.getByTestId('draft-feedback')).toHaveAttribute('data-kind', 'restored');
  await expect(page.getByTestId('sequence-card')).toHaveCount(6);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
});

test('失败校准不推进履历：撤销直接回到添加前，空履历点击给就地说明', async ({ page }) => {
  // 装载 480 千克的闭环，+50 后越出 500 上限被整批拒绝
  await page.getByTestId('palette-weight').fill('480');
  await addCycle(page);
  await page.getByTestId('calibration-delta').fill('50');
  await page.getByTestId('apply-calibration').click();
  await expect(page.getByTestId('calibration-feedback')).toHaveAttribute('data-kind', 'error');
  await expect(page.getByTestId('card-weight')).toHaveValue('480');

  // 履历中只有「添加闭环」一步：撤销直接清空序列，
  // 若失败校准也入栈，第一次撤销会停在 6 张卡
  await page.getByTestId('undo-edit').click();
  await expect(page.getByTestId('sequence-card')).toHaveCount(0);
  await expect(page.getByTestId('verdict-banner')).toContainText('尚未加入口令卡');

  // 履历已空：再次撤销保持序列不变并给出就地说明
  await page.getByTestId('undo-edit').click();
  const feedback = page.getByTestId('history-feedback');
  await expect(feedback).toContainText('没有可撤销');
  await expect(feedback).toContainText('序列保持不变');
  await expect(page.getByTestId('sequence-card')).toHaveCount(0);
});

test('走台进行中撤销重做入口随编辑区锁定，走台不推进履历', async ({ page }) => {
  await addCycle(page);
  await page.getByTestId('start-walkthrough').click();

  // 走台进行中：两个入口随编辑区一起锁定
  await expect(page.getByTestId('undo-edit')).toBeDisabled();
  await expect(page.getByTestId('redo-edit')).toBeDisabled();

  // 逐张执行完毕：走台完成，入口恢复
  await executeAll(page, 6);
  await expect(page.getByTestId('walkthrough-result')).toContainText('走台完成');
  await expect(page.getByTestId('undo-edit')).toBeEnabled();
  await expect(page.getByTestId('redo-edit')).toBeEnabled();

  // 走台推进不生成履历：撤销直接回到添加闭环之前（空序列）
  await page.getByTestId('undo-edit').click();
  await expect(page.getByTestId('sequence-card')).toHaveCount(0);
  await page.getByTestId('undo-edit').click();
  await expect(page.getByTestId('history-feedback')).toContainText('没有可撤销');
});

test('刷新后履历为空但草稿内容不受影响', async ({ page }) => {
  await addCycle(page);
  await page.getByTestId('save-draft').click();
  await expect(page.getByTestId('draft-feedback')).toHaveAttribute('data-kind', 'saved');
  await page.getByTestId('add-lock').click();
  await expect(page.getByTestId('sequence-card')).toHaveCount(7);

  await page.reload();
  // 刷新后历史为空：撤销只给就地说明，屏幕序列（空）不变
  await page.getByTestId('undo-edit').click();
  await expect(page.getByTestId('history-feedback')).toContainText('没有可撤销');
  await expect(page.getByTestId('sequence-card')).toHaveCount(0);

  // 草稿槽位不受履历清空影响，仍可恢复
  await page.getByTestId('restore-draft').click();
  await expect(page.getByTestId('draft-feedback')).toHaveAttribute('data-kind', 'restored');
  await expect(page.getByTestId('sequence-card')).toHaveCount(6);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
});
