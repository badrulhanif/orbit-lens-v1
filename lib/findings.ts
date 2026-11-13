import type { AppId } from "@/lib/apps"
import type { Place } from "@/lib/geo"

/**
 * The findings page: what Orbit Lens measured over three Malaysian study
 * areas, and what we think it means. Every number here was measured with
 * the app from the full NISAR products (see each story's dates); the
 * "why" parts are hypotheses.
 */

export type Story = {
  id: string
  kicker: string
  title: string
  dates: string
  place: Place
  app: AppId
  figures: { label: string; value: string; sub: string }[]
  images: { src: string; caption: string }[]
  shows: string[]
  why: string[]
  next: string
}

export const FINDINGS_INTRO = [
  "NISAR, the NASA-ISRO radar satellite, passes over Malaysia every 12 days, day or night and through monsoon cloud. Its long L-band wave (24 cm) passes through leaves to the branches and ground below, and its two polarizations (HH and HV) react differently to water, crops, forest and buildings.",
  "We used Orbit Lens to measure three places from the full NISAR products, from the first public passes over Malaysia (June 2026) to October 2026. Each story below gives the measured numbers, what we think caused them, and what to watch as the north-east monsoon arrives.",
  "A fourth story crosses the border to Masamba, Indonesia, where Canada's RCM radar caught the aftermath of a 2020 flash flood: a partner agency's archive gives NISAR a \"before\" picture it could not take itself.",
]

export const POLARIZATION_GUIDE = [
  {
    change: "Open flood water",
    watch: "HH and HV both drop",
    why: "Calm water reflects the radar away like a mirror, so it looks black in every polarization.",
  },
  {
    change: "Water under trees",
    watch: "HH rises, HV steady",
    why: "The wave bounces off the water, then off the trunks, straight back (double bounce). Only long wavelengths like L-band get under the canopy to do this.",
  },
  {
    change: "Crops growing",
    watch: "HV rises",
    why: "HV comes from the wave twisting in a jumble of stems and leaves, so it grows with the plants.",
  },
  {
    change: "Rice in flooded fields",
    watch: "HH very bright",
    why: "Upright stalks standing in water act like tiny walls: HH bounces back as from buildings.",
  },
  {
    change: "Clearing and harvest",
    watch: "HV drops",
    why: "Less vegetation volume, less twisting of the wave.",
  },
  {
    change: "Wetter soil",
    watch: "HH rises on bare land",
    why: "Water raises the soil's dielectric constant, so damp ground echoes more strongly.",
  },
  {
    change: "Ground sinking or rising",
    watch: "Phase between two passes (GUNW)",
    why: "A full colour cycle of the interferogram is 12 cm of movement toward or away from the satellite.",
  },
]

export const FUTURE = [
  {
    title: "Flood maps through monsoon cloud",
    text: "Every 12 days, including under forest canopy, for JKM, NADMA and the state disaster committees, while optical satellites see only cloud.",
  },
  {
    title: "Rice calendar for the whole country",
    text: "Planting, growth and harvest dates for every paddy field from HH and HV, for crop and water planning (MADA, KADA, IADA areas).",
  },
  {
    title: "Peat and sinking ground",
    text: "Millimetre-scale sinking of drained peat (Selangor, Johor, Sarawak) and reclaimed coast, before it cracks roads and buildings.",
  },
  {
    title: "Slopes that are starting to move",
    text: "Slow creep on hill slopes and highway cuts (Cameron Highlands, Genting, Bukit Antarabangsa) months before a landslide.",
  },
  {
    title: "Forest and plantation change",
    text: "Clearing, logging and replanting under cloud, to check deforestation-free claims and restore peat swamp forest.",
  },
]

export const LIMITS = [
  "Public NISAR science products over Malaysia start in June 2026, so these stories cover the dry months; the monsoon floods are still to come.",
  "Large states are sampled in patches, not read whole, and only where both dates were imaged.",
  "Land-cover classes come from brightness thresholds calibrated on a handful of Malaysian sites; flooded rice and young crops can be mistaken for water or buildings.",
  "A single 12-day movement pair is mostly weather delay in the signal; trends over many pairs are more reliable, and a yearly rate needs at least 6 months.",
  'The "why" parts are our hypotheses from the radar alone; they need checking on the ground.',
]

