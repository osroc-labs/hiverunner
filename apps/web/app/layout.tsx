import product from "@/config/product.json"
import { PRODUCT_ORIGIN } from "@/components/marketing/site"
export const metadata = {
  metadataBase: new URL(PRODUCT_ORIGIN),
  title: { default: product.name, template: `%s | ${product.name}` },
  description: product.description,
  openGraph: { siteName: product.name, type: "website", locale: "en_US" },
  twitter: { card: "summary_large_image" },
}
import "@fontsource-variable/bricolage-grotesque/opsz.css"
import "@fontsource-variable/martian-mono/wdth.css"
import "@workspace/ui/globals.css"
import { ThemeProvider } from "@/components/theme-provider"

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="font-sans antialiased">
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
