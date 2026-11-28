// ─────────────────────────────────────────────────────────────
// VERDIEND — kleine lockscreen-widget: alleen vandaag al verdiend
// Werkt als accessoryRectangular, accessoryInline en accessoryCircular.
// ─────────────────────────────────────────────────────────────

const TOPIC = "wu-widget-4e91c7a2b8d60f35";   // zelfde topic als in de astyle-patch
const NTFY = "https://ntfy.sh/";
const UURLOON_FALLBACK = 13;
const REFRESH_MINUTEN = 15;                   // vraag niet vaker dan elk kwartier
const APP_URL = "https://toshalbir.github.io/astyle/";
const VERSIE = "L1";

const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), "werkuren-lockscreen-cache.json");

// ── Hulpfuncties ─────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, "0"); }

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function hhmm(h, m) { return `${pad(h)}:${pad(m)}`; }

function parseTime(value) {
  const v = String(value || "").trim();
  if (!v) return null;

  let match = v.match(/^(\d{1,2})$/);          // "8" = 08:00, net als in astyle
  if (match) {
    const h = Number(match[1]);
    if (h > 23) return null;
    return { h: h, m: 0, mins: h * 60 };
  }

  match = v.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { h: h, m: m, mins: h * 60 + m };
}

// Begin-/einduur kan bovenaan het bericht staan of in records[vandaag].
function startUit(d) {
  if (!d) return null;
  const a = parseTime(d.start);
  if (a) return a;
  const r = d.records && d.records[vandaag];
  return r ? parseTime(r.start) : null;
}

function eindUit(d) {
  if (!d) return null;
  const a = parseTime(d.end);
  if (a) return a;
  const r = d.records && d.records[vandaag];
  return r ? parseTime(r.end) : null;
}

function euroBedrag(n) {
  const delen = n.toFixed(2).replace(".", ",").split(",");
  delen[0] = delen[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return "€ " + delen.join(",");
}

function euroKort(n) {
  // Op het ronde widget is weinig plaats: tot € 10 met één decimaal,
  // daarboven afgerond op hele euro's.
  const tekst = n < 10
    ? n.toFixed(1).replace(".", ",")
    : String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return "€ " + tekst;
}

function duurTekst(minuten) {
  return `${Math.floor(minuten / 60)}:${pad(Math.floor(minuten % 60))}`;
}

// Op een lichte wallpaper blijft witte tekst leesbaar met een zachte schaduw.
function schaduw(tekst) {
  tekst.shadowColor = new Color("#000000", 0.4);
  tekst.shadowRadius = 2;
  return tekst;
}

async function haalBerichten() {
  const url = `${NTFY}${TOPIC}/json?poll=1&since=all&_=${Date.now()}`;
  const req = new Request(url);
  req.timeoutInterval = 10;
  const tekst = await req.loadString();
  const berichten = [];
  tekst.split("\n").slice(-500).forEach(function (regel) {
    if (!regel.trim()) return;
    try {
      const ev = JSON.parse(regel);
      if (ev.event !== "message") return;
      const d = JSON.parse(ev.message);
      if (!d || typeof d !== "object") return;
      const t = Number(d.at) || Date.parse(ev.time) || 0;
      if (!t || t > Date.now() + 5 * 60 * 1000) return;
      if (d.date && !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) return;
      if (d.rate !== undefined && (!(Number(d.rate) > 0) || Number(d.rate) > 1000)) return;
      berichten.push({ d: d, tijd: t });
    } catch (error) { /* geen geldig bericht */ }
  });
  return berichten;
}

function readCache() {
  try {
    if (!fm.fileExists(cachePath)) return null;
    return JSON.parse(fm.readString(cachePath));
  } catch (error) { return null; }
}

function writeCache(obj) {
  try { fm.writeString(cachePath, JSON.stringify(obj)); } catch (error) {}
}

// Nachtdienst: eind vóór start betekent doorlopend naar de volgende dag.
function tijdenVoor(rec, key) {
  const s = parseTime(rec && rec.start);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(String(key))) return null;
  const p = String(key).split("-").map(Number);
  const start = new Date(p[0], p[1] - 1, p[2], s.h, s.m, 0, 0);
  const e = parseTime(rec && rec.end);
  let end = null;
  if (e) {
    end = new Date(p[0], p[1] - 1, p[2], e.h, e.m, 0, 0);
    if (end <= start) end.setDate(end.getDate() + 1);
  }
  return { start: start, end: end };
}

