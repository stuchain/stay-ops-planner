import type { Meta, StoryObj } from "@storybook/react";
import { useState } from "react";
import { Button } from "./Button";
import { ModalShell } from "./ModalShell";

function DrawerDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open drawer
      </Button>
      <ModalShell
        open={open}
        placement="drawer-end"
        title="Example drawer"
        useAppShellInert={false}
        onRequestClose={() => setOpen(false)}
        headerActions={
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Confirm
            </Button>
          </>
        }
      >
        <p className="ops-muted">Panel content uses shared tokens and drawer chrome.</p>
      </ModalShell>
    </>
  );
}

function CenterDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Open modal
      </Button>
      <ModalShell
        open={open}
        placement="center"
        title="Centered dialog"
        useAppShellInert={false}
        onRequestClose={() => setOpen(false)}
        footer={
          <Button variant="primary" onClick={() => setOpen(false)}>
            OK
          </Button>
        }
      >
        <p className="ops-muted">Centered modal for confirmations.</p>
      </ModalShell>
    </>
  );
}

const meta: Meta = {
  title: "UI/ModalShell",
};

export default meta;

export const DrawerEnd: StoryObj = {
  render: () => <DrawerDemo />,
};

export const Center: StoryObj = {
  render: () => <CenterDemo />,
};
