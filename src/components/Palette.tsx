import { useState } from 'react';
import { CARD_DEFS, CARD_ORDER } from '../domain/cards';
import type { CardType } from '../domain/types';

interface PaletteProps {
  onAdd: (type: CardType, weightKg?: number) => void;
  onAddCycle: (weightKg?: number) => void;
  onClear: () => void;
  hasCards: boolean;
}

/** 左侧牌库：添加单卡、生成标准闭环、清空 */
export function Palette({ onAdd, onAddCycle, onClear, hasCards }: PaletteProps) {
  const [weightText, setWeightText] = useState('100');
  const parsed = Number(weightText);
  const weight = weightText.trim() === '' || !Number.isFinite(parsed) ? undefined : parsed;

  return (
    <section className="panel palette" aria-label="口令卡牌库">
      <h2>牌库</h2>
      <label className="weight-field">
        装载重量（千克）
        <input
          data-testid="palette-weight"
          type="number"
          value={weightText}
          onChange={(e) => setWeightText(e.target.value)}
          placeholder="1–500 的整数"
        />
      </label>
      <div className="palette-buttons">
        {CARD_ORDER.map((type) => {
          const def = CARD_DEFS[type];
          return (
            <button
              key={type}
              type="button"
              data-testid={`add-${type}`}
              className="palette-btn"
              title={def.hint}
              onClick={() => onAdd(type, type === 'load' ? weight : undefined)}
            >
              <strong>＋ {def.name}</strong>
              <small>{def.hint}</small>
            </button>
          );
        })}
      </div>
      <div className="palette-actions">
        <button type="button" data-testid="add-cycle" onClick={() => onAddCycle(weight)}>
          生成标准闭环
        </button>
        <button type="button" data-testid="clear-all" onClick={onClear} disabled={!hasCards}>
          清空
        </button>
      </div>
    </section>
  );
}
