import type { Metadata } from "next";
import { Space_Grotesk, Space_Mono, Newsreader } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import Heartbeat from "@/components/Heartbeat";

const grotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-grotesk",
});

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-spacemono",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-newsreader",
});

const SITE_URL = "https://taterscout.org";
const DESCRIPTION =
  "A FIRST Tech Challenge scouting dashboard: team EPA & OPR, win predictions, strength of schedule, event rankings, and match results in one place.";

export const metadata: Metadata = {
  // metadataBase resolves the relative URLs Next generates for social tags;
  // without it, shared links render no preview card at all.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "TaterScout — FTC Scouting Dashboard",
    template: "%s · TaterScout",
  },
  description: DESCRIPTION,
  applicationName: "TaterScout",
  openGraph: {
    type: "website",
    siteName: "TaterScout",
    title: "TaterScout — FTC Scouting Dashboard",
    description: DESCRIPTION,
    url: SITE_URL,
  },
  twitter: {
    card: "summary_large_image",
    title: "TaterScout — FTC Scouting Dashboard",
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${grotesk.variable} ${spaceMono.variable} ${newsreader.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background">
        <Heartbeat />
        <Header />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
