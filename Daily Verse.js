// =============================================================================
// Daily Verse.js
// -----------------------------------------------------------------------------
// A regal daily Bible verse widget for iOS, built for the Scriptable app.
//
// Companion file: "VerseData.js" (must live in the same iCloud Drive/Scriptable
// folder). It exports 365 verse entries selected by day-of-year, and is the
// file you edit on your laptop to paste in NIV 1984 verse text.
//
// Widget sizes supported:
//   - Home Screen: large (full regal layout), medium, small (compact fallbacks)
//   - Lock Screen: accessoryRectangular (shortened verse + reference),
//                  accessoryInline (reference only)
//   - In-app run: a polished WebView detail screen
//
// Tap behavior: tapping the widget opens this script, which (because it is
// not running inside a widget at that point) presents the WebView detail
// screen instead.
// =============================================================================

const VerseData = importModule("VerseData");

// -----------------------------------------------------------------------------
// CONFIG -- API (optional). Fill these in ONLY if you want the widget to try
// fetching verse text automatically for days you haven't filled in yet.
//
// IMPORTANT: Most free/keyless Bible APIs only offer public-domain
// translations (KJV, WEB, ASV, etc.) because NIV is still under copyright.
// A licensed API such as api.scripture.api.bible can return NIV text, but
// typically only the NIV 2011 edition -- NOT the NIV 1984 wording this widget
// is designed around. If exact NIV 1984 wording matters to you, the most
// reliable path is still to paste it into VerseData.js yourself; treat the
// API fetch below purely as a "better than nothing" placeholder for days you
// haven't filled in yet.
// -----------------------------------------------------------------------------
const API_URL = "https://api.scripture.api.bible/v1/bibles/{BIBLE_ID}/search?query={QUERY}"; // <-- SET ME (or leave as a template; it's unused until configured below)
const API_KEY = "YOUR_API_KEY_HERE";        // <-- SET ME to enable fetching
const API_BIBLE_ID = "YOUR_BIBLE_ID_HERE";  // <-- SET ME to enable fetching (an api.bible "bibleId")
const FALLBACK_NOTE = "Add verse text in VerseData.js";

// -----------------------------------------------------------------------------
// CONFIG -- Design
// -----------------------------------------------------------------------------
const COLORS = {
  gradientTop: new Color("#0B1F3A"),       // deep navy
  gradientBottom: new Color("#3B0A1F"),    // deep burgundy
  gold: new Color("#C9A24B"),
  cream: new Color("#F5EBD7"),
  creamDim: new Color("#F5EBD7", 0.72),
};

// HTML palette mirrors COLORS above, plus a light-mode variant for the
// in-app detail screen.
const HTML_COLORS = {
  dark: { bgTop: "#0B1F3A", bgBottom: "#3B0A1F", gold: "#C9A24B", cream: "#F5EBD7", creamDim: "rgba(245,235,215,0.72)" },
  light: { bg: "#F5EBD7", panel: "#FFFDF8", gold: "#8A6A22", text: "#1B2A41", textDim: "rgba(27,42,65,0.65)" },
};

function serifFont(size, bold) {
  // Scriptable's Font constructor falls back gracefully if a named font is
  // unavailable on-device, but we still guard with try/catch for safety.
  try {
    return new Font(bold ? "Georgia-Bold" : "Georgia", size);
  } catch (e) {
    return bold ? Font.boldSystemFont(size) : Font.systemFont(size);
  }
}

// Simulates small-caps + letter spacing using uppercase text with thin spaces
// between characters (Scriptable's WidgetText has no native letter-spacing).
function letterSpaced(str) {
  if (!str) return "";
  return str.toUpperCase().split("").join(" ");
}

function buildGradient() {
  const g = new LinearGradient();
  g.colors = [COLORS.gradientTop, COLORS.gradientBottom];
  g.locations = [0, 1];
  g.startPoint = new Point(0, 0);
  g.endPoint = new Point(1, 1);
  return g;
}

// -----------------------------------------------------------------------------
// Date helpers
// -----------------------------------------------------------------------------
function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  const diffMs = date.getTime() - start.getTime();
  return Math.floor(diffMs / 86400000) + 1;
}

function nextRefreshDate() {
  const now = new Date();
  // Shortly after midnight so the new day's verse is ready when checked.
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 5, 0, 0);
}

// -----------------------------------------------------------------------------
// Verse text resolution: manual text -> on-disk cache -> API fetch -> fallback
// -----------------------------------------------------------------------------
function isApiConfigured() {
  return (
    typeof API_KEY === "string" && API_KEY.length > 0 && API_KEY !== "YOUR_API_KEY_HERE" &&
    typeof API_BIBLE_ID === "string" && API_BIBLE_ID.length > 0 && API_BIBLE_ID !== "YOUR_BIBLE_ID_HERE"
  );
}

