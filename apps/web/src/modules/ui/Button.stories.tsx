import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button";

const meta: Meta<typeof Button> = {
  title: "UI/Button",
  component: Button,
  args: { children: "Action" },
};

export default meta;

type Story = StoryObj<typeof Button>;

export const Primary: Story = { args: { variant: "primary" } };
export const Secondary: Story = { args: { variant: "secondary" } };
export const Danger: Story = { args: { variant: "danger" } };
export const Ghost: Story = { args: { variant: "ghost" } };
export const Loading: Story = { args: { variant: "primary", loading: true, children: "Save" } };
export const Small: Story = { args: { variant: "secondary", size: "sm", children: "Close" } };
