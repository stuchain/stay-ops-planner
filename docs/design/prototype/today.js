/* Σήμερα: arrivals, departures and bookings that need an apartment, then tomorrow at a glance. */
(function () {
  "use strict";
  const P = window.PROTO;
  const D = P.dates;
  const { fmt, esc, icon } = App;

  function personRow(b, line) {
    const room = b.roomId ? App.room(b.roomId) : null;
    const chip = room
      ? '<span class="chip"><span class="sw" style="background:' + room.color + '"></span>' + esc(room.name) + "</span>"
      : b.status === "pending"
        ? '<span class="pill pill-muted">Αναμένει επιβεβαίωση</span>'
        : "";
    return '<li><button type="button" class="person" data-open="' + b.id + '">' +
      '<span class="grow"><span class="who">' + esc(b.guest) + '</span><br><span class="what">' + esc(line) + "</span></span>" + chip + "</button></li>";
  }
  function list(items, line, emptyText) {
    if (!items.length) return '<p class="empty">' + emptyText + "</p>";
    return '<ul class="people-list">' + items.map((b) => personRow(b, line(b))).join("") + "</ul>";
  }

  App.screens.today = {
    mount(el) {
      const db = App.db;
      const today = db.today;
      const tomorrow = D.addDays(today, 1);
      const live = db.bookings.filter((b) => b.status !== "cancelled");
      const placed = live.filter((b) => b.roomId);
      const arrivals = placed.filter((b) => b.checkin === today);
      const departures = placed.filter((b) => b.checkout === today);
      const needs = App.unplaced().sort((a, b) => a.checkin.localeCompare(b.checkin));
      const needsConfirmed = needs.filter((b) => b.status === "confirmed");
      const arrT = placed.filter((b) => b.checkin === tomorrow);
      const depT = placed.filter((b) => b.checkout === tomorrow);

      const occ = db.rooms.map((r) => {
        const b = placed.find((x) => x.roomId === r.id && x.checkin <= today && x.checkout > today);
        return '<div class="occ" style="border-top:6px solid ' + r.color + '"><span class="name">' + esc(r.name) + "</span>" +
          (b ? '<span>' + esc(fmt.short(b.guest)) + '</span><span class="muted">έως ' + fmt.day(b.checkout) + "</span>"
            : '<span class="muted">Άδειο απόψε</span>') + "</div>";
      }).join("");

      el.innerHTML =
        '<div class="page">' +
        '<header class="page-head"><h1>Σήμερα</h1><span class="sub">' + fmt.long(today) + "</span></header>" +
        '<div class="today-grid">' +
        '<section class="card today-card"><h2>' + icon("log-in") + 'Αφίξεις σήμερα</h2><div class="count num">' + arrivals.length + "</div>" +
        list(arrivals, (b) => fmt.party(b) + " · " + fmt.nights(P.nights(b)), "Δεν έρχεται κανείς σήμερα.") +
        '<button type="button" class="btn btn-big" data-cal>' + icon("calendar-days") + "Στο ημερολόγιο</button></section>" +
        '<section class="card today-card"><h2>' + icon("log-out") + 'Αναχωρήσεις σήμερα</h2><div class="count num">' + departures.length + "</div>" +
        list(departures, (b) => "έμειναν " + fmt.nights(P.nights(b)), "Δεν φεύγει κανείς σήμερα.") +
        '<button type="button" class="btn btn-big" data-cal>' + icon("calendar-days") + "Στο ημερολόγιο</button></section>" +
        '<section class="card today-card' + (needsConfirmed.length ? " attention" : "") + '"><h2>' + icon("circle-alert") + 'Χρειάζονται διαμέρισμα</h2><div class="count num">' + needsConfirmed.length + "</div>" +
        list(needs, (b) => fmt.range(b.checkin, b.checkout) + " · " + fmt.party(b), "Όλες οι κρατήσεις έχουν διαμέρισμα.") +
        (needsConfirmed.length
          ? '<button type="button" class="btn btn-primary btn-big" data-place>' + icon("arrow-right") + "Βάλτε τις σε διαμέρισμα</button>"
          : "") +
        "</section></div>" +
        '<section class="card"><h2>' + icon("bed-double") + 'Απόψε στα διαμερίσματα</h2><div class="occupancy">' + occ + "</div></section>" +
        '<section class="card"><h2>' + icon("sunrise") + "Αύριο, " + fmt.long(tomorrow) + "</h2>" +
        '<div class="tomorrow"><div><h3>Αφίξεις (' + arrT.length + ")</h3>" + list(arrT, (b) => fmt.party(b) + " · " + fmt.nights(P.nights(b)), "Καμία άφιξη.") + "</div>" +
        "<div><h3>Αναχωρήσεις (" + depT.length + ")</h3>" + list(depT, (b) => "έμειναν " + fmt.nights(P.nights(b)), "Καμία αναχώρηση.") + "</div></div></section>" +
        "</div>";

      el.querySelectorAll("[data-open]").forEach((btn) => { btn.onclick = () => App.go("calendar", { select: btn.dataset.open }); });
      el.querySelectorAll("[data-cal]").forEach((btn) => { btn.onclick = () => App.go("calendar"); });
      const place = el.querySelector("[data-place]");
      if (place) place.onclick = () => App.go("calendar", { select: needsConfirmed[0].id });
    },
  };
})();
