import { CleaningScreen } from "@/features/dev/CleaningScreen";
import { CleaningBoard } from "@/modules/cleaning/CleaningBoard";

export default function DevCleaningPage() {
  return (
    <CleaningScreen>
      <CleaningBoard />
    </CleaningScreen>
  );
}