function minutenOpVandaag(rec, key, nu) {
  const t = tijdenVoor(rec, key);
  if (!t) return 0;
  const dagStart = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate());
  const a = Math.max(t.start.getTime(), dagStart.getTime());
  const b = Math.min(t.end ? t.end.getTime() : nu.getTime(), nu.getTime());
  return b > a ? (b - a) / 60000 : 0;
}

// ── Gegevens ophalen ─────────────────────────────────────────

const nu = new Date();
const vandaag = dateKey(nu);
const info = { fout: null, start: null, eind: null, tarief: UURLOON_FALLBACK,
  minuten: 0, euro: 0, cached: false };

let berichten = [];
try {
  berichten = await haalBerichten();
} catch (error) {
  console.log("ntfy niet bereikbaar");
}

const bronnen = berichten
  .filter(function (b) { return b.d && b.d.date === vandaag; })
  .sort(function (a, b) { return b.tijd - a.tijd; });

// De cache van vandaag is een extra bron. Zo blijft een goed beginuur
// zichtbaar als er tussendoor een leeg bericht binnenkomt.
const oud = readCache();
let cacheBron = null;
if (oud && oud.date === vandaag) {
  cacheBron = { d: oud, tijd: Number(oud.at) || 0 };
  bronnen.push(cacheBron);
  bronnen.sort(function (a, b) { return b.tijd - a.tijd; });
}

// Kies het nieuwste bericht mét beginuur; een leeg bericht duwt het niet weg.
// Een bewuste wissing (clear) in de app gaat wél voor.
const metStart = bronnen.filter(function (b) { return !!startUit(b.d); });
const wissing = bronnen
  .filter(function (b) { return b.d.clear === true; })
  .sort(function (a, b) { return b.tijd - a.tijd; })[0];

let data = null;
if (metStart.length && (!wissing || metStart[0].tijd > wissing.tijd)) {
  data = metStart[0].d;
} else if (wissing) {
  data = wissing.d;
} else if (bronnen.length) {
  data = bronnen[0].d;
}

info.cached = !!cacheBron && data === cacheBron.d;

if (data) {
  info.start = startUit(data);
  info.eind = eindUit(data);
  info.tarief = Number(data.rate) > 0 ? Number(data.rate) : UURLOON_FALLBACK;

  if (info.start) {
    info.minuten = minutenOpVandaag(
      { start: hhmm(info.start.h, info.start.m),
        end: info.eind ? hhmm(info.eind.h, info.eind.m) : "" }, vandaag, nu);
    info.toekomst = nu < new Date(nu.getFullYear(), nu.getMonth(), nu.getDate(),
      info.start.h, info.start.m, 0, 0);
  } else {
    info.toekomst = false;
  }

  writeCache({
    date: vandaag,
    start: info.start ? hhmm(info.start.h, info.start.m) : "",
    end: info.eind ? hhmm(info.eind.h, info.eind.m) : "",
    rate: info.tarief,
    at: Number(data.at) || 0,
    clear: data.clear === true
  });
} else {
  info.fout = berichten.length ? "Nog geen beginuur ingevuld" : "Geen verbinding";
}

// Nachtdienst van gisteren loopt vandaag nog door — ook als er vandaag nog
// geen bericht is (je bent bijvoorbeeld nog niet in de app geweest).
const gisteren = dateKey(new Date(nu.getFullYear(), nu.getMonth(), nu.getDate() - 1));
const gisterBericht = berichten
  .filter(function (b) {
    return b.d && b.d.date === gisteren && b.d.records &&
      typeof b.d.records === "object";
  })
  .sort(function (a, b) { return b.tijd - a.tijd; })[0];
