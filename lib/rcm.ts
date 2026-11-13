import type { SarScene } from "@/lib/sar"

type Bbox = [number, number, number, number]

/**
 * Canada's RADARSAT Constellation Mission (RCM, C-band) images that Orbit
 * Lens can set beside NISAR. Open data from the Canadian Space Agency; each
 * one is calibrated and placed on the map by scripts/rcm/masamba.py and
 * served from public/rcm.
 */
export type RcmScene = {
  id: string
  /** Acquisition day, "YYYY-MM-DD" (UTC). */
  day: string
  place: string
  /** Why it was taken. */
  event: string
  url: string
  bbox: Bbox
  /** [lon, lat] the story is about; NISAR should cover it too. */
  focus: [number, number]
}

const RCM_SCENES: RcmScene[] = [
  {
    id: "masamba-2020-07-18",
    day: "2020-07-18",
    place: "Masamba, North Luwu, Indonesia",
    event:
      "5 days after the 13 Jul 2020 flash flood (International Charter call 763)",
    url: "/rcm/masamba-2020-07-18-hh.webp",
    bbox: [119.95, -2.95, 120.5, -2.3],
    focus: [120.326, -2.547],
  },
]

/** The credit RCM's licence asks for, next to the imagery. */
export const RCM_CREDIT = {
  copyright: (year: string) =>
    `RADARSAT Constellation Mission Imagery © Government of Canada (${year})`,
  mark: "RADARSAT is an official mark of the Canadian Space Agency",
  licence:
    "https://donnees-data.asc-csa.gc.ca/users/OpenData_DonneesOuvertes/pub/RCM/license.pdf",
}

/** The RCM image overlapping an area the most, if any. */
export function rcmSceneFor([w, s, e, n]: Bbox): RcmScene | null {
  let best: RcmScene | null = null
  let bestArea = 0
  for (const scene of RCM_SCENES) {
    const [sw, ss, se, sn] = scene.bbox
    const area =
      Math.max(0, Math.min(e, se) - Math.max(w, sw)) *
      Math.max(0, Math.min(n, sn) - Math.max(s, ss))
    if (area > bestArea) {
      best = scene
      bestArea = area
    }
  }
  return best
}

/** Image corners: top-left, top-right, bottom-right, bottom-left. */
export function rcmCorners({ bbox: [w, s, e, n] }: RcmScene) {
  return [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
  ] satisfies SarScene["coordinates"]
}
