import { expect, test, type Page } from '@playwright/test';

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

test('两段标准闭环统一校准：只改重量、保留顺序，并立即重新裁决', async ({ page }) => {
  // 两段标准闭环：各 6 张，装载均为默认 100 千克
  await page.getByTestId('add-cycle').click();
  await page.getByTestId('add-cycle').click();
  await expect(page.getByTestId('sequence-card')).toHaveCount(12);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
  await expect(page.locator('[data-testid="trajectory-step"][data-status="ok"]')).toHaveCount(12);

  // 统一 +50 千克：整批通过，原子替换后立即复算
  await page.getByTestId('calibration-delta').fill('50');
  await page.getByTestId('apply-calibration').click();

  const feedback = page.getByTestId('calibration-feedback');
  await expect(feedback).toHaveAttribute('data-kind', 'applied');
  await expect(feedback).toContainText('+50');
  await expect(feedback).toContainText('校准 2 张装载卡');

  // 两张装载卡重量都变为 150，其余卡片与顺序不变
  await expect(page.getByTestId('card-weight')).toHaveCount(2);
  await expect(page.getByTestId('card-weight').nth(0)).toHaveValue('150');
  await expect(page.getByTestId('card-weight').nth(1)).toHaveValue('150');
  await expect(await cardTitles(page)).toEqual([
    '装载', '锁定', '移动', '归位', '解锁', '卸载',
    '装载', '锁定', '移动', '归位', '解锁', '卸载',
  ]);

  // 重新裁决：轨迹按新重量推演，整套仍闭合
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
  await expect(page.locator('[data-testid="trajectory-step"][data-status="ok"]')).toHaveCount(12);
  await expect(page.getByTestId('trajectory-step').nth(0)).toContainText('#1 装载（150 千克）');
  await expect(page.getByTestId('trajectory-step').nth(0)).toContainText('载重 150 千克');
  await expect(page.getByTestId('trajectory-step').nth(6)).toContainText('#7 装载（150 千克）');
  await expect(page.getByTestId('state-load')).toHaveText('空载');

  // 再次统一 −100 千克：校准可重复应用，结论同步复算
  await page.getByTestId('calibration-delta').fill('-100');
  await page.getByTestId('apply-calibration').click();
  await expect(feedback).toContainText('-100');
  await expect(page.getByTestId('card-weight').nth(0)).toHaveValue('50');
  await expect(page.getByTestId('card-weight').nth(1)).toHaveValue('50');
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
  await expect(page.getByTestId('trajectory-step').nth(0)).toContainText('#1 装载（50 千克）');
});

test('单卡越界整批拒绝：界面继续展示原序列与原结论', async ({ page }) => {
  // 装载 480 千克的标准闭环，+50 后计算为 530，越出 500 上限
  await page.getByTestId('palette-weight').fill('480');
  await page.getByTestId('add-cycle').click();
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');

  await page.getByTestId('calibration-delta').fill('50');
  await page.getByTestId('apply-calibration').click();

  // 整批拒绝：指出首张受影响卡及计算后重量
  const feedback = page.getByTestId('calibration-feedback');
  await expect(feedback).toHaveAttribute('data-kind', 'error');
  await expect(feedback).toContainText('第 1 张「装载」');
  await expect(feedback).toContainText('530');
  await expect(feedback).toContainText('拒绝整批');

  // 原序列与原结论保持不变：重量仍 480，仍闭合，轨迹未变
  await expect(page.getByTestId('card-weight')).toHaveValue('480');
  await expect(page.getByTestId('sequence-card')).toHaveCount(6);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
  await expect(page.getByTestId('trajectory-step').nth(0)).toContainText('#1 装载（480 千克）');
  await expect(page.locator('[data-testid="trajectory-step"][data-status="ok"]')).toHaveCount(6);
});

test('没有装载卡时保持不变并给出说明', async ({ page }) => {
  // 空序列：没有装载卡可校准
  await page.getByTestId('apply-calibration').click();
  const feedback = page.getByTestId('calibration-feedback');
  await expect(feedback).toHaveAttribute('data-kind', 'no-load');
  await expect(feedback).toContainText('没有装载卡');
  await expect(feedback).toContainText('保持不变');
  await expect(page.getByTestId('verdict-banner')).toContainText('尚未加入口令卡');

  // 只有非装载卡的序列：同样不改动任何卡片
  await page.getByTestId('add-lock').click();
  await page.getByTestId('add-move').click();
  await expect(page.getByTestId('verdict-banner')).toContainText('首错');

  await page.getByTestId('calibration-delta').fill('30');
  await page.getByTestId('apply-calibration').click();
  await expect(feedback).toHaveAttribute('data-kind', 'no-load');
  await expect(feedback).toContainText('没有装载卡');
  await expect(page.getByTestId('sequence-card')).toHaveCount(2);
  await expect(await cardTitles(page)).toEqual(['锁定', '移动']);
  // 原结论（首错）保持展示
  await expect(page.getByTestId('verdict-banner')).toContainText('首错');
});