function cacheDirectory() {
  const fm = FileManager.local();
  const dir = fm.joinPath(fm.cacheDirectory(), "DailyVerseCache");
  if (!fm.fileExists(dir)) {
    fm.createDirectory(dir);
  }
  return dir;
}

function cacheFilePath(reference) {
  const fm = FileManager.local();
  const safeName = reference.replace(/[^a-z0-9]/gi, "_") + ".json";
  return fm.joinPath(cacheDirectory(), safeName);
}

function readCache(reference) {
  const fm = FileManager.local();
  const path = cacheFilePath(reference);
  if (!fm.fileExists(path)) return null;
  try {
    const raw = fm.readString(path);
    const obj = JSON.parse(raw);
    return obj && typeof obj.text === "string" ? obj.text : null;
  } catch (e) {
    return null;
  }
}

function writeCache(reference, text) {
  try {
    const fm = FileManager.local();
    const path = cacheFilePath(reference);
    fm.writeString(path, JSON.stringify({ reference, text, fetchedAt: Date.now() }));
  } catch (e) {
    // Cache write failures are non-fatal; the widget still renders.
  }
}

function stripHtmlTags(s) {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// Best-effort extraction across a few common Bible API response shapes.
// If you use a different provider, adjust this function to match its JSON.
function extractTextFromResponse(json) {
  if (!json) return null;
  if (typeof json.text === "string") return json.text;
  if (json.data) {
    if (typeof json.data.content === "string") return json.data.content;
    if (Array.isArray(json.data.passages) && json.data.passages[0] && typeof json.data.passages[0].content === "string") {
      return json.data.passages[0].content;
    }
  }
  if (Array.isArray(json.verses) && json.verses[0] && typeof json.verses[0].text === "string") {
    return json.verses[0].text;
  }
  return null;
}

async function fetchVerse(reference) {
  if (!isApiConfigured()) return null;
  try {
    const query = encodeURIComponent(reference);
    const url = API_URL.replace("{BIBLE_ID}", API_BIBLE_ID).replace("{QUERY}", query);
    const req = new Request(url);
    req.headers = { "api-key": API_KEY };
    const json = await req.loadJSON();
    const raw = extractTextFromResponse(json);
    return raw ? stripHtmlTags(raw) : null;
  } catch (e) {
    return null;
  }
}

async function resolveVerseText(entry) {
  if (entry.text && entry.text.trim().length > 0) {
    return entry.text.trim();
  }
  const cached = readCache(entry.reference);
  if (cached) return cached;
  const fetched = await fetchVerse(entry.reference);
  if (fetched) {
    writeCache(entry.reference, fetched);
    return fetched;
  }
  return FALLBACK_NOTE;
}

function truncate(str, maxLen) {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1).trimEnd() + "…";
}

// -----------------------------------------------------------------------------
// Widget builders
// -----------------------------------------------------------------------------
function addDivider(w) {
  const divider = w.addText("✦ ❖ ✦"); // ✦ ❖ ✦
  divider.font = serifFont(11, false);
  divider.textColor = COLORS.gold;
  divider.centerAlignText();
}

function createLargeWidget(entry, verseText) {
  const w = new ListWidget();
  w.backgroundGradient = buildGradient();
  w.url = URLScheme.forRunningScript();
  w.setPadding(22, 20, 16, 20);

  const themeEl = w.addText(letterSpaced(entry.theme));
  themeEl.font = serifFont(13, true);
  themeEl.textColor = COLORS.gold;
  themeEl.centerAlignText();

  w.addSpacer(12);

  const verseEl = w.addText(verseText);
  verseEl.font = serifFont(22, false);
  verseEl.textColor = COLORS.cream;
  verseEl.centerAlignText();
  verseEl.minimumScaleFactor = 0.5;
  verseEl.lineLimit = 7;

  w.addSpacer(12);

  const refEl = w.addText(letterSpaced(entry.reference));
  refEl.font = serifFont(13, true);
  refEl.textColor = COLORS.gold;
  refEl.centerAlignText();

  w.addSpacer(10);
  addDivider(w);
  w.addSpacer(10);

  const ctxEl = w.addText(entry.context);
  ctxEl.font = serifFont(12, false);
  ctxEl.textColor = COLORS.creamDim;
  ctxEl.centerAlignText();
  ctxEl.lineLimit = 2;
  ctxEl.minimumScaleFactor = 0.7;

  w.addSpacer();

  const credit = w.addText("NIV 1984, © Biblica");
  credit.font = serifFont(9, false);
  credit.textColor = COLORS.creamDim;
  credit.centerAlignText();

  w.refreshAfterDate = nextRefreshDate();
  return w;
}

