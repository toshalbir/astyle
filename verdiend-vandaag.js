// ─────────────────────────────────────────────────────────────
// VERDIEND VANDAAG - Scriptable widget voor astyle (Werkuren)
// Leest het beginuur uit je eigen werkuren-app via ntfy.
// ─────────────────────────────────────────────────────────────

const TOPIC = "wu-widget-4e91c7a2b8d60f35";   // zelfde topic als in de astyle-patch
const NTFY = "https://ntfy.sh/";
const UURLOON_FALLBACK = 13;
const REFRESH_MINUTEN = 10;                  // iOS beslist uiteindelijk
const VERSIE = "2";                          // staat in de voetregel van de widget
const APP_URL = "https://toshalbir.github.io/astyle/";

const fm = FileManager.local();
const cachePath = fm.joinPath(fm.documentsDirectory(), "werkuren-widget-cache.json");

// ── Hulpfuncties ─────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, "0"); }

function dateKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function hhmm(h, m) { return `${pad(h)}:${pad(m)}`; }

function parseTime(value) {
  const v = String(value || "").trim();
  if (!v) return null;

  // astyle accepteert ook een los uur: "8" betekent 08:00 (net als in de app).
  let match = v.match(/^(\d{1,2})$/);
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

function euroBedrag(n) {
  const delen = n.toFixed(2).replace(".", ",").split(",");
  delen[0] = delen[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return "€ " + delen.join(",");
}

async function haalBerichten() {
  const url = `${NTFY}${TOPIC}/json?poll=1&since=all&_=${Date.now()}`;
  const req = new Request(url);
  req.timeoutInterval = 12;
  const tekst = await req.loadString();
  const berichten = [];
  tekst.split("\n").forEach(function (regel) {
    if (!regel.trim()) return;
    try {
      const ev = JSON.parse(regel);
      if (ev.event !== "message") return;
      const d = JSON.parse(ev.message);
      berichten.push({ d: d, tijd: Number(d.at) || Date.parse(ev.time) || 0 });
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

// ── Gegevens ophalen ─────────────────────────────────────────

const nu = new Date();
const vandaag = dateKey(nu);
const info = { fout: null, cached: false };

let berichten = [];
try {
  berichten = await haalBerichten();
} catch (error) {
  console.log("ntfy niet bereikbaar");
}

// Nieuwste bericht van vandaag met een niet-leeg beginuur.
const geldig = berichten
  .filter(function (b) { return b.d && b.d.date === vandaag && parseTime(b.d.start); })
  .sort(function (a, b) { return b.tijd - a.tijd; });

let data = geldig.length ? geldig[0].d : null;

if (data) {
  info.start = parseTime(data.start);
  info.eind = parseTime(data.end);
  info.tarief = Number(data.rate) > 0 ? Number(data.rate) : UURLOON_FALLBACK;
  writeCache({
    date: vandaag, start: data.start, end: data.end || "",
    rate: info.tarief
  });
} else {
  const oud = readCache();
  if (oud && oud.date === vandaag && parseTime(oud.start)) {
    info.start = parseTime(oud.start);
    info.eind = parseTime(oud.end);
    info.tarief = Number(oud.rate) > 0 ? Number(oud.rate) : UURLOON_FALLBACK;
    info.cached = true;
  } else if (!berichten.length) {
    info.fout = "Geen verbinding";
  } else {
    info.fout = "Nog geen beginuur ingevuld";
  }
}

if (!info.fout) {
  info.startDate = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate(),
    info.start.h, info.start.m, 0, 0);

  let minuten = (nu - info.startDate) / 60000;

  // Als het einduur al ingevuld is, stopt de teller daar.
  if (info.eind) {
    let eindMin = info.eind.mins;
    if (eindMin < info.start.mins) eindMin += 24 * 60;   // nachtdienst
    minuten = Math.min(minuten, eindMin - info.start.mins);
  }

  minuten = Math.max(0, minuten);
  info.euro = (minuten / 60) * info.tarief;
  info.afgelopen = !!info.eind && nu >= new Date(
    nu.getFullYear(), nu.getMonth(), nu.getDate(),
    info.eind.h, info.eind.m, 0, 0);
  info.toekomst = nu < info.startDate;

  const u = Math.floor(minuten / 60);
  const m = Math.floor(minuten % 60);
  info.duur = `${u}:${pad(m)}`;
}

// ── Widget bouwen ────────────────────────────────────────────

async function bouwWidget() {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#11161F");
  widget.setPadding(14, 16, 12, 16);
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTEN * 60 * 1000);
  widget.url = APP_URL;

  const kop = widget.addText("VERDIEND VANDAAG");
  kop.font = Font.mediumSystemFont(11);
  kop.textColor = new Color("#8B98A9");

  if (info.fout) {
    const groot = widget.addText("—");
    groot.font = Font.boldSystemFont(38);
    groot.textColor = Color.white();

    const melding = widget.addText(info.fout);
    melding.font = Font.footnote();
    melding.textColor = new Color("#F0B429");
    melding.lineLimit = 2;

    const tip = widget.addText("Beginuur invullen in astyle");
    tip.font = Font.caption2();
    tip.textColor = new Color("#6B7686");
    return widget;
  }

  const bedrag = widget.addText(euroBedrag(info.euro));
  bedrag.font = Font.boldSystemFont(38);
  bedrag.textColor = info.toekomst ? new Color("#8B98A9") : new Color("#6EE7B7");
  bedrag.minimumScaleFactor = 0.6;
  bedrag.lineLimit = 1;

  widget.addSpacer(6);

  const rij = widget.addStack();
  rij.layoutHorizontally();

  let timer;
  if (info.afgelopen) {
    // Dienst is afgelopen: vaste duur, geen live timer meer nodig.
    timer = rij.addText(info.duur);
    timer.font = Font.mediumMonospacedSystemFont(15);
  } else {
    timer = rij.addDate(info.startDate);
    timer.applyTimerStyle();   // loopt live door zonder widget-refresh
    timer.font = Font.mediumMonospacedSystemFont(15);
  }
  timer.textColor = Color.white();

  const achtervoegsel = rij.addText(
    info.toekomst ? " tot start" : (info.afgelopen ? " gewerkt · klaar" : " gewerkt")
  );
  achtervoegsel.font = Font.footnote();
  achtervoegsel.textColor = new Color("#8B98A9");

  widget.addSpacer(4);

  const voet = widget.addText(
    `start ${hhmm(info.start.h, info.start.m)} · €${info.tarief}/u · v${VERSIE}` +
    (info.cached ? " · offline" : "")
  );
  voet.font = Font.caption2();
  voet.textColor = new Color("#6B7686");
  voet.lineLimit = 1;

  return widget;
}

const widget = await bouwWidget();

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentSmall();
}

Script.complete();
