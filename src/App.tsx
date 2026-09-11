import { useCallback, useEffect, useMemo, useState } from 'react';
import { DraftControls, type DraftFeedback } from './components/DraftControls';
import { Palette, type CompletionFeedback } from './components/Palette';
import { SequenceList } from './components/SequenceList';
import { StatePanel } from './components/StatePanel';
import { Trajectory } from './components/Trajectory';
import { VerdictBanner } from './components/VerdictBanner';
import { WalkthroughPanel } from './components/WalkthroughPanel';
import { CARD_DEFS, CARD_ORDER } from './domain/cards';
import { planCompletion } from './domain/completion';
import { readStoredDraft, saveDraft, type DraftMeta } from './domain/draft';
import { adjudicate } from './domain/machine';
import { executeNext, idleSession, startSession, type WalkSession } from './domain/session';
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
  // 补全收尾的短暂反馈（已追加 / 无需补全 / 存在首错）
  const [completionFeedback, setCompletionFeedback] = useState<CompletionFeedback | null>(null);
  // 走台会话：待命 / 进行中 / 完成 / 受阻，由纯函数推进，刷新即回到待命
  const [session, setSession] = useState<WalkSession>(() => idleSession());
  const [sessionFeedback, setSessionFeedback] = useState<string | null>(null);

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
  const clearCompletionFeedback = useCallback(() => setCompletionFeedback(null), []);

  // 结论完全由 cards 派生：任何增删、重排或草稿恢复都会改变 cards，
  // 旧结论随之被丢弃并重新裁决，不存在过期结果。
  const verdict = useMemo(() => adjudicate(cards), [cards]);

  // 走台进行中：锁定牌库、排序、重量、删除与草稿操作，结束或受阻后恢复编辑
  const sessionRunning = session.status === 'running';

  // 序列一旦变化（如空序列反馈后添加了卡），过期的走台反馈即清除
  useEffect(() => setSessionFeedback(null), [cards]);

  const handleStartSession = useCallback(() => {
    if (cards.length === 0) {
      // 空序列无法开始：留在待命并给出可理解的反馈
      setSession(idleSession());
      setSessionFeedback('序列为空，无法开始走台：请先从牌库添加口令卡，或点击「生成标准闭环」。');
      return;
    }
    setSessionFeedback(null);
    // 复制当时的卡序与重量作为会话快照，会话期间不随牌面编辑变化
    setSession(startSession(cards));
  }, [cards]);

  // 每次点击都通过现有单卡裁决推进游标；非进行中时纯函数原样返回，不会越过末张或受阻卡
  const handleExecuteNext = useCallback(() => {
    setSession((prev) => executeNext(prev));
  }, []);

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

  // 补全收尾：领域纯函数读取当前裁决终态，确定性生成回到空载归位的最短安全收尾，
  // 一次性追加带新标识的动作卡；cards 变化后立即走原有裁决链复算。
  const handleCompleteEnding = useCallback(() => {
    if (verdict.firstErrorIndex !== null) {
      // 已有首错：保持卡序不变，在牌库操作区说明应先修正对应卡
      const step = verdict.steps[verdict.firstErrorIndex];
      const name = CARD_DEFS[step.card.type].name;
      setCompletionFeedback({
        kind: 'error',
        text: `当前序列存在首错（第 ${verdict.firstErrorIndex + 1} 张「${name}」）：请先修正该卡，再补全收尾；卡序保持不变。`,
      });
      return;
    }
    if (verdict.closed) {
      // 已闭合序列不产生新卡
      setCompletionFeedback({
        kind: 'closed',
        text: '整套口令已闭合，吊杆已回到空载归位，无需补全收尾，未追加新卡。',
      });
      return;
    }
    const suffix = planCompletion(verdict.finalState);
    if (suffix.length === 0) {
      // 空序列：吊杆本就在空载归位，没有需要补全的半途状态
      setCompletionFeedback({
        kind: 'closed',
        text: '序列为空，无需补全：请先从牌库添加口令卡，或点击「生成标准闭环」。',
      });
      return;
    }
    const names = suffix.map((type) => CARD_DEFS[type].name).join(' → ');
    setCards((prev) => [...prev, ...suffix.map((type) => makeCard(type))]);
    setCompletionFeedback({
      kind: 'appended',
      text: `已按当前推演状态追加 ${suffix.length} 张收尾卡：${names}，序列已重新裁决。`,
    });
  }, [verdict]);

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
            onComplete={handleCompleteEnding}
            completionFeedback={completionFeedback}
            onCompletionFeedbackDone={clearCompletionFeedback}
            hasCards={cards.length > 0}
            disabled={sessionRunning}
          />
          <DraftControls
            meta={draftMeta}
            storageCorrupt={storageCorrupt}
            feedback={feedback}
            disabled={sessionRunning}
            onSave={handleSaveDraft}
            onRestore={handleRestoreDraft}
            onFeedbackDone={clearFeedback}
          />
        </div>
        <section className="panel sequence-panel" aria-label="口令序列">
          <h2>{sessionRunning ? '口令序列（走台中已收起）' : '口令序列（可拖放排序）'}</h2>
          {sessionRunning ? (
            <p className="empty-hint" data-testid="sequence-locked-hint">
              走台进行中：整套口令序列已收起，操作者只按走台面板的当前口令逐张执行。
            </p>
          ) : (
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
          )}
        </section>
        <aside className="side">
          <WalkthroughPanel
            session={session}
            feedback={sessionFeedback}
            onStart={handleStartSession}
            onExecuteNext={handleExecuteNext}
          />
          {!sessionRunning && (
            <>
              <VerdictBanner verdict={verdict} cardCount={cards.length} />
              <StatePanel state={verdict.finalState} label={stateLabel} />
            </>
          )}
        </aside>
      </main>
      {!sessionRunning && <Trajectory steps={verdict.steps} />}
    </div>
  );
}