function createMediumWidget(entry, verseText) {
  const w = new ListWidget();
  w.backgroundGradient = buildGradient();
  w.url = URLScheme.forRunningScript();
  w.setPadding(16, 18, 14, 18);

  const themeEl = w.addText(letterSpaced(entry.theme));
  themeEl.font = serifFont(11, true);
  themeEl.textColor = COLORS.gold;
  themeEl.centerAlignText();

  w.addSpacer(6);

  const verseEl = w.addText(verseText);
  verseEl.font = serifFont(16, false);
  verseEl.textColor = COLORS.cream;
  verseEl.centerAlignText();
  verseEl.minimumScaleFactor = 0.55;
  verseEl.lineLimit = 4;

  w.addSpacer(6);

  const refEl = w.addText(letterSpaced(entry.reference));
  refEl.font = serifFont(11, true);
  refEl.textColor = COLORS.gold;
  refEl.centerAlignText();

  w.refreshAfterDate = nextRefreshDate();
  return w;
}

function createSmallWidget(entry) {
  const w = new ListWidget();
  w.backgroundGradient = buildGradient();
  w.url = URLScheme.forRunningScript();
  w.setPadding(14, 10, 14, 10);

  const themeEl = w.addText(letterSpaced(entry.theme));
  themeEl.font = serifFont(10, true);
  themeEl.textColor = COLORS.gold;
  themeEl.centerAlignText();
  themeEl.minimumScaleFactor = 0.7;

  w.addSpacer();

  addDivider(w);

  w.addSpacer(6);

  const refEl = w.addText(entry.reference);
  refEl.font = serifFont(13, true);
  refEl.textColor = COLORS.cream;
  refEl.centerAlignText();
  refEl.minimumScaleFactor = 0.7;
  refEl.lineLimit = 2;

  w.refreshAfterDate = nextRefreshDate();
  return w;
}

function createLockRectangular(entry, verseText) {
  const w = new ListWidget();
  w.url = URLScheme.forRunningScript();
  w.setPadding(4, 6, 4, 6);
  // Lock Screen accessory widgets are rendered by iOS in a tinted/monochrome
  // style; custom backgrounds and colors are intentionally left unset here
  // so the system styling is respected.

  const shortVerse = truncate(verseText, 70);
  const verseEl = w.addText(shortVerse);
  verseEl.font = serifFont(12, false);
  verseEl.minimumScaleFactor = 0.6;
  verseEl.lineLimit = 2;

  w.addSpacer(2);

  const refEl = w.addText(entry.reference);
  refEl.font = serifFont(11, true);
  refEl.lineLimit = 1;
  refEl.minimumScaleFactor = 0.8;

  return w;
}

function createLockInline(entry) {
  const w = new ListWidget();
  w.url = URLScheme.forRunningScript();
  const t = w.addText(entry.reference);
  t.font = serifFont(13, false);
  return w;
}

async function createWidget(family, entry, verseText) {
  switch (family) {
    case "large":
      return createLargeWidget(entry, verseText);
    case "medium":
      return createMediumWidget(entry, verseText);
    case "small":
      return createSmallWidget(entry);
    case "accessoryRectangular":
      return createLockRectangular(entry, verseText);
    case "accessoryInline":
      return createLockInline(entry);
    default:
      // Sensible fallback if a new/unknown family is requested.
      return createLargeWidget(entry, verseText);
  }
}

