import flyerSemanticForaging from "@/assets/flyer_semantic_foraging.jpeg";
import { StudyBookingPage } from "@/components/study-booking-page";
import { studyConfigs } from "@/lib/booking";

export default function SemanticForagingPage() {
  return (
    <StudyBookingPage
      flyer={flyerSemanticForaging}
      study={studyConfigs["semantic-foraging"]}
    />
  );
}
