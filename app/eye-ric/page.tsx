import { existsSync } from "fs";
import path from "path";
import { StudyBookingPage } from "@/components/study-booking-page";
import { studyConfigs } from "@/lib/booking";

export default function EyeTrackingExperimentPage() {
  const flyerFileName = "flyer_eye_ric.png";
  const flyerPath = path.join(process.cwd(), "assets", flyerFileName);
  const flyer = existsSync(flyerPath) ? `/api/flyers/${flyerFileName}` : null;

  return (
    <StudyBookingPage
      flyer={flyer}
      study={studyConfigs["eye-track-monpath"]}
    />
  );
}
