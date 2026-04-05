import type { CalendarBlockItem } from "./calendarTypes";

type Props = { item: CalendarBlockItem };

export function BlockChip({ item }: Props) {
  return (
    <div className="ops-block-chip" data-testid={`ops-block-chip-${item.id}`}>
      <span className="ops-block-chip-label">Block</span>
      <span>
        {item.startDate} → {item.endDate}
      </span>
      {item.reason && <span className="ops-block-reason">{item.reason}</span>}
    </div>
  );
}
