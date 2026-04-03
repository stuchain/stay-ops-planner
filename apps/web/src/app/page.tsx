import { sharedPackageReady } from "@stay-ops/shared";

export default function HomePage() {
  return (
    <main>
      <h1>Stay Ops Planner</h1>
      <p>Workspace: {sharedPackageReady ? "ok" : "not linked"}</p>
    </main>
  );
}
