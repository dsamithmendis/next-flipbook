import type { Metadata } from "next";
import type { ReactNode } from "react";
import "next-flipbook/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "next-flipbook demo",
  description: "Demos for the next-flipbook React and Next.js flipbook engine.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
