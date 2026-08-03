import type { Metadata } from "next";
import { SeptemberSignupForm } from "@/components/september-signup-form";

export const metadata: Metadata = {
  title: "Back in September | Experiment Booking",
  description:
    "Experiment bookings are paused for August and will continue in September.",
};

export default function SeptemberPage() {
  return (
    <main className="pause-page">
      <section className="pause-card" aria-labelledby="pause-title">
        <div className="pause-mark" aria-hidden="true">
          <span />
        </div>

        <p className="eyebrow">Taking an August break</p>
        <h1 id="pause-title">We’ll continue in September.</h1>
        <p className="pause-intro">
          Our experiment booking website is paused for August. Leave your email
          below and we’ll let you know when bookings reopen.
        </p>

        <SeptemberSignupForm />

        <p className="pause-footnote">
          Thank you for your interest in our research. We look forward to seeing
          you soon.
        </p>
      </section>
    </main>
  );
}
