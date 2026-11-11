# Orbit Lens

**Watch Malaysia's surface change through NASA-ISRO NISAR radar.**
Floods, sinking ground, land clearing and crop cycles, measured from the full
NISAR products and explained in plain words, for anyone with a browser.

Built for the 2026 NASA Space Apps Challenge, _Dancing with the SARs_.

- **App:** _add your live Vercel link here_
- **Findings (story of what we saw):** `/findings` in the app
- **License:** MIT (see [LICENSE](LICENSE))

## What it does

Search a place (a state, district, town or kampung), or pick a case study,
and Orbit Lens shows:

| | |
|---|---|
| **NISAR radar on the map** | Ground movement (GUNW interferograms) and radar brightness (GCOV), stitched per 12-day cycle. Step through cycles, or press ▶ to play them as a time-lapse. |
| **Measured change** | Read straight from the full NISAR HDF5 products (only the tiles over the area): land cover in km² on two dates (water, vegetation, open, built-up), what changed, and ground movement in mm with weather and ionosphere corrections. |
| **Polarizations** | The same pass in HH, HV and a colour mix, plus how HH and HV each changed, with what each one is good at. |
| **"Likely why"** | Hypotheses for each change, from which polarization moved and how: monsoon flooding, flooded paddy, water under the forest canopy (L-band double bounce), clearing and replanting, wetter soil, sinking ground. |
| **L-band vs C-band** | Sentinel-1 (C-band, NASA OPERA) beside NISAR (L-band) on a nearby date, in a swipe view. |
| **Compare** | Any two dates side by side, with a swipe handle. |
| **Context** | Recorded hazards (USGS, GDACS, NASA EONET, Wikipedia), relief centres open now and weather warnings (Malaysia), population (WorldPop). |
| **Radar change notices** | Watch a place and pick "Radar changes": after each new NISAR pass, Orbit Lens tells you if vegetation was cleared (or burnt, checked against NASA FIRMS fire hotspots), new water appeared, or the ground kept moving beyond twice its uncertainty. Always marked unconfirmed; never sent to authorities automatically. |
| **Reports and alerts** | A report for the place (copy, print/PDF, Markdown, CSV, GeoJSON) stating its scope and period; watch a place for in-app or email alerts; community reports, checked by a moderator. |

## How it fits the challenge

| The challenge asks for | Orbit Lens |
|---|---|
| An interactive app using NISAR to track and visualize surface change | Web map with NISAR GUNW and GCOV layers, measured change, time-lapse |
| One or more kinds of change | Floods and wetlands, forest and plantations, agriculture (paddy), ground movement, landslides |
| Different polarizations / frequencies | HH, HV, colour mix and per-polarization change; Sentinel-1 C-band beside NISAR L-band |
| Time series | Every 12-day cycle, playable; movement trend over up to 8 cycles |
| Ancillary data | Hazard records, population, boundaries, satellite imagery base map |
| Hypothesize the physical drivers | "Likely why" on every measurement, citing the radar evidence |
| Human drivers | Paddy cycles, land clearing and replanting, construction, groundwater pumping (as hypotheses) |
| Storytelling, interactive summary | `/findings` page; swipe views; shareable links |
| Actionable insights | Radar change notices for slow changes (clearing, new water, moving ground); "what a 12-day radar can and can't do" on `/findings` |
| Open source, user friendly | MIT licensed; plain-language UI; works on phones |

## How it works

```
Browser (Next.js, MapLibre)
   │
   ├── /api/sar/*           NISAR passes (ASF search), GIBS tiles (cleaned), Sentinel-1 days (NASA CMR)
   ├── /api/analysis/*      measured values ──► NISAR service (Python, workers/nisar)
   │                                              reads only the HDF5 tiles over the area
   │                                              (HTTP range requests, Earthdata login)
   ├── /api/area-history    hazard records (USGS, GDACS, EONET, Wikipedia/Wikidata, JKM, MetMalaysia)
   ├── /api/population      WorldPop
   ├── /api/fires           NASA FIRMS hotspots (or EONET wildfires)
   ├── /api/alerts/radar    radar change notices for a watched place
   └── /api/alerts, /api/reports   Supabase (watch list, community reports), Gmail SMTP
```

**NISAR processing (workers/nisar/reader.py)**

- _Ground movement (GUNW):_ unwrapped phase minus the ionosphere screen; only
  connected, coherent pixels; broad tilt (orbit ramp) removed; terrain-linked
  weather delay removed with a DEM; converted to mm along the line of sight.
  Trends stack up to 8 pairs and keep only pixels that move consistently.
- _Land cover (GCOV, 80 m, HH and HV gamma0):_ thresholds calibrated on NISAR
  over Kuala Lumpur, forest, peat swamp, mangrove and paddy; a change counts
  only with a 3 dB jump; the sea is masked out with Natural Earth coastlines.
- _Polarizations:_ median HH and HV, and their change where cover stayed the
  same (flooding under canopy, canopy thinning, soil moisture).

## Data

NISAR (NASA-ISRO, via ASF DAAC), NASA GIBS, Sentinel-1 (ESA Copernicus,
NASA OPERA RTC-S1), NASA FIRMS, USGS, GDACS, NASA EONET, Wikipedia/Wikidata, JKM
InfoBencana, MetMalaysia (data.gov.my), WorldPop, GeoNames, OpenStreetMap,
Natural Earth, CARTO, Esri, OpenFreeMap. Full list with licences: the
"About the data" panel in the app (`lib/data-sources.ts`).

Public NISAR science products over Malaysia start in mid-2026; the app shows
whatever the archive has.

## Run it locally

```bash
npm install
npm run dev                      # http://localhost:3000

# Measured values (optional): the Python NISAR service
npm run nisar:setup              # once
npm run nisar                    # http://localhost:8787
```

Settings go in `.env.local` (names only; never commit the values):

| Variable | For |
|---|---|
| `EARTHDATA_TOKEN` | NISAR service: NASA Earthdata login token (renew every 60 days) |
| `NISAR_WORKER_URL` | App: where the NISAR service runs (e.g. `http://localhost:8787`) |
| `NISAR_WORKER_KEY` | Optional shared key between app and service |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Watches and community reports (`supabase/schema.sql`) |
| `GMAIL_USER`, `GMAIL_APP_PASSWORD` | Email alerts |
| `FIRMS_MAP_KEY` | Optional: NASA FIRMS fire hotspots (free key: firms.modaps.eosdis.nasa.gov/api/map_key) |
| `CRON_SECRET` | Nightly pre-warm and alert jobs (`vercel.json`) |
| `MODERATOR_KEY` | `/moderate` page |

Without the optional services the app still works: radar layers, hazards and
reports; measured values, alerts and community reports switch themselves off.

**Deploy:** the app on Vercel; the NISAR service as a Docker web service
(`workers/nisar/Dockerfile`, build context = repo root), e.g. on Render.

## Tests

```bash
npm run test:setup   # once
npm test             # unit + end-to-end (Playwright)
```

## Limits

- Event lists only hold what the sources recorded.
- "Likely why" notes are hypotheses from radar alone, not confirmed causes.
- A single 12-day movement pair is mostly weather noise in forest; use the trend.
- Outside Malaysia, hazard records are thinner (no relief centres or warnings).

## Use of AI

Parts of the code and text were written with an AI coding assistant (Claude
Code), reviewed and tested by the author. All data comes from the sources
listed above; nothing is generated.
