import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "JV Skill Intelligence",
  description:
    "Workforce analytics platform — Skill Intelligence, Performance Evidence, Labor Analytics, and Skill Gap & Development, built on Blueprint v2.0 / Implementation Architecture v3.0.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
