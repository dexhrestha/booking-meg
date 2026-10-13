import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Experiment Booking",
  description: "Participant booking forms for available experiment sessions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
        <footer className="site-footer">
          <Link href="/privacy">Privacy Policy</Link> ·{" "}
          <Link href="/tos">Terms of Service</Link>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
