import flyerSpeedEng from "@/assets/flyer_ita_speed.png";
import { StudyBookingPage } from "@/components/study-booking-page";
import { studyConfigs } from "@/lib/booking";

export default function SensorimotorStudyPage() {
  return (
    <StudyBookingPage
      flyer={flyerSpeedEng}
      study={studyConfigs["sensorimotor-study"]}
    />
  );
}