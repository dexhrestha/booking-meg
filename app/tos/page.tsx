import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service | Experiment Booking",
  description: "Terms for using the experiment booking site.",
};

const contactEmail = "dipesh.shrestha@unitn.it";

export default function TermsPage() {
  return (
    <main className="page-shell legal-page">
      <p className="eyebrow">Last updated 13 October 2026</p>
      <h1>Terms of Service</h1>
      <p>
        This site is used to book sessions for research experiments run at
        CIMeC, University of Trento. By booking a session you agree to these
        terms.
      </p>

      <h2>Booking</h2>
      <ul>
        <li>Use your real name and an email address you check.</li>
        <li>Only book if you meet the eligibility criteria shown for the study.</li>
        <li>Book one set of sessions per person per experiment.</li>
        <li>
          A booking reserves time slots. It is not consent to take part in the
          experiment; you will be asked to give informed consent at the lab.
        </li>
      </ul>

      <h2>Changes and cancellations</h2>
      <p>
        You can change or cancel your booking on the booking page or by
        contacting us. Please let us know as early as possible if you cannot
        attend. The research team may move or cancel sessions, for example if
        lab equipment is unavailable, and will tell you by email or calendar
        update.
      </p>

      <h2>Taking part is voluntary</h2>
      <p>
        You may withdraw from the experiment at any time without giving a
        reason.
      </p>

      <h2>The service</h2>
      <p>
        The booking site is provided as is. We try to keep it available and
        accurate but cannot guarantee it will always work. Please do not misuse
        it, for example by making bookings for other people without their
        permission or trying to access other participants&apos; information.
      </p>

      <h2>Privacy</h2>
      <p>
        How we handle your information is described in our{" "}
        <Link href="/privacy">Privacy Policy</Link>.
      </p>

      <h2>Contact</h2>
      <p>
        Questions: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>
      </p>

      <p className="legal-links">
        <Link href="/">Back to experiments</Link> · <Link href="/privacy">Privacy Policy</Link>
      </p>
    </main>
  );
}
