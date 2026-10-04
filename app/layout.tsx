import type { Metadata } from "next";
import "./globals.css";
import "./qi.css";

export const metadata: Metadata = {
  title: "QI 启 · The Agent Launchpad",
  description: "Launch a token. Awaken its agent. On BNB, powered by Flap.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/qi-symbol.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
