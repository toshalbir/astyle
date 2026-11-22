// ─────────────────────────────────────────────────────────────
// VERDIEND - Scriptable widget voor astyle (Werkuren)
// Grote widget: vandaag / deze week / deze maand
// ─────────────────────────────────────────────────────────────

const TOPIC = "wu-widget-4e91c7a2b8d60f35";   // zelfde topic als in de astyle-patch
const NTFY = "https://ntfy.sh/";
const UURLOON_FALLBACK = 13;
const REFRESH_MINUTEN = 3;                   // iOS beslist uiteindelijk
const VERSIE = "4";                          // staat in de voetregel van de widget
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

function duurTekst(minuten) {
  return `${Math.floor(minuten / 60)}:${pad(Math.floor(minuten % 60))}`;
}

function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const wd = (x.getDay() + 6) % 7;   // maandag = 0
  x.setDate(x.getDate() - wd);
  return x;
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

// Minuten voor één dagrecord. Vandaag loopt hij tot nu (of tot het einduur).
function minutenVoor(rec, key, nu, vandaag) {
  const s = parseTime(rec && rec.start);
  if (!s) return 0;
  const e = parseTime(rec && rec.end);

  if (e) {
    let min = e.mins - s.mins;
    if (min < 0) min += 24 * 60;             // nachtdienst: doorlopend, niet inkorten
    if (key === vandaag && e.mins >= s.mins) {
      const nuMin = nu.getHours() * 60 + nu.getMinutes();
      min = Math.min(min, Math.max(0, nuMin - s.mins));
    }
    return Math.max(0, min);
  }

  if (key === vandaag) {
    const start = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate(), s.h, s.m, 0, 0);
    return Math.max(0, (nu - start) / 60000);
  }
  return 0;   // geen einduur op een oude dag: niet meetellen
}

// ── Gegevens ophalen ─────────────────────────────────────────

const nu = new Date();
const vandaag = dateKey(nu);
const info = { fout: null, cached: false, oud: false };

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
  info.records = (data.records && typeof data.records === "object") ? data.records : null;
  writeCache({
    date: vandaag, start: data.start, end: data.end || "",
    rate: info.tarief, records: info.records
  });
} else {
  const oud = readCache();
  if (oud && oud.date === vandaag && parseTime(oud.start)) {
    info.start = parseTime(oud.start);
    info.eind = parseTime(oud.end);
    info.tarief = Number(oud.rate) > 0 ? Number(oud.rate) : UURLOON_FALLBACK;
    info.records = (oud.records && typeof oud.records === "object") ? oud.records : null;
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

  // Zorg dat vandaag altijd aanwezig is, ook bij een ouder bericht.
  const recs = Object.assign({}, info.records || {});
  recs[vandaag] = { start: hhmm(info.start.h, info.start.m), end: info.eind ? hhmm(info.eind.h, info.eind.m) : "" };
  if (!info.records) info.oud = true;

  info.minuten = minutenVoor(recs[vandaag], vandaag, nu, vandaag);

  const weekKey = dateKey(mondayOf(nu));
  const maandPrefix = vandaag.slice(0, 7);
  let weekMin = 0;
  let maandMin = 0;

  Object.keys(recs).forEach(function (k) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return;
    const m = minutenVoor(recs[k], k, nu, vandaag);
    if (k >= weekKey && k <= vandaag) weekMin += m;
    if (k.slice(0, 7) === maandPrefix) maandMin += m;
  });

  info.euroVandaag = (info.minuten / 60) * info.tarief;
  info.euroWeek = (weekMin / 60) * info.tarief;
  info.euroMaand = (maandMin / 60) * info.tarief;
  info.weekMin = weekMin;
  info.maandMin = maandMin;

  info.afgelopen = !!info.eind && info.eind.mins >= info.start.mins && nu >= new Date(
    nu.getFullYear(), nu.getMonth(), nu.getDate(),
    info.eind.h, info.eind.m, 0, 0);
  info.toekomst = nu < info.startDate;
  info.duur = duurTekst(info.minuten);
}

// ── Widget bouwen ────────────────────────────────────────────

async function bouwWidget() {
  const widget = new ListWidget();
  widget.backgroundColor = new Color("#11161F");
  widget.setPadding(16, 18, 14, 18);
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTEN * 60 * 1000);
  widget.url = APP_URL;

  const kop = widget.addText(info.oud ? "VERDIEND · VERSE APP NODIG" : "VERDIEND");
  kop.font = Font.mediumSystemFont(11);
  kop.textColor = new Color("#8B98A9");

  if (info.fout) {
    widget.addSpacer(8);
    const groot = widget.addText("—");
    groot.font = Font.boldSystemFont(42);
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

  // Vandaag
  const hoofd = widget.addStack();
  hoofd.layoutHorizontally();
  hoofd.centerAlignContent();

  const bedrag = hoofd.addText(euroBedrag(info.euroVandaag));
  bedrag.font = Font.boldSystemFont(42);
  bedrag.textColor = info.toekomst ? new Color("#8B98A9") : new Color("#6EE7B7");
  bedrag.minimumScaleFactor = 0.5;
  bedrag.lineLimit = 1;

  hoofd.addSpacer(8);
  const label = hoofd.addText("vandaag");
  label.font = Font.mediumSystemFont(12);
  label.textColor = new Color("#8B98A9");

  const rij = widget.addStack();
  rij.layoutHorizontally();
  rij.centerAlignContent();

  let timer;
  if (info.afgelopen) {
    timer = rij.addText(info.duur);
  } else {
    timer = rij.addDate(info.startDate);
    timer.applyTimerStyle();   // loopt live door zonder widget-refresh
  }
  timer.font = Font.mediumMonospacedSystemFont(15);
  timer.textColor = Color.white();

  const achtervoegsel = rij.addText(
    info.toekomst ? " tot start" : (info.afgelopen ? " gewerkt · klaar" : " gewerkt")
  );
  achtervoegsel.font = Font.footnote();
  achtervoegsel.textColor = new Color("#8B98A9");

  widget.addSpacer(14);

  function addRegel(titel, euro, minuten) {
    const regel = widget.addStack();
    regel.layoutHorizontally();
    regel.centerAlignContent();

    const naam = regel.addText(titel);
    naam.font = Font.mediumSystemFont(12);
    naam.textColor = new Color("#8B98A9");

    regel.addSpacer();

    const waarde = regel.addText(euroBedrag(euro));
    waarde.font = Font.boldSystemFont(18);
    waarde.textColor = Color.white();

    const sub = widget.addText(`${duurTekst(minuten)} uur`);
    sub.font = Font.caption2();
    sub.textColor = new Color("#6B7686");
  }

  addRegel("Deze week", info.euroWeek, info.weekMin);
  widget.addSpacer(8);
  addRegel("Deze maand", info.euroMaand, info.maandMin);

  widget.addSpacer();

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
  await widget.presentLarge();
}

Script.complete();
