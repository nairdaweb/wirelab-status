/* wirelab status page. No dependencies. Data: data/status.json, data/history.json, data/incidents.json */
(function () {
  "use strict";

  var DAYS = 90;
  var STALE_MIN = 30;
  var REFRESH_MS = 60 * 1000;
  var HISTORY_PAGE = 10;

  var T = {
    pl: {
      skip: "Przejdź do treści", brandTag: "status", loading: "Sprawdzam stan usług…",
      lastChecked: "Ostatnio sprawdzono", stale: "Dane mogą być nieaktualne. Automat sprawdzający się spóźnia.",
      activeIncidents: "Aktualne zdarzenia", services: "Usługi", history: "Historia zdarzeń",
      noHistory: "Brak zgłoszonych zdarzeń w ostatnich 90 dniach.", showMore: "Pokaż starsze",
      lgOk: "działa", lgMinor: "utrudnienia", lgMajor: "awaria", lgNone: "brak danych",
      footMonitor: "Sprawdzamy usługi co około 5 minut z zewnątrz, niezależnie od naszych serwerów. Czasy podajemy w Twojej strefie, a paski dni według UTC.",
      footBack: "Wróć na wirelab.pl",
      overall: { up: "Wszystkie usługi działają", degraded: "Częściowe utrudnienia", down: "Awaria części usług",
        downAll: "Poważna awaria", maintenance: "Trwają prace serwisowe", error: "Nie udało się wczytać danych" },
      state: { up: "Działa", degraded: "Utrudnienia", down: "Niedostępne", maintenance: "Prace serwisowe", prelaunch: "Przed otwarciem", unknown: "Brak danych" },
      detail: { slow: "Wolne odpowiedzi", partial: "Część usług niedostępna", maintenance: "Planowane prace", timeout: "Brak odpowiedzi w czasie", tls: "Problem z certyfikatem", connect: "Brak połączenia", health: "Usługa zgłasza problem" },
      since: "od", ago: "temu", today: "dziś", daysAgo: function (n) { return n + " dni temu"; },
      uptime: function (p) { return "Dostępność 90 dni: " + p; },
      dayUptime: "dostępność", avg: "śr. odpowiedź", noData: "brak danych", preDay: "przed otwarciem", maintDay: "prace serwisowe",
      incidentsOn: "Zdarzenia", affects: "Dotyczy", resolvedIn: "Rozwiązano po",
      status: { investigating: "Badamy", identified: "Zidentyfikowano", monitoring: "Monitorujemy", resolved: "Rozwiązano",
        scheduled: "Zaplanowane", in_progress: "W trakcie", completed: "Zakończone" },
      scheduledFor: "Planowo", langBtn: "Switch to English", themeBtnDark: "Włącz ciemny motyw", themeBtnLight: "Włącz jasny motyw",
      barsLabel: function (name) { return "Dostępność " + name + " dzień po dniu. Strzałki zmieniają dzień."; }
    },
    en: {
      skip: "Skip to content", brandTag: "status", loading: "Checking services…",
      lastChecked: "Last checked", stale: "Data may be out of date. The checker is running late.",
      activeIncidents: "Current incidents", services: "Services", history: "Past incidents",
      noHistory: "No incidents reported in the last 90 days.", showMore: "Show older",
      lgOk: "operational", lgMinor: "degraded", lgMajor: "outage", lgNone: "no data",
      footMonitor: "We check every service about every 5 minutes from outside, independently of our servers. Times are shown in your time zone, day bars use UTC.",
      footBack: "Back to wirelab.pl",
      overall: { up: "All systems operational", degraded: "Partial degradation", down: "Partial outage",
        downAll: "Major outage", maintenance: "Maintenance in progress", error: "Could not load status data" },
      state: { up: "Operational", degraded: "Degraded", down: "Down", maintenance: "Maintenance", prelaunch: "Before launch", unknown: "No data" },
      detail: { slow: "Slow responses", partial: "Some components unavailable", maintenance: "Planned maintenance", timeout: "Timed out", tls: "Certificate problem", connect: "Cannot connect", health: "Service reports a problem" },
      since: "since", ago: "ago", today: "today", daysAgo: function (n) { return n + " days ago"; },
      uptime: function (p) { return "90-day uptime: " + p; },
      dayUptime: "uptime", avg: "avg. response", noData: "no data", preDay: "before launch", maintDay: "maintenance",
      incidentsOn: "Incidents", affects: "Affects", resolvedIn: "Resolved after",
      status: { investigating: "Investigating", identified: "Identified", monitoring: "Monitoring", resolved: "Resolved",
        scheduled: "Scheduled", in_progress: "In progress", completed: "Completed" },
      scheduledFor: "Scheduled", langBtn: "Przełącz na polski", themeBtnDark: "Switch to dark theme", themeBtnLight: "Switch to light theme",
      barsLabel: function (name) { return name + " uptime by day. Arrow keys change the day."; }
    }
  };

  var root = document.documentElement;
  var lang = root.lang === "en" ? "en" : "pl";
  var data = { status: null, history: null, incidents: null };
  var historyShown = HISTORY_PAGE;

  function t(key) { return T[lang][key]; }
  function tx(v) { return !v ? "" : typeof v === "string" ? v : (v[lang] || v.pl || v.en || ""); }
  function locale() { return lang === "pl" ? "pl-PL" : "en-GB"; }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function store(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function parseDate(s) { var d = s ? new Date(s) : null; return d && !isNaN(d) ? d : null; }

  function fmtTime(d) { return new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit" }).format(d); }
  function fmtDateTime(d) {
    return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
  }
  function fmtDay(key) {
    return new Intl.DateTimeFormat(locale(), { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(key + "T12:00:00Z"));
  }
  function fmtRel(d) {
    var s = Math.round((Date.now() - d.getTime()) / 1000);
    var rtf = new Intl.RelativeTimeFormat(locale(), { numeric: "auto" });
    if (s < 60) return rtf.format(-Math.max(s, 0), "second");
    if (s < 3600) return rtf.format(-Math.round(s / 60), "minute");
    if (s < 86400) return rtf.format(-Math.round(s / 3600), "hour");
    return rtf.format(-Math.round(s / 86400), "day");
  }
  function fmtDuration(ms) {
    var m = Math.max(1, Math.round(ms / 60000));
    var h = Math.floor(m / 60), d = Math.floor(h / 24);
    if (d) return d + (lang === "pl" ? " d " : " d ") + (h % 24) + " h";
    if (h) return h + " h " + (m % 60) + " min";
    return m + " min";
  }
  function pct(v) {
    return new Intl.NumberFormat(locale(), { maximumFractionDigits: v >= 0.9999 || v < 0.99 ? 2 : 3, minimumFractionDigits: 2 }).format(v * 100) + "%";
  }

  /* ---------------------------------------------------------------- data */

  function getJSON(path) {
    return fetch(path + "?t=" + Date.now(), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(path + " " + r.status);
      return r.json();
    });
  }

  function load() {
    return Promise.all([
      getJSON("data/status.json"),
      getJSON("data/history.json").catch(function () { return { days: {} }; }),
      getJSON("data/incidents.json").catch(function () { return { incidents: [] }; })
    ]).then(function (res) {
      data.status = res[0];
      data.history = res[1] && res[1].days ? res[1] : { days: {} };
      data.incidents = cleanIncidents(res[2]);
      render();
    }).catch(function () {
      if (!data.status) {
        var o = document.getElementById("overall");
        o.dataset.state = "down";
        document.getElementById("overall-title").textContent = t("overall").error;
      }
    });
  }

  // skip malformed entries instead of failing the whole page
  function cleanIncidents(doc) {
    var list = doc && Array.isArray(doc.incidents) ? doc.incidents : [];
    return list.filter(function (i) {
      return i && typeof i.id === "string" && i.title && parseDate(i.createdAt) && Array.isArray(i.updates) && i.updates.length;
    }).map(function (i) {
      var ups = i.updates.filter(function (u) { return u && parseDate(u.at) && u.body; })
        .sort(function (a, b) { return parseDate(b.at) - parseDate(a.at); });
      return Object.assign({}, i, { updates: ups, services: Array.isArray(i.services) ? i.services : [] });
    }).sort(function (a, b) { return parseDate(b.createdAt) - parseDate(a.createdAt); });
  }

  function isActive(i) {
    if (i.status === "resolved" || i.status === "completed") return false;
    if (i.status === "scheduled") {
      var end = parseDate(i.scheduledEnd);
      return !end || end > new Date();
    }
    return true;
  }

  /* ---------------------------------------------------------------- render */

  function applyStatic() {
    root.lang = lang;
    document.querySelectorAll("[data-i18n]").forEach(function (n) {
      var v = t(n.getAttribute("data-i18n"));
      if (typeof v === "string") n.textContent = v;
    });
    document.getElementById("lang-label").textContent = lang === "pl" ? "EN" : "PL";
    document.getElementById("lang-btn").setAttribute("aria-label", t("langBtn"));
    document.title = lang === "pl" ? "Status wirelab" : "wirelab status";
    updateThemeLabel();
  }

  function render() {
    applyStatic();
    if (!data.status) return;
    renderOverall();
    renderActive();
    renderServices();
    renderHistory();
  }

  function services() { return (data.status && data.status.services) || []; }
  function svcName(id) {
    var s = services().filter(function (x) { return x.id === id; })[0];
    return s ? tx(s.name) : id;
  }

  function renderOverall() {
    var list = services().filter(function (s) { return s.state !== "prelaunch"; });
    var down = list.filter(function (s) { return s.state === "down"; }).length;
    var state = "up", title;
    if (down) state = "down";
    else if (list.some(function (s) { return s.state === "degraded"; })) state = "degraded";
    else if (list.some(function (s) { return s.state === "maintenance"; })) state = "maintenance";
    var active = data.incidents.filter(isActive);
    if (state === "up" && active.length) {
      var imp = active.map(function (i) { return i.impact || "minor"; });
      state = imp.indexOf("maintenance") !== -1 && imp.length === 1 ? "maintenance" : "degraded";
      if (imp.indexOf("major") !== -1 || imp.indexOf("critical") !== -1) state = "down";
    }
    var o = t("overall");
    title = state === "down" && down && down === list.length ? o.downAll : o[state];
    var box = document.getElementById("overall");
    box.dataset.state = state;
    document.getElementById("overall-title").textContent = title;
    var checked = parseDate(data.status.checkedAt);
    var tEl = document.getElementById("checked-at");
    if (checked) {
      tEl.dateTime = data.status.checkedAt;
      tEl.textContent = fmtRel(checked) + " (" + fmtTime(checked) + ")";
      tEl.title = fmtDateTime(checked);
      document.getElementById("stale").hidden = Date.now() - checked.getTime() < STALE_MIN * 60000;
    }
  }

  function renderIncident(i, collapsible) {
    var box = el(collapsible ? "details" : "article", "inc");
    box.dataset.impact = i.impact || "minor";
    var head = collapsible ? el("summary") : box;
    if (collapsible) box.appendChild(head);
    head.appendChild(el("h3", null, tx(i.title)));
    var meta = el("div", "inc-meta");
    var st = el("span", "chip st st-" + i.status, (t("status")[i.status] || i.status));
    meta.appendChild(st);
    if (i.services.length) meta.appendChild(el("span", null, t("affects") + ": " + i.services.map(svcName).join(", ")));
    var start = parseDate(i.createdAt), end = parseDate(i.resolvedAt);
    if (i.status === "scheduled" && parseDate(i.scheduledStart)) {
      var ss = parseDate(i.scheduledStart), se = parseDate(i.scheduledEnd);
      meta.appendChild(el("span", null, t("scheduledFor") + ": " + fmtDateTime(ss) + (se ? " – " + fmtTime(se) : "")));
    } else if (end && start) {
      meta.appendChild(el("span", null, t("resolvedIn") + " " + fmtDuration(end - start)));
    }
    head.appendChild(meta);
    var ul = el("ul", "updates");
    i.updates.forEach(function (u) {
      var li = el("li");
      var h = el("div", "upd-head");
      h.appendChild(el("b", null, t("status")[u.status] || u.status || ""));
      var at = parseDate(u.at);
      var time = el("time", null, " · " + fmtDateTime(at));
      time.dateTime = u.at;
      h.appendChild(time);
      li.appendChild(h);
      li.appendChild(el("p", "upd-body", tx(u.body)));
      ul.appendChild(li);
    });
    box.appendChild(ul);
    return box;
  }

  function renderActive() {
    var active = data.incidents.filter(isActive);
    var sec = document.getElementById("active"), list = document.getElementById("active-list");
    list.textContent = "";
    sec.hidden = !active.length;
    active.forEach(function (i) { list.appendChild(renderIncident(i, false)); });
  }

  function renderHistory() {
    var cutoff = Date.now() - DAYS * 86400000;
    var past = data.incidents.filter(function (i) { return !isActive(i) && parseDate(i.createdAt).getTime() >= cutoff; });
    var box = document.getElementById("history-list"), more = document.getElementById("history-more");
    box.textContent = "";
    if (!past.length) {
      box.appendChild(el("p", "empty", t("noHistory")));
      more.hidden = true;
      return;
    }
    var groups = [], last = null;
    past.slice(0, historyShown).forEach(function (i) {
      var key = new Intl.DateTimeFormat(locale(), { day: "numeric", month: "long", year: "numeric" }).format(parseDate(i.createdAt));
      if (!last || last.key !== key) { last = { key: key, items: [] }; groups.push(last); }
      last.items.push(i);
    });
    groups.forEach(function (g) {
      var day = el("section", "hist-day");
      day.appendChild(el("h3", null, g.key));
      g.items.forEach(function (i) { day.appendChild(renderIncident(i, true)); });
      box.appendChild(day);
    });
    more.hidden = past.length <= historyShown;
  }

  /* ---- service rows + day bars */

  function dayKeys() {
    var keys = [], now = new Date();
    var base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    for (var i = DAYS - 1; i >= 0; i--) keys.push(new Date(base - i * 86400000).toISOString().slice(0, 10));
    return keys;
  }

  function incidentsByDay(svcId) {
    var map = {};
    data.incidents.forEach(function (i) {
      if (i.services.indexOf(svcId) === -1) return;
      var from = parseDate(i.createdAt), to = parseDate(i.resolvedAt) || new Date();
      for (var t0 = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()); t0 <= to.getTime(); t0 += 86400000) {
        var k = new Date(t0).toISOString().slice(0, 10);
        (map[k] = map[k] || []).push(i);
      }
    });
    return map;
  }

  function dayInfo(rec) {
    rec = rec || {};
    var up = (rec.u || 0) + (rec.g || 0), down = rec.d || 0, total = up + down;
    var info = { ratio: total ? up / total : null, ms: rec.n ? Math.round(rec.ms / rec.n) : null, cls: "", up: up, total: total };
    // a day with response samples but no credited time yet (first run of the day) counts as up
    if (!total && rec.n && !rec.m && !rec.p) { info.ratio = 1; info.cls = "ok"; }
    else if (!total) info.cls = rec.m ? "maint" : rec.p ? "pre" : "";
    else if (info.ratio >= 0.999 && (rec.g || 0) <= total * 0.1) info.cls = "ok";
    else if (info.ratio >= 0.99) info.cls = "minor";
    else if (info.ratio >= 0.95) info.cls = "partial";
    else info.cls = "major";
    info.rec = rec;
    return info;
  }

  function renderServices() {
    var ul = document.getElementById("services");
    var keys = dayKeys();
    var days = data.history.days || {};
    ul.textContent = "";
    services().forEach(function (s) {
      var li = el("li", "svc");
      var head = el("div", "svc-head");
      var left = el("div");
      var name = el("div", "svc-name");
      if (s.link) {
        var a = el("a", null, tx(s.name));
        a.href = s.link; a.rel = "noopener";
        name.appendChild(a);
      } else name.textContent = tx(s.name);
      left.appendChild(name);
      if (s.desc) left.appendChild(el("p", "svc-desc", tx(s.desc)));
      head.appendChild(left);
      var badge = el("span", "badge", t("state")[s.state] || t("state").unknown);
      badge.dataset.state = s.state;
      head.appendChild(badge);
      li.appendChild(head);

      var note = [];
      if (s.state !== "up" && s.state !== "prelaunch" && s.detail && t("detail")[s.detail]) note.push(t("detail")[s.detail]);
      if (s.failed && s.failed.length) note.push(s.failed.join(", "));
      var since = parseDate(s.since);
      if (s.state !== "up" && since) note.push(t("since") + " " + fmtDateTime(since));
      if (note.length) li.appendChild(el("p", "svc-note", note.join(" · ")));

      var inc = incidentsByDay(s.id);
      var infos = keys.map(function (k) { return dayInfo(days[k] && days[k][s.id]); });
      var bars = el("div", "bars");
      bars.tabIndex = 0;
      bars.setAttribute("role", "group");
      bars.setAttribute("aria-label", t("barsLabel")(tx(s.name)));
      infos.forEach(function (info, idx) {
        var b = el("span", "bar " + info.cls);
        if (inc[keys[idx]] && info.cls === "ok") b.className = "bar minor";
        b.dataset.i = idx;
        bars.appendChild(b);
      });
      li.appendChild(bars);

      var sumUp = 0, sumTotal = 0;
      infos.forEach(function (i) { sumUp += i.up; sumTotal += i.total; });
      var overall = sumTotal ? t("uptime")(pct(sumUp / sumTotal)) : t("uptime")("–");
      var foot = el("div", "bar-foot");
      var l = el("span");
      [30, 60, 90].forEach(function (n) { l.appendChild(el("span", "range-" + n, t("daysAgo")(n))); });
      foot.appendChild(l);
      foot.appendChild(el("span", null, t("today")));
      li.appendChild(foot);
      var detail = el("p", "bar-detail");
      detail.setAttribute("aria-live", "polite");
      detail.textContent = overall;
      li.appendChild(detail);

      wireBars(bars, detail, keys, infos, inc, overall);
      ul.appendChild(li);
    });
  }

  function describeDay(key, info, incs) {
    var parts = [fmtDay(key)];
    if (info.ratio != null) parts.push(t("dayUptime") + " " + pct(info.ratio));
    else parts.push(info.cls === "maint" ? t("maintDay") : info.cls === "pre" ? t("preDay") : t("noData"));
    if (info.ms != null) parts.push(t("avg") + " " + info.ms + " ms");
    if (incs && incs.length) parts.push(t("incidentsOn") + ": " + incs.map(function (i) { return tx(i.title); }).join("; "));
    return parts.join(" · ");
  }

  function wireBars(bars, detail, keys, infos, inc, overall) {
    var sel = -1;
    function visible() {
      return Array.prototype.filter.call(bars.children, function (b) { return b.offsetParent !== null; });
    }
    function select(bar) {
      Array.prototype.forEach.call(bars.querySelectorAll(".sel"), function (b) { b.classList.remove("sel"); });
      if (!bar) { sel = -1; detail.textContent = overall; return; }
      bar.classList.add("sel");
      sel = +bar.dataset.i;
      detail.textContent = describeDay(keys[sel], infos[sel], inc[keys[sel]]);
    }
    function barAt(x) {
      var vis = visible();
      for (var i = 0; i < vis.length; i++) {
        var r = vis[i].getBoundingClientRect();
        if (x >= r.left - 1 && x <= r.right + 1) return vis[i];
      }
      return null;
    }
    bars.addEventListener("pointermove", function (e) { if (e.pointerType === "mouse") select(barAt(e.clientX)); });
    bars.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") select(null); });
    bars.addEventListener("click", function (e) { var b = barAt(e.clientX); select(b && +b.dataset.i === sel ? null : b); });
    bars.addEventListener("keydown", function (e) {
      var vis = visible();
      if (!vis.length) return;
      var pos = vis.findIndex(function (b) { return +b.dataset.i === sel; });
      if (e.key === "ArrowLeft") pos = pos < 0 ? vis.length - 1 : Math.max(0, pos - 1);
      else if (e.key === "ArrowRight") pos = pos < 0 ? vis.length - 1 : Math.min(vis.length - 1, pos + 1);
      else if (e.key === "Home") pos = 0;
      else if (e.key === "End") pos = vis.length - 1;
      else if (e.key === "Escape") { select(null); return; }
      else return;
      e.preventDefault();
      select(vis[pos]);
    });
    bars.addEventListener("blur", function () { select(null); });
  }

  /* ---------------------------------------------------------------- controls */

  function effectiveTheme() {
    var set = root.getAttribute("data-theme");
    if (set) return set;
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function updateThemeLabel() {
    document.getElementById("theme-btn").setAttribute("aria-label", effectiveTheme() === "dark" ? t("themeBtnLight") : t("themeBtnDark"));
  }

  document.getElementById("theme-btn").addEventListener("click", function () {
    var next = effectiveTheme() === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    store("wl-status-theme", next);
    updateThemeLabel();
  });
  document.getElementById("lang-btn").addEventListener("click", function () {
    lang = lang === "pl" ? "en" : "pl";
    store("wl-status-lang", lang);
    render();
  });
  document.getElementById("history-more").addEventListener("click", function () {
    historyShown += HISTORY_PAGE;
    renderHistory();
  });

  applyStatic();
  load();
  setInterval(function () { if (!document.hidden) load(); }, REFRESH_MS);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
})();
