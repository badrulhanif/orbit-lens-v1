import type {
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from "maplibre-gl"

export type MapView = "map" | "satellite" | "3d"

export const MAP_VIEWS: { id: MapView; label: string }[] = [
  { id: "map", label: "Map" },
  { id: "satellite", label: "Satellite" },
  { id: "3d", label: "3D" },
]

const CARTO = {
  light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
  dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
}

const SOURCES: Record<string, SourceSpecification> = {
  imagery: {
    type: "raster",
    tiles: [
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    ],
    tileSize: 256,
    maxzoom: 19,
    attribution:
      'Imagery © <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
  },
  // OpenStreetMap vector data (labels, buildings), no API key needed.
  osm: {
    type: "vector",
    url: "https://tiles.openfreemap.org/planet",
    attribution:
      '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  },
  terrain: {
    type: "raster-dem",
    tiles: [
      "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
    ],
    encoding: "terrarium",
    tileSize: 256,
    maxzoom: 15,
    attribution: "Terrain: Mapzen, AWS Open Data",
  },
}

const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf"
type SymbolLayout = NonNullable<
  Extract<LayerSpecification, { type: "symbol" }>["layout"]
>
const NAME: SymbolLayout["text-field"] = [
  "coalesce",
  ["get", "name:en"],
  ["get", "name:latin"],
  ["get", "name"],
]

/** White labels with a dark halo so they read on top of imagery. */
const LABEL_LAYERS: LayerSpecification[] = [
  {
    id: "road-labels",
    type: "symbol",
    source: "osm",
    "source-layer": "transportation_name",
    minzoom: 13,
    filter: [
      "match",
      ["get", "class"],
      ["motorway", "trunk", "primary", "secondary", "tertiary", "minor"],
      true,
      false,
    ],
    layout: {
      "symbol-placement": "line",
      "text-field": NAME,
      "text-font": ["Noto Sans Regular"],
      "text-size": ["interpolate", ["linear"], ["zoom"], 13, 10, 18, 14],
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "rgba(0,0,0,0.75)",
      "text-halo-width": 1.5,
    },
  },
  {
    id: "place-labels",
    type: "symbol",
    source: "osm",
    "source-layer": "place",
    filter: [
      "match",
      ["get", "class"],
      [
        "country",
        "state",
        "city",
        "town",
        "village",
        "suburb",
        "neighbourhood",
        "quarter",
      ],
      true,
      false,
    ],
    layout: {
      "text-field": NAME,
      "text-font": [
        "match",
        ["get", "class"],
        ["country", "state", "city"],
        ["literal", ["Noto Sans Bold"]],
        ["literal", ["Noto Sans Regular"]],
      ],
      "text-size": [
        "match",
        ["get", "class"],
        "country",
        16,
        "state",
        14,
        "city",
        15,
        "town",
        13,
        12,
      ],
      "text-max-width": 8,
      "text-transform": [
        "match",
        ["get", "class"],
        ["country", "state"],
        "uppercase",
        "none",
      ],
      "text-letter-spacing": [
        "match",
        ["get", "class"],
        ["country", "state"],
        0.08,
        0,
      ],
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "rgba(0,0,0,0.75)",
      "text-halo-width": 1.5,
    },
  },
]

/** Esri World Imagery with OpenStreetMap place and road names on top. */
function satelliteStyle(): StyleSpecification {
  return {
    version: 8,
    projection: { type: "globe" },
    glyphs: GLYPHS,
    sources: { imagery: SOURCES.imagery, osm: SOURCES.osm },
    layers: [
      { id: "imagery", type: "raster", source: "imagery" },
      ...LABEL_LAYERS,
    ],
  }
}

/** Satellite draped over real terrain, with 3D buildings and a sky. */
function threeDStyle(): StyleSpecification {
  return {
    version: 8,
    projection: { type: "globe" },
    glyphs: GLYPHS,
    sources: SOURCES,
    // 1 = true height; more than that makes flat cities look wavy.
    terrain: { source: "terrain", exaggeration: 1 },
    sky: {
      "sky-color": "#7ab8f5",
      "horizon-color": "#dcecfb",
      "fog-color": "#dcecfb",
      "sky-horizon-blend": 0.6,
      "horizon-fog-blend": 0.7,
      "fog-ground-blend": 0.8,
      "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 12, 0],
    },
    layers: [
      { id: "imagery", type: "raster", source: "imagery" },
      {
        id: "buildings-3d",
        type: "fill-extrusion",
        source: "osm",
        "source-layer": "building",
        minzoom: 14,
        paint: {
          "fill-extrusion-color": "#e8e4dc",
          "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
          "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
          "fill-extrusion-opacity": 0.85,
        },
      },
      ...LABEL_LAYERS,
    ],
  }
}

export function styleFor(
  view: MapView,
  theme: "light" | "dark"
): string | StyleSpecification {
  if (view === "satellite") return satelliteStyle()
  if (view === "3d") return threeDStyle()
  return CARTO[theme]
}

/** Identity of the style, so we only call setStyle when it really changes. */
export function styleKey(view: MapView, theme: "light" | "dark") {
  return view === "map" ? `map-${theme}` : view
}
