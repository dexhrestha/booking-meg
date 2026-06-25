import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import flyerMegEng from "@/assets/flyer_MEG_eng.png";
import flyerSpeedEng from "@/assets/flyer_ita_speed.png";
import { studyConfigs } from "@/lib/booking";

type ExperimentCard = {
  description: string;
  href: string;
  image: StaticImageData;
  meta: string;
  title: string;
};

const experiments: ExperimentCard[] = [
  {
    title: studyConfigs["meg-study"].title,
    description:
      "Book four MEG sessions for the long-term memory study, starting on an available Tuesday.",
    href: "/meg",
    image: flyerMegEng,
    meta: "4 sessions · Tuesday start",
  },
  {
    title: studyConfigs["sensorimotor-study"].title,
    description:
      "Choose session dates and hourly lab slots for the sensorimotor experiment.",
    href: "/sensorimotor-study",
    image: flyerSpeedEng,
    meta: "4 sessions · same week",
  },
];

export default function Home() {
  return (
    <main className="page-shell experiments-home">
      <section className="experiments-hero" aria-labelledby="experiments-title">
        <p className="eyebrow">We are currently running following experiments</p>
        <h1 id="experiments-title">Choose an experiment</h1>
        <p>
          Select a study to view details, check available slots, and reserve
          your sessions.
        </p>
      </section>

      <section className="experiment-card-grid" aria-label="Available experiments">
        {experiments.map((experiment, index) => (
          <Link
            className="experiment-card"
            href={experiment.href}
            key={experiment.href}
          >
            <span className="experiment-card-image">
              <Image
                alt=""
                fill
                priority={index === 0}
                sizes="(max-width: 760px) 100vw, 50vw"
                src={experiment.image}
              />
            </span>
            <span className="experiment-card-body">
              <span className="experiment-card-meta">{experiment.meta}</span>
              <span className="experiment-card-title">{experiment.title}</span>
              <span className="experiment-card-description">
                {experiment.description}
              </span>
              <span className="experiment-card-action">Open booking</span>
            </span>
          </Link>
        ))}
      </section>
    </main>
  );
}
