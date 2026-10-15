import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Automation Tool",
  description: "Coded-workflow automation runner — n8n replacement",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
