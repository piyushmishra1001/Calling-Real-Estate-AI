import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LeadPilot AI",
  description: "Real estate lead-conversion platform: CRM, AI follow-up calls and site-visit tracking.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-slate-50 text-slate-900">{children}</body>
    </html>
  );
}
