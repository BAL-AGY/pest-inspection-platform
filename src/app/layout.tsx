import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { isStagingEnvironment } from "@/lib/environment";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Demo Pest Control Co. — Free Home Pest Inspection",
  description:
    "Get a free, no-obligation home pest inspection from a local, licensed technician.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {isStagingEnvironment() && (
          <div className="bg-sky-900 px-4 py-2 text-center text-xs font-semibold tracking-wide text-white">
            STAGING DEMO · Synthetic data · Email and SMS are simulated
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
