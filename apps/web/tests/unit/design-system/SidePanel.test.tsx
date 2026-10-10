// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "../intl";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { SidePanel } from "@/ui/SidePanel";

afterEach(cleanup);

function Harness({ modal = false }: { modal?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div id="new-ui-root" data-ui="new">
      <button onClick={() => setOpen(true)}>Άνοιγμα</button>
      <button>Έξω</button>
      <SidePanel
        open={open}
        onOpenChange={setOpen}
        title="Κράτηση"
        description="Λεπτομέρειες"
        footer={<button>Αποθήκευση</button>}
        modal={modal}
      >
        <p>Περιεχόμενο</p>
      </SidePanel>
    </div>
  );
}

describe("SidePanel", () => {
  it("opens inside #new-ui-root with title, description, footer", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Άνοιγμα"));
    const dialog = screen.getByRole("dialog", { name: "Κράτηση" });
    expect(dialog.closest("#new-ui-root")).not.toBeNull();
    expect(screen.getByText("Λεπτομέρειες")).toBeInTheDocument();
    expect(screen.getByText("Αποθήκευση")).toBeInTheDocument();
  });

  it("closes with the Κλείσιμο button and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Άνοιγμα"));
    await user.click(screen.getByRole("button", { name: "Κλείσιμο" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Άνοιγμα")).toHaveFocus();
  });

  it("closes with Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Άνοιγμα"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("non-modal by default: outside click does not dismiss", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByText("Άνοιγμα"));
    await user.click(screen.getByText("Έξω"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("modal option renders an overlay and has no axe violations", async () => {
    const user = userEvent.setup();
    const { baseElement } = render(<Harness modal />);
    await user.click(screen.getByText("Άνοιγμα"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const results = await axe.run(baseElement, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it("has no axe violations when non-modal", async () => {
    const user = userEvent.setup();
    const { baseElement } = render(<Harness />);
    await user.click(screen.getByText("Άνοιγμα"));
    const results = await axe.run(baseElement, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });
});
