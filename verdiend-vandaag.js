// ─────────────────────────────────────────────────────────────
// VERDIEND - Scriptable widget voor astyle (Werkuren)
// Grote widget: vandaag / deze week / deze maand
// ─────────────────────────────────────────────────────────────

const TOPIC = "wu-widget-4e91c7a2b8d60f35";   // zelfde topic als in de astyle-patch
const NTFY = "https://ntfy.sh/";
const UURLOON_FALLBACK = 13;
const REFRESH_MINUTEN = 15;                  // iOS beslist uiteindelijk; rustiger voor je budget
const VERSIE = "9";                          // staat in de voetregel van de widget
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

// Begin-/einduur kan bovenaan het bericht staan of in records[vandaag].
function startUit(d, key) {
  if (!d) return null;
  const a = parseTime(d.start);
  if (a) return a;
  const r = d.records && d.records[key];
  return r ? parseTime(r.start) : null;
}

function eindUit(d, key) {
  if (!d) return null;
  const a = parseTime(d.end);
  if (a) return a;
  const r = d.records && d.records[key];
  return r ? parseTime(r.end) : null;
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
  // Alleen de laatste berichten: een widget heeft weinig geheugen.
  tekst.split("\n").slice(-500).forEach(function (regel) {
    if (!regel.trim()) return;
    try {
      const ev = JSON.parse(regel);
      if (ev.event !== "message") return;
      const d = JSON.parse(ev.message);
      if (!d || typeof d !== "object") return;
      const t = Number(d.at) || Date.parse(ev.time) || 0;
      if (!t || t > Date.now() + 5 * 60 * 1000) return;   // geen berichten uit de toekomst
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

// Absolute start-/einddatum van een record. Eind vóór start = nachtdienst.
function tijdenVoor(rec, key) {
  const s = parseTime(rec && rec.start);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(String(key))) return null;
  const p = String(key).split("-").map(Number);
  const start = new Date(p[0], p[1] - 1, p[2], s.h, s.m, 0, 0);
  const e = parseTime(rec && rec.end);
  let end = null;
  if (e) {
    end = new Date(p[0], p[1] - 1, p[2], e.h, e.m, 0, 0);
    if (end <= start) end.setDate(end.getDate() + 1);   // doorlopend naar morgen
  }
  return { start: start, end: end };
}

// Minuten van een record die op vandaag vallen (ook het stuk na middernacht).
function minutenOpVandaag(rec, key, nu) {
  const t = tijdenVoor(rec, key);
  if (!t) return 0;
  const dagStart = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate());
  const a = Math.max(t.start.getTime(), dagStart.getTime());
  const b = Math.min(t.end ? t.end.getTime() : nu.getTime(), nu.getTime());
  return b > a ? (b - a) / 60000 : 0;
}

// Minuten voor één dagrecord, voor de week- en maandtotalen.
function minutenVoor(rec, key, nu, vandaag) {
  const t = tijdenVoor(rec, key);
  if (!t) return 0;
  const einde = key === vandaag
    ? Math.min(t.end ? t.end.getTime() : nu.getTime(), nu.getTime())
    : (t.end ? t.end.getTime() : 0);
  return einde > t.start.getTime() ? (einde - t.start.getTime()) / 60000 : 0;
}

// ── Gegevens ophalen ─────────────────────────────────────────

const nu = new Date();
const vandaag = dateKey(nu);
const info = { fout: null, cached: false, oud: false, geenStart: false, yearMin: null };

let berichten = [];
try {
  berichten = await haalBerichten();
} catch (error) {
  console.log("ntfy niet bereikbaar");
}

// Alle berichten van vandaag, nieuwste eerst.
const vanVandaag = berichten
  .filter(function (b) { return b.d && b.d.date === vandaag; })
  .sort(function (a, b) { return b.tijd - a.tijd; });

// De cache is een extra bron. Zo kan een leeg bericht (bijv. na het openen
// van de app) een eerder ingevuld beginuur niet wegduwen.
const oud = readCache();
let cacheBron = null;
if (oud && oud.date === vandaag) {
  cacheBron = { d: oud, tijd: Number(oud.at) || 0 };
  vanVandaag.push(cacheBron);
  vanVandaag.sort(function (a, b) { return b.tijd - a.tijd; });
}

// Kies het nieuwste bericht mét een geldig beginuur. Een bewuste wissing
// (clear, vanaf de bijgewerkte astyle-app) gaat daar wél overheen.
const metStart = vanVandaag
  .filter(function (b) { return !!startUit(b.d, vandaag); })
  .sort(function (a, b) {                    // volledig urenoverzicht eerst
    const ar = a.d.records && Object.keys(a.d.records).length ? 1 : 0;
    const br = b.d.records && Object.keys(b.d.records).length ? 1 : 0;
    return br - ar || b.tijd - a.tijd;
  });
const wissing = vanVandaag
  .filter(function (b) { return b.d.clear === true; })
  .sort(function (a, b) { return b.tijd - a.tijd; })[0];

let data = null;
if (metStart.length && (!wissing || metStart[0].tijd > wissing.tijd)) {
  data = metStart[0].d;                      // nieuwste bericht mét beginuur
} else if (wissing) {
  data = wissing.d;                          // beginuur is echt gewist
} else if (vanVandaag.length) {
  data = vanVandaag[0].d;                    // nog geen beginuur ingevuld
}

// De pc stuurt het volledige jaartotaal als los bericht (alleen één getal).
// De telefoon bewaart maar ~28 dagen, dus dat cijfer is onvolledig: geef
// het pc-bericht voorrang. Het veld heet 'dag' zodat het niet als gewoon
// urenbericht van vandaag wordt gezien.
const pcBerichten = berichten
  .filter(function (b) {
    return b.d && b.d.source === "pc" && b.d.dag === vandaag &&
      typeof b.d.yearMin === "number" && isFinite(b.d.yearMin);
  })
  .sort(function (a, b) { return b.tijd - a.tijd; });
// Als het pc-bericht verlopen is (ntfy bewaart ~12 u), gebruik het laatst
// goede getal uit de cache in plaats van het onvolledige telefooncijfer.
const pcYearMin = pcBerichten.length ? pcBerichten[0].d.yearMin :
  (oud && oud.date === vandaag && typeof oud.pcYearMin === "number" ? oud.pcYearMin : null);

info.cached = !!cacheBron && data === cacheBron.d;

if (data) {
  info.start = startUit(data, vandaag);
  info.eind = eindUit(data, vandaag);
  info.tarief = Number(data.rate) > 0 ? Number(data.rate) : UURLOON_FALLBACK;
  info.records = (data.records && typeof data.records === "object") ? data.records : null;
  info.geenStart = !info.start;
  info.yearMin = pcYearMin !== null ? pcYearMin :
    ((typeof data.yearMin === "number" && isFinite(data.yearMin)) ? data.yearMin : null);
  if (!info.records) info.oud = true;
  writeCache({
    date: vandaag,
    start: info.start ? hhmm(info.start.h, info.start.m) : "",
    end: info.eind ? hhmm(info.eind.h, info.eind.m) : "",
    rate: info.tarief, records: info.records, yearMin: info.yearMin,
    pcYearMin: pcBerichten.length ? pcYearMin :
      (oud && typeof oud.pcYearMin === "number" ? oud.pcYearMin : null),
    at: Number(data.at) || 0, clear: data.clear === true
  });
} else {
  // Nachtdienst van gisteren kan nog doorlopen zonder bericht van vandaag.
  const gisterSleutel = dateKey(new Date(nu.getFullYear(), nu.getMonth(), nu.getDate() - 1));
  const gisterNacht = berichten
    .filter(function (b) {
      return b.d && b.d.date === gisterSleutel && b.d.records &&
        b.d.records[gisterSleutel] &&
        minutenOpVandaag(b.d.records[gisterSleutel], gisterSleutel, nu) > 0;
    })
    .sort(function (a, b) { return b.tijd - a.tijd; })[0];
  if (gisterNacht) {
    info.records = gisterNacht.d.records;
    info.tarief = Number(gisterNacht.d.rate) > 0 ?
      Number(gisterNacht.d.rate) : UURLOON_FALLBACK;
    info.geenStart = true;
    info.yearMin = pcYearMin;
    writeCache({
      date: vandaag, start: "", end: "", rate: info.tarief,
      records: info.records, yearMin: info.yearMin,
      pcYearMin: pcBerichten.length ? pcYearMin : null,
      at: Number(gisterNacht.d.at) || 0, clear: false
    });
  } else {
    info.fout = berichten.length ? "Nog geen beginuur ingevuld" : "Geen verbinding";
  }
}

if (!info.fout) {
  const recs = Object.assign({}, info.records || {});
  const gisteren = dateKey(new Date(nu.getFullYear(), nu.getMonth(), nu.getDate() - 1));

  // Een nachtdienst van gisteren kan vandaag nog doorlopen. Die uren staan
  // in een bericht van gisteren, niet in dat van vandaag.
  const gisterBericht = berichten
    .filter(function (b) {
      return b.d && b.d.date === gisteren && b.d.records &&
        typeof b.d.records === "object";
    })
    .sort(function (a, b) { return b.tijd - a.tijd; })[0];
  if (gisterBericht) {
    Object.keys(gisterBericht.d.records).forEach(function (k) {
      if (!recs[k]) recs[k] = gisterBericht.d.records[k];
    });
  }

  if (info.start) {
    info.startDate = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate(),
      info.start.h, info.start.m, 0, 0);
    recs[vandaag] = {
      start: hhmm(info.start.h, info.start.m),
      end: info.eind ? hhmm(info.eind.h, info.eind.m) : ""
    };
    info.minuten = minutenOpVandaag(recs[vandaag], vandaag, nu);
    info.afgelopen = !!info.eind && info.eind.mins >= info.start.mins && nu >= new Date(
      nu.getFullYear(), nu.getMonth(), nu.getDate(),
      info.eind.h, info.eind.m, 0, 0);
    info.toekomst = nu < info.startDate;
  } else {
    // Beginuur is in de app leeggehaald: vandaag niet meetellen.
    delete recs[vandaag];
    info.minuten = 0;
  }

  const overdracht = minutenOpVandaag(recs[gisteren], gisteren, nu);
  if (overdracht > 0) {
    info.minuten += overdracht;               // ook na middernacht mee verdiend
    if (!info.start) {
      info.start = { h: 0, m: 0, mins: 0 };    // doorlopende nachtdienst
      info.startDate = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate(), 0, 0, 0, 0);
      info.nacht = true;
      info.geenStart = false;
      info.toekomst = false;
    }
  }
  info.duur = duurTekst(info.minuten);

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
}

