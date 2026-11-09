/**
 * Major Malaysian floods that the live feeds don't cover (GDACS only has
 * Malaysian records from 2025, and Wikidata's flood items have no
 * coordinates). Each entry lists only the states its Wikipedia article
 * names as affected; they're state-wide records, not points on the map.
 *
 * Dates: "YYYY-MM-DD" where the article gives a day, "YYYY-MM" otherwise.
 */
type MajorFlood = {
  title: string
  date: string
  states: string[]
  detail: string
  url: string
}

const MAJOR_FLOODS: MajorFlood[] = [
  {
    title: "1971 Kuala Lumpur floods",
    date: "1971-01",
    states: ["Kuala Lumpur"],
    detail: "Klang, Batu and Gombak rivers; 32 killed, 180,000 affected",
    url: "https://en.wikipedia.org/wiki/1971_Kuala_Lumpur_floods",
  },
  {
    title: "2006–07 Southeast Asian floods",
    date: "2006-12-18",
    states: ["Johor", "Pahang", "Negeri Sembilan", "Malacca"],
    detail: "Johor worst hit, with a second larger flood in January 2007",
    url: "https://en.wikipedia.org/wiki/2006%E2%80%932007_Southeast_Asian_floods",
  },
  {
    title: "2010 Thailand–Malaysia floods",
    date: "2010-11",
    states: ["Kedah", "Perlis"],
    detail: "Northern Peninsular Malaysia",
    url: "https://en.wikipedia.org/wiki/2010_Thailand%E2%80%93Malaysia_floods",
  },
  {
    title: "Early 2014 Sabah floods",
    date: "2014-01-13",
    states: ["Sabah"],
    detail: "Interior Division, plus Menggatal, Penampang and Tuaran",
    url: "https://en.wikipedia.org/wiki/Early_2014_Sabah_floods",
  },
  {
    title: "2014 Cameron Highlands mud floods",
    date: "2014-11-05",
    states: ["Pahang"],
    detail: "Ringlet and Bertam Valley, Cameron Highlands; 3 killed",
    url: "https://en.wikipedia.org/wiki/2014_Cameron_Highlands_mud_floods",
  },
  {
    title: "2014–15 Malaysian floods",
    date: "2014-12-15",
    states: ["Kelantan", "Terengganu", "Pahang", "Perak", "Sabah", "Perlis"],
    detail: "Over 500,000 affected; Kelantan worst hit, 21 killed",
    url: "https://en.wikipedia.org/wiki/2014%E2%80%932015_Malaysian_floods",
  },
  {
    title: "2015 East Malaysian floods",
    date: "2015-01-17",
    states: ["Sarawak", "Sabah"],
    detail: "About 13,900 people evacuated",
    url: "https://en.wikipedia.org/wiki/2015_East_Malaysian_floods",
  },
  {
    title: "2017 Malaysian floods",
    date: "2017-11-04",
    states: ["Penang", "Kedah", "Perak"],
    detail: "Penang worst hit; 7 killed",
    url: "https://en.wikipedia.org/wiki/2017_Malaysian_floods",
  },
  {
    title: "2021–22 Malaysian floods",
    date: "2021-12-16",
    states: [
      "Selangor",
      "Kuala Lumpur",
      "Pahang",
      "Kelantan",
      "Negeri Sembilan",
      "Malacca",
      "Terengganu",
    ],
    detail:
      "Hulu Langat and Shah Alam badly hit; at least 54 dead, 125,000 affected",
    url: "https://en.wikipedia.org/wiki/2021%E2%80%932022_Malaysian_floods",
  },
  {
    title: "2022 Malaysian east coast floods",
    date: "2022-02",
    states: ["Kelantan", "Terengganu", "Pahang"],
    detail: "Monsoon rain; thousands displaced in Kelantan",
    url: "https://en.wikipedia.org/wiki/2022_Malaysian_east_coast_floods",
  },
]

/** Gazetteer state names → the names used above. */
const ALIASES: Record<string, string> = {
  "Pulau Pinang": "Penang",
  Melaka: "Malacca",
}

/** Major floods recorded for a state (by its gazetteer name). */
export function majorFloodsFor(stateName: string) {
  const name = ALIASES[stateName] ?? stateName
  return MAJOR_FLOODS.filter((f) => f.states.includes(name))
}
