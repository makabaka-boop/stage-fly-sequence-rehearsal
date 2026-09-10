import { useCallback, useEffect, useMemo, useState } from 'react';
import { DraftControls, type DraftFeedback } from './components/DraftControls';
import { Palette } from './components/Palette';
import { SequenceList } from './components/SequenceList';
import { StatePanel } from './components/StatePanel';
import { Trajectory } from './components/Trajectory';
import { VerdictBanner } from './components/VerdictBanner';
import { CARD_ORDER } from './domain/cards';
import { readStoredDraft, saveDraft, type DraftMeta } from './domain/draft';
import { adjudicate } from './domain/machine';
import type { ActionCard, CardType } from './domain/types';

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `card-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const makeCard = (type: CardType, weightKg?: number): ActionCard => ({
  id: newId(),
  type,
  ...(type === 'load' ? { weightKg } : {}),
});

export default function App() {
  // 空草稿启动：初始序列始终为空；草稿只存在浏览器存储中，刷新不会自动覆盖屏幕。
  const [cards, setCards] = useState<ActionCard[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [draftMeta, setDraftMeta] = useState<DraftMeta | null>(null);
  const [storageCorrupt, setStorageCorrupt] = useState(false);
  const [feedback, setFeedback] = useState<DraftFeedback | null>(null);

  // 启动时仅探测草稿槽位是否可恢复：任何存储异常都在操作区说明，不能穿透到页面。
  useEffect(() => {
    const result = readStoredDraft();
    if (result.ok) {
      if (result.draft) {
        setDraftMeta({ savedAt: result.draft.savedAt, cardCount: result.draft.cards.length });
      }
    } else {
      setStorageCorrupt(true);
    }
  }, []);

  const clearFeedback = useCallback(() => setFeedback(null), []);

  // 结论完全由 cards 派生：任何增删、重排或草稿恢复都会改变 cards，
  // 旧结论随之被丢弃并重新裁决，不存在过期结果。
  const verdict = useMemo(() => adjudicate(cards), [cards]);

  const handleSaveDraft = useCallback(() => {
    const result = saveDraft(cards);
    if (result.ok) {
      setDraftMeta(result.meta);
      setStorageCorrupt(false);
      setFeedback({
        kind: 'saved',
        text: `已保存 ${result.meta.cardCount} 张口令卡，可随时恢复或刷新后找回。`,
      });
    } else {
      setFeedback({ kind: 'error', text: result.reason });
    }
  }, [cards]);

  const handleRestoreDraft = useCallback(() => {
    // 恢复时重新读取并逐卡校验：损坏/不兼容时保留屏幕上的当前序列。
    const result = readStoredDraft();
    if (!result.ok) {
      // 槽位内容不可恢复：旧摘要已失效，损坏警告出现时不再展示原保存时间与卡数。
      setDraftMeta(null);
      setStorageCorrupt(true);
      setFeedback({ kind: 'error', text: `无法恢复草稿：${result.reason}，当前序列保持不变。` });
      return;
    }
    if (!result.draft) {
      // 槽位已空：摘要回到「尚无已保存草稿」，并同步清除可能残留的损坏警告。
      setDraftMeta(null);
      setStorageCorrupt(false);
      setFeedback({ kind: 'error', text: '没有可恢复的草稿，当前序列保持不变。' });
      return;
    }
    // 原子替换整套序列：单次 state 更新后立即走现有裁决链。
    setCards(result.draft.cards);
    setDragIndex(null);
    setDraftMeta({ savedAt: result.draft.savedAt, cardCount: result.draft.cards.length });
    setStorageCorrupt(false);
    setFeedback({
      kind: 'restored',
      text: `已恢复 ${result.draft.cards.length} 张口令卡并重新裁决。`,
    });
  }, []);

  const addCard = (type: CardType, weightKg?: number) =>
    setCards((prev) => [...prev, makeCard(type, weightKg)]);

  const addCycle = (weightKg?: number) =>
    setCards((prev) => [
      ...prev,
      ...CARD_ORDER.map((type) => makeCard(type, type === 'load' ? weightKg : undefined)),
    ]);

  const removeCard = (id: string) => setCards((prev) => prev.filter((c) => c.id !== id));

  const updateWeight = (id: string, weightKg: number | undefined) =>
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, weightKg } : c)));

  const moveCard = (from: number, to: number) =>
    setCards((prev) => {
      if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });

  const dropAt = (index: number) => {
    if (dragIndex !== null && dragIndex !== index) moveCard(dragIndex, index);
    setDragIndex(null);
  };

  const stateLabel =
    verdict.firstErrorIndex !== null
      ? `首错发生时的吊杆状态（第 ${verdict.firstErrorIndex + 1} 张执行前）`
      : '推演结束时的吊杆状态';

  return (
    <div className="app">
      <header className="app-header">
        <h1>吊杆口令预演台</h1>
        <p>
          初始状态为空载且归位。拖放排序口令卡后实时裁决：遇到第一张非法卡即停止，
          任何增删或重排都会清除旧结论并重新推演。
        </p>
      </header>
      <main className="layout">
        <div className="palette-column">
          <Palette
            onAdd={addCard}
            onAddCycle={addCycle}
            onClear={() => setCards([])}
            hasCards={cards.length > 0}
          />
          <DraftControls
            meta={draftMeta}
            storageCorrupt={storageCorrupt}
            feedback={feedback}
            onSave={handleSaveDraft}
            onRestore={handleRestoreDraft}
            onFeedbackDone={clearFeedback}
          />
        </div>
        <section className="panel sequence-panel" aria-label="口令序列">
          <h2>口令序列（可拖放排序）</h2>
          <SequenceList
            cards={cards}
            steps={verdict.steps}
            dragIndex={dragIndex}
            onDragStart={setDragIndex}
            onDragEnd={() => setDragIndex(null)}
            onDropAt={dropAt}
            onMove={moveCard}
            onRemove={removeCard}
            onWeightChange={updateWeight}
          />
        </section>
        <aside className="side">
          <VerdictBanner verdict={verdict} cardCount={cards.length} />
          <StatePanel state={verdict.finalState} label={stateLabel} />
        </aside>
      </main>
      <Trajectory steps={verdict.steps} />
    </div>
  );
}
