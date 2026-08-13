"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (element: HTMLElement, options: Record<string, unknown>) => string;
      remove: (widgetId: string) => void;
    };
  }
}

type TurnstileProps = {
  siteKey: string;
  onToken: (token: string) => void;
  onError: () => void;
};

const scriptId = "cf-turnstile-script";

/** Cloudflare Turnstile token collector. The token is verified server-side. */
export function Turnstile({ siteKey, onToken, onError }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !siteKey) return;

    let widgetId: string | undefined;
    let cancelled = false;
    const render = () => {
      if (cancelled || widgetId || !window.turnstile) return;
      widgetId = window.turnstile.render(container, {
        sitekey: siteKey,
        callback: (token: string) => onToken(token),
        "expired-callback": () => onToken(""),
        "error-callback": onError,
        theme: "light"
      });
    };

    let script = document.getElementById(scriptId) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.addEventListener("load", render, { once: true });
      script.addEventListener("error", onError, { once: true });
      document.head.appendChild(script);
    }

    render();
    const retry = window.setInterval(render, 100);
    return () => {
      cancelled = true;
      window.clearInterval(retry);
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [onError, onToken, siteKey]);

  return <div className="captcha" aria-label="Verificación antiabuso" ref={containerRef} />;
}
