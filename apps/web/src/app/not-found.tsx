import { ErrorState } from "@/modules/ui/ErrorState";

export default function NotFound() {
  return (
    <div className="ops-error-boundary-root">
      <ErrorState
        title="Page not found"
        description="The page you requested does not exist or has been moved."
        homeHref="/app/calendar"
      />
    </div>
  );
}
