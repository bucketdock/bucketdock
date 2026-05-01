import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "BucketDock",
  description: "S3-compatible object storage browser",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">
        {children}
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  );
}
