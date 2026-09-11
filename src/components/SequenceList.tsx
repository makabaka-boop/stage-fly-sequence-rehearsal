import { CARD_DEFS } from '../domain/cards';
import type { ActionCard, StepRecord } from '../domain/types';

interface SequenceListProps {
  cards: ActionCard[];
  steps: StepRecord[];
  dragIndex: number | null;
  onDragStart: (index: number) => void;
  onDragEnd: () => void;
  onDropAt: (index: number) => void;
  onMove: (from: number, to: number) => void;
  onRemove: (id: string) => void;
  onWeightChange: (id: string, weightKg: number | undefined) => void;
}

const STATUS_LABEL: Record<StepRecord['status'], string> = {
  ok: '✓ 通过',
  error: '✗ 首错',
  skipped: '⊘ 跳过',
};

/** 口令序列：HTML5 拖放排序，附带上移/下移/删除与装载重量编辑 */
export function SequenceList({
  cards,
  steps,
  dragIndex,
  onDragStart,
  onDragEnd,
  onDropAt,
  onMove,
  onRemove,
  onWeightChange,
}: SequenceListProps) {
  if (cards.length === 0) {
    return <p className="empty-hint">序列为空——从牌库添加口令卡，或点击「生成标准闭环」。</p>;
  }

  return (
    <ol className="sequence-list" data-testid="sequence-list">
      {cards.map((card, i) => {
        const def = CARD_DEFS[card.type];
        const status = steps[i]?.status;
        return (
          <li
            key={card.id}
            data-testid="sequence-card"
            data-status={status}
            className={[
              'sequence-card',
              status ? `card-${status}` : '',
              dragIndex === i ? 'dragging' : '',
            ].join(' ')}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', String(i));
              onDragStart(i);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              e.preventDefault();
              onDropAt(i);
            }}
            onDragEnd={onDragEnd}
          >
            <span className="drag-handle" title="拖放排序" aria-hidden>
              ⠿
            </span>
            <span className="card-index">#{i + 1}</span>
            <span className="card-title">{def.name}</span>
            {card.type === 'load' && (
              <label className="card-weight">
                <input
                  data-testid="card-weight"
                  type="number"
                  value={card.weightKg ?? ''}
                  placeholder="未填写"
                  onChange={(e) => {
                    const v = e.target.valueAsNumber;
                    onWeightChange(card.id, Number.isNaN(v) ? undefined : v);
                  }}
                />
                <span>千克</span>
              </label>
            )}
            {status && (
              <span className={`status-badge status-${status}`} data-testid="card-status">
                {STATUS_LABEL[status]}
              </span>
            )}
            <span className="card-actions">
              <button
                type="button"
                data-testid="card-up"
                aria-label="上移"
                disabled={i === 0}
                onClick={() => onMove(i, i - 1)}
              >
                ↑
              </button>
              <button
                type="button"
                data-testid="card-down"
                aria-label="下移"
                disabled={i === cards.length - 1}
                onClick={() => onMove(i, i + 1)}
              >
                ↓
              </button>
              <button
                type="button"
                data-testid="card-delete"
                aria-label="删除"
                onClick={() => onRemove(card.id)}
              >
                ✕
              </button>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
