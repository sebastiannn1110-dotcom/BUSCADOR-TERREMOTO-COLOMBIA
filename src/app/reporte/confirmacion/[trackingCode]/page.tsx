import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

const trackingPattern = /^[A-Z0-9-]{6,40}$/i;

export const metadata: Metadata = {
  title: "Reporte recibido",
  robots: {
    index: false,
    follow: false
  }
};

export default async function ReportConfirmationPage({
  params
}: {
  params: Promise<{ trackingCode: string }>;
}) {
  const trackingCode = (await params).trackingCode.toUpperCase();
  if (!trackingPattern.test(trackingCode)) notFound();
  redirect("/reporte/confirmacion");
}
