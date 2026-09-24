const MONTHS: Record<string, string> = {
  jan: "january",
  feb: "february",
  mar: "march",
  apr: "april",
  jun: "june",
  jul: "july",
  aug: "august",
  sep: "september",
  sept: "september",
  oct: "october",
  nov: "november",
  dec: "december",
};

/** Abbreviations and synonyms common in market titles. Values may be multi-word. */
const ABBREVIATIONS: Record<string, string> = {
  ...MONTHS,
  us: "united states",
  usa: "united states",
  uk: "united kingdom",
  fed: "federal reserve",
  fomc: "federal reserve",
  gop: "republican",
  rep: "republican",
  dem: "democrat",
  dems: "democrat",
  democrats: "democrat",
  democratic: "democrat",
  republicans: "republican",
  potus: "president",
  pres: "president",
  gov: "governor",
  sen: "senator",
  btc: "bitcoin",
  eth: "ethereum",
  sol: "solana",
  cpi: "inflation",
  pct: "percent",
  "%": "percent",
  vs: "versus",
  v: "versus",
  nyc: "new york city",
  la: "los angeles",
  sf: "san francisco",
  mlb: "baseball",
  nba: "basketball",
  nfl: "football",
  nhl: "hockey",
  bps: "basis points",
  bp: "basis points",
  q1: "first quarter",
  q2: "second quarter",
  q3: "third quarter",
  q4: "fourth quarter",
  wins: "win",
  won: "win",
  winner: "win",
  reaches: "reach",
  above: "above",
  over: "above",
  exceed: "above",
  exceeds: "above",
  below: "below",
  under: "below",
};

const STOPWORDS = new Set([
  "a", "an", "the", "will", "be", "is", "are", "was", "of", "in", "on", "at", "by", "to", "for",
  "and", "or", "who", "what", "which", "when", "does", "do", "this", "that", "it", "its", "as",
  "with", "from", "than", "any", "before", "after", "end", "market", "yes", "no",
]);

/** "$100k" → "100000", "1.5m" → "1500000", "2,500" → "2500". */
function expandNumber(tok: string): string {
  const m = /^(\d+(?:\.\d+)?)([kmb])$/.exec(tok);
  if (!m) return tok;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2] as "k" | "m" | "b"];
  return String(Math.round(Number(m[1]) * mult));
}

/** Lowercase, strip punctuation, expand abbreviations and months, drop stopwords. */
export function normalizeTokens(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/%/g, " percent ")
    .replace(/(\d),(\d{3})/g, "$1$2")
    .replace(/[’']s\b/g, "")
    .replace(/[^a-z0-9.\s]/g, " ")
    // keep decimal points only inside numbers
    .replace(/(?<!\d)\.|\.(?!\d)/g, " ");
  const out: string[] = [];
  for (const raw of cleaned.split(/\s+/)) {
    if (!raw) continue;
    const expanded = ABBREVIATIONS[raw] ?? expandNumber(raw);
    for (const t of expanded.split(" ")) {
      if (t && !STOPWORDS.has(t)) out.push(t);
    }
  }
  return out;
}

export function normalizeTitle(text: string): string {
  return normalizeTokens(text).join(" ");
}
