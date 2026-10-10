/* Έσοδα: the year at a glance. Stat tiles, income per apartment, a bar per month, exact numbers, estimated tax. */
(function () {
  "use strict";
  const { fmt, esc, icon } = App;

  // Estimate brackets: 15% up to 12.000, 35% from 12.000 to 35.000, 45% above.
  const BRACKETS = [
    { upTo: 12000, rate: 0.15 },
    { upTo: 35000, rate: 0.35 },
    { upTo: Infinity, rate: 0.45 },
  ];
  function taxParts(total) {
    let from = 0;
    return BRACKETS.map((b) => {
      const part = Math.max(0, Math.min(total, b.upTo) - from);
      const row = { from, upTo: b.upTo, rate: b.rate, part, tax: part * b.rate };
      from = b.upTo;
      return row;
    });
  }
  function bracketLabel(b) {
    const pct = Math.round(b.rate * 100) + "%";
    if (b.from === 0) return pct + " μέχρι " + fmt.money(b.upTo);
    if (b.upTo === Infinity) return pct + " πάνω από " + fmt.money(b.from);
    return pct + " από " + fmt.money(b.from) + " έως " + fmt.money(b.upTo);
  }

  const KIND_WORD = { actual: "", current: "Τώρα", expected: "αναμένονται" };

  function stat(label, value, sub, extra) {
    return '<div class="card stat' + (extra || "") + '"><span class="stat-label">' + label + '</span><span class="stat-value num">' + value +
      '</span><span class="stat-sub muted">' + sub + "</span></div>";
  }

  App.screens.money = {
    mount(el) {
      const inc = App.db.income;
      const rooms = App.db.rooms.slice().sort((a, b) => a.sortOrder - b.sortOrder);
      const sum = (m) => rooms.reduce((s, r) => s + (m.perRoom[r.id] || 0), 0);
      const totals = inc.months.map(sum);
      const yearTotal = totals.reduce((a, b) => a + b, 0);
      const soFar = inc.months.filter((m) => m.kind !== "expected").reduce((s, m) => s + sum(m), 0);
      const expected = yearTotal - soFar;
      const roomYear = (r) => inc.months.reduce((s, m) => s + (m.perRoom[r.id] || 0), 0);
      const parts = taxParts(yearTotal);
      const tax = parts.reduce((s, p) => s + p.tax, 0);
      const maxTotal = Math.max.apply(null, totals.concat([1]));

      const tiles =
        stat("Έσοδα μέχρι σήμερα", fmt.money(soFar), "Από τον Ιανουάριο μέχρι και τον μήνα που διανύουμε") +
        stat("Αναμένονται", fmt.money(expected), "Από κρατήσεις που έχουν ήδη γίνει, για τους επόμενους μήνες") +
        stat('Φόρος <span class="pill pill-warn">Εκτίμηση</span>', fmt.money(tax), "Για τα έσοδα όλης της χρονιάς: " + fmt.money(yearTotal), " stat-tax");

      const roomTiles = rooms.map((r) =>
        '<div class="room-total" style="border-top:6px solid ' + r.color + '"><span class="name"><span class="sw" style="background:' + r.color + '"></span>' + esc(r.name) +
        '</span><span class="room-sum num">' + fmt.money(roomYear(r)) + "</span></div>").join("");

      const legendRooms = rooms.map((r) =>
        '<span class="chip"><span class="sw" style="background:' + r.color + '"></span>' + esc(r.name) + "</span>").join("");

      const cols = inc.months.map((m, i) => {
        const segs = rooms.map((r) => {
          const v = m.perRoom[r.id] || 0;
          return v ? '<span class="mseg" style="background-color:' + r.color + ";flex-grow:" + v + '"></span>' : "";
        }).join("");
        const word = KIND_WORD[m.kind];
        return '<div class="mcol is-' + m.kind + '"><span class="mtotal num">' + fmt.money(totals[i]) + "</span>" +
          '<div class="mtrack"><div class="mstack" style="--h:' + (totals[i] / maxTotal * 100).toFixed(1) + '%">' + segs + "</div></div>" +
          '<span class="mname">' + fmt.MON[m.month] + (word ? '<span class="mkind">' + word + "</span>" : "") + "</span></div>";
      }).join("");

      const future = inc.months.filter((m) => m.kind === "expected");
      const futureNote = future.length
        ? '<p class="muted mfuture">' + (future.length > 1 ? fmt.MON_LONG[future[0].month] + " – " + fmt.MON_LONG[future[future.length - 1].month] : fmt.MON_LONG[future[0].month]) +
          ": αναμένονται, από κρατήσεις που έχουν ήδη γίνει. Θα αλλάξουν όσο έρχονται νέες κρατήσεις.</p>"
        : "";

      const rows = inc.months.map((m, i) =>
        '<tr class="is-' + m.kind + '"><th scope="row">' + fmt.MON_LONG[m.month] +
        (m.kind === "expected" ? ' <span class="muted">(αναμένονται)</span>' : m.kind === "current" ? ' <span class="pill pill-ok">Τώρα</span>' : "") + "</th>" +
        rooms.map((r) => '<td class="num">' + fmt.money(m.perRoom[r.id] || 0) + "</td>").join("") +
        '<td class="num tot">' + fmt.money(totals[i]) + "</td></tr>").join("");
      const foot = '<tr><th scope="row">Σύνολο χρονιάς</th>' + rooms.map((r) => '<td class="num">' + fmt.money(roomYear(r)) + "</td>").join("") +
        '<td class="num tot">' + fmt.money(yearTotal) + "</td></tr>";

      const taxRows = parts.map((p) =>
        '<tr><th scope="row">' + bracketLabel(p) + '</th><td class="num">' + fmt.money(p.part) + '</td><td class="num tot">' + fmt.money(p.tax) + "</td></tr>").join("");

      el.innerHTML =
        '<div class="page money-page">' +
        '<header class="page-head"><h1>Έσοδα</h1><span class="sub num">' + inc.year + "</span></header>" +
        '<div class="stat-grid">' + tiles + "</div>" +
        '<section class="card"><h2>' + icon("bed-double") + "Έσοδα ανά διαμέρισμα, " + inc.year + '</h2><div class="room-totals">' + roomTiles + "</div>" +
        '<p class="muted">Τα έσοδα μετρώνται στο διαμέρισμα που έκλεισε ο επισκέπτης.</p></section>' +
        '<section class="card"><h2>' + icon("chart-column") + "Έσοδα ανά μήνα</h2>" +
        '<div class="legend">' + legendRooms +
        '<span class="chip"><span class="sw sw-solid"></span>Έσοδα που έχουν γίνει</span>' +
        '<span class="chip"><span class="sw sw-hatch"></span>Αναμένονται (από κρατήσεις που έχουν γίνει)</span></div>' +
        '<div class="mchart">' + cols + "</div>" + futureNote + "</section>" +
        '<section class="card"><h2>' + icon("table") + "Ακριβή ποσά ανά μήνα</h2>" +
        '<div class="table-wrap"><table class="mtable"><thead><tr><th scope="col">Μήνας</th>' +
        rooms.map((r) => '<th scope="col" class="num"><span class="sw" style="background:' + r.color + '"></span>' + esc(r.name) + "</th>").join("") +
        '<th scope="col" class="num">Σύνολο</th></tr></thead><tbody>' + rows + "</tbody><tfoot>" + foot + "</tfoot></table></div></section>" +
        '<section class="card"><h2>' + icon("landmark") + 'Φόρος εισοδήματος <span class="pill pill-warn">Εκτίμηση</span></h2>' +
        '<div class="table-wrap"><table class="mtable"><thead><tr><th scope="col">Κλιμάκιο</th><th scope="col" class="num">Έσοδα στο κλιμάκιο</th><th scope="col" class="num">Φόρος</th></tr></thead><tbody>' + taxRows +
        '</tbody><tfoot><tr><th scope="row">Εκτιμώμενος φόρος</th><td class="num">' + fmt.money(yearTotal) + '</td><td class="num tot">' + fmt.money(tax) + "</td></tr></tfoot></table></div>" +
        "<p>Εκτίμηση με βάση τα κλιμάκια. Ο λογιστής θα επιβεβαιώσει το τελικό ποσό.</p></section>" +
        '<div><button type="button" class="btn btn-primary btn-big" data-export>' + icon("download") + "Εξαγωγή σε Excel</button></div>" +
        "</div>";

      el.querySelector("[data-export]").onclick = () =>
        App.toast("Στην κανονική εφαρμογή εδώ κατεβαίνει το αρχείο Excel με όλες τις κρατήσεις της χρονιάς.");
    },
  };
})();
