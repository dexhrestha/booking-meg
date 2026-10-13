import flyerMonpath from "@/assets/flyer_monpath.webp";
import { StudyBookingPage } from "@/components/study-booking-page";
import { studyConfigs } from "@/lib/booking";

export default function MonPathExperimentPage() {
  return (
    <StudyBookingPage
      flyer={flyerMonpath}
      study={studyConfigs["eye-track-monpath"]}
    />
  );
}
