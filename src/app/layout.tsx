import type { Metadata } from "next";
import "./globals.css";
import "./components.css";
import { Providers } from "@/components/Providers";

export const metadata: Metadata = {
  title: "Perpustakaan Digital SMA",
  description: "Sistem Informasi Perpustakaan Digital Berbasis AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
