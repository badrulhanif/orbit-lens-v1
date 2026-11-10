/**
 * Major Malaysian floods that the live feeds don't cover (GDACS only has
 * Malaysian records from 2025, and Wikidata's flood items have no
 * coordinates). Each entry lists only the states its Wikipedia article
 * names as affected, with what happened in each; they're state-wide
 * records, not points on the map.
 *
 * Dates: "YYYY-MM-DD" where the article gives a day, "YYYY-MM" otherwise.
 */
type MajorFlood = {
  title: string
  date: string
  url: string
  /**
   * The states its Wikipedia article names as affected, each with what
   * happened there (null: listed as affected, no details given).
   */
  states: Record<string, string | null>
}

// Checked against each Wikipedia article (Nov 2026).
const MAJOR_FLOODS: MajorFlood[] = [
  {
    title: "1971 Kuala Lumpur floods",
    date: "1971-01",
    url: "https://en.wikipedia.org/wiki/1971_Kuala_Lumpur_floods",
    states: {
      "Kuala Lumpur":
        "Klang, Batu and Gombak rivers; 32 killed, 180,000 affected",
    },
  },
  {
    title: "2006–07 Southeast Asian floods",
    date: "2006-12-18",
    url: "https://en.wikipedia.org/wiki/2006%E2%80%932007_Southeast_Asian_floods",
    states: {
      Johor:
        "Worst hit: all 8 districts flooded, 60,000–70,000 evacuated (Segamat, Kota Tinggi)",
      Malacca: "3,193 people left their homes",
      Pahang: "Over 2,000 evacuated around Rompin",
      "Negeri Sembilan": "80 evacuated; Gemas and Gemencheh flooded",
    },
  },
  {
    title: "2010 Thailand–Malaysia floods",
    date: "2010-11",
    url: "https://en.wikipedia.org/wiki/2010_Thailand%E2%80%93Malaysia_floods",
    states: {
      Kedah:
        "Worst hit: at least 4 killed, about 50,000 evacuated, 45,000 ha of rice fields damaged",
      Perlis: "Over 2,200 evacuated; two-thirds of the state under water",
      Kelantan: "Least affected; some schools closed",
    },
  },
  {
    title: "Early 2014 Sabah floods",
    date: "2014-01-13",
    url: "https://en.wikipedia.org/wiki/Early_2014_Sabah_floods",
    states: {
      Sabah: "Interior Division, plus Menggatal, Penampang and Tuaran",
    },
  },
  {
    title: "2014 Cameron Highlands mud floods",
    date: "2014-11-05",
    url: "https://en.wikipedia.org/wiki/2014_Cameron_Highlands_mud_floods",
    states: {
      Pahang: "Ringlet and Bertam Valley, Cameron Highlands; 3 killed",
    },
  },
  {
    title: "2014–15 Malaysian floods",
    date: "2014-12-15",
    url: "https://en.wikipedia.org/wiki/2014%E2%80%932015_Malaysian_floods",
    states: {
      Kelantan: "Worst hit: 354,800 affected, 21 killed",
      Terengganu: "Kemaman the worst-hit district",
      Pahang: "Kuantan, Maran, Jerantut, Lipis and Pekan worst hit",
      Sabah:
        "About 30 villages along the Padas River (Beaufort) badly affected",
      Johor: null,
      Kedah: null,
      "Negeri Sembilan": null,
      Perak: null,
      Perlis: null,
      Sarawak: null,
      Selangor: null,
    },
  },
  {
    title: "2015 East Malaysian floods",
    date: "2015-01-17",
    url: "https://en.wikipedia.org/wiki/2015_East_Malaysian_floods",
    states: {
      Sarawak:
        "Up to about 10,000 evacuated; Kuching and Limbang among the worst",
      Sabah:
        "Beaufort, Membakut, Papar, Tenom and Sipitang; 500+ families in relief centres",
    },
  },
  {
    title: "2017 Malaysian floods",
    date: "2017-11-04",
    url: "https://en.wikipedia.org/wiki/2017_Malaysian_floods",
    states: {
      Penang: "Worst hit: 7 killed, over 7,000 displaced",
      Kedah: "3,402 evacuated across five districts",
      Perak: "174 displaced; a landslide near Lenggong",
    },
  },
  {
    title: "2021–22 Malaysian floods",
    date: "2021-12-16",
    url: "https://en.wikipedia.org/wiki/2021%E2%80%932022_Malaysian_floods",
    states: {
      Selangor: "Worst hit: 45 deaths, 31,644 displaced",
      Pahang: "Among the worst hit: 21 deaths, 33,353 displaced",
      "Kuala Lumpur":
        "332 displaced; Dataran Merdeka and Jalan Masjid India flooded",
      Kelantan: "4 deaths, 1,559 displaced",
      Sabah: "3 deaths; evacuations around Kudat",
      "Negeri Sembilan": "1 death, 301 displaced",
      Perak: "225 displaced",
      Malacca: "2,537 evacuated; the worst floods there in 50 years",
      Terengganu: "Minor flooding",
    },
  },
  {
    title: "2022 Malaysian east coast floods",
    date: "2022-02-26",
    url: "https://en.wikipedia.org/wiki/2022_Malaysian_east_coast_floods",
    states: {
      Terengganu: "Worst hit: 17,641 displaced",
      Kelantan: "9,056 displaced; Pasir Mas the worst-hit district",
      Pahang: "Smaller scale; evacuations in Kuantan",
    },
  },
]

/** Gazetteer state names → the names used above. */
const ALIASES: Record<string, string> = {
  "Pulau Pinang": "Penang",
  Melaka: "Malacca",
}

/**
 * Major floods recorded for a state (by its gazetteer name), each with
 * what happened in that state.
 */
export function majorFloodsFor(stateName: string) {
  const name = ALIASES[stateName] ?? stateName
  return MAJOR_FLOODS.filter((f) => name in f.states).map((f) => {
    const others = Object.keys(f.states).length - 1
    return {
      title: f.title,
      date: f.date,
      url: f.url,
      detail:
        f.states[name] ?? `Listed among the ${others + 1} affected states`,
    }
  })
}
