import flyerMegEng from "@/assets/flyer_MEG_eng.png";
import { StudyBookingPage } from "@/components/study-booking-page";
import { studyConfigs } from "@/lib/booking";

export default function Home() {
  return (
    <StudyBookingPage
      flyer={flyerMegEng}
      study={studyConfigs["meg-study"]}
    />
  );
}
