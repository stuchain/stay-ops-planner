import type { Meta, StoryObj } from "@storybook/react";
import { ToastBanner } from "./ToastBanner";

const meta: Meta<typeof ToastBanner> = {
  title: "UI/ToastBanner",
  component: ToastBanner,
};

export default meta;

type Story = StoryObj<typeof ToastBanner>;

export const Default: Story = {
  args: { children: "Something was saved successfully." },
};
