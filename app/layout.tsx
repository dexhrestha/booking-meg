import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MEG Experiment Booking",
  description: "Participant booking form for MEG experiment sessions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