if (gisterBericht && gisterBericht.d.records[gisteren]) {
  const overdracht = minutenOpVandaag(gisterBericht.d.records[gisteren], gisteren, nu);
  if (overdracht > 0) {
    info.fout = null;
    info.minuten += overdracht;
    if (!info.start) {
      info.start = { h: 0, m: 0, mins: 0 };
      info.nacht = true;
      info.tarief = Number(gisterBericht.d.rate) > 0 ?
        Number(gisterBericht.d.rate) : UURLOON_FALLBACK;
    }
  }
}
info.euro = (info.minuten / 60) * info.tarief;

// ── Widget bouwen ────────────────────────────────────────────

async function bouwWidget() {
  const WIT = new Color("#FFFFFF");
  const ZACHT = new Color("#FFFFFF", 0.72);

  const widget = new ListWidget();
  // Volgende kwartgrens: geen onnodige refreshes, maar wel regelmatig actueel.
  widget.refreshAfterDate = new Date(
    Math.ceil((Date.now() + 1000) / (REFRESH_MINUTEN * 60 * 1000)) * (REFRESH_MINUTEN * 60 * 1000)
  );
  widget.url = APP_URL;
  widget.addAccessoryWidgetBackground = config.runsInAccessoryWidget;

  const familie = config.widgetFamily || "accessoryRectangular";
  if (config.runsInAccessoryWidget) {
    const p = familie === "accessoryCircular" ? 2 : 6;
    widget.setPadding(p, 8, p, 8);            // krap bemeten op het lockscreen
  }

  if (familie === "accessoryInline") {
    // Inline toont maar één tekst; lettertypen worden door iOS genegeerd.
    schaduw(widget.addText(info.fout ? "VERDIEND · —" : `${euroBedrag(info.euro)} · vandaag`));
    return widget;
  }

  if (familie === "accessoryCircular") {
    const bedrag = schaduw(widget.addText(info.fout ? "—" : euroKort(info.euro)));
    bedrag.font = Font.boldSystemFont(21);
    bedrag.textColor = WIT;
    bedrag.minimumScaleFactor = 0.5;
    bedrag.centerAlignText();

    const label = schaduw(widget.addText("vandaag"));
    label.font = Font.mediumSystemFont(12);
    label.textColor = ZACHT;
    label.centerAlignText();
    return widget;
  }

  // accessoryRectangular (ook als preview wanneer je het script in Scriptable start)
  const kop = schaduw(widget.addText("VERDIEND VANDAAG"));
  kop.font = Font.mediumSystemFont(11);
  kop.textColor = ZACHT;

  widget.addSpacer(4);

  const bedrag = schaduw(widget.addText(info.fout ? "—" : euroBedrag(info.euro)));
  bedrag.font = Font.boldSystemFont(26);
  bedrag.textColor = WIT;
  bedrag.minimumScaleFactor = 0.5;
  bedrag.lineLimit = 1;

  widget.addSpacer(2);

  let voetTekst;
  if (info.fout) {
    voetTekst = info.fout;
  } else if (info.toekomst) {
    voetTekst = `vanaf ${hhmm(info.start.h, info.start.m)}` + (info.cached ? " · offline" : "");
  } else if (info.start) {
    voetTekst = `${info.nacht ? "nacht" : "sinds"} ${hhmm(info.start.h, info.start.m)} · ` +
      `${duurTekst(info.minuten)} u` + (info.cached ? " · offline" : "");
  } else {
    voetTekst = "beginuur invullen in astyle";
  }
  const voet = schaduw(widget.addText(voetTekst));
  voet.font = Font.systemFont(11);
  voet.textColor = ZACHT;
  voet.lineLimit = 1;

  return widget;
}

const widget = await bouwWidget();

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentAccessoryRectangular();
}

Script.complete();
