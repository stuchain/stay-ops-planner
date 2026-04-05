import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { RoomLane } from "@/modules/calendar/RoomLane";

function wrap(ui: ReactElement) {
  return <DndContext onDragEnd={() => {}}>{ui}</DndContext>;
}

describe("RoomLane", () => {
  it("renders header and stable lane test id", () => {
    render(
      wrap(
        <RoomLane laneId="lane-room-x" title="R1 — Suite" testIdSuffix="R1">
          <span>child</span>
        </RoomLane>,
      ),
    );
    expect(screen.getByText("R1 — Suite")).toBeInTheDocument();
    expect(screen.getByTestId("ops-room-lane-R1")).toBeInTheDocument();
    expect(screen.getByText("child")).toBeInTheDocument();
  });
});
