import { StatisticsScreen } from "@/features/stats/StatisticsScreen";
import { todayIso } from "@/server/time";

export default function StatsPage() {
  return <StatisticsScreen today={todayIso()} />;
}
