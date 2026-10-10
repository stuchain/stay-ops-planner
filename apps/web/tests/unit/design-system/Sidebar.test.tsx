// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import axe from "axe-core";
import { Sidebar, defaultSidebarItems, type SidebarLinkProps } from "@/ui/Sidebar";

afterEach(cleanup);

const items = defaultSidebarItems.map((i) => ({ ...i, current: i.label === "Ημερολόγιο" }));

describe("Sidebar", () => {
  it("renders the four items with the current page marked", async () => {
    const { container } = render(<Sidebar items={items} footer={<span>Ενημερώθηκε 10:32</span>} />);
    for (const label of ["Σήμερα", "Ημερολόγιο", "Έσοδα", "Ρυθμίσεις"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "Ημερολόγιο" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Σήμερα" })).not.toHaveAttribute("aria-current");
    expect(screen.getByText("Ενημερώθηκε 10:32")).toBeInTheDocument();
    const results = await axe.run(container, { rules: { "color-contrast": { enabled: false } } });
    expect(results.violations).toEqual([]);
  });

  it("defaults to four items without a current page", () => {
    render(<Sidebar />);
    expect(screen.getAllByRole("link")).toHaveLength(4);
  });

  it("uses a custom link component", () => {
    function Custom({ href, children, ...rest }: SidebarLinkProps) {
      return (
        <a href={href} data-custom="yes" {...rest}>
          {children}
        </a>
      );
    }
    render(<Sidebar items={items} linkComponent={Custom} />);
    expect(screen.getByRole("link", { name: "Έσοδα" })).toHaveAttribute("data-custom", "yes");
  });
});
