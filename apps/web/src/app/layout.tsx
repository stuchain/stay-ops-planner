import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stay Ops Planner",
  description: "Internal short-term rental operations tool",
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