// ── Widget bouwen ────────────────────────────────────────────

async function bouwWidget() {
  const WIT = new Color("#FFFFFF");
  const BLAUW = new Color("#1D4ED8");
  const NAVY = new Color("#17365D");
  const ZACHT = new Color("#64748B");
  const WAARSCHUWING = new Color("#B45309");

  const widget = new ListWidget();
  widget.backgroundColor = WIT;
  widget.setPadding(16, 18, 14, 18);
  widget.refreshAfterDate = new Date(
    Math.ceil((Date.now() + 1000) / (REFRESH_MINUTEN * 60 * 1000)) * (REFRESH_MINUTEN * 60 * 1000)
  );
  widget.url = APP_URL;

  const kop = widget.addText(info.oud ? "VERDIEND · VERSE APP NODIG" : "VERDIEND");
  kop.font = Font.mediumSystemFont(13);
  kop.textColor = NAVY;
  widget.addSpacer(8);

  if (info.fout) {
    const groot = widget.addText("—");
    groot.font = Font.boldSystemFont(48);
    groot.textColor = NAVY;

    const melding = widget.addText(info.fout);
    melding.font = Font.mediumSystemFont(14);
    melding.textColor = WAARSCHUWING;
    melding.lineLimit = 2;

    const tip = widget.addText("Beginuur invullen in astyle");
    tip.font = Font.systemFont(12);
    tip.textColor = ZACHT;
    return widget;
  }

  // Vandaag
  const hoofd = widget.addStack();
  hoofd.layoutHorizontally();
  hoofd.centerAlignContent();

  const bedrag = hoofd.addText(info.geenStart ? "—" : euroBedrag(info.euroVandaag));
  bedrag.font = Font.boldSystemFont(48);
  bedrag.textColor = info.geenStart || info.toekomst ? ZACHT : BLAUW;
  bedrag.minimumScaleFactor = 0.5;
  bedrag.lineLimit = 1;

  hoofd.addSpacer(10);
  const label = hoofd.addText("vandaag");
  label.font = Font.mediumSystemFont(14);
  label.textColor = ZACHT;

  widget.addSpacer(4);

  const rij = widget.addStack();
  rij.layoutHorizontally();
  rij.centerAlignContent();

  if (info.geenStart) {
    const leeg = rij.addText("nog geen beginuur ingevuld");
    leeg.font = Font.mediumSystemFont(13);
    leeg.textColor = ZACHT;
  } else {
    let timer;
    if (info.afgelopen) {
      timer = rij.addText(info.duur);
    } else {
      timer = rij.addDate(info.startDate);
      timer.applyTimerStyle();   // loopt live door zonder widget-refresh
    }
    timer.font = Font.mediumMonospacedSystemFont(17);
    timer.textColor = NAVY;

    const achtervoegsel = rij.addText(
      info.toekomst ? "  tot start" : (info.afgelopen ? "  gewerkt · klaar" : "  gewerkt")
    );
    achtervoegsel.font = Font.mediumSystemFont(13);
    achtervoegsel.textColor = ZACHT;
  }

  widget.addSpacer(20);

  function addRegel(titel, euro, minuten, override) {
    const regel = widget.addStack();
    regel.layoutHorizontally();
    regel.centerAlignContent();

    const naam = regel.addText(titel);
    naam.font = Font.mediumSystemFont(14);
    naam.textColor = NAVY;

    regel.addSpacer();

    const waarde = regel.addText(override === undefined ? euroBedrag(euro) : override);
    waarde.font = Font.boldSystemFont(21);
    waarde.textColor = NAVY;

    const sub = widget.addText(override === undefined ? `${duurTekst(minuten)} uur` : "app bijwerken");
    sub.font = Font.systemFont(12);
    sub.textColor = ZACHT;
  }

  addRegel("Deze week", info.euroWeek, info.weekMin);
  widget.addSpacer(10);
  addRegel("Deze maand", info.euroMaand, info.maandMin);
  widget.addSpacer(10);
  addRegel("Dit jaar",
    info.yearMin === null ? 0 : (info.yearMin / 60) * info.tarief,
    info.yearMin === null ? 0 : info.yearMin,
    info.yearMin === null ? "—" : undefined);

  widget.addSpacer();

  const startTekst = info.geenStart ? "geen start" :
    `start ${hhmm(info.start.h, info.start.m)}${info.nacht ? " · nacht" : ""}`;
  const voet = widget.addText(
    `${startTekst} · €${info.tarief}/u · v${VERSIE}` + (info.cached ? " · offline" : "")
  );
  voet.font = Font.systemFont(11);
  voet.textColor = ZACHT;
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
