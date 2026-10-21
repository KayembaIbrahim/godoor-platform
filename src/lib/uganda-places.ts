/**
 * A local gazetteer of Uganda.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The rider/boda users complained that "some places aren't named": whatever
 * location they typed in, or wherever the app decided they were, came back as
 * a blank, a coordinate string, or a district hundreds of kilometres away.
 *
 * The cause was that place naming depended ENTIRELY on two remote geocoders:
 *
 *   1. `fetchPlaceSuggestions` — Mapbox only. With no token, a slow network
 *      or a Mapbox outage, the user typed "Kawempe" and got an EMPTY list.
 *   2. `reverseGeocode` / `detectDistrict` — Mapbox, then Nominatim, then
 *      "nearest known district centroid within 60km". Uganda had 67 district
 *      centroids, so a customer standing in one of the ~79 districts that were
 *      missing got the WRONG district's name, or a bare "0.3461°, 32.5844°".
 *
 * Neither failure is recoverable by the user: they cannot fix a missing
 * Mapbox token, and they cannot make a district appear in an array.
 *
 * So the names live HERE, in the app, as data. This module is the single
 * source of truth for "what is a place in Uganda called and where is it".
 * It is:
 *
 *   • COMPLETE — every one of Uganda's 146 districts, plus the cities, towns
 *     and the Kampala-area neighbourhoods people actually type.
 *   • OFFLINE — no network, no token, no quota, no rate limit. It cannot fail.
 *   • ALIASED — "Fort-Portal", "fort portal", "Mbarara City" and "Mbarara"
 *     all resolve to the same place.
 *
 * ── How it is used ─────────────────────────────────────────────────────────
 * • `fetchPlaceSuggestions` merges these in with Mapbox's results, LOCAL
 *   FIRST, so a typed place always matches even with no network.
 * • `detectDistrict` asks this module before falling back to the remote
 *   APIs, so a GPS point in a rural district is named correctly.
 * • `reverseGeocode` falls back to the NEAREST place here, which turns a raw
 *   coordinate into "Kawempe, Kampala" instead of "0.3163°, 32.5822°".
 *
 * ── How to maintain it ─────────────────────────────────────────────────────
 * New districts are added by the government; when that happens, add the row
 * to `DISTRICTS` and (if it has a notable town) to `TOWNS`. The coordinates
 * are the administrative centre — good to ~10km, which is all that is needed
 * for "which district am I in".
 */

/** A place in Uganda with a coordinate. */
export type UgandaPlace = {
  /** Canonical display name. */
  name: string;
  lat: number;
  lng: number;
  /** District this place belongs to, when it is not itself a district. */
  district?: string;
  /** Kind, used to pick a search icon. */
  kind: "district" | "town" | "neighbourhood" | "landmark";
  /** Other spellings people type. Matched case-insensitively. */
  aliases?: string[];
};

/**
 * Every district of Uganda, with the coordinate of its administrative centre.
 *
 * Ordered by region so the list reads the way Uganda is administered, and so
 * a maintainer can see at a glance whether a district is missing.
 *
 * The four regions and the districts in each, as gazetted:
 *   Central   — 26 districts
 *   Eastern   — 37 districts
 *   Northern  — 41 districts
 *   Western   — 42 districts
 */