// -----------------------------------------------------------------------------
// In-app detail screen (WebView), shown when the script is run manually
// (e.g. by tapping the widget) rather than rendered as a widget.
// -----------------------------------------------------------------------------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildDetailHTML(entry, verseText) {
  const d = HTML_COLORS.dark;
  const l = HTML_COLORS.light;
  const showPlaceholderNote = verseText === FALLBACK_NOTE;

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta charset="utf-8">
<style>
  :root {
    --bgTop: ${d.bgTop}; --bgBottom: ${d.bgBottom};
    --gold: ${d.gold}; --cream: ${d.cream}; --creamDim: ${d.creamDim};
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bgTop: ${l.bg}; --bgBottom: ${l.bg};
      --gold: ${l.gold}; --cream: ${l.text}; --creamDim: ${l.textDim};
    }
  }
  html, body {
    margin: 0; padding: 0;
    background: linear-gradient(160deg, var(--bgTop), var(--bgBottom));
    color: var(--cream);
    font-family: Baskerville, Georgia, "Times New Roman", serif;
    min-height: 100%;
  }
  .wrap {
    max-width: 560px;
    margin: 0 auto;
    padding: 48px 28px 32px;
    box-sizing: border-box;
    text-align: center;
  }
  .theme {
    letter-spacing: 3px;
    text-transform: uppercase;
    color: var(--gold);
    font-size: 14px;
    font-weight: bold;
    margin-bottom: 18px;
  }
  .verse {
    font-size: 26px;
    line-height: 1.45;
    margin-bottom: 18px;
  }
  .note {
    font-size: 15px;
    font-style: italic;
    color: var(--creamDim);
    margin-bottom: 18px;
  }
  .reference {
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--gold);
    font-weight: bold;
    font-size: 15px;
    margin-bottom: 16px;
  }
  .divider {
    color: var(--gold);
    font-size: 14px;
    margin: 10px 0 24px;
  }
  .passage {
    font-size: 13px;
    color: var(--creamDim);
    margin-bottom: 20px;
  }
  .context {
    font-size: 16px;
    line-height: 1.6;
    margin-bottom: 26px;
  }
  .reflection-label {
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--gold);
    font-size: 11px;
    margin-bottom: 8px;
  }
  .reflection {
    font-size: 17px;
    font-style: italic;
    line-height: 1.5;
    margin-bottom: 36px;
  }
  .footer {
    font-size: 11px;
    color: var(--creamDim);
    border-top: 1px solid rgba(201,162,75,0.3);
    padding-top: 14px;
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="theme">${escapeHtml(entry.theme)}</div>
    ${showPlaceholderNote
      ? `<div class="note">${escapeHtml(verseText)}</div>`
      : `<div class="verse">“${escapeHtml(verseText)}”</div>`}
    <div class="reference">${escapeHtml(entry.reference)}</div>
    <div class="divider">✦ ❖ ✦</div>
    <div class="passage">${escapeHtml(entry.passage)}</div>
    <div class="context">${escapeHtml(entry.context)}</div>
    <div class="reflection-label">Reflect</div>
    <div class="reflection">${escapeHtml(entry.reflection)}</div>
    <div class="footer">NIV 1984, &copy; Biblica</div>
  </div>
</body>
</html>`;
}

async function presentDetailScreen(entry, verseText) {
  const html = buildDetailHTML(entry, verseText);
  const wv = new WebView();
  await wv.loadHTML(html);
  await wv.present(true);
}

// -----------------------------------------------------------------------------
// Main
// -----------------------------------------------------------------------------
async function main() {
  const today = dayOfYear(new Date());
  const entry = VerseData.getVerseForDay(today);
  const verseText = await resolveVerseText(entry);

  if (config.runsInWidget) {
    const widget = await createWidget(config.widgetFamily, entry, verseText);
    Script.setWidget(widget);
  } else {
    // Running inside the app (including via a widget tap, since
    // URLScheme.forRunningScript() launches the script outside widget
    // context) -- show the polished detail screen.
    await presentDetailScreen(entry, verseText);
  }
  Script.complete();
}

await main();

// =============================================================================
// SETUP
// =============================================================================
// 1. Save both files on your laptop, inside:
//      iCloud Drive / Scriptable / VerseData.js
//      iCloud Drive / Scriptable / Daily Verse.js
//    Wait for iCloud to sync them to your iPhone (open the Scriptable app
//    once on the phone to confirm both scripts appear).
//
// 2. Add the widget:
//      Home Screen (large):  long-press the Home Screen -> "+" -> Scriptable
//        -> choose the "Large" size -> add it -> long-press the new widget
//        -> Edit Widget -> set "Script" to "Daily Verse", "When Interacting"
//        to "Run Script", and leave "Widget Parameter" blank.
//      Lock Screen (rectangular/inline): on the Lock Screen, long-press ->
//        Customize -> tap the widget area below the clock -> "+" -> search
//        for Scriptable -> choose "Rectangular" or "Circular/Inline" ->
//        select the "Daily Verse" script the same way as above.
//
// 3. Filling in NIV 1984 verse text:
//    Open VerseData.js on your laptop. Each of the 365 entries has a `text`
//    field left as an empty string (""). Paste the NIV 1984 wording for that
//    entry's `reference` between the quotes, e.g.:
//        text: "The LORD is my shepherd, I shall not be in want."
//    Save the file; iCloud Drive syncs it to your phone automatically, and
//    the widget picks it up the next time it refreshes (or immediately if
//    you re-open the script). You do not need to fill them all in at once --
//    any day left blank will show a small "Add verse text in VerseData.js"
//    note (or an automatically fetched verse, if you've configured the API
//    settings near the top of this file).
// =============================================================================
