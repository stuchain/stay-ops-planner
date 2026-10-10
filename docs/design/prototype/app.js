/* App shell: state, formatting, navigation, booking panel, moves, undo toasts.
   Screens register themselves in App.screens[name] = { mount(el, params), update?() }. */
(function () {
  "use strict";
  const P = window.PROTO;
  const D = P.dates;

  // ---------- formatting (Greek) ----------
  const WD = ["Κυρ", "Δευ", "Τρι", "Τετ", "Πεμ", "Παρ", "Σαβ"];
  const WD_LONG = ["Κυριακή", "Δευτέρα", "Τρίτη", "Τετάρτη", "Πέμπτη", "Παρασκευή", "Σάββατο"];
  const MON = ["Ιαν", "Φεβ", "Μαρ", "Απρ", "Μαΐ", "Ιουν", "Ιουλ", "Αυγ", "Σεπ", "Οκτ", "Νοε", "Δεκ"];
  const MON_LONG = ["Ιανουάριος", "Φεβρουάριος", "Μάρτιος", "Απρίλιος", "Μάιος", "Ιούνιος", "Ιούλιος", "Αύγουστος", "Σεπτέμβριος", "Οκτώβριος", "Νοέμβριος", "Δεκέμβριος"];
  const MON_GEN = ["Ιανουαρίου", "Φεβρουαρίου", "Μαρτίου", "Απριλίου", "Μαΐου", "Ιουνίου", "Ιουλίου", "Αυγούστου", "Σεπτεμβρίου", "Οκτωβρίου", "Νοεμβρίου", "Δεκεμβρίου"];

  const fmt = {
    WD, WD_LONG, MON, MON_LONG, MON_GEN,
    weekday(iso) { return D.parse(iso).getUTCDay(); },
    /** "Παρ 17 Οκτ" */
    day(iso) { const d = D.parse(iso); return WD[d.getUTCDay()] + " " + d.getUTCDate() + " " + MON[d.getUTCMonth()]; },
    /** "Σάββατο 10 Οκτωβρίου" */
    long(iso) { const d = D.parse(iso); return WD_LONG[d.getUTCDay()] + " " + d.getUTCDate() + " " + MON_GEN[d.getUTCMonth()]; },
    /** "Παρ 17 – Τρι 21 Οκτ" or "Παρ 30 Οκτ – Τρι 3 Νοε" */
    range(a, b) {
      const da = D.parse(a), db = D.parse(b);
      if (da.getUTCMonth() === db.getUTCMonth()) return WD[da.getUTCDay()] + " " + da.getUTCDate() + " – " + fmt.day(b);
      return fmt.day(a) + " – " + fmt.day(b);
    },
    /** "1.250 €" */
    money(n) {
      const s = String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      return (n < 0 ? "−" : "") + s + " €";
    },
    nights(n) { return n === 1 ? "1 νύχτα" : n + " νύχτες"; },
    people(b) {
      const parts = [b.adults === 1 ? "1 ενήλικας" : b.adults + " ενήλικες"];
      if (b.children) parts.push(b.children === 1 ? "1 παιδί" : b.children + " παιδιά");
      if (b.infants) parts.push(b.infants === 1 ? "1 μωρό" : b.infants + " μωρά");
      return parts.join(", ");
    },
    party(b) { const p = P.party(b); return p === 1 ? "1 άτομο" : p + " άτομα"; },
    /** "Μαρία Κ." */
    short(name) { const parts = name.split(" "); return parts.length > 1 ? parts[0] + " " + parts[parts.length - 1][0] + "." : name; },
    ago(min) { return min <= 0 ? "μόλις τώρα" : min === 1 ? "πριν από 1 λεπτό" : "πριν από " + min + " λεπτά"; },
  };

  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function icon(name) { return '<i data-lucide="' + name + '" aria-hidden="true"></i>'; }
  function refreshIcons() { if (window.lucide) window.lucide.createIcons({ attrs: { "aria-hidden": "true" } }); }
  function storage(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      window.localStorage.setItem(key, value);
    } catch (e) { /* storage blocked: settings just won't be remembered */ }
    return null;
  }

  // ---------- state ----------
  const App = {
    fmt, esc, icon, refreshIcons,
    screens: {},
    db: null,
    state: {
      screen: "today",
      selectedId: null,
      confirmMove: null,
      user: "father",
      devMode: false,
      textSize: storage("proto.textSize") || "normal",
      lang: "el",
      zoom: "month",
      syncAgo: 5,
      syncing: false,
    },
    undoStack: [],
  };
  window.App = App;

  App.room = (id) => App.db.rooms.find((r) => r.id === id);
  App.booking = (id) => App.db.bookings.find((b) => b.id === id);
  App.unplaced = () => App.db.bookings.filter((b) => !b.roomId && b.status !== "cancelled" && b.checkout > App.db.today);
  App.needsRoom = () => App.unplaced().filter((b) => b.status === "confirmed");
  App.selected = () => (App.state.selectedId ? App.booking(App.state.selectedId) : null);

  // ---------- navigation ----------
  const content = () => document.getElementById("content");
  let mounted = null;

  App.go = function (screen, params) {
    params = params || {};
    App.state.screen = screen;
    if (screen !== "calendar") App.state.selectedId = null;
    if (params.select !== undefined) App.state.selectedId = params.select;
    mounted = screen;
    const el = content();
    el.innerHTML = "";
    el.scrollTop = 0;
    App.screens[screen].mount(el, params);
    renderChrome();
    renderPanel();
    refreshIcons();
  };

  /** Re-render after a state change, keeping the current screen mounted when it can update in place. */
  App.render = function () {
    const s = App.screens[App.state.screen];
    if (mounted === App.state.screen && s.update) s.update();
    else App.go(App.state.screen);
    renderChrome();
    renderPanel();
    refreshIcons();
  };

  function renderChrome() {
    document.querySelectorAll("[data-nav]").forEach((b) => {
      if (b.dataset.nav === App.state.screen) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
    const n = App.needsRoom().length;
    const badge = document.querySelector("[data-badge]");
    badge.hidden = n === 0;
    badge.textContent = n;
    badge.setAttribute("aria-label", n + " κρατήσεις χρειάζονται διαμέρισμα");
    document.getElementById("sync-foot").textContent = App.state.syncing ? "Ενημέρωση από Hosthub…" : "Ενημερώθηκε από Hosthub " + fmt.ago(App.state.syncAgo);
  }

  App.select = function (id) {
    App.state.selectedId = id;
    App.state.confirmMove = null;
    App.render();
  };

  // ---------- moves ----------
  function roomPhrase(room) { return "στο " + room.name; }

  /** Moves (or places) a booking. Returns true on success; explains the problem in a toast otherwise. */
  App.move = function (bookingId, roomId, opts) {
    opts = opts || {};
    const b = App.booking(bookingId);
    const room = App.room(roomId);
    if (!b || !room || b.roomId === roomId) return false;
    if (b.status === "pending") {
      App.toast("Η κράτηση " + fmt.short(b.guest) + " δεν έχει επιβεβαιωθεί ακόμα. Θα μπορείτε να τη βάλετε σε διαμέρισμα όταν επιβεβαιωθεί.", { kind: "error" });
      return false;
    }
    const ranked = P.rankRooms(App.db, b);
    const target = ranked.find((r) => r.room.id === roomId);
    const alt = ranked.find((r) => r.recommended) || ranked.find((r) => r.free && r.fits && !r.current);
    const tryAlt = alt ? " Δοκιμάστε " + (alt.room.id === roomId ? "άλλο." : "το " + alt.room.name + ".") : "";
    if (!target.free) {
      const who = target.busy.map((o) => fmt.short(o.guest)).join(", ");
      App.toast("Το " + room.name + " είναι κλεισμένο εκείνες τις μέρες (" + who + ")." + tryAlt, { kind: "error" });
      return false;
    }
    // A guest who is already staying there: ask first, in the panel (edge case E1-1).
    if (b.roomId && b.checkin <= App.db.today && !opts.confirmed) {
      App.state.selectedId = b.id;
      App.state.confirmMove = { id: b.id, roomId };
      App.render();
      return false;
    }
    App.state.confirmMove = null;
    const from = b.roomId;
    b.roomId = roomId;
    App.lastMovedId = b.id;
    const msg = from
      ? fmt.short(b.guest) + ": μετακινήθηκε " + roomPhrase(room) + "."
      : fmt.short(b.guest) + ": μπήκε " + roomPhrase(room) + ".";
    // Too small is allowed, with a warning (edge case E1-2).
    const warn = target.fits ? "" : " Προσοχή: χωράει έως " + room.capacity + " άτομα και είναι " + P.party(b) + ".";
    App.toast(msg + warn, {
      undo() {
        b.roomId = from;
        App.lastMovedId = b.id;
        App.toast(from ? "Αναιρέθηκε. " + fmt.short(b.guest) + " είναι ξανά " + roomPhrase(App.room(from)) + "." : "Αναιρέθηκε. " + fmt.short(b.guest) + " χρειάζεται ξανά διαμέρισμα.");
        App.render();
      },
    });
    App.render();
    return true;
  };

  // ---------- toasts ----------
  App.toast = function (text, opts) {
    opts = opts || {};
    const wrap = document.getElementById("toasts");
    wrap.innerHTML = ""; // one message at a time
    const ms = opts.undo ? 10000 : opts.kind === "error" ? 8000 : 4000;
    const t = document.createElement("div");
    t.className = "toast" + (opts.kind === "error" ? " error" : "");
    t.setAttribute("role", opts.kind === "error" ? "alert" : "status");
    t.innerHTML = (opts.kind === "error" ? icon("circle-alert") : icon("circle-check")) +
      '<span class="msg">' + esc(text) + "</span>" +
      (opts.undo ? '<button type="button" class="btn" data-undo>' + icon("undo-2") + "Αναίρεση</button>" : "") +
      '<button type="button" class="btn btn-ghost icon-btn" data-close aria-label="Κλείσιμο">' + icon("x") + "</button>" +
      '<span class="timer" style="animation-duration:' + ms + 'ms"></span>';
    wrap.appendChild(t);
    const timer = setTimeout(() => t.remove(), ms);
    t.querySelector("[data-close]").onclick = () => { clearTimeout(timer); t.remove(); };
    if (opts.undo) t.querySelector("[data-undo]").onclick = () => { clearTimeout(timer); t.remove(); opts.undo(); };
    refreshIcons();
  };

  // ---------- booking panel ----------
  function renderPanel() {
    const panel = document.getElementById("panel");
    const b = App.state.screen === "calendar" ? App.selected() : null;
    if (!b) { panel.hidden = true; panel.innerHTML = ""; panel.dataset.id = ""; return; }
    const isNew = panel.dataset.id !== b.id;
    panel.dataset.id = b.id;
    panel.hidden = false;
    const room = b.roomId ? App.room(b.roomId) : null;
    const booked = App.room(b.bookedRoomId);
    const ranked = P.rankRooms(App.db, b);
    const n = P.nights(b);
    const pending = b.status === "pending";
    const over = b.checkout <= App.db.today;
    const confirm = App.state.confirmMove && App.state.confirmMove.id === b.id ? App.state.confirmMove : null;

    let status;
    if (pending) status = '<span class="pill pill-muted">' + icon("hourglass") + "Αναμένει επιβεβαίωση</span>";
    else if (!room) status = '<span class="pill pill-warn">' + icon("circle-alert") + "Χρειάζεται διαμέρισμα</span>";
    else status = '<span class="chip"><span class="sw" style="background:' + room.color + '"></span>' + esc(room.name) + "</span>";

    const moves = ranked.map((r) => {
      const style = ' style="--room:' + r.room.color + '"';
      let why, cls = "move", disabled = false, go = "";
      if (r.current) { why = "Εδώ είναι τώρα"; cls += " current"; disabled = true; }
      else if (!r.free) {
        const o = r.busy[0];
        why = "Κλεισμένο: " + fmt.short(o.guest) + " (" + fmt.range(o.checkin, o.checkout) + ")" + (r.busy.length > 1 ? " και άλλοι" : "");
        disabled = true;
      } else if (!r.fits) { why = "Μικρό: χωράει έως " + r.room.capacity + " άτομα, η κράτηση είναι για " + P.party(b); cls += " warn"; }
      else if (r.recommended) { why = "Προτείνεται: " + r.reason; cls += " rec"; }
      else why = "Ελεύθερο όλες τις νύχτες";
      if (pending) disabled = true;
      if (!disabled) go = '<span class="go">' + (r.recommended ? icon("star") : icon("arrow-right")) + "</span>";
      return '<button type="button" class="' + cls + '"' + style + ' data-move="' + r.room.id + '"' + (disabled ? " disabled" : "") + ">" +
        '<span class="sw"></span><span class="grow"><span class="nm">' + (r.current || !room ? "" : "Μετακίνηση στο ") + esc(r.room.name) + '</span><span class="why">' + esc(why) + "</span></span>" + go + "</button>";
    }).join("");

    panel.innerHTML =
      '<div class="panel-head"><div class="grow"><h2>' + esc(b.guest) + "</h2>" + status + "</div>" +
      '<button type="button" class="btn icon-btn" data-close-panel aria-label="Κλείσιμο">' + icon("x") + "</button></div>" +
      '<div class="panel-body">' +
      (confirm ? '<div class="confirm" role="alert"><p><strong>' + esc(fmt.short(b.guest)) + " μένει ήδη " + roomPhrase(room) + " από " + fmt.day(b.checkin) + ".</strong> Να μετακινηθεί " + roomPhrase(App.room(confirm.roomId)) + " για τις υπόλοιπες νύχτες;</p>" +
        '<div class="confirm-actions"><button type="button" class="btn btn-primary btn-big" data-confirm-yes>Ναι, μετακίνηση ' + roomPhrase(App.room(confirm.roomId)) + '</button><button type="button" class="btn btn-big" data-confirm-no>Όχι</button></div></div>' : "") +
      (pending ? '<div class="notice">' + icon("hourglass") + "<span>Η κράτηση δεν έχει επιβεβαιωθεί ακόμα από το " + esc(b.channel) + ". Θα μπορείτε να τη βάλετε σε διαμέρισμα όταν επιβεβαιωθεί.</span></div>" : "") +
      '<dl class="facts">' +
      "<dt>Άφιξη</dt><dd>" + fmt.day(b.checkin) + "</dd>" +
      "<dt>Αναχώρηση</dt><dd>" + fmt.day(b.checkout) + " · " + fmt.nights(n) + "</dd>" +
      "<dt>Άτομα</dt><dd>" + fmt.people(b) + "</dd>" +
      "</dl>" +
      (over
        ? '<div class="note">' + icon("history") + "<span>Η διαμονή τελείωσε " + fmt.day(b.checkout) + ", οπότε δεν μετακινείται.</span></div>"
        : '<div class="section-title">' + (room ? "Μετακίνηση σε άλλο διαμέρισμα" : "Σε ποιο διαμέρισμα θα μείνει;") + "</div>" +
          '<div class="moves">' + moves + "</div>") +
      '<div class="section-title">Στοιχεία κράτησης</div>' +
      '<dl class="facts">' +
      "<dt>Από</dt><dd>" + esc(b.channel) + "</dd>" +
      '<dt>Ποσό</dt><dd class="num">' + fmt.money(b.amount) + "</dd>" +
      (booked ? "<dt>Έκλεισε για</dt><dd>" + esc(booked.name) + "</dd>" : "") +
      "</dl>" +
      (b.notes ? '<div class="note">' + icon("message-square-text") + "<span>" + esc(b.notes) + "</span></div>" : "") +
      "</div>";

    panel.querySelector("[data-close-panel]").onclick = () => App.select(null);
    panel.querySelectorAll("[data-move]").forEach((btn) => { btn.onclick = () => App.move(b.id, btn.dataset.move); });
    if (confirm) {
      panel.querySelector("[data-confirm-yes]").onclick = () => App.move(b.id, confirm.roomId, { confirmed: true });
      panel.querySelector("[data-confirm-no]").onclick = () => { App.state.confirmMove = null; App.render(); };
      panel.scrollTop = 0;
    }
    if (isNew) { panel.scrollTop = 0; panel.querySelector("[data-close-panel]").focus({ preventScroll: true }); }
  }

  // ---------- settings helpers (used by the Settings screen) ----------
  App.setTextSize = function (size) {
    App.state.textSize = size;
    if (size === "normal") document.documentElement.removeAttribute("data-text");
    else document.documentElement.setAttribute("data-text", size);
    storage("proto.textSize", size);
    App.render();
  };
  App.syncNow = function (done) {
    App.state.syncing = true;
    App.render();
    setTimeout(() => {
      App.state.syncing = false;
      App.state.syncAgo = 0;
      App.render();
      App.toast("Η ενημέρωση από Hosthub έγινε. Δεν υπάρχουν νέες κρατήσεις.");
      if (done) done();
    }, 1500);
  };
  App.setUser = function (user) {
    App.state.user = user;
    if (user !== "stelios") App.state.devMode = false;
    document.getElementById("proto-user").value = user;
    App.render();
  };

  // ---------- start ----------
  App.reset = function () {
    App.db = P.generate();
    App.state.selectedId = null;
    App.state.syncAgo = 5;
    App.go(App.state.screen);
  };

  App.start = function () {
    App.db = P.generate();
    if (App.state.textSize !== "normal") document.documentElement.setAttribute("data-text", App.state.textSize);
    document.querySelectorAll("[data-nav]").forEach((b) => { b.onclick = () => App.go(b.dataset.nav); });
    document.getElementById("proto-reset").onclick = () => { App.reset(); App.toast("Το πρωτότυπο ξεκίνησε από την αρχή."); };
    document.getElementById("proto-user").onchange = (e) => App.setUser(e.target.value);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && App.state.selectedId) { App.select(null); }
    });
    // "Ενημερώθηκε πριν από Χ λεπτά" ticks along like the real app.
    setInterval(() => { if (!App.state.syncing) { App.state.syncAgo += 1; renderChrome(); } }, 60000);
    const hash = (location.hash || "").replace("#", "");
    App.go(App.screens[hash] ? hash : "today");
  };
})();
