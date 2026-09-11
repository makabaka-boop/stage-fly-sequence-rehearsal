import { expect, test, type Page } from '@playwright/test';

async function addCycle(page: Page) {
  await page.getByTestId('add-cycle').click();
}

async function executeAll(page: Page, count: number) {
  for (let i = 0; i < count; i += 1) {
    await page.getByTestId('execute-next').click();
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('标准闭环逐张完成：操作者只看到当前口令、吊杆状态与剩余张数', async ({ page }) => {
  await addCycle(page);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');

  await page.getByTestId('start-walkthrough').click();

  // 走台进行中：整套口令序列收起，整条轨迹、实时结论与状态面板也不再展示
  await expect(page.getByTestId('sequence-card')).toHaveCount(0);
  await expect(page.getByTestId('sequence-locked-hint')).toBeVisible();
  await expect(page.getByTestId('trajectory')).toHaveCount(0);
  await expect(page.getByTestId('verdict-banner')).toHaveCount(0);
  await expect(page.getByTestId('state-panel')).toHaveCount(0);

  const current = page.getByTestId('walkthrough-current');
  const state = page.getByTestId('walkthrough-state');
  const progress = page.getByTestId('walkthrough-progress');

  // 会话快照从初始状态开始：当前口令为第 1 张，剩余 6 张
  await expect(current).toContainText('#1 装载（100 千克）');
  await expect(state).toContainText('空载 · 归位 · 未锁定');
  await expect(progress).toContainText('已执行 0 / 共 6 张 · 剩余 6 张');

  // 逐张报令：每次执行后推进到下一口令并更新吊杆状态
  const steps: Array<[string, string]> = [
    ['#2 锁定', '载重 100 千克 · 归位 · 未锁定'],
    ['#3 移动', '载重 100 千克 · 归位 · 已锁定'],
    ['#4 归位', '载重 100 千克 · 舞台位 · 已锁定'],
    ['#5 解锁', '载重 100 千克 · 归位 · 已锁定'],
    ['#6 卸载', '载重 100 千克 · 归位 · 已解锁'],
  ];
  for (const [command, rig] of steps) {
    await page.getByTestId('execute-next').click();
    await expect(current).toContainText(command);
    await expect(state).toContainText(rig);
  }
  await expect(progress).toContainText('已执行 5 / 共 6 张 · 剩余 1 张');

  // 末张执行后合法闭合：走台完成，吊杆回到空载归位
  await page.getByTestId('execute-next').click();
  await expect(page.getByTestId('walkthrough-result')).toContainText('走台完成');
  await expect(page.getByTestId('walkthrough-result')).toContainText('6 张口令全部执行');
  await expect(state).toContainText('空载归位');

  // 末张幂等：重复点击不会越过末张
  await page.getByTestId('execute-next').click();
  await expect(page.getByTestId('walkthrough-result')).toContainText('走台完成');
  await expect(state).toContainText('空载归位');
});

test('非法序列在对应卡受阻：停在执行前状态，后续状态不变', async ({ page }) => {
  await page.getByTestId('add-load').click();
  await page.getByTestId('add-move').click();
  await page.getByTestId('add-unlock').click();
  await page.getByTestId('add-unload').click();

  await page.getByTestId('start-walkthrough').click();
  await expect(page.getByTestId('walkthrough-current')).toContainText('#1 装载（100 千克）');

  // 第 1 张装载合法通过
  await page.getByTestId('execute-next').click();
  await expect(page.getByTestId('walkthrough-current')).toContainText('#2 移动');
  await expect(page.getByTestId('walkthrough-state')).toContainText('载重 100 千克 · 归位 · 未锁定');

  // 第 2 张「移动」非法：受阻并停在执行前状态，给出卡号与原因
  await page.getByTestId('execute-next').click();
  const result = page.getByTestId('walkthrough-result');
  await expect(result).toContainText('走台受阻');
  await expect(result).toContainText('第 2 张「移动」');
  await expect(page.getByTestId('walkthrough-reason')).toContainText('未锁定先移动');
  await expect(page.getByTestId('walkthrough-state')).toContainText(
    '停在执行前状态：载重 100 千克 · 归位 · 未锁定',
  );
  await expect(page.getByTestId('walkthrough-progress')).toContainText(
    '已执行 1 / 共 4 张 · 剩余 3 张未执行',
  );

  // 重复点击不会越过受阻卡：状态与进度保持不变
  await page.getByTestId('execute-next').click();
  await expect(result).toContainText('第 2 张「移动」');
  await expect(page.getByTestId('walkthrough-state')).toContainText('载重 100 千克 · 归位 · 未锁定');
  await expect(page.getByTestId('walkthrough-progress')).toContainText('剩余 3 张未执行');

  // 受阻后恢复编辑：清空重来，新的走台可以完成
  await expect(page.getByTestId('clear-all')).toBeEnabled();
  await page.getByTestId('clear-all').click();
  await addCycle(page);
  await page.getByTestId('start-walkthrough').click();
  await executeAll(page, 6);
  await expect(page.getByTestId('walkthrough-result')).toContainText('走台完成');
});

test('未闭合序列不显示走台完成：全部执行后提示未闭合，可整理后重走', async ({ page }) => {
  await page.getByTestId('add-load').click();
  await page.getByTestId('add-lock').click();

  await page.getByTestId('start-walkthrough').click();
  await page.getByTestId('execute-next').click();
  await expect(page.getByTestId('walkthrough-current')).toContainText('#2 锁定');

  // 末张执行完毕但未回到空载归位：未闭合，而非走台完成
  await page.getByTestId('execute-next').click();
  const result = page.getByTestId('walkthrough-result');
  await expect(result).toContainText('走台未闭合');
  await expect(result).not.toContainText('走台完成');
  await expect(page.getByTestId('walkthrough-state')).toContainText('载重 100 千克 · 归位 · 已锁定');

  // 未闭合也是终态：重复点击不再推进，序列与编辑入口恢复
  await page.getByTestId('execute-next').click();
  await expect(result).toContainText('走台未闭合');
  await expect(page.getByTestId('sequence-card')).toHaveCount(2);
  await expect(page.getByTestId('add-unlock')).toBeEnabled();

  // 整理为闭合序列后重新走台可以完成
  await page.getByTestId('add-unlock').click();
  await page.getByTestId('add-unload').click();
  await page.getByTestId('start-walkthrough').click();
  await executeAll(page, 4);
  await expect(page.getByTestId('walkthrough-result')).toContainText('走台完成');
});

test('走台进行中锁定编辑入口，完成后重新可用', async ({ page }) => {
  await addCycle(page);
  await page.getByTestId('start-walkthrough').click();

  // 整套口令序列收起：排序、重量、删除入口不复存在
  await expect(page.getByTestId('sequence-card')).toHaveCount(0);
  await expect(page.getByTestId('card-weight')).toHaveCount(0);
  await expect(page.getByTestId('card-delete')).toHaveCount(0);
  await expect(page.getByTestId('sequence-locked-hint')).toBeVisible();

  // 牌库与草稿操作锁定
  await expect(page.getByTestId('add-load')).toBeDisabled();
  await expect(page.getByTestId('add-cycle')).toBeDisabled();
  await expect(page.getByTestId('complete-ending')).toBeDisabled();
  await expect(page.getByTestId('clear-all')).toBeDisabled();
  await expect(page.getByTestId('palette-weight')).toBeDisabled();
  await expect(page.getByTestId('save-draft')).toBeDisabled();
  await expect(page.getByTestId('restore-draft')).toBeDisabled();

  // 执行完全部 6 张 → 走台完成
  await executeAll(page, 6);
  await expect(page.getByTestId('walkthrough-result')).toContainText('走台完成');

  // 结束后序列与编辑入口恢复，实时裁决视图同步恢复
  await expect(page.getByTestId('sequence-card')).toHaveCount(6);
  await expect(page.getByTestId('sequence-card').first()).toHaveAttribute('draggable', 'true');
  await expect(page.getByTestId('card-delete').first()).toBeEnabled();
  await expect(page.getByTestId('card-weight').first()).toBeEnabled();
  await expect(page.getByTestId('add-load')).toBeEnabled();
  await expect(page.getByTestId('add-cycle')).toBeEnabled();
  await expect(page.getByTestId('complete-ending')).toBeEnabled();
  await expect(page.getByTestId('clear-all')).toBeEnabled();
  await expect(page.getByTestId('palette-weight')).toBeEnabled();
  await expect(page.getByTestId('save-draft')).toBeEnabled();
  await expect(page.getByTestId('restore-draft')).toBeEnabled();
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
  await expect(page.getByTestId('trajectory-step')).toHaveCount(6);
});

test('空序列点击开始走台：留在待命并显示可理解的反馈', async ({ page }) => {
  await page.getByTestId('start-walkthrough').click();
  await expect(page.getByTestId('walkthrough-feedback')).toContainText('序列为空');
  // 仍在待命：没有进入执行视图，开始按钮仍在
  await expect(page.getByTestId('execute-next')).toHaveCount(0);
  await expect(page.getByTestId('start-walkthrough')).toBeVisible();

  // 添加卡片后反馈清除，可正常开始走台
  await addCycle(page);
  await expect(page.getByTestId('walkthrough-feedback')).toHaveCount(0);
  await page.getByTestId('start-walkthrough').click();
  await expect(page.getByTestId('walkthrough-current')).toContainText('#1 装载');
});

test('刷新后走台会话不保留：仍按现有空序列启动', async ({ page }) => {
  await addCycle(page);
  await page.getByTestId('start-walkthrough').click();
  await page.getByTestId('execute-next').click();
  await expect(page.getByTestId('walkthrough-current')).toContainText('#2 锁定');

  // 刷新：会话不持久化，回到待命，序列仍为空
  await page.reload();
  await expect(page.getByTestId('sequence-card')).toHaveCount(0);
  await expect(page.getByTestId('start-walkthrough')).toBeVisible();
  await expect(page.getByTestId('execute-next')).toHaveCount(0);
  await expect(page.getByTestId('verdict-banner')).toContainText('尚未加入口令卡');
});