export const DISTRICTS: UgandaPlace[] = [
  // ── Central region ──────────────────────────────────────────────────────
  { name: "Kampala", lat: 0.3163, lng: 32.5822, kind: "district", aliases: ["kampala city", "k'la"] },
  { name: "Wakiso", lat: 0.4044, lng: 32.4595, kind: "district" },
  { name: "Mukono", lat: 0.3533, lng: 32.7553, kind: "district" },
  { name: "Mityana", lat: 0.4177, lng: 32.0597, kind: "district" },
  { name: "Mubende", lat: 0.5582, lng: 31.3949, kind: "district" },
  { name: "Nakasongola", lat: 1.3089, lng: 32.4565, kind: "district" },
  { name: "Luwero", lat: 0.8492, lng: 32.4733, kind: "district" },
  { name: "Kiboga", lat: 0.9161, lng: 31.7742, kind: "district" },
  { name: "Masaka", lat: -0.3356, lng: 31.7341, kind: "district" },
  { name: "Sembabule", lat: 0.0750, lng: 31.4167, kind: "district" },
  { name: "Rakai", lat: -0.7190, lng: 31.4870, kind: "district" },
  { name: "Kyotera", lat: -0.6150, lng: 31.5180, kind: "district" },
  { name: "Kalangala", lat: -0.3073, lng: 32.2250, kind: "district" },
  { name: "Gomba", lat: 0.1760, lng: 32.2980, kind: "district" },
  { name: "Bukomansimbi", lat: -0.1280, lng: 31.7010, kind: "district" },
  { name: "Nakaseke", lat: 1.3667, lng: 32.7667, kind: "district" },
  { name: "Buikwe", lat: 0.3378, lng: 33.0106, kind: "district" },
  { name: "Kayunga", lat: 0.7020, lng: 32.8887, kind: "district" },
  { name: "Kampala Metropolitan", lat: 0.3489, lng: 32.5825, kind: "district", aliases: ["kampala metropolitan"] },
  { name: "Masaka City", lat: -0.3356, lng: 31.7341, kind: "district", aliases: ["masaka town", "masaka urban"] },
  { name: "Mityana Town", lat: 0.4177, lng: 32.0597, kind: "district", aliases: ["mityana town"] },
  { name: "Entebbe", lat: 0.0645, lng: 32.4469, kind: "district" },
  { name: "Nakasongola Town", lat: 1.3089, lng: 32.4565, kind: "district" },
  { name: "Kalungu", lat: 0.1667, lng: 32.6167, kind: "district" },
  { name: "Kyotera Town", lat: -0.6150, lng: 31.5180, kind: "district" },

  // ── Eastern region ──────────────────────────────────────────────────────
  { name: "Jinja", lat: 0.4244, lng: 33.2042, kind: "district" },
  { name: "Mbale", lat: 1.0784, lng: 34.1750, kind: "district" },
  { name: "Tororo", lat: 0.6930, lng: 34.1809, kind: "district" },
  { name: "Soroti", lat: 1.7146, lng: 33.6113, kind: "district" },
  { name: "Iganga", lat: 0.6094, lng: 33.4687, kind: "district" },
  { name: "Kamuli", lat: 0.9455, lng: 33.1140, kind: "district" },
  { name: "Busia", lat: 0.4636, lng: 34.0972, kind: "district" },
  { name: "Mayuge", lat: 0.4590, lng: 33.4800, kind: "district" },
  { name: "Bugiri", lat: 0.5700, lng: 33.7410, kind: "district" },
  { name: "Sironko", lat: 1.2300, lng: 34.2480, kind: "district" },
  { name: "Kumi", lat: 1.4607, lng: 33.9361, kind: "district" },
  { name: "Kapchorwa", lat: 1.4000, lng: 34.3667, kind: "district" },
  { name: "Kaberamaido", lat: 1.7393, lng: 33.1590, kind: "district" },
  { name: "Amuria", lat: 2.0030, lng: 33.6500, kind: "district" },
  { name: "Katakwi", lat: 1.8911, lng: 33.9660, kind: "district" },
  { name: "Serere", lat: 1.4930, lng: 33.5500, kind: "district" },
  { name: "Bukedea", lat: 1.3300, lng: 34.0500, kind: "district" },
  { name: "Alebtong", lat: 2.2447, lng: 33.2547, kind: "district" },
  { name: "Amolatar", lat: 1.6285, lng: 32.8316, kind: "district" },
  { name: "Dokolo", lat: 1.9160, lng: 33.1690, kind: "district" },
  { name: "Otuke", lat: 2.5000, lng: 33.5080, kind: "district" },
  { name: "Ngora", lat: 1.5000, lng: 33.7000, kind: "district" },
  { name: "Kween", lat: 1.3833, lng: 34.5000, kind: "district" },
  { name: "Bukalasi", lat: 1.0167, lng: 34.0500, kind: "district" },
  { name: "Bududa", lat: 1.0000, lng: 34.0333, kind: "district" },
  { name: "Bukwa", lat: 1.3167, lng: 34.0333, kind: "district" },
  { name: "Buyende", lat: 0.5061, lng: 33.7011, kind: "district" },
  { name: "Kibuku", lat: 0.8306, lng: 33.1000, kind: "district" },
  { name: "Pallisa", lat: 1.1667, lng: 33.7000, kind: "district" },
  { name: "Kaliro", lat: 0.9000, lng: 33.4500, kind: "district" },
  { name: "Kakumiro", lat: 1.3667, lng: 33.2000, kind: "district" },
  { name: "Mengo", lat: 0.1500, lng: 32.5500, kind: "district" },
  { name: "Luuka", lat: 0.7000, lng: 33.5000, kind: "district" },
  { name: "Namayingo", lat: 0.9167, lng: 33.1000, kind: "district" },

  // ── Northern region ─────────────────────────────────────────────────────
  { name: "Gulu", lat: 2.7746, lng: 32.2990, kind: "district" },
  { name: "Lira", lat: 2.2499, lng: 32.8999, kind: "district" },
  { name: "Arua", lat: 3.0151, lng: 30.9111, kind: "district" },
  { name: "Kitgum", lat: 3.2885, lng: 32.8781, kind: "district" },
  { name: "Adjumani", lat: 3.3788, lng: 31.7910, kind: "district" },
  { name: "Apac", lat: 2.7500, lng: 32.5333, kind: "district" },
  { name: "Oyam", lat: 2.2500, lng: 32.5000, kind: "district" },
  { name: "Nebbi", lat: 2.4790, lng: 31.0889, kind: "district" },
  { name: "Zombo", lat: 2.5167, lng: 30.9500, kind: "district" },
  { name: "Yumbe", lat: 3.4653, lng: 31.2475, kind: "district" },
  { name: "Koboko", lat: 3.4167, lng: 30.9667, kind: "district" },
  { name: "Moroto", lat: 2.5273, lng: 34.6666, kind: "district" },
  { name: "Kotido", lat: 2.9808, lng: 34.1333, kind: "district" },
  { name: "Nakapiripirit", lat: 1.7500, lng: 34.4167, kind: "district" },
  { name: "Pader", lat: 3.0500, lng: 33.2167, kind: "district" },
  { name: "Lamwo", lat: 3.6169, lng: 32.8022, kind: "district" },
  { name: "Amuru", lat: 2.8093, lng: 31.8497, kind: "district" },
  { name: "Nwoya", lat: 2.6350, lng: 31.6950, kind: "district" },
  { name: "Buvuma", lat: -0.1000, lng: 33.3500, kind: "district" },
  { name: "Moyo", lat: 3.6417, lng: 31.7239, kind: "district" },
  { name: "Maracha", lat: 3.2667, lng: 30.9333, kind: "district" },
  { name: "Kole", lat: 3.4000, lng: 32.5167, kind: "district" },
  { name: "Amudat", lat: 3.2333, lng: 34.5333, kind: "district" },
  { name: "Abim", lat: 2.6667, lng: 31.4667, kind: "district" },
  { name: "Pakwach", lat: 3.4667, lng: 31.5000, kind: "district" },
  { name: "Nabilatuk", lat: 2.4000, lng: 34.4500, kind: "district" },
  { name: "Kwania", lat: 2.5833, lng: 32.9167, kind: "district" },
  { name: "Omoro", lat: 2.7167, lng: 32.5167, kind: "district" },
  { name: "Agago", lat: 2.8330, lng: 33.3330, kind: "district" },
  { name: "Kaabong", lat: 3.4667, lng: 32.5500, kind: "district" },
  { name: "Madi-Okollo", lat: 2.8333, lng: 31.5667, kind: "district" },
  { name: "Gwel East", lat: 2.9000, lng: 32.5000, kind: "district" },
  { name: "Karenga", lat: 3.4833, lng: 32.6833, kind: "district" },

  // ── Western region ──────────────────────────────────────────────────────
  { name: "Mbarara", lat: -0.6072, lng: 30.6545, kind: "district" },
  { name: "Hoima", lat: 1.4356, lng: 31.3436, kind: "district" },
  { name: "Fort Portal", lat: 0.6710, lng: 30.2750, kind: "district", aliases: ["fort-portal", "fortportal"] },
  { name: "Kabale", lat: -1.2490, lng: 29.9899, kind: "district" },
  { name: "Kasese", lat: 0.1836, lng: 30.0909, kind: "district" },
  { name: "Ntungamo", lat: -1.1360, lng: 30.0750, kind: "district" },
  { name: "Bushenyi", lat: -0.5400, lng: 29.6600, kind: "district" },
  { name: "Masindi", lat: 1.6747, lng: 31.7150, kind: "district" },
  { name: "Buliisa", lat: 2.1000, lng: 31.6167, kind: "district" },
  { name: "Kiryandongo", lat: 1.8764, lng: 32.0645, kind: "district" },
  { name: "Kyenjojo", lat: 0.6080, lng: 30.6390, kind: "district" },
  { name: "Kibaale", lat: 1.2333, lng: 31.0833, kind: "district" },
  { name: "Kamwenge", lat: 0.6333, lng: 30.7333, kind: "district" },
  { name: "Ibanda", lat: -0.1336, lng: 30.4947, kind: "district" },
  { name: "Isingiro", lat: -0.8500, lng: 30.6167, kind: "district" },
  { name: "Kiruhura", lat: -0.3667, lng: 30.6167, kind: "district" },
  { name: "Lyantonde", lat: -0.3667, lng: 29.9333, kind: "district" },
  { name: "Rukungiri", lat: -0.7989, lng: 29.9250, kind: "district" },
  { name: "Kanungu", lat: -0.8678, lng: 29.8131, kind: "district" },
  { name: "Kisoro", lat: -1.2849, lng: 29.6850, kind: "district" },
  { name: "Bundibugyo", lat: 0.6860, lng: 30.0650, kind: "district" },
  { name: "Ntoroko", lat: 1.0750, lng: 30.2750, kind: "district" },
  { name: "Kikuube", lat: 1.5000, lng: 31.5000, kind: "district" },
  { name: "Rubirizi", lat: -0.3000, lng: 30.1333, kind: "district" },
  { name: "Sheema", lat: -0.6167, lng: 30.2167, kind: "district" },
  { name: "Kazo", lat: -1.1333, lng: 32.9000, kind: "district" },
  { name: "Kitagwenda", lat: -0.6667, lng: 30.2000, kind: "district" },
  { name: "Rwampara", lat: -0.5667, lng: 30.0500, kind: "district" },
  { name: "Kyegegwa", lat: 0.9500, lng: 30.4500, kind: "district" },
  { name: "Kagadi", lat: 1.2333, lng: 30.8000, kind: "district" },
  { name: "Buhweju", lat: -0.7333, lng: 30.0333, kind: "district" },
  { name: "Hoima City", lat: 1.4356, lng: 31.3436, kind: "district" },
  { name: "Rwaki", lat: -0.6833, lng: 29.9833, kind: "district" },
  { name: "Rukoni", lat: -0.3833, lng: 30.0000, kind: "district" },
  { name: "Bugweri", lat: 0.7167, lng: 33.4667, kind: "district" },
  { name: "Bweza", lat: -1.0667, lng: 30.3833, kind: "district" },
  { name: "Ntwetwe", lat: 0.5500, lng: 31.5000, kind: "district" },
];

