import type { Meta, StoryObj } from "@storybook/react";

const swatches = [
  { label: "surface-page", var: "--color-surface-page" },
  { label: "surface-base", var: "--color-surface-base" },
  { label: "text-primary", var: "--color-text-primary" },
  { label: "text-muted", var: "--color-text-muted" },
  { label: "accent-soft", var: "--color-accent-soft-bg" },
  { label: "btn-primary", var: "--color-btn-primary-bg" },
  { label: "danger", var: "--color-danger" },
  { label: "border-subtle", var: "--color-border-subtle" },
] as const;

function TokenSwatch() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(9rem, 1fr))",
        gap: "0.75rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      {swatches.map(({ label, var: cssVar }) => (
        <figure
          key={label}
          style={{
            margin: 0,
            border: "1px solid #ccc",
            borderRadius: 8,
            overflow: "hidden",
            background: "#fff",
          }}
        >
          <div style={{ height: "3.5rem", background: `var(${cssVar})` }} title={cssVar} />
          <figcaption style={{ padding: "0.35rem 0.5rem", fontSize: "0.75rem" }}>
            <strong>{label}</strong>
            <br />
            <code style={{ fontSize: "0.65rem" }}>{cssVar}</code>
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

const meta: Meta<typeof TokenSwatch> = {
  title: "UI/TokenSwatch",
  component: TokenSwatch,
};

export default meta;

type Story = StoryObj<typeof TokenSwatch>;

export const Default: Story = {
  render: () => <TokenSwatch />,
};
