/** Matches `AppShell` root; overlays portaled to `document.body` stay outside this subtree. */
export const OPS_APP_ROOT_ID = "ops-app-root";

let inertDepth = 0;

/** Marks `#ops-app-root` inert while depth > 0. Call the returned disposer when the overlay closes. */
export function pushOverlayInert(): () => void {
  if (typeof document === "undefined") return () => {};
  const root = document.getElementById(OPS_APP_ROOT_ID);
  if (root && inertDepth === 0) {
    root.setAttribute("inert", "");
  }
  inertDepth += 1;
  return () => {
    inertDepth = Math.max(0, inertDepth - 1);
    const el = document.getElementById(OPS_APP_ROOT_ID);
    if (inertDepth === 0 && el?.hasAttribute("inert")) {
      el.removeAttribute("inert");
    }
  };
}