export const STORIES: Story[] = [
  {
    id: "kedah",
    kicker: "Agriculture · Kedah, the rice bowl",
    title: "Watching a rice season grow",
    dates:
      "16 June → 14 October 2026 · 4 NISAR frames · 5,906 km² of land measured · about 2.2 million people",
    place: {
      id: "g6,100.6667",
      name: "Kedah",
      kind: "State",
      icon: "area",
      area: "Malaysia",
      address: "",
      latitude: 6,
      longitude: 100.6667,
      bbox: [99.709, 5.0965, 100.9491, 6.4775],
      boundaryKey: "state|Kedah|Malaysia",
    },
    app: "agriculture",
    figures: [
      { label: "Water", value: "72 → 31 km²", sub: "35 km² clearly receded" },
      { label: "Became vegetation", value: "81 km²", sub: "open land → crops" },
      { label: "HV (median)", value: "+0.2 dB", sub: "−11.4 → −11.2 dB" },
      {
        label: "Vegetation index",
        value: "0.869 → 0.880",
        sub: "0 bare, 1 dense",
      },
    ],
    images: [
      {
        src: "/findings/kedah-rgb.png",
        caption: "14 Oct, colour mix: red HH, green HV, blue HH÷HV",
      },
      { src: "/findings/kedah-hv.png", caption: "14 Oct, HV only" },
      {
        src: "/findings/kedah-dhv.png",
        caption: "HV change since 16 Jun: blue = more vegetation",
      },
      {
        src: "/findings/kedah-change.png",
        caption: "Measured change: green gained, light blue water gone",
      },
    ],
    shows: [
      "Between mid-June and mid-October, 41 km² of water disappeared from the part of Kedah NISAR imaged, and 81 km² of open land turned into vegetation. The HV change map lights up in a solid blue band on the eastern side of the rice plain, around Pendang (about 5.9–6.2°N, 100.4–100.5°E), while the hills to the east barely change.",
      "Our classifier also counted 155 km² more \"built-up\" land. We don't believe that: half-grown rice standing in water bounces HH straight back, just like walls do. It's a known trap for simple brightness thresholds, and a good example of why both polarizations matter.",
    ],
    why: [
      'The main rice season. In the MADA scheme, fields are usually flooded and planted around August and September. In June many were bare or flooded after the off-season harvest; by October the young rice had closed over the water, so the water "receded" from radar\'s view and HV rose with the growing plants.',
      "This is a human driver: the water and the crop both follow the irrigation calendar, not the weather.",
    ],
    next: "The harvest (usually January–February) should show the opposite: HV falling back and open land returning. Then the fields flood again for the off-season crop around March–April.",
  },
  {
    id: "kelantan",
    kicker: "Floods · Kelantan, before the monsoon",
    title: "A dry-season baseline for Malaysia's flood state",
    dates:
      "19 June → 5 October 2026 · 4 NISAR frames · 5,502 km² of land measured · about 1.7 million people",
    place: {
      id: "g5.3333,102",
      name: "Kelantan",
      kind: "State",
      icon: "area",
      area: "Malaysia",
      address: "",
      latitude: 5.3333,
      longitude: 102,
      bbox: [101.5597, 4.77, 102.5248, 6.2315],
      boundaryKey: "state|Kelantan|Malaysia",
    },
    app: "flood",
    figures: [
      { label: "Water on land", value: "25 → 16 km²", sub: "rivers and lakes" },
      { label: "New water", value: "0.5 km²", sub: "nothing flooding" },
      { label: "Vegetation", value: "87%", sub: "of the land measured" },
      { label: "HH on open land", value: "+1.4 dB", sub: "wetter soil" },
    ],
    images: [
      {
        src: "/findings/kelantan-rgb.png",
        caption:
          "5 Oct, colour mix: the Kota Bharu plain and the Kelantan River",
      },
      { src: "/findings/kelantan-hh.png", caption: "5 Oct, HH" },
      { src: "/findings/kelantan-hv.png", caption: "5 Oct, HV" },
      {
        src: "/findings/kelantan-dhh.png",
        caption: "HH change since 19 Jun: blue brighter, red darker",
      },
    ],
    shows: [
      "From June to early October, Kelantan was quiet: almost no new water (0.5 km²), the river channels slightly narrower (water on land 25 → 16 km²), and the forest and plantations steady (vegetation index 0.907 → 0.903).",
      "The one clear signal is on open land, where HH rose by 1.4 dB while HV hardly moved. On the HH picture the Kelantan River winds dark through a bright, built-up Kota Bharu.",
    ],
    why: [
      "June to September is Kelantan's drier season (the south-west monsoon mostly rains on the other side of the peninsula), so rivers run lower.",
      "The HH rise on bare ground points to wetter soil: water raises the soil's dielectric constant, so damp ground echoes more strongly. That fits the first inter-monsoon rains of late September and October.",
    ],
    next: 'This is the "before" picture. Kelantan was the worst-hit state in the 2014–15 floods (354,800 people affected), and the north-east monsoon runs from November to March. When it floods, the Kota Bharu–Pasir Mas plain should turn dark in both HH and HV; watch for water under the trees too (HH up, HV steady). Watch Kelantan in Orbit Lens to get an alert.',
  },
  {
    id: "klang-valley",
    kicker: "Ground movement · Klang Valley",
    title: "Is the city sinking? Not measurable yet",
    dates:
      "1 July → 10 October 2026 · 7 interferogram pairs from 2 tracks · 101 days",
    place: {
      id: "case-klang-valley",
      name: "Klang Valley",
      kind: "Urban region",
      icon: "area",
      area: "Selangor, Kuala Lumpur, Putrajaya",
      address: "",
      latitude: 3.08,
      longitude: 101.6,
      bbox: [101.35, 2.85, 101.85, 3.3],
    },
    app: "subsidence",
    figures: [
      { label: "Movement", value: "−28 to +23 mm", sub: "5–95% of the area" },
      { label: "Uncertainty", value: "±35 mm", sub: "over 101 days" },
      { label: "Consistent", value: "44%", sub: "same way in every pair" },
      { label: "One 12-day pair", value: "52%", sub: "coherence (7–19 Oct)" },
    ],
    images: [
      {
        src: "/findings/klang-valley-trend.png",
        caption: "Total movement, 1 Jul → 10 Oct: red away, blue toward",
      },
      {
        src: "/findings/klang-valley-pair.png",
        caption: "One 12-day pair, 7 → 19 Oct",
      },
    ],
    shows: [
      "Over 101 days, the valley's movement spans −28 to +23 mm, but the uncertainty (±35 mm) is just as large, and fewer than half the pixels moved the same way in every pair.",
      "The map shows why: broad, smooth patches of red and blue tens of kilometres across. Ground doesn't sink like that; water vapour in the air delays the radar in exactly that shape. Real subsidence shows up as small, sharp patches that stay put from pair to pair.",
    ],
    why: [
      "Mostly the atmosphere, not the ground: the tropics hold a lot of water vapour and it changes from pass to pass.",
      "Where real sinking appears later, likely causes to test are soft ground (river clay, old tin-mining land, peat near the coast) settling under new buildings, and groundwater pumping.",
    ],
    next: "From about January 2027 NISAR will have six months of passes here, and Orbit Lens switches to a yearly rate (mm/yr). Spots that keep moving the same way, pair after pair, will stand out from the weather.",
  },
  {
    id: "masamba",
    kicker: "Floods · Masamba, Indonesia · with Canada's RCM",
    title: "A flash flood, through two radars six years apart",
    dates:
      "RCM 18 July 2020 · NISAR 3 July → 31 October 2026 · 964 km² measured",
    place: {
      id: "case-masamba",
      name: "Masamba, Indonesia",
      kind: "Town",
      icon: "area",
      area: "North Luwu, South Sulawesi, Indonesia",
      address: "",
      latitude: -2.547,
      longitude: 120.326,
      bbox: [120.12, -2.7, 120.4, -2.42],
    },
    app: "flood",
    figures: [
      { label: "RCM (Canada)", value: "18 Jul 2020", sub: "5 days after" },
      {
        label: "Very dark lowland",
        value: "17 → 3 km²",
        sub: "RCM 2020 vs NISAR 2026",
      },
      { label: "Lined up", value: "≈150 m", sub: "RCM vs NISAR" },
      {
        label: "Vegetation lost",
        value: "6.4 km²",
        sub: "NISAR, Jul → Oct 2026",
      },
    ],
    images: [
      {
        src: "/findings/masamba-rcm-hh.png",
        caption: "18 Jul 2020, RCM C-band HH, 5 days after the flood",
      },
      {
        src: "/findings/masamba-nisar-hh.png",
        caption: "3 Jul 2026, NISAR L-band HH, same grid and grey scale",
      },
      {
        src: "/findings/masamba-dark.png",
        caption: "Very dark lowland: orange in 2020 only, blue in both",
      },
      {
        src: "/findings/masamba-nisar-rgb.png",
        caption: "31 Oct 2026, colour mix: red HH, green HV, blue HH÷HV",
      },
    ],
    shows: [
      "On 13 July 2020 the rivers above Masamba, North Luwu, burst out of the hills and buried parts of the town in mud. Canada's RADARSAT Constellation Mission (RCM) imaged the area five days later for the International Charter, and the Canadian Space Agency has released that image as open data. We calibrated it and placed it with a terrain model: the product puts all ground at 1,138 m, which would have shifted the lowland about 1.6 km west. Checked against NISAR, the two now line up to within about 150 m.",
      "Five days after the flood, 17 km² of the lowland was very dark to RCM (HH below −15 dB: smooth water or wet mud). In July 2026, NISAR saw only 3 km² that dark. Most of the dark ground seen only in 2020 lies in the rice blocks south and east of the river bend, not in Masamba town itself, where mud among buildings still echoes brightly at 30 m.",
      "From July to October 2026, NISAR measured 6.4 km² of vegetation turning to open ground and 3.2 km² of new water in the 964 km² box, while the forested hills stayed steady (vegetation index 0.917 → 0.912). The two pictures also show a difference between products: NISAR's layer is terrain-corrected, so the hills look flat, while RCM's keeps their light and shadow.",
    ],
    why: [
      "Part of the 2020 darkness is likely the flood: standing water and fresh, wet mud are smooth, so they bounce the radar away. Not all of it, though: flooded rice fields look darker in C-band than in L-band, and the crop stage in July 2020 and July 2026 differ, so this is not a flood map.",
      "The 2026 clearing and new water fit the rice season (fields drained, ploughed and flooded again), a human driver. North Luwu's planting calendar would confirm it.",
    ],
    next: 'Watch the river fans and the slopes above Masamba in the next wet spells (the 2020 flood came in July): NISAR\'s movement layer can show slopes starting to creep, and its signal layer water spreading on the plain. In Orbit Lens, open Masamba, turn on Signal quality, then press "RCM 2020" to swipe between the two radars.',
  },
]

