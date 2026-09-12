import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DraftControls, type DraftFeedback } from './components/DraftControls';
import { HistoryControls } from './components/HistoryControls';
import { Palette, type CalibrationFeedback, type CompletionFeedback } from './components/Palette';
import { SequenceList } from './components/SequenceList';
import { StatePanel } from './components/StatePanel';
import { Trajectory } from './components/Trajectory';
import { VerdictBanner } from './components/VerdictBanner';
import { WalkthroughPanel } from './components/WalkthroughPanel';
import { planCalibration } from './domain/calibration';
import { CARD_DEFS, CARD_ORDER } from './domain/cards';
import { planCompletion } from './domain/completion';
import { readStoredDraft, saveDraft, type DraftMeta } from './domain/draft';
import {
  canRedo,
  canUndo,
  commitEdit,
  emptyHistory,
  redoEdit,
  undoEdit,
  type EditHistory,
} from './domain/history';
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
  // 载重校准的短暂反馈（已应用 / 无装载卡 / 整批拒绝）
  const [calibrationFeedback, setCalibrationFeedback] = useState<CalibrationFeedback | null>(null);
  // 走台会话：待命 / 进行中 / 完成 / 受阻，由纯函数推进，刷新即回到待命
  const [session, setSession] = useState<WalkSession>(() => idleSession());
  const [sessionFeedback, setSessionFeedback] = useState<string | null>(null);
  // 编辑履历：仅限本次页面会话，纯函数维护最多二十步过去/未来记录，刷新即为空
  const [history, setHistory] = useState<EditHistory>(() => emptyHistory());
  // 撤销/重做不可用时的就地说明（短暂状态）
  const [historyFeedback, setHistoryFeedback] = useState<string | null>(null);

  // 事件处理器外读取最新序列与履历用的引用（避免 setState 更新函数内的副作用）
  const cardsRef = useRef(cards);
  const historyRef = useRef(history);
  useEffect(() => {
    cardsRef.current = cards;
    historyRef.current = history;
  }, [cards, history]);

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
  const clearCalibrationFeedback = useCallback(() => setCalibrationFeedback(null), []);
  const clearSequenceFeedback = useCallback(() => {
    setCompletionFeedback(null);
    setCalibrationFeedback(null);
  }, []);

  // 所有成功编辑（增删、改重、拖放、补全、校准、草稿恢复）的统一入口：
  // 以完整序列作为事务载荷提交履历；失败路径不经过这里，无变化时纯函数原样返回。
  const changeCards = useCallback(
    (updater: (prev: ActionCard[]) => ActionCard[]) => {
      const prev = cardsRef.current;
      const next = updater(prev);
      setHistory((h) => commitEdit(h, prev, next));
      setCards(next);
      clearSequenceFeedback();
      setHistoryFeedback(null);
    },
    [clearSequenceFeedback],
  );

  // 撤销/重做：原子替换整套卡组，cards 变化立即走现有裁决链复算；
  // 只改写屏幕序列，不触碰本地草稿槽位。无记录时保持序列不变并就地说明。
  const handleUndo = useCallback(() => {
    const result = undoEdit(historyRef.current, cardsRef.current);
    if (!result) {
      setHistoryFeedback('没有可撤销的编辑：本次会话尚未记录成功改动，序列保持不变。');
      return;
    }
    setHistory(result.history);
    setCards(result.cards);
    setDragIndex(null);
    clearSequenceFeedback();
    setHistoryFeedback(null);
  }, [clearSequenceFeedback]);

  const handleRedo = useCallback(() => {
    const result = redoEdit(historyRef.current, cardsRef.current);
    if (!result) {
      setHistoryFeedback('没有可重做的编辑：请先撤销，或继续新的编辑，序列保持不变。');
      return;
    }
    setHistory(result.history);
    setCards(result.cards);
    setDragIndex(null);
    clearSequenceFeedback();
    setHistoryFeedback(null);
  }, [clearSequenceFeedback]);

  const clearHistoryFeedback = useCallback(() => setHistoryFeedback(null), []);

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
    const restoredCards = result.draft.cards;
    // 原子替换整套序列：单次 state 更新后立即走现有裁决链。
    changeCards(() => restoredCards);
    setDragIndex(null);
    setDraftMeta({ savedAt: result.draft.savedAt, cardCount: restoredCards.length });
    setStorageCorrupt(false);
    setFeedback({
      kind: 'restored',
      text: `已恢复 ${restoredCards.length} 张口令卡并重新裁决。`,
    });
  }, [changeCards]);

  // 补全收尾：领域纯函数读取当前裁决终态，确定性生成回到空载归位的最短安全收尾，
  // 一次性追加带新标识的动作卡；cards 变化后立即走原有裁决链复算。
  const handleCompleteEnding = useCallback(() => {
    // 补全操作产生当前反馈后，上一轮载重校准反馈立即过期。
    setCalibrationFeedback(null);
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
    changeCards((prev) => [...prev, ...suffix.map((type) => makeCard(type))]);
    setCompletionFeedback({
      kind: 'appended',
      text: `已按当前推演状态追加 ${suffix.length} 张收尾卡：${names}，序列已重新裁决。`,
    });
  }, [changeCards, verdict]);

  // 载重校准：领域纯函数基于当前序列生成候选卡组，只改装载重量并保留卡片标识
  // 与顺序；整批通过后通过 changeCards 原子替换，cards 变化立即走现有裁决链复算。
  // 任一结果越界（或没有装载卡）时不触碰 cards，界面继续展示原序列与原结论。
  const handleCalibrate = useCallback(
    (deltaKg: number) => {
      // 校准操作产生当前反馈后，上一轮补全收尾反馈立即过期。
      setCompletionFeedback(null);
      const result = planCalibration(cards, deltaKg);
      if (!result.ok) {
        switch (result.kind) {
          case 'invalid-delta':
            setCalibrationFeedback({
              kind: 'error',
              text: '校准差额须为整数千克（可正可负），未改动任何卡片。',
            });
            return;
          case 'no-load-cards':
            setCalibrationFeedback({
              kind: 'no-load',
              text: '当前序列没有装载卡，无需载重校准；序列与裁决结论保持不变。',
            });
            return;
          case 'missing-weight':
            setCalibrationFeedback({
              kind: 'error',
              text: `第 ${result.index + 1} 张「装载」未填写重量，无法计算校准结果；已拒绝整批校准，序列与裁决结论保持不变。`,
            });
            return;
          case 'out-of-range':
            setCalibrationFeedback({
              kind: 'error',
              text: `第 ${result.index + 1} 张「装载」校准后为 ${result.computedWeightKg} 千克，越出 1–500 千克边界；已拒绝整批校准，序列与裁决结论保持不变。`,
            });
            return;
        }
      }
      // 整批通过：原子替换整套序列，立即交给现有裁决链复算
      changeCards(() => result.cards);
      setDragIndex(null);
      const signed = deltaKg > 0 ? `+${deltaKg}` : String(deltaKg);
      setCalibrationFeedback({
        kind: 'applied',
        text: `已按统一差额 ${signed} 千克校准 ${result.adjustedCount} 张装载卡，卡片标识与顺序不变，序列已重新裁决。`,
      });
    },
    [cards, changeCards],
  );

  const addCard = (type: CardType, weightKg?: number) =>
    changeCards((prev) => [...prev, makeCard(type, weightKg)]);

  const addCycle = (weightKg?: number) =>
    changeCards((prev) => [
      ...prev,
      ...CARD_ORDER.map((type) => makeCard(type, type === 'load' ? weightKg : undefined)),
    ]);

  const removeCard = (id: string) => changeCards((prev) => prev.filter((c) => c.id !== id));

  const updateWeight = (id: string, weightKg: number | undefined) =>
    changeCards((prev) => prev.map((c) => (c.id === id ? { ...c, weightKg } : c)));

  const moveCard = (from: number, to: number) =>
    changeCards((prev) => {
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
            onClear={() => changeCards(() => [])}
            onComplete={handleCompleteEnding}
            completionFeedback={completionFeedback}
            onCompletionFeedbackDone={clearCompletionFeedback}
            onCalibrate={handleCalibrate}
            calibrationFeedback={calibrationFeedback}
            onCalibrationFeedbackDone={clearCalibrationFeedback}
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
          <HistoryControls
            canUndo={canUndo(history)}
            canRedo={canRedo(history)}
            feedback={historyFeedback}
            disabled={sessionRunning}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onFeedbackDone={clearHistoryFeedback}
          />
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
