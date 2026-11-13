import type { HazardType } from "@/lib/area"
import type { SarLayer } from "@/lib/sar"

/**
 * What the radar is being used for. Each application picks the NISAR layer
 * that shows it, the analysis it runs, and which past hazards matter.
 */
export type AppId =
  "flood" | "subsidence" | "landslide" | "forest" | "agriculture" | "earthquake"

type AppDef = {
  id: AppId
  label: string
  /** Radar layer to show for this application. */
  layer: SarLayer
  /** Which past hazards are relevant to the analysis. */
  hazards: HazardType[]
  /** The recorded events this chip filters to: its own hazard only. */
  types: HazardType[]
  /** Compare the latest pass with the previous one, or the earliest. */
  baseline: "previous" | "earliest"
  /** One line on what the radar shows for this. */
  measures: string
  /** What the analysis produces. */
  output: string
}

export const APPS: AppDef[] = [
  {
    id: "flood",
    label: "Flood",
    layer: "signal",
    hazards: ["flood", "storm"],
    types: ["flood"],
    baseline: "previous",
    measures:
      "Water is smooth, so it bounces the radar away and looks dark. New dark areas between passes mean new water.",
    output: "Water extent, new inundation and how it changes over time",
  },
  {
    id: "subsidence",
    label: "Subsidence",
    layer: "movement",
    hazards: ["landslide", "earthquake"],
    types: [],
    baseline: "previous",
    measures:
      "Interferograms compare two passes 12 days apart; colour fringes show ground moving toward or away from the satellite.",
    output: "Where ground movement can be measured, and the pairs to process",
  },
  {
    id: "landslide",
    label: "Landslide",
    layer: "movement",
    hazards: ["landslide"],
    types: ["landslide"],
    baseline: "previous",
    measures:
      "Where the ground surface changes between passes, the radar signal loses coherence. New patches of lost coherence can mean slope failure.",
    output: "Newly disturbed ground (coherence loss) and past landslides",
  },
  {
    id: "forest",
    label: "Forest",
    layer: "signal",
    hazards: ["wildfire"],
    types: ["wildfire"],
    baseline: "earliest",
    measures:
      "L-band's cross-polarised echo (HV) is strong from tree canopies. Where it drops, forest has been cleared or disturbed.",
    output: "Vegetation cover, loss and regrowth",
  },
  {
    id: "agriculture",
    label: "Agriculture",
    layer: "signal",
    hazards: ["flood"],
    types: [],
    baseline: "previous",
    measures:
      "On open and crop land the echo gets brighter with wetter soil and growing crops, and darker as fields dry or are harvested.",
    output: "Cropland area and moisture / growth change",
  },
  {
    id: "earthquake",
    label: "Earthquake",
    layer: "movement",
    hazards: ["earthquake", "tsunami", "volcano"],
    types: ["earthquake", "tsunami", "volcano"],
    baseline: "previous",
    measures:
      "An interferogram spanning an earthquake shows the ground shift as rings of colour around the fault; damaged ground loses coherence.",
    output: "Recorded quakes, pairs spanning them and disturbed ground",
  },
]

export const appById = (id: AppId) => APPS.find((a) => a.id === id)!

/**
 * Suggested study areas (proposed uses, not confirmed findings): Malaysia,
 * plus one neighbour where a partner agency's radar archive adds a past event.
 */
export const CASE_STUDIES: {
  place: string
  app: AppId
  data: string
  expect: string
}[] = [
  {
    place: "Selangor",
    app: "flood",
    data: "Backscatter, coherence",
    expect: "Flood and land-change monitoring",
  },
  {
    place: "Klang Valley",
    app: "subsidence",
    data: "InSAR displacement",
    expect: "Urban land subsidence",
  },
  {
    place: "Pahang",
    app: "landslide",
    data: "Backscatter, coherence",
    expect: "Landslide and slope change",
  },
  {
    place: "Johor",
    app: "agriculture",
    data: "Backscatter, polarimetry",
    expect: "Agriculture and plantations",
  },
  {
    place: "Sarawak",
    app: "forest",
    data: "L-band backscatter",
    expect: "Forest and vegetation",
  },
  {
    place: "Sabah",
    app: "earthquake",
    data: "InSAR, coherence",
    expect: "Terrain deformation",
  },
  {
    place: "Masamba, Indonesia",
    app: "flood",
    data: "L-band vs Canada's RCM C-band (2020)",
    expect: "Flash flood, five years on",
  },
]

/** Where to get the full NISAR data for deeper processing. */
export const DATA_PORTALS = [
  {
    name: "ASF DAAC — Vertex search",
    url: "https://search.asf.alaska.edu/",
    note: "Search and download NISAR L-band products (GCOV, GUNW, …)",
  },
  {
    name: "ISRO Bhoonidhi",
    url: "https://bhoonidhi.nrsc.gov.in/",
    note: "NISAR S-band and other ISRO data (S-band mostly over India)",
  },
  {
    name: "NISAR Data User Guide",
    url: "https://nisar.jpl.nasa.gov/data/user-guide/",
    note: "Product descriptions and processing guides",
  },
  {
    name: "NISAR products",
    url: "https://nisar.jpl.nasa.gov/data/products/",
    note: "What each product level contains",
  },
]

/** The hazard filter: one application's hazards, or everything. */
export type HazardFilter = AppId | "all"

export const inFilter = (type: HazardType, filter: HazardFilter) =>
  filter === "all" || appById(filter).types.includes(type)
