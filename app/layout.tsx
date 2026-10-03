import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SHEN · The Agent Launchpad",
  description: "Tokens with a mind of their own. Launch on BNB, powered by Flap.",
  icons: {
    icon: "/shen-symbol.png",
    shortcut: "/shen-symbol.png",
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
