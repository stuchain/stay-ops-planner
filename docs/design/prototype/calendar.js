/* Ημερολόγιο: one continuous day timeline, a row per apartment, the
   "Χρειάζονται διαμέρισμα" tray, click-to-move with the side panel and
   drag as a shortcut. A move only changes the apartment, never the dates. */
(function () {
  "use strict";
  const P = window.PROTO;
  const D = P.dates;
  const { fmt, esc, icon } = App;

  const NAME_W = 168;
  const ROW_H = 80;
  const BAR_H = 56;
  const DAY_W = { week: 132, month: 40 };

  let el = null;        // page root
  let scroller = null;  // horizontal scroll container
  let W = DAY_W.month;
  let days = [];
  let drag = null;      // { id, startX, startY, active, float, overRoom }
  let suppressClick = false;

  const dayIdx = (iso) => D.diffDays(App.db.start, iso);

  // ---------- skeleton ----------
  function buildGrid() {
    const db = App.db;
    W = DAY_W[App.state.zoom];
    days = [];
    for (let d = db.start; d <= db.end; d = D.addDays(d, 1)) days.push(d);

    const months = [];
    days.forEach((d) => {
      const key = d.slice(0, 7);
      const last = months[months.length - 1];
      if (last && last.key === key) last.n++;
      else months.push({ key, n: 1, m: Number(d.slice(5, 7)) - 1, y: d.slice(0, 4) });
    });

    const dayCls = (d) => {
      const wd = fmt.weekday(d);
      return (wd === 0 || wd === 6 ? " weekend" : "") + (d.endsWith("-01") ? " month-first" : "") + (d === db.today ? " is-today" : "");
    };
    const monthRow = months.map((m) => '<div class="month-seg" style="width:' + m.n * W + 'px"><span>' + fmt.MON_LONG[m.m] + " " + m.y + "</span></div>").join("");
    const dayRow = days.map((d) => {
      const wd = fmt.weekday(d);
      const label = App.state.zoom === "week" ? fmt.WD_LONG[wd] : fmt.WD[wd].slice(0, 2);
      return '<div class="day' + dayCls(d) + '" style="width:' + W + 'px"><span>' + label + "</span><b>" + Number(d.slice(8)) + "</b></div>";
    }).join("");
    const cells = days.map((d) => '<div class="cell' + dayCls(d).replace(" is-today", d === db.today ? " is-today" : "") + '" style="width:' + W + 'px"></div>').join("");
    const rows = db.rooms.map((r) =>
      '<div class="row" data-row="' + r.id + '" style="--room:' + r.color + '">' +
      '<div class="row-name"><span class="n">' + esc(r.name) + '</span><span class="c" data-status="' + r.id + '">έως ' + r.capacity + " άτομα</span></div>" +
      '<div class="row-days">' + cells + "</div></div>").join("");

    const cal = el.querySelector(".cal");
    cal.style.setProperty("--name-w", NAME_W + "px");
    cal.style.setProperty("--row-h", ROW_H + "px");
    cal.innerHTML =
      '<div class="cal-scroll" tabindex="0" aria-label="Ημερολόγιο διαμερισμάτων"><div class="cal-inner" style="width:' + (NAME_W + days.length * W) + 'px">' +
      '<div class="cal-head"><div class="corner"></div><div class="months-days"><div class="month-row">' + monthRow + '</div><div class="day-row">' + dayRow + "</div></div></div>" +
      '<div class="cal-body">' + rows + '<div class="bars" style="overflow:hidden;z-index:2"></div></div>' +
      "</div></div>";
    scroller = cal.querySelector(".cal-scroll");
    scroller.addEventListener("scroll", onScroll, { passive: true });
  }

  // ---------- painting ----------
  function barHtml(b, room, rowIdx) {
    const n = P.nights(b);
    const left = (dayIdx(b.checkin) + 0.5) * W + 2;
    const width = n * W - 4;
    const top = rowIdx * ROW_H + (ROW_H - BAR_H) / 2;
    return { left, width, top };
  }

  function paint() {
    const db = App.db;
    const sel = drag && drag.active ? App.booking(drag.id) : App.selected();
    paintTray(sel);

    const layer = el.querySelector(".bars");
    const existing = new Map();
    layer.querySelectorAll(".bar").forEach((n) => existing.set(n.dataset.id, n));
    const seen = new Set();
    db.bookings.forEach((b) => {
      if (!b.roomId || b.status === "cancelled" || b.checkout <= db.start || b.checkin > db.end) return;
      const rowIdx = db.rooms.findIndex((r) => r.id === b.roomId);
      const room = db.rooms[rowIdx];
      const g = barHtml(b, room, rowIdx);
      let node = existing.get(b.id);
      if (!node) {
        node = document.createElement("button");
        node.type = "button";
        node.className = "bar";
        node.dataset.id = b.id;
        node.addEventListener("pointerdown", onPointerDown);
        node.addEventListener("click", onBarClick);
        layer.appendChild(node);
      }
      seen.add(b.id);
      node.style.setProperty("--room", room.color);
      node.style.left = g.left + "px";
      node.style.width = g.width + "px";
      node.style.top = g.top + "px";
      const wide = g.width >= 110;
      const name = App.state.zoom === "week" ? b.guest : fmt.short(b.guest);
      node.innerHTML = '<span class="g">' + esc(name) + "</span>" +
        (wide ? '<span class="m">' + fmt.party(b) + " · " + fmt.nights(P.nights(b)) + "</span>" : "");
      node.setAttribute("aria-label", b.guest + ", " + room.name + ", " + fmt.range(b.checkin, b.checkout) + ", " + fmt.party(b));
      node.classList.toggle("selected", !!sel && sel.id === b.id);
      node.classList.toggle("past", b.checkout <= db.today);
      node.classList.toggle("dragging", !!drag && drag.active && drag.id === b.id);
      if (App.lastMovedId === b.id) {
        node.classList.remove("just-moved");
        void node.offsetWidth;
        node.classList.add("just-moved");
      }
    });
    existing.forEach((n, id) => { if (!seen.has(id)) n.remove(); });
    App.lastMovedId = null;

    // Free / busy guidance while a booking is selected or dragged.
    layer.querySelectorAll(".ghost").forEach((n) => n.remove());
    el.querySelectorAll(".row").forEach((row) => row.classList.remove("drop-ok", "drop-busy", "drop-hover", "drop-hover-busy"));
    db.rooms.forEach((r) => {
      const s = el.querySelector('[data-status="' + r.id + '"]');
      s.textContent = "έως " + r.capacity + " άτομα";
      s.style.color = "";
      s.style.fontWeight = "";
    });
    if (sel && sel.status !== "pending") {
      const ranked = P.rankRooms(db, sel);
      ranked.forEach((r, i) => {
        const row = el.querySelector('[data-row="' + r.room.id + '"]');
        const status = el.querySelector('[data-status="' + r.room.id + '"]');
        const g = barHtml(sel, r.room, i);
        const ghost = document.createElement(r.free && r.fits && !r.current ? "button" : "div");
        ghost.style.left = g.left + "px";
        ghost.style.width = g.width + "px";
        ghost.style.top = g.top + "px";
        if (r.current) {
          ghost.className = "ghost here";
          status.textContent = "Εδώ είναι τώρα";
          status.style.color = "var(--accent)";
        } else if (!r.free) {
          ghost.className = "ghost busy";
          row.classList.add("drop-busy");
          status.textContent = "Κλεισμένο: " + r.busy.map((o) => fmt.short(o.guest)).join(", ");
          status.style.color = "var(--text-muted)";
        } else if (!r.fits) {
          ghost.className = "ghost small";
          ghost.textContent = "Χωράει έως " + r.room.capacity + " άτομα";
          row.classList.add("drop-busy");
          status.textContent = "Μικρό για " + fmt.party(sel);
        } else {
          ghost.type = "button";
          ghost.className = "ghost free" + (r.recommended ? " rec" : "");
          ghost.innerHTML = (r.recommended ? icon("star") + "Προτείνεται" : icon("check") + "Ελεύθερο");
          ghost.setAttribute("aria-label", (sel.roomId ? "Μετακίνηση στο " : "Στο ") + r.room.name);
          ghost.onclick = () => App.move(sel.id, r.room.id);
          row.classList.add("drop-ok");
          status.textContent = r.recommended ? "Προτείνεται" : "Ελεύθερο";
          status.style.color = "var(--success-text)";
        }
        status.style.fontWeight = "700";
        if (drag && drag.active && drag.overRoom === r.room.id && !r.current) row.classList.add(r.free && r.fits ? "drop-hover" : "drop-hover-busy");
        layer.appendChild(ghost);
      });
    }
    App.refreshIcons();
  }

  function paintTray(sel) {
    const tray = el.querySelector(".tray");
    const items = App.unplaced().sort((a, b) => a.checkin.localeCompare(b.checkin));
    const confirmed = items.filter((b) => b.status === "confirmed");
    tray.classList.toggle("done", confirmed.length === 0);
    if (!items.length) {
      tray.innerHTML = '<div class="tray-empty">' + icon("circle-check") + "Όλες οι κρατήσεις έχουν διαμέρισμα.</div>";
      return;
    }
    tray.innerHTML =
      '<div class="tray-head">' + icon("circle-alert") + "<span>Χρειάζονται<br>διαμέρισμα (" + confirmed.length + ")</span></div>" +
      '<div class="tray-items">' + items.map((b) => {
        const booked = App.room(b.bookedRoomId);
        const pending = b.status === "pending";
        return '<button type="button" class="tray-card' + (pending ? " pending" : "") + (sel && sel.id === b.id ? " selected" : "") + '" data-tray="' + b.id + '">' +
          '<span class="who">' + esc(b.guest) + "</span>" +
          '<span class="what">' + fmt.range(b.checkin, b.checkout) + " · " + fmt.party(b) + "</span>" +
          (pending ? '<span class="what tray-pending">' + icon("hourglass") + "Αναμένει επιβεβαίωση</span>"
            : '<span class="what">' + fmt.nights(P.nights(b)) + (booked ? " · έκλεισε για " + esc(booked.name) : "") + "</span>") +
          "</button>";
      }).join("") + "</div>";
    tray.querySelectorAll("[data-tray]").forEach((card) => {
      card.addEventListener("pointerdown", onPointerDown);
      card.addEventListener("click", (e) => {
        if (suppressClick) { suppressClick = false; return; }
        const id = card.dataset.tray;
        App.select(id);
        scrollToBooking(App.booking(id));
        e.preventDefault();
      });
    });
  }

  // ---------- scrolling ----------
  function scrollToDate(iso, smooth) {
    const left = Math.max(0, (dayIdx(iso)) * W);
    scroller.scrollTo({ left, behavior: smooth ? "smooth" : "instant" });
  }
  function leadDays() { return App.state.zoom === "week" ? 1 : 3; }
  function scrollToToday(smooth) { scrollToDate(D.addDays(App.db.today, -leadDays()), smooth); }
  function scrollToBooking(b, smooth) {
    if (!b) return;
    const view = scroller.clientWidth - NAME_W;
    const start = dayIdx(b.checkin) * W, end = dayIdx(b.checkout) * W;
    const cur = scroller.scrollLeft;
    if (start >= cur && end <= cur + view) return; // already visible
    scrollToDate(D.addDays(b.checkin, -leadDays()), smooth !== false);
  }
  function leftDate() { return D.addDays(App.db.start, Math.round(scroller.scrollLeft / W)); }
  function step(dir) {
    if (App.state.zoom === "week") { scroller.scrollBy({ left: dir * 7 * W, behavior: "smooth" }); return; }
    const cur = leftDate();
    const target = D.monthStart(D.addDays(cur, dir > 0 ? 0 : -1), dir > 0 ? 1 : 0);
    scrollToDate(target < App.db.start ? App.db.start : target, true);
  }
  let raf = 0;
  function onScroll() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const mid = D.addDays(leftDate(), Math.floor((scroller.clientWidth - NAME_W) / W / 2));
      const label = el.querySelector(".cal-month-label");
      if (label) label.textContent = fmt.MON_LONG[Number(mid.slice(5, 7)) - 1] + " " + mid.slice(0, 4);
    });
  }

  // ---------- click and drag ----------
  function onBarClick(e) {
    if (suppressClick) { suppressClick = false; return; }
    App.select(e.currentTarget.dataset.id);
  }
  function onPointerDown(e) {
    if (e.button !== 0) return;
    const id = e.currentTarget.dataset.id || e.currentTarget.dataset.tray;
    const b = App.booking(id);
    if (!b || b.status === "pending") return;
    drag = { id, startX: e.clientX, startY: e.clientY, active: false, float: null, overRoom: null };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
  }
  function roomAtY(y) {
    const body = el.querySelector(".cal-body").getBoundingClientRect();
    if (y < body.top || y > body.bottom) return null;
    const i = Math.floor((y - body.top) / ROW_H);
    return App.db.rooms[i] ? App.db.rooms[i].id : null;
  }
  function onPointerMove(e) {
    if (!drag) return;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
      drag.active = true;
      const b = App.booking(drag.id);
      const room = b.roomId ? App.room(b.roomId) : null;
      const f = document.createElement("div");
      f.className = "drag-float";
      f.style.setProperty("--room", room ? room.color : "var(--accent)");
      f.innerHTML = "<span>" + esc(fmt.short(b.guest)) + '</span><span style="font-weight:500">' + fmt.party(b) + "</span>";
      document.body.appendChild(f);
      drag.float = f;
      paint();
    }
    drag.float.style.left = e.clientX + 12 + "px";
    drag.float.style.top = e.clientY - 28 + "px";
    const over = roomAtY(e.clientY);
    if (over !== drag.overRoom) { drag.overRoom = over; paint(); }
  }
  function onPointerUp() {
    window.removeEventListener("pointermove", onPointerMove);
    const d = drag;
    drag = null;
    if (!d || !d.active) return; // a plain click; the click handler selects
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    d.float.remove();
    const b = App.booking(d.id);
    if (d.overRoom && d.overRoom !== b.roomId) {
      App.state.selectedId = d.id;
      if (!App.move(d.id, d.overRoom)) App.render();
    } else paint();
  }

  // ---------- keyboard ----------
  function onKey(e) {
    if (App.state.screen !== "calendar" || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    if (e.key === "ArrowLeft") { step(-1); e.preventDefault(); }
    if (e.key === "ArrowRight") { step(1); e.preventDefault(); }
  }
  document.addEventListener("keydown", onKey);

  // ---------- screen ----------
  function setZoom(z) {
    if (App.state.zoom === z) return;
    const keep = D.addDays(leftDate(), leadDays());
    App.state.zoom = z;
    buildGrid();
    el.querySelectorAll("[data-zoom]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.zoom === z)));
    paint();
    scrollToDate(D.addDays(keep, -leadDays()), false);
    onScroll();
  }

  App.screens.calendar = {
    mount(root, params) {
      el = root;
      el.innerHTML =
        '<div class="page cal-page">' +
        '<div class="cal-toolbar"><h1 class="cal-title">Ημερολόγιο</h1>' +
        '<button type="button" class="btn icon-btn" data-step="-1" aria-label="Προηγούμενο">' + icon("chevron-left") + "</button>" +
        '<button type="button" class="btn" data-today>Σήμερα</button>' +
        '<button type="button" class="btn icon-btn" data-step="1" aria-label="Επόμενο">' + icon("chevron-right") + "</button>" +
        '<span class="cal-month-label"></span><span class="grow" style="flex:1"></span>' +
        '<div class="seg" role="group" aria-label="Εμφάνιση"><button type="button" data-zoom="week" aria-pressed="' + (App.state.zoom === "week") + '">Εβδομάδα</button>' +
        '<button type="button" data-zoom="month" aria-pressed="' + (App.state.zoom === "month") + '">Μήνας</button></div>' +
        "</div>" +
        '<div class="tray" aria-live="polite"></div>' +
        '<div class="cal"></div>' +
        '<p class="cal-hint">' + icon("mouse-pointer-click") + "Κάντε κλικ σε μια κράτηση για να δείτε τα στοιχεία της και να τη μετακινήσετε. Μπορείτε και να τη σύρετε σε άλλο διαμέρισμα.</p>" +
        "</div>";
      el.querySelector("[data-today]").onclick = () => scrollToToday(true);
      el.querySelectorAll("[data-step]").forEach((b) => { b.onclick = () => step(Number(b.dataset.step)); });
      el.querySelectorAll("[data-zoom]").forEach((b) => { b.onclick = () => setZoom(b.dataset.zoom); });
      buildGrid();
      paint();
      const sel = App.selected();
      // Wait one frame so the panel has taken its width before measuring.
      requestAnimationFrame(() => {
        scrollToToday(false);
        if (sel && params && params.select) scrollToBooking(sel, false);
        onScroll();
      });
    },
    update() {
      paint();
      const sel = App.selected();
      if (sel && !sel.roomId) requestAnimationFrame(() => scrollToBooking(sel));
    },
  };
})();
