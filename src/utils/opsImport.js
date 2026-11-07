// Tolerant importer for exports from the WeChat admin console (and hand-made
// spreadsheets). Exports are per-day summaries, so rows are aggregated by date
// before they are stored; re-importing the same file must not double-count.
const FIELD_PATTERNS = {
  date: [/^日期$/, /统计日期/, /^时间$/, /^date$/],
  reads: [/阅读次数/, /阅读人数/, /阅读/, /^reads?$/],
  shares: [/分享次数/, /分享人数/, /分享/, /^shares?$/, /^forwards?$/],
  favorites: [/收藏次数/, /收藏人数/, /收藏/, /favou?rites?/],
  newFollowers: [/新增关注/, /新增人数/, /新关注/, /新增粉丝/, /new.?followers?/],
  lostFollowers: [/取消关注/, /取消人数/, /取关/, /unfollow/, /lost.?followers?/],
  title: [/^标题$/, /文章标题/, /^title$/],
};
const NUMERIC_FIELDS = ["reads", "shares", "favorites", "newFollowers", "lostFollowers"];
const DELIMITERS = [",", "\t", ";"];
const MAX_SKIP_DETAILS = 50;

function normalizeHeader(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s_（）()【】\[\]]/g, "");
}

function parseWithDelimiter(text, delimiter) {
  const rows = [];
  const numbers = [];
  let row = [];
  let cell = "";
  let quoted = false;
  // Original 1-based line numbers survive blank-row removal, so skip reasons
  // can point at the row the user sees in their spreadsheet.
  let line = 1;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      numbers.push(line);
      line += 1;
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  numbers.push(line);
  const cleaned = [];
  const cleanedNumbers = [];
  rows.forEach((items, index) => {
    if (!items.some((item) => String(item).trim())) return;
    cleaned.push(items);
    cleanedNumbers.push(numbers[index]);
  });
  const width = cleaned.reduce((max, items) => Math.max(max, items.length), 0);
  return {
    headers: cleaned[0] || [],
    rows: cleaned.slice(1),
    rowNumbers: cleanedNumbers.slice(1),
    width,
  };
}

export function parseDelimitedText(text) {
  const clean = String(text ?? "").replace(/^\uFEFF/, "").trim();
  if (!clean) return { headers: [], rows: [], rowNumbers: [], width: 0 };
  const best = DELIMITERS.map((delimiter) => parseWithDelimiter(clean, delimiter)).sort(
    (left, right) => right.width - left.width,
  )[0];
  return best;
}

export function detectMapping(headers) {
  const normalized = headers.map(normalizeHeader);
  const mapping = {};
  for (const [field, patterns] of Object.entries(FIELD_PATTERNS)) {
    const index = normalized.findIndex((header) => header && patterns.some((pattern) => pattern.test(header)));
    if (index >= 0) mapping[field] = index;
  }
  return mapping;
}

function isoDate(year, month, day) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

export function parseDateCell(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  let match = text.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]));
  match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return isoDate(Number(match[3]), Number(match[1]), Number(match[2]));
  if (/^\d{5}$/.test(text)) {
    // Excel serial days are counted from 1899-12-30.
    const serial = Number(text);
    const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
    if (date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100) return "";
    return date.toISOString().slice(0, 10);
  }
  return "";
}

export function parseNumberCell(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/[,，\s]/g, "");
  if (!text) return 0;
  const numeric = Number(text.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}

export function parseImportText(text) {
  const { headers, rows, rowNumbers, width } = parseDelimitedText(text);
  if (!headers.length || width < 2) return { error: "noHeader", headers, rows: [] };
  const mapping = detectMapping(headers);
  if (mapping.date === undefined) {
    return { error: "missingDate", headers, mapping, rows: [] };
  }
  const aggregated = new Map();
  let skipped = 0;
  const skippedRows = [];
  const pushSkip = (index, reason, value) => {
    if (skippedRows.length >= MAX_SKIP_DETAILS) return;
    skippedRows.push({ number: rowNumbers[index] ?? index + 2, reason, value });
  };
  rows.forEach((row, index) => {
    const date = parseDateCell(row[mapping.date]);
    if (!date) {
      skipped += 1;
      pushSkip(index, "date", String(row[mapping.date] ?? "").trim().slice(0, 24));
      return;
    }
    const day = aggregated.get(date) || {
      date,
      reads: 0,
      shares: 0,
      favorites: 0,
      newFollowers: 0,
      lostFollowers: 0,
    };
    let hasValue = false;
    for (const field of NUMERIC_FIELDS) {
      if (mapping[field] === undefined) continue;
      const value = parseNumberCell(row[mapping[field]]);
      if (value) hasValue = true;
      day[field] += value;
    }
    if (!hasValue) {
      skipped += 1;
      pushSkip(index, "empty", "");
      return;
    }
    aggregated.set(date, day);
  });
  const records = [...aggregated.values()].sort((left, right) => left.date.localeCompare(right.date));
  if (!records.length) return { error: "noRows", headers, mapping, rows: [], skipped, skippedRows };
  const fields = NUMERIC_FIELDS.filter((field) => mapping[field] !== undefined);
  return {
    error: "",
    headers,
    mapping,
    fields,
    records,
    skipped,
    skippedRows,
    mappedLabels: Object.fromEntries(
      fields.map((field) => [field, String(headers[mapping[field]] ?? "").trim()]),
    ),
  };
}
