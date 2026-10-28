import { notFound } from "next/navigation";
import flyerMonpath from "@/assets/flyer_monpath.webp";
import { StudyBookingPage } from "@/components/study-booking-page";
import { isPublicBookingOpen, studyConfigs } from "@/lib/booking";

export default function MonPathExperimentPage() {
  if (!isPublicBookingOpen("eye-track-monpath")) notFound();

  return (
    <StudyBookingPage
      flyer={flyerMonpath}
      study={studyConfigs["eye-track-monpath"]}
    />
  );
}
