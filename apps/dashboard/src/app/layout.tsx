import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./header.css";

export const metadata: Metadata = {
  title: "ADE Control Plane",
  description: "Global supervision and control surface for ADE projects.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
