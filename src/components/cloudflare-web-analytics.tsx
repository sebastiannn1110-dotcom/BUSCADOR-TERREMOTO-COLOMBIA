"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const measurablePaths = new Set(["/", "/fallecidos", "/privacidad"]);

export function CloudflareWebAnalytics({ token }: { token: string }) {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(
      measurablePaths.has(pathname)
      && window.location.search === ""
      && window.location.hash === ""
    );
  }, [pathname]);

  if (!enabled) return null;
  return <Script
    id="cloudflare-web-analytics"
    type="module"
    src="https://static.cloudflareinsights.com/beacon.min.js"
    strategy="afterInteractive"
    data-cf-beacon={JSON.stringify({ token, spa: false })}
  />;
}
