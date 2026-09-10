import { expect, test, type Page } from '@playwright/test';

const CARD = '[data-testid="sequence-card"]';

async function addCycle(page: Page) {
  await page.getByTestId('add-cycle').click();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('完整闭环：裁决闭合回到空载归位', async ({ page }) => {
  await page.getByTestId('add-load').click();
  await page.getByTestId('add-lock').click();
  await page.getByTestId('add-move').click();
  await page.getByTestId('add-return').click();
  await page.getByTestId('add-unlock').click();
  await page.getByTestId('add-unload').click();

  const banner = page.getByTestId('verdict-banner');
  await expect(banner).toContainText('闭合');
  await expect(banner).toContainText('空载归位');

  await expect(page.getByTestId('state-load')).toHaveText('空载');
  await expect(page.getByTestId('state-position')).toHaveText('归位');
  await expect(page.getByTestId('state-lock')).toHaveText('未锁定');

  await expect(page.getByTestId('trajectory-step')).toHaveCount(6);
  await expect(page.locator('[data-testid="trajectory-step"][data-status="error"]')).toHaveCount(0);
});

test('拖放重排后复算：首错定位到「未锁定先移动」，再拖回后恢复闭合', async ({ page }) => {
  await addCycle(page);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');

  const cards = page.getByTestId('sequence-card');
  await expect(cards).toHaveCount(6);
  // 初始顺序：装载 锁定 移动 归位 解锁 卸载
  await expect(cards.nth(1)).toContainText('锁定');
  await expect(cards.nth(2)).toContainText('移动');

  // 把「移动」拖到「锁定」的位置（即锁定之前）
  await page.dragAndDrop(`${CARD} >> nth=2`, `${CARD} >> nth=1`);

  // 新顺序：装载 移动 锁定 归位 解锁 卸载
  await expect(cards.nth(1)).toContainText('移动');
  await expect(cards.nth(2)).toContainText('锁定');

  // 重排后旧结论被清除并重新裁决：首错为第 2 张「移动」
  const banner = page.getByTestId('verdict-banner');
  await expect(banner).toContainText('首错');
  await expect(banner).toContainText('第 2 张「移动」');
  await expect(banner).toContainText('未锁定先移动');

  // 首错发生时的吊杆状态：载重 100 千克 · 归位 · 未锁定
  await expect(page.getByTestId('state-load')).toHaveText('100 千克');
  await expect(page.getByTestId('state-position')).toHaveText('归位');
  await expect(page.getByTestId('state-lock')).toHaveText('未锁定');

  // 首错即停：后续 4 张卡被跳过，不再改变状态
  await expect(page.locator(`[data-testid="trajectory-step"][data-status="ok"]`)).toHaveCount(1);
  await expect(page.locator(`[data-testid="trajectory-step"][data-status="error"]`)).toHaveCount(1);
  await expect(page.locator(`[data-testid="trajectory-step"][data-status="skipped"]`)).toHaveCount(4);
  await expect(cards.nth(1)).toHaveAttribute('data-status', 'error');

  // 再拖回「锁定」之后 → 重新裁决恢复闭合
  await page.dragAndDrop(`${CARD} >> nth=1`, `${CARD} >> nth=2`);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');
  await expect(page.getByTestId('state-load')).toHaveText('空载');
});

test('修改装载重量触发复算：非法重量被定位为首错', async ({ page }) => {
  await addCycle(page);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');

  const weight = cards0(page).getByTestId('card-weight');
  await weight.fill('600');
  const banner = page.getByTestId('verdict-banner');
  await expect(banner).toContainText('首错');
  await expect(banner).toContainText('第 1 张「装载」');
  await expect(banner).toContainText('1–500 千克的整数');

  await weight.fill('250');
  await expect(banner).toContainText('闭合');
});

test('删除卡片后立即清除旧结论并重新裁决', async ({ page }) => {
  await addCycle(page);
  await expect(page.getByTestId('verdict-banner')).toContainText('闭合');

  // 删除「装载」后，第一张「锁定」即为首错（空载不能锁定）
  await page.getByTestId('sequence-card').first().getByTestId('card-delete').click();
  const banner = page.getByTestId('verdict-banner');
  await expect(banner).toContainText('首错');
  await expect(banner).toContainText('第 1 张「锁定」');
  await expect(banner).toContainText('空载');
  await expect(page.getByTestId('sequence-card')).toHaveCount(5);
});

test('装载后直接卸载不闭合：判为首错，拖入锁定与解锁后恢复闭合', async ({ page }) => {
  await page.getByTestId('add-load').click();
  await page.getByTestId('add-unload').click();

  // 装载后直接卸载：首错，必须锁定再解锁
  const banner = page.getByTestId('verdict-banner');
  await expect(banner).toContainText('首错');
  await expect(banner).toContainText('第 2 张「卸载」');
  await expect(banner).toContainText('先锁定再解锁');
  await expect(banner).not.toContainText('闭合');
  await expect(page.getByTestId('state-load')).toHaveText('100 千克');

  // 追加锁定、解锁，再把「卸载」拖到末尾 → 装载 锁定 解锁 卸载，恢复闭合
  await page.getByTestId('add-lock').click();
  await page.getByTestId('add-unlock').click();
  await page.dragAndDrop(`${CARD} >> nth=1`, `${CARD} >> nth=3`);

  const cards = page.getByTestId('sequence-card');
  await expect(cards.nth(0)).toContainText('装载');
  await expect(cards.nth(1)).toContainText('锁定');
  await expect(cards.nth(2)).toContainText('解锁');
  await expect(cards.nth(3)).toContainText('卸载');
  await expect(banner).toContainText('闭合');
  await expect(page.getByTestId('state-load')).toHaveText('空载');
});

function cards0(page: Page) {
  return page.getByTestId('sequence-card').nth(0);
}