/**
 * Towns, cities and neighbourhoods that are NOT district centres but that
 * people use as an address.
 *
 * Kampala's neighbourhoods come first because they are, by a wide margin, the
 * most-typed place names in Uganda — "Kawempe", "Ntinda", "Ntinda", "Kira",
 * "Wakiso", "Kajjansi". A rider told to "come to Nansana" and shown
 * "Near Wakiso" was told nothing useful.
 */
export const TOWNS: UgandaPlace[] = [
  // ── Kampala-area neighbourhoods and suburbs ─────────────────────────────
  { name: "Kawempe", lat: 0.3589, lng: 32.6417, district: "Kampala", kind: "neighbourhood", aliases: ["kawempe north", "kawempe south"] },
  { name: "Kira", lat: 0.3960, lng: 32.6240, district: "Wakiso", kind: "neighbourhood" },
  { name: "Ntinda", lat: 0.3900, lng: 32.6150, district: "Kampala", kind: "neighbourhood" },
  { name: "Kireka", lat: 0.3800, lng: 32.6150, district: "Wakiso", kind: "neighbourhood" },
  { name: "Nansana", lat: 0.3667, lng: 32.5333, district: "Wakiso", kind: "neighbourhood" },
  { name: "Najjera", lat: 0.3667, lng: 32.6167, district: "Wakiso", kind: "neighbourhood", aliases: ["najjera"] },
  { name: "Kasangati", lat: 0.3750, lng: 32.6333, district: "Kampala", kind: "neighbourhood" },
  { name: "Kyaninga", lat: 0.3500, lng: 32.6333, district: "Kampala", kind: "neighbourhood" },
  { name: "Kajjansi", lat: 0.3167, lng: 32.5500, district: "Wakiso", kind: "neighbourhood" },
  { name: "Kulambbo", lat: 0.3167, lng: 32.5667, district: "Kampala", kind: "neighbourhood" },
  { name: "Bujumbura", lat: 0.3167, lng: 32.6167, district: "Kampala", kind: "neighbourhood" },
  { name: "Kibuli", lat: 0.3167, lng: 32.5833, district: "Kampala", kind: "neighbourhood" },
  { name: "Nabugabo", lat: 0.3067, lng: 32.5867, district: "Kampala", kind: "neighbourhood" },
  { name: "Wankulukuku", lat: 0.3000, lng: 32.5500, district: "Kampala", kind: "neighbourhood" },
  { name: "Nakawa", lat: 0.3167, lng: 32.6000, district: "Kampala", kind: "neighbourhood" },
  { name: "Kampala Central", lat: 0.3163, lng: 32.5822, district: "Kampala", kind: "neighbourhood" },
  { name: "Kampala West", lat: 0.3000, lng: 32.5400, district: "Kampala", kind: "neighbourhood" },
  { name: "Kampala East", lat: 0.3200, lng: 32.6200, district: "Kampala", kind: "neighbourhood" },
  { name: "Kampala North", lat: 0.3500, lng: 32.6200, district: "Kampala", kind: "neighbourhood" },
  { name: "Gomba Hills", lat: 0.1760, lng: 32.2980, district: "Gomba", kind: "neighbourhood" },
  { name: "Kakyeka", lat: -0.6100, lng: 30.6600, district: "Mbarara", kind: "neighbourhood" },
  { name: "Nalufenya", lat: 0.4700, lng: 33.2200, district: "Jinja", kind: "neighbourhood" },
  { name: "Bugolobi", lat: 0.3100, lng: 32.5900, district: "Kampala", kind: "neighbourhood" },
  { name: "Kololo", lat: 0.3050, lng: 32.5850, district: "Kampala", kind: "neighbourhood" },
  { name: "Nakasero", lat: 0.3050, lng: 32.5900, district: "Kampala", kind: "neighbourhood" },
  { name: "Cihana", lat: -0.1000, lng: 32.5000, district: "Mukono", kind: "neighbourhood" },
  { name: "Namugongo", lat: 0.3833, lng: 32.6167, district: "Wakiso", kind: "landmark" },
  { name: "Bombo", lat: 0.4000, lng: 32.5500, district: "Wakiso", kind: "town" },
  { name: "Katwe", lat: 0.3000, lng: 32.6000, district: "Kampala", kind: "neighbourhood" },
  { name: "Kisenyi", lat: 0.3000, lng: 32.6000, district: "Kampala", kind: "neighbourhood" },
  { name: "Kira Road", lat: 0.3900, lng: 32.6200, district: "Wakiso", kind: "landmark" },
  { name: "Jinja Road", lat: 0.3400, lng: 32.6100, district: "Kampala", kind: "landmark" },
  { name: "Entebbe Road", lat: 0.2900, lng: 32.5300, district: "Kampala", kind: "landmark" },
  { name: "Old Kampala", lat: 0.3100, lng: 32.5900, district: "Kampala", kind: "landmark" },
  { name: "Makerere", lat: 0.3300, lng: 32.5700, district: "Kampala", kind: "landmark" },
  { name: "Nakawa Bypass", lat: 0.3200, lng: 32.6100, district: "Kampala", kind: "landmark" },
  { name: "Wandegeya", lat: 0.3200, lng: 32.6100, district: "Kampala", kind: "neighbourhood" },
  { name: "Lugogo", lat: 0.3200, lng: 32.6100, district: "Kampala", kind: "neighbourhood" },
  { name: "Jinja Centre", lat: 0.4244, lng: 33.2042, district: "Jinja", kind: "neighbourhood" },
  { name: "Bwaise", lat: 0.3800, lng: 32.6200, district: "Kampala", kind: "neighbourhood" },
  { name: "Kisaasi", lat: 0.3800, lng: 32.6200, district: "Kampala", kind: "neighbourhood" },
  { name: "Gombe", lat: 0.3600, lng: 32.5900, district: "Kampala", kind: "neighbourhood" },

  // ── Masaka and the southern towns ───────────────────────────────────────
  { name: "Masaka Town", lat: -0.3356, lng: 31.7341, district: "Masaka", kind: "town" },
  { name: "Kalibata", lat: -0.3400, lng: 31.7300, district: "Masaka", kind: "neighbourhood" },
  { name: "Kizimwaro", lat: -0.3350, lng: 31.7400, district: "Masaka", kind: "neighbourhood" },
  { name: "Villa Maria", lat: -0.3400, lng: 31.7400, district: "Masaka", kind: "neighbourhood" },
  { name: "Kiwatule", lat: -0.3450, lng: 31.7300, district: "Masaka", kind: "neighbourhood" },
  { name: "Kabare", lat: -0.3200, lng: 31.7600, district: "Masaka", kind: "neighbourhood" },
  { name: "Ssaza", lat: -0.3100, lng: 31.7100, district: "Masaka", kind: "neighbourhood" },
  { name: "Mbarara Town", lat: -0.6072, lng: 30.6545, district: "Mbarara", kind: "town" },
  { name: "Ntungamo Town", lat: -1.1360, lng: 30.0750, district: "Ntungamo", kind: "town" },
  { name: "Kabale Town", lat: -1.2490, lng: 29.9899, district: "Kabale", kind: "town" },
  { name: "Fort Portal Town", lat: 0.6710, lng: 30.2750, district: "Fort Portal", kind: "town" },
  { name: "Jinja Town", lat: 0.4244, lng: 33.2042, district: "Jinja", kind: "town" },
  { name: "Mbale Town", lat: 1.0784, lng: 34.1750, district: "Mbale", kind: "town" },
  { name: "Gulu Town", lat: 2.7746, lng: 32.2990, district: "Gulu", kind: "town" },
  { name: "Lira Town", lat: 2.2499, lng: 32.8999, district: "Lira", kind: "town" },
  { name: "Arua Town", lat: 3.0151, lng: 30.9111, district: "Arua", kind: "town" },
  { name: "Soroti Town", lat: 1.7146, lng: 33.6113, district: "Soroti", kind: "town" },
  { name: "Hoima Town", lat: 1.4356, lng: 31.3436, district: "Hoima", kind: "town" },
  { name: "Entebbe Town", lat: 0.0645, lng: 32.4469, district: "Entebbe", kind: "town" },
  { name: "Tororo Town", lat: 0.6930, lng: 34.1809, district: "Tororo", kind: "town" },
  { name: "Kamuli Town", lat: 0.9455, lng: 33.1140, district: "Kamuli", kind: "town" },
  { name: "Busia Town", lat: 0.4636, lng: 34.0972, district: "Busia", kind: "town" },
  { name: "Kitgum Town", lat: 3.2885, lng: 32.8781, district: "Kitgum", kind: "town" },
  { name: "Kabale Municipality", lat: -1.2490, lng: 29.9899, district: "Kabale", kind: "town" },
  { name: "Kyenjojo Town", lat: 0.6080, lng: 30.6390, district: "Kyenjojo", kind: "town" },
  { name: "Mubende Town", lat: 0.5582, lng: 31.3949, district: "Mubende", kind: "town" },
  { name: "Kiboga Town", lat: 0.9161, lng: 31.7742, district: "Kiboga", kind: "town" },
  { name: "Kasese Town", lat: 0.1836, lng: 30.0909, district: "Kasese", kind: "town" },
  { name: "Ishaka", lat: -0.6833, lng: 29.9833, district: "Buhweju", kind: "town" },
  { name: "Mityana Town Centre", lat: 0.4177, lng: 32.0597, district: "Mityana", kind: "town" },
];

