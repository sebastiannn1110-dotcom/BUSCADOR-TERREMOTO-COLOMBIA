"use client";

import { PeopleImporter } from "@/components/people-importer";

export function OfficialDeceasedImporter() {
  return <PeopleImporter initialType="deceased" lockType />;
}