export const BANDS = [
  'Sentinel-1 (ESA) sees Malaysia in C-band, a 5.6 cm wave; NISAR in L-band, 24 cm. Set side by side in Orbit Lens (radar layer "Signal quality", then C-band), the same day looks quite different.',
  "C-band bounces off the top of the canopy, so oil palm, rubber and forest all look much the same grey-green. L-band reaches the trunks and branches: forest, plantations and young crops separate, and water under the trees shows up as bright HH. Over towns and open water both agree: buildings bright, water black.",
  "That's why NISAR matters for a country covered in trees and cloud: floods in forest and peat swamp, and clearing under a closed canopy, are hard to see any other way.",
]

/** What a 12-day radar can and can't do, and where Orbit Lens uses it. */
export const CAPABILITIES: {
  hazard: string
  fit: "watch" | "after" | "rarely" | "no"
  use: string
  inApp: string
}[] = [
  {
    hazard: "Illegal logging, land clearing",
    fit: "watch",
    use: "Clearing takes weeks, so a pass every 12 days catches it.",
    inApp: "Forest / Agriculture → vegetation lost; radar notice",
  },
  {
    hazard: "Slopes creeping (before landslides)",
    fit: "watch",
    use: "Slopes often creep for weeks or months before they fail.",
    inApp: "Landslide → movement trend; radar notice",
  },
  {
    hazard: "Sinking ground, coastal subsidence",
    fit: "watch",
    use: "Millimetres a year, measured over many passes.",
    inApp: "Subsidence → trend, then yearly rate",
  },
  {
    hazard: "New ponds, mining, standing water",
    fit: "watch",
    use: "New water that stays shows up pass after pass.",
    inApp: "Flood → new water; radar notice",
  },
  {
    hazard: "Rice and plantations",
    fit: "watch",
    use: "Crop cycles last months; HV follows the plants.",
    inApp: "Agriculture → land cover, polarizations",
  },
  {
    hazard: "Floods",
    fit: "after",
    use: "Too slow to warn (rivers rise in hours). Maps the extent if a pass falls during the flood, even under trees, and the recovery after.",
    inApp: "Flood → new water; warnings come from MetMalaysia",
  },
  {
    hazard: "Forest and peat fires",
    fit: "after",
    use: "Radar can't see flames or heat; it maps the burn scar afterwards.",
    inApp: 'Vegetation lost + NASA FIRMS hotspots → "burn scar"',
  },
  {
    hazard: "Earthquakes (e.g. Sabah)",
    fit: "after",
    use: "How far the ground moved, after the event.",
    inApp: "Earthquake → movement between passes",
  },
  {
    hazard: "Oil spills",
    fit: "rarely",
    use: "NISAR mostly images land and ice; Sentinel-1 covers the sea far more often.",
    inApp: "Not covered",
  },
  {
    hazard: "Glaciers, sea ice, hurricanes",
    fit: "no",
    use: "Not found in Malaysia.",
    inApp: "Not covered",
  },
]

