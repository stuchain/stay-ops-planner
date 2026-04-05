import type { CalendarBlockItem } from "./calendarTypes";

type Props = { item: CalendarBlockItem; onEdit?: (item: CalendarBlockItem) => void };

export function BlockChip({ item, onEdit }: Props) {
  return (
    <div className="ops-block-chip" data-testid={`ops-block-chip-${item.id}`}>
      <span className="ops-block-chip-label">Block</span>
      <span>
        {item.startDate} → {item.endDate}
      </span>
      {item.reason && <span className="ops-block-reason">{item.reason}</span>}
      {onEdit && (
        <button type="button" className="ops-btn ops-btn-small" onClick={() => onEdit(item)}>
          Edit
        </button>
      )}
    </div>
  );
}
