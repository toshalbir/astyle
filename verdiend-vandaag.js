// ─────────────────────────────────────────────────────────────
// VERDIEND - Scriptable widget voor astyle (Werkuren)
// Grote widget: vandaag / deze week / deze maand
// ─────────────────────────────────────────────────────────────

const TOPIC = "wu-widget-4e91c7a2b8d60f35";   // zelfde topic als in de astyle-patch
const NTFY = "https://ntfy.sh/";
const UURLOON_FALLBACK = 13;
const REFRESH_MINUTEN = 3;                   // iOS beslist uiteindelijk
const VERSIE = "8";                          // staat in de voetregel van de widget
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

// Een oude app-instantie stuurt soms berichten zónder records. Die negeren we,
// anders springt de widget terug naar uren die allang gewist zijn.
const metRecords = vanVandaag.filter(function (b) {
  const r = b.d.records;
  return r && typeof r === "object" && Object.keys(r).length > 0;
});

let data = null;
if (metRecords.length) {
  data = metRecords[0].d;                    // nieuwste bericht mét urenoverzicht
} else if (vanVandaag.length) {
  data = vanVandaag[0].d;                    // oude app: alleen begin-/einduur
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
const pcYearMin = pcBerichten.length ? pcBerichten[0].d.yearMin : null;

if (data) {
  info.start = parseTime(data.start);
  info.eind = parseTime(data.end);
  info.tarief = Number(data.rate) > 0 ? Number(data.rate) : UURLOON_FALLBACK;
  info.records = (data.records && typeof data.records === "object") ? data.records : null;
  info.geenStart = !info.start;
  info.yearMin = pcYearMin !== null ? pcYearMin :
    ((typeof data.yearMin === "number" && isFinite(data.yearMin)) ? data.yearMin : null);
  if (!info.records) info.oud = true;
  writeCache({
    date: vandaag, start: data.start || "", end: data.end || "",
    rate: info.tarief, records: info.records, yearMin: info.yearMin
  });
} else {
  const oud = readCache();
  if (oud && oud.date === vandaag) {
    info.start = parseTime(oud.start);
    info.eind = parseTime(oud.end);
    info.tarief = Number(oud.rate) > 0 ? Number(oud.rate) : UURLOON_FALLBACK;
    info.records = (oud.records && typeof oud.records === "object") ? oud.records : null;
    info.geenStart = !info.start;
    info.yearMin = pcYearMin !== null ? pcYearMin :
      ((typeof oud.yearMin === "number" && isFinite(oud.yearMin)) ? oud.yearMin : null);
    info.cached = true;
  } else if (!berichten.length) {
    info.fout = "Geen verbinding";
  } else {
    info.fout = "Nog geen beginuur ingevuld";
  }
}

if (!info.fout) {
  const recs = Object.assign({}, info.records || {});

  if (info.start) {
    info.startDate = new Date(nu.getFullYear(), nu.getMonth(), nu.getDate(),
      info.start.h, info.start.m, 0, 0);
    recs[vandaag] = {
      start: hhmm(info.start.h, info.start.m),
      end: info.eind ? hhmm(info.eind.h, info.eind.m) : ""
    };
    info.minuten = minutenVoor(recs[vandaag], vandaag, nu, vandaag);
    info.afgelopen = !!info.eind && info.eind.mins >= info.start.mins && nu >= new Date(
      nu.getFullYear(), nu.getMonth(), nu.getDate(),
      info.eind.h, info.eind.m, 0, 0);
    info.toekomst = nu < info.startDate;
    info.duur = duurTekst(info.minuten);
  } else {
    // Beginuur is in de app leeggehaald: vandaag niet meetellen.
    delete recs[vandaag];
    info.minuten = 0;
  }

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
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTEN * 60 * 1000);
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

  const startTekst = info.geenStart ? "geen start" : `start ${hhmm(info.start.h, info.start.m)}`;
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