/** NASA learning material on radar and NISAR, from the Space Apps resource list. */
export const LEARN: { title: string; by: string; url: string; text: string }[] =
  [
    {
      title: "What is synthetic aperture radar?",
      by: "NASA Earthdata",
      url: "https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/sar",
      text: "Wavelength, polarization and how radar bounces off water, trees and buildings.",
    },
    {
      title: "Remote sensing basics",
      by: "NASA Earthdata",
      url: "https://www.earthdata.nasa.gov/learn/earth-observation-data-basics/remote-sensing",
      text: "How satellites measure the Earth, and what resolution means.",
    },
    {
      title: "NISAR StoryMaps",
      by: "NASA JPL",
      url: "https://nisar.jpl.nasa.gov/applications/arcgis-storymaps/",
      text: "Radar stories on floods, wildfires, sinking ground, oil slicks and glaciers.",
    },
    {
      title: "NISAR applications white papers",
      by: "NASA JPL",
      url: "https://nisar.jpl.nasa.gov/applications/societal-benefit/",
      text: "Two-page overviews of how NISAR helps farming, disasters, forests and more.",
    },
    {
      title: "NISAR Data User Guide",
      by: "Alaska Satellite Facility",
      url: "https://nisar-docs.asf.alaska.edu/",
      text: "The NISAR products Orbit Lens reads (GUNW, GCOV) and how to get them.",
    },
    {
      title: "ARSET trainings",
      by: "NASA Applied Sciences",
      url: "https://appliedsciences.nasa.gov/get-involved/training",
      text: "Free online courses on radar, NISAR, disasters and farming, in English and Spanish.",
    },
  ]
