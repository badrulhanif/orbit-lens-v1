import type { Metadata } from "next"

import { Moderation } from "@/components/moderation"

export const metadata: Metadata = {
  title: "Moderate reports · Orbit Lens",
  robots: { index: false },
}

export default function ModeratePage() {
  return <Moderation />
}
