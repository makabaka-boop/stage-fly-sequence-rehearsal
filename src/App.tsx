import { useMemo, useState } from 'react';
import { Palette } from './components/Palette';
import { SequenceList } from './components/SequenceList';
import { StatePanel } from './components/StatePanel';
import { Trajectory } from './components/Trajectory';
import { VerdictBanner } from './components/VerdictBanner';
import { CARD_ORDER } from './domain/cards';
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
  const [cards, setCards] = useState<ActionCard[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  // 结论完全由 cards 派生：任何增删或重排都会改变 cards，
  // 旧结论随之被丢弃并重新裁决，不存在过期结果。
  const verdict = useMemo(() => adjudicate(cards), [cards]);

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
        <Palette
          onAdd={addCard}
          onAddCycle={addCycle}
          onClear={() => setCards([])}
          hasCards={cards.length > 0}
        />
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