test('走台期间校准入口随牌库锁定，结束后恢复并可正常校准', async ({ page }) => {
  await page.getByTestId('add-cycle').click();
  await page.getByTestId('start-walkthrough').click();

  // 走台进行中：校准输入与按钮随牌库一起锁定
  await expect(page.getByTestId('calibration-delta')).toBeDisabled();
  await expect(page.getByTestId('apply-calibration')).toBeDisabled();

  // 逐张执行完毕：走台完成，校准入口恢复
  await executeAll(page, 6);
  await expect(page.getByTestId('walkthrough-result')).toContainText('走台完成');
  await expect(page.getByTestId('calibration-delta')).toBeEnabled();
  await expect(page.getByTestId('apply-calibration')).toBeEnabled();

  // 恢复后可正常校准并重新裁决
  await page.getByTestId('calibration-delta').fill('25');
  await page.getByTestId('apply-calibration').click();
  await expect(page.getByTestId('calibration-feedback')).toHaveAttribute('data-kind', 'applied');
  await expect(page.getByTestId('card-weight')).toHaveValue('125');
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
});

test('校准完成后继续手工改重：过期的校准反馈立即清除', async ({ page }) => {
  await page.getByTestId('add-cycle').click();
  await page.getByTestId('calibration-delta').fill('50');
  await page.getByTestId('apply-calibration').click();

  const calibrationFeedback = page.getByTestId('calibration-feedback');
  await expect(calibrationFeedback).toHaveAttribute('data-kind', 'applied');
  await expect(page.getByTestId('card-weight')).toHaveValue('150');

  // 手工编辑会产生新的实时裁决结果，上一批校准完成提示不能继续停留
  await page.getByTestId('card-weight').fill('200');
  await expect(calibrationFeedback).toBeHidden();
  await expect(page.getByTestId('card-weight')).toHaveValue('200');
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
});

test('校准完成后恢复另一份草稿：旧序列的校准反馈随草稿替换清除', async ({ page }) => {
  // 先保存一份标准闭环草稿
  await page.getByTestId('add-cycle').click();
  await page.getByTestId('save-draft').click();
  await expect(page.getByTestId('draft-feedback')).toHaveAttribute('data-kind', 'saved');

  // 在当前编排上继续扩展并完成一次批量校准
  await page.getByTestId('add-cycle').click();
  await expect(page.getByTestId('sequence-card')).toHaveCount(12);
  await page.getByTestId('calibration-delta').fill('50');
  await page.getByTestId('apply-calibration').click();

  const calibrationFeedback = page.getByTestId('calibration-feedback');
  await expect(calibrationFeedback).toHaveAttribute('data-kind', 'applied');
  await expect(page.getByTestId('card-weight').nth(0)).toHaveValue('150');
  await expect(page.getByTestId('card-weight').nth(1)).toHaveValue('150');

  // 恢复此前保存的另一份草稿：屏幕序列已替换，旧校准结果提示必须移除
  await page.getByTestId('restore-draft').click();
  await expect(page.getByTestId('sequence-card')).toHaveCount(6);
  await expect(page.getByTestId('card-weight')).toHaveValue('100');
  await expect(calibrationFeedback).toBeHidden();
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
});

test('首错导致补全失败后通过批量校准修复：只展示当前校准成功结果', async ({ page }) => {
  // 装载 600 千克超出重量契约，第一张卡即首错
  await page.getByTestId('palette-weight').fill('600');
  await page.getByTestId('add-cycle').click();
  const verdict = page.getByTestId('verdict-banner');
  await expect(verdict).toContainText('首错');
  await expect(verdict).toContainText('1–500');

  await page.getByTestId('complete-ending').click();
  const completionFeedback = page.getByTestId('completion-feedback');
  await expect(completionFeedback).toHaveAttribute('data-kind', 'error');
  await expect(completionFeedback).toContainText('请先修正该卡');

  // 批量校准把超限重量改回合法范围：旧补全首错提示过期，仅保留校准结果
  await page.getByTestId('calibration-delta').fill('-200');
  await page.getByTestId('apply-calibration').click();
  const calibrationFeedback = page.getByTestId('calibration-feedback');
  await expect(calibrationFeedback).toHaveAttribute('data-kind', 'applied');
  await expect(calibrationFeedback).toContainText('-200');
  await expect(completionFeedback).toBeHidden();
  await expect(page.getByTestId('card-weight')).toHaveValue('400');
  await expect(verdict).toContainText('闭合');
  await expect(verdict).not.toContainText('首错');
});