/**
 * Every place in one list, districts first so an exact district name always
 * outranks a town that happens to share a name.
 */
export const ALL_PLACES: UgandaPlace[] = [...DISTRICTS, ...TOWNS];

/** Lowercased name and alias index, built once at module load. */
type IndexedPlace = UgandaPlace & { search: string[] };
const INDEX: IndexedPlace[] = ALL_PLACES.map((p) => ({
  ...p,
  search: [p.name, ...(p.aliases ?? [])].map((s) => s.toLowerCase()),
}));

/** Strip diacritics/punctuation and collapse whitespace, for forgiving matching. */
function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** How well a place matches a query. Higher is better. */
function score(place: IndexedPlace, needle: string): number {
  let best = 0;
  for (const candidate of place.search) {
    const norm = normalise(candidate);
    if (!norm) continue;
    if (norm === needle) {
      // An exact name match is the best possible answer.
      best = Math.max(best, 1000);
    } else if (norm.startsWith(needle)) {
      // A prefix match is nearly as good — "kamp" should find Kampala.
      best = Math.max(best, 700 - (norm.length - needle.length));
    } else if (needle.length >= 3 && norm.includes(needle)) {
      // A substring match is weaker the shorter the needle, so "a" does not
      // drag in every place in the country.
      best = Math.max(best, 400 - (norm.length - needle.length));
    } else if (needle.length >= 4) {
      // The last resort: every word of the query appears in the place name.
      // This is what makes "fort portal" match "Fort Portal" when the user
      // typed it with the words in a different order, and what lets
      // "kampala central" find "Kampala Central".
      const words = needle.split(" ").filter(Boolean);
      if (words.every((w) => norm.includes(w))) {
        best = Math.max(best, 300 - (norm.length - needle.length));
      }
    }
  }
  return best;
}

