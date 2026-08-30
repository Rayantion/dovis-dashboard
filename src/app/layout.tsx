import type { Metadata } from "next";
import { Source_Serif_4, IBM_Plex_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { DovisProvider } from "@/lib/dovis-provider";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

/*
  Two families, per the design system. Source Serif 4 signals "document" rather than
  "dashboard"; IBM Plex Sans carries body and UI.

  Traditional Chinese deliberately does NOT load a webfont. A TC face is 3-8MB even
  subsetted, and every device this runs on already has one. The stack below falls
  through to the OS face, so switching to zh-TW costs zero bytes.
*/
const heading = Source_Serif_4({
  variable: "--font-heading-src",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "600", "700"],
});

const body = IBM_Plex_Sans({
  variable: "--font-sans-src",
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Dovis",
  description:
    "Executive assistant. Proposals waiting on your decision, and nothing that acts without it.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${heading.variable} ${body.variable} h-full antialiased`}
      style={
        {
          "--font-heading": `var(--font-heading-src), Georgia, "Noto Serif TC", "Songti TC", serif`,
          "--font-sans": `var(--font-sans-src), -apple-system, "PingFang TC", "Microsoft JhengHei", "Noto Sans TC", sans-serif`,
          "--font-mono": `ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace`,
        } as React.CSSProperties
      }
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>
          <DovisProvider>
            {children}
            <Toaster position="bottom-right" />
          </DovisProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
