"use client";

import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";

type Props = {
  laneId: string;
  title: string;
  testIdSuffix: string;
  children: ReactNode;
};

export function RoomLane({ laneId, title, testIdSuffix, children }: Props) {
  const { setNodeRef, isOver } = useDroppable({
    id: laneId,
  });

  return (
    <section
      className={`ops-room-lane${isOver ? " ops-room-lane-over" : ""}`}
      data-testid={`ops-room-lane-${testIdSuffix}`}
    >
      <header className="ops-room-lane-header">{title}</header>
      <div ref={setNodeRef} className="ops-room-lane-body">
        {children}
      </div>
    </section>
  );
}