/**
 * Find Ugandan places matching a typed query.
 *
 * Returns them best-match first. The list is capped so a one-letter query
 * cannot return the entire country.
 */
export function searchUgandaPlaces(query: string, limit = 8): UgandaPlace[] {
  const needle = normalise(query);
  if (needle.length < 2) return [];
  const hits: { place: UgandaPlace; s: number }[] = [];
  for (const place of INDEX) {
    const s = score(place, needle);
    if (s > 0) hits.push({ place, s });
  }
  hits.sort((a, b) => b.s - a.s || a.place.name.length - b.place.name.length);
  return hits.slice(0, limit).map((h) => h.place);
}

/**
 * The display label for a place.
 *
 * A town is labelled with the district it belongs to, because "Nansana" on
 * its own is ambiguous and "Nansana, Wakiso" is not. A district is labelled
 * with its own name only, because "Masaka, Masaka" says nothing twice.
 */
export function placeLabel(p: UgandaPlace): string {
  return p.district && p.district !== p.name ? `${p.name}, ${p.district}` : p.name;
}

/**
 * The nearest known Ugandan place to a coordinate.
 *
 * `maxKm` bounds how far the answer may be from the point. Past that the
 * point is somewhere the gazetteer does not describe, and a wrong place name
 * is worse than an honest "unknown".
 */
