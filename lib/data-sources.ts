/**
 * Every outside source the app uses: shown in the "About the data" dialog
 * and listed at the end of reports.
 */

type DataSource = {
  name: string
  by: string
  url: string
  /** What we take from it. */
  gives: string
  /** How fresh it is / what it covers. */
  coverage: string
  licence?: string
}

export const DATA_GROUPS: {
  title: string
  note?: string
  sources: DataSource[]
}[] = [
  {
    title: "Satellite radar",
    note: "The radar layers, Compare and the analysis cards.",
    sources: [
      {
        name: "NISAR",
        by: "NASA-ISRO, via the Alaska Satellite Facility (ASF DAAC)",
        url: "https://search.asf.alaska.edu/",
        gives:
          "Ground movement (GUNW interferograms) and radar brightness (GCOV) for every pass. Measured movement (mm, with weather and ionosphere corrections) and land cover (km²) are read from the full GUNW and GCOV products, only the tiles over an area",
        coverage:
          "Every 12 days since late 2025; newest passes are provisional",
        licence: "NASA open data",
      },
      {
        name: "NASA GIBS",
        by: "NASA Earthdata",
        url: "https://nasa-gibs.github.io/gibs-api-docs/",
        gives:
          "Map tiles of NISAR radar brightness, and of Sentinel-1 for the C-band comparison",
        coverage: "About two weeks behind the ASF archive",
        licence: "NASA open data",
      },
      {
        name: "Sentinel-1 (OPERA RTC-S1)",
        by: "ESA Copernicus; terrain-corrected by NASA JPL's OPERA project, found via NASA CMR",
        url: "https://www.jpl.nasa.gov/go/opera/products/rtc-product/",
        gives:
          "C-band radar brightness (VV and VH) on the pass nearest a NISAR date, to set beside NISAR's L-band",
        coverage: "Every few days since 2023",
        licence: "Copernicus open data; NASA open data",
      },
    ],
  },
  {
    title: "Context",
    sources: [
      {
        name: "WorldPop",
        by: "WorldPop, University of Southampton",
        url: "https://www.worldpop.org/",
        gives: "How many people live in the area on screen",
        coverage: "2020 estimate, 100 m grid",
        licence: "CC BY 4.0",
      },
    ],
  },
  {
    title: "Hazard history",
    note: "The event lists, markers and reports.",
    sources: [
      {
        name: "USGS earthquake catalogue",
        by: "U.S. Geological Survey",
        url: "https://earthquake.usgs.gov/earthquakes/search/",
        gives: "Epicentres, magnitude, depth, felt reports and impact alerts",
        coverage: "Magnitude 3.5 and above, since 1970",
        licence: "Public domain",
      },
      {
        name: "GDACS",
        by: "UN / European Commission",
        url: "https://www.gdacs.org/",
        gives:
          "Flood alerts with dates, and people displaced or killed by district (reported by national agencies)",
        coverage: "Malaysian floods from 2025",
      },
      {
        name: "NASA EONET",
        by: "NASA Earth Observatory",
        url: "https://eonet.gsfc.nasa.gov/",
        gives: "Index of floods, storms, wildfires and landslides",
        coverage: "Malaysia from 2025",
        licence: "NASA open data",
      },
      {
        name: "Wikipedia and Wikidata",
        by: "Wikimedia volunteers",
        url: "https://www.wikidata.org/",
        gives:
          "Named disasters with locations, and the major floods (state-wide, 1971 onwards) with their summaries",
        coverage: "Only events someone has written up",
        licence: "CC BY-SA / CC0",
      },
    ],
  },
  {
    title: "Happening now (Malaysia)",
    note: "The 'Happening now' section; checked every 10–15 minutes.",
    sources: [
      {
        name: "InfoBencana relief centres",
        by: "JKM, Social Welfare Department of Malaysia",
        url: "https://infobencanajkmv2.jkm.gov.my/",
        gives:
          "Evacuation centres open now: exact location, disaster type, evacuees and families",
        coverage: "Live",
      },
      {
        name: "Weather warnings",
        by: "MetMalaysia, via data.gov.my",
        url: "https://data.gov.my/data-catalogue",
        gives:
          "Continuous rain, thunderstorm and strong wind warnings by state and district",
        coverage: "Live",
        licence: "Open data (CC BY 4.0)",
      },
    ],
  },
  {
    title: "Community",
    note: "Shown only after a moderator checks them.",
    sources: [
      {
        name: "Public reports",
        by: "People using Orbit Lens",
        url: "https://supabase.com/",
        gives:
          "Hazards seen on the ground (flooding, landslides, sinkholes), with optional photos",
        coverage: 'Unverified on the ground; labelled "Public report"',
      },
    ],
  },
  {
    title: "Places and boundaries",
    sources: [
      {
        name: "GeoNames",
        by: "GeoNames.org",
        url: "https://www.geonames.org/",
        gives: "Names and positions of states, districts, towns and kampungs",
        coverage: "Offline copy, refreshed with npm run data:gazetteer",
        licence: "CC BY 4.0",
      },
      {
        name: "OpenStreetMap",
        by: "OpenStreetMap contributors, via Nominatim and Photon",
        url: "https://www.openstreetmap.org/",
        gives: "State and district outlines, buildings, streets and places",
        coverage: "Outlines: offline copy; search: live",
        licence: "ODbL",
      },
      {
        name: "Natural Earth",
        by: "Natural Earth",
        url: "https://www.naturalearthdata.com/",
        gives:
          "Coastlines: tells offshore events from those on land, and keeps the sea out of radar water and land-cover figures",
        coverage: "1:10 million scale",
        licence: "Public domain",
      },
    ],
  },
  {
    title: "Base maps",
    sources: [
      {
        name: "CARTO",
        by: "CARTO, from OpenStreetMap",
        url: "https://carto.com/attributions",
        gives: "The light and dark map",
        coverage: "Live",
      },
      {
        name: "Esri World Imagery",
        by: "Esri, Maxar and partners",
        url: "https://www.esri.com/",
        gives: "Satellite view",
        coverage: "Imagery dates vary by place",
      },
      {
        name: "OpenFreeMap and AWS Terrain Tiles",
        by: "OpenFreeMap; Mapzen / AWS open data",
        url: "https://openfreemap.org/",
        gives: "3D buildings, labels and terrain",
        coverage: "Live",
      },
    ],
  },
]

/** How results are worked out, and their limits. */
export const DATA_CAVEATS = [
  "Event lists only include what these sources recorded; no record doesn't mean nothing happened.",
  "Flood points from GDACS mark where a flood was reported, not its full extent. Impact figures are as reported by national agencies.",
  "Quick radar figures use NASA's preview images, so they're estimates. Measured values come from the full NISAR products: movement relative to the area's median, land cover from brightness thresholds calibrated over Kuala Lumpur.",
  "Yearly rates (mm/yr) need at least 6 months of passes; before that the app shows total movement over the period instead.",
  "Relief centre locations are exact; the flooded area is usually nearby.",
  '"Likely why" notes are hypotheses from the radar alone (which polarization changed and how), not confirmed causes.',
]