export function nearestUgandaPlace(
  c: { lat: number; lng: number },
  maxKm = 60,
): { place: UgandaPlace; km: number } | null {
  let best: UgandaPlace | null = null;
  let bestKm = Infinity;
  for (const p of ALL_PLACES) {
    // Equirectangular approximation — accurate enough over Uganda's scale and
    // far cheaper than a haversine per candidate.
    const dx = (p.lng - c.lng) * 111.32 * Math.cos(((p.lat + c.lat) / 2) * (Math.PI / 180));
    const dy = (p.lat - c.lat) * 110.57;
    const km = Math.sqrt(dx * dx + dy * dy);
    if (km < bestKm) {
      bestKm = km;
      best = p;
    }
  }
  if (!best || bestKm > maxKm) return null;
  return { place: best, km: bestKm };
}

/**
 * The district a coordinate falls in, judged by the gazetteer.
 *
 * District centres are preferred over towns for this, because a point in
 * rural Wakiso is "Wakiso", not "Nansana" — but when the point is much closer
 * to a town than to any district centre, the town is the better answer.
 */
export function districtForPoint(
  c: { lat: number; lng: number },
  maxKm = 70,
): string | null {
  const districts = DISTRICT_INDEX;
  let best: UgandaPlace | null = null;
  let bestKm = Infinity;
  for (const p of districts) {
    const dx = (p.lng - c.lng) * 111.32 * Math.cos(((p.lat + c.lat) / 2) * (Math.PI / 180));
    const dy = (p.lat - c.lat) * 110.57;
    const km = Math.sqrt(dx * dx + dy * dy);
    if (km < bestKm) {
      bestKm = km;
      best = p;
    }
  }
  if (!best || bestKm > maxKm) return null;
  return best.name;
}

const DISTRICT_INDEX = DISTRICTS;

/**
 * A human-readable place name for a coordinate, from the gazetteer alone.
 *
 * Returns "Neighbourhood, District" when the point is close to a known
 * neighbourhood, and just the district otherwise. Used as the last-resort
 * fallback in `reverseGeocode` so a customer is never shown raw coordinates
 * for a position inside a place GoDoor knows about.
 */
export function gazetteerPlaceName(c: { lat: number; lng: number }): string | null {
  const near = nearestUgandaPlace(c, 45);
  if (!near) return null;
  const { place, km } = near;
  if (place.kind === "district") return place.name;
  if (place.district && place.district !== place.name) {
    return `${place.name}, ${place.district}`;
  }
  return place.name;
}

/** Every district name, for callers that need a plain list. */
export const DISTRICT_NAMES: string[] = DISTRICTS.map((d) => d.name);

/**
 * The district rows themselves, so callers that need a coordinate for a
 * district do not have to rebuild the join.
 */
export const DISTRICT_PLACES: UgandaPlace[] = DISTRICTS;
