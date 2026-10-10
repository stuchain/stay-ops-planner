/* Ρυθμίσεις: the owner's part (language, text size, Hosthub update, password) and,
   for Stelios only, a non-functional Dev mode preview of the admin sections. */
(function () {
  "use strict";
  const { fmt, esc, icon } = App;

  const SIZES = [["normal", "Κανονικά"], ["large", "Μεγάλα"], ["xlarge", "Πολύ μεγάλα"]];
  const LANGS = [["el", "Ελληνικά"], ["en", "English"]];

  function seg(name, items, current, label) {
    return '<div class="seg" role="group" aria-label="' + esc(label) + '" data-seg="' + name + '">' +
      items.map((i) => '<button type="button" data-v="' + i[0] + '" aria-pressed="' + (i[0] === current) + '">' + esc(i[1]) + "</button>").join("") + "</div>";
  }
  function setPressed(root, value) {
    root.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === value)));
  }
  function swatch(room) { return '<span class="chip"><span class="sw" style="background:' + room.color + '"></span>' + esc(room.name) + "</span>"; }
  function sw(id, on, label) {
    return '<div class="set-row"><span class="grow" id="' + id + '-l">' + esc(label) + '</span><button type="button" class="switch" role="switch" id="' + id +
      '" aria-checked="' + on + '" aria-labelledby="' + id + '-l"></button><span class="sw-word" aria-hidden="true">' + (on ? "Ναι" : "Όχι") + "</span></div>";
  }

  // ---------- owner parts ----------
  function syncHtml() {
    const s = App.state;
    return "<h2>" + icon("refresh-cw") + "Ενημέρωση από Hosthub</h2>" +
      '<p class="set-big">Τελευταία ενημέρωση από Hosthub: <strong>' + (s.syncing ? "γίνεται τώρα" : fmt.ago(s.syncAgo)) + "</strong></p>" +
      '<p class="muted">Οι νέες κρατήσεις έρχονται μόνες τους. Πατήστε το κουμπί αν θέλετε να δείτε τις πιο πρόσφατες αμέσως.</p>' +
      '<button type="button" class="btn btn-primary btn-big" data-sync' + (s.syncing ? " disabled" : "") + ">" +
      (s.syncing ? icon("loader") + "Γίνεται ενημέρωση…" : icon("refresh-cw") + "Ενημέρωση τώρα") + "</button>";
  }

  function pwField(id, label, hint) {
    return '<div class="field"><label for="' + id + '">' + label + '</label>' +
      '<input class="input" type="password" id="' + id + '" autocomplete="' + (id === "pw-cur" ? "current-password" : "new-password") + '" aria-describedby="' + id + '-e">' +
      '<div class="field-err" id="' + id + '-e" role="alert"></div>' + (hint ? '<div class="muted hint">' + hint + "</div>" : "") + "</div>";
  }

  // ---------- dev preview ----------
  function devHtml() {
    const db = App.db;
    const rooms = db.rooms.slice().sort((a, b) => a.sortOrder - b.sortOrder);
    const aptRows = rooms.map((r) =>
      "<tr><td>" + swatch(r) + '</td><td class="num">' + r.sortOrder + '</td><td class="num">' + r.capacity + " άτομα</td><td>" +
      (r.large ? '<span class="pill pill-ok">Ναι</span>' : '<span class="pill pill-muted">Όχι</span>') +
      '</td><td><span class="pill pill-ok">Ενεργό</span></td></tr>').join("");

    const runs = [
      ["ok", "Επιτυχία", "2 νέες κρατήσεις, 1 αλλαγή"],
      ["ok", "Επιτυχία", "Καμία αλλαγή"],
      ["warn", "Με προειδοποίηση", "1 νέα κράτηση, 1 χωρίς διαμέρισμα"],
      ["ok", "Επιτυχία", "1 ακύρωση"],
      ["ok", "Επιτυχία", "Καμία αλλαγή"],
    ];
    const runRows = runs.map((r, i) => {
      const mins = App.state.syncAgo + i * 30;
      return "<tr><td>" + esc(fmt.ago(mins)) + '</td><td><span class="pill pill-' + r[0] + '">' + (r[0] === "ok" ? icon("check") : icon("triangle-alert")) + r[1] + "</span></td><td>" + r[2] + "</td></tr>";
    }).join("");

    const rules = [
      "Ελεύθερο όλες τις νύχτες της διαμονής.",
      "Χωράει την παρέα (τα βρέφη δεν μετράνε).",
      "Για 3-4 άτομα προτιμώνται τα Cosmos και Helios.",
      "Για 1-2 άτομα προτιμώνται τα υπόλοιπα.",
      "Το διαμέρισμα που έκλεισε ο ίδιος ο επισκέπτης.",
      "Όσο το δυνατόν λιγότερες μεμονωμένες άδειες νύχτες.",
      "Σειρά διαμερισμάτων (Onar, Cosmos, Iris, Helios).",
    ];

    const tiers = [["Έως 12.000 €", "15%"], ["12.000 € έως 35.000 €", "35%"], ["Πάνω από 35.000 €", "45%"]];

    const placed = db.bookings.filter((b) => b.roomId && b.status === "confirmed");
    const audit = [];
    for (let i = 0; i < placed.length && audit.length < 4; i++) {
      const b = placed[i];
      const from = rooms.find((r) => r.id !== b.roomId && r.id === b.bookedRoomId) || rooms.find((r) => r.id !== b.roomId);
      audit.push(["Stelios", "μετακίνησε", fmt.short(b.guest), "από " + from.name + " σε " + App.room(b.roomId).name]);
    }
    const when = ["σήμερα 10:42", "σήμερα 09:15", "χθες 21:08", "χθες 18:30"];

    return '<div class="dev-banner">' + icon("wrench") + "<span>Λειτουργία προγραμματιστή: προεπισκόπηση. Τίποτα εδώ δεν αλλάζει πραγματικά δεδομένα.</span></div>" +
      '<section class="card"><h2>' + icon("building-2") + "Διαμερίσματα</h2>" +
      '<div class="table-wrap"><table class="dev-table"><thead><tr><th>Όνομα</th><th>Σειρά</th><th>Χωρητικότητα</th><th>Προτιμάται για 3-4 άτομα</th><th>Κατάσταση</th></tr></thead><tbody>' + aptRows + "</tbody></table></div></section>" +

      '<section class="card"><h2>' + icon("plug") + "Hosthub</h2>" +
      '<dl class="facts"><dt>Κλειδί σύνδεσης</dt><dd class="num mono">hh_live_••••••••••••7f3a</dd>' +
      '<dt>Webhook</dt><dd><span class="pill pill-ok">' + icon("check") + 'Ενεργό</span> <span class="muted">τελευταίο μήνυμα ' + esc(fmt.ago(App.state.syncAgo + 2)) + "</span></dd></dl>" +
      '<h3 class="sub-h">Τελευταίες 5 ενημερώσεις</h3><div class="table-wrap"><table class="dev-table"><thead><tr><th>Πότε</th><th>Αποτέλεσμα</th><th>Τι άλλαξε</th></tr></thead><tbody>' + runRows + "</tbody></table></div>" +
      '<button type="button" class="btn" data-dev-fake>' + icon("rotate-ccw") + "Πλήρης επανασυγχρονισμός</button></section>" +

      '<section class="card"><h2>' + icon("sparkles") + "Προτάσεις διαμερίσματος</h2>" +
      '<p class="muted">Τα διαμερίσματα ταξινομούνται με αυτούς τους κανόνες, με αυτή τη σειρά. Αν δύο ισοβαθμούν σε έναν κανόνα, αποφασίζει ο επόμενος.</p>' +
      '<ol class="rules">' + rules.map((r) => "<li>" + esc(r) + "</li>").join("") + "</ol></section>" +

      '<section class="card"><h2>' + icon("landmark") + "Έσοδα και φόρος</h2>" +
      '<div class="table-wrap"><table class="dev-table"><thead><tr><th>Κλιμάκιο ετήσιου εισοδήματος</th><th>Συντελεστής</th></tr></thead><tbody>' +
      tiers.map((t) => '<tr><td class="num">' + t[0] + '</td><td class="num"><strong>' + t[1] + "</strong></td></tr>").join("") + "</tbody></table></div>" +
      "<p>Το εισόδημα μετράει για το διαμέρισμα που έκλεισε ο επισκέπτης, όχι εκείνο που μένει τελικά.</p></section>" +

      '<section class="card"><h2>' + icon("calendar-cog") + "Ημερολόγιο: επιπλέον επιλογές</h2>" +
      sw("dev-sw-prices", true, "Τιμή ανά νύχτα στις κρατήσεις") + sw("dev-sw-logos", true, "Λογότυπα καναλιών") +
      sw("dev-sw-multi", false, "Προβολή πολλών μηνών") + sw("dev-sw-reorder", false, "Αλλαγή σειράς διαμερισμάτων") +
      '<h3 class="sub-h">Ιστορικό</h3><ul class="audit">' +
      audit.map((a, i) => "<li><span><strong>" + a[0] + "</strong> " + a[1] + " <strong>" + esc(a[2]) + "</strong> " + esc(a[3]) + '</span><span class="muted">' + when[i] + "</span></li>").join("") +
      "</ul></section>";
  }

  // ---------- screen ----------
  App.screens.settings = {
    mount(el) {
      el.innerHTML =
        '<div class="page"><header class="page-head"><h1>Ρυθμίσεις</h1></header><div class="settings">' +
        '<section class="card" id="st-lang"><h2>' + icon("languages") + "Γλώσσα</h2>" + seg("lang", LANGS, App.state.lang, "Γλώσσα") + "</section>" +
        '<section class="card" id="st-size"><h2>' + icon("a-large-small") + "Μέγεθος γραμμάτων</h2>" + seg("size", SIZES, App.state.textSize, "Μέγεθος γραμμάτων") +
        '<p class="sample" aria-live="polite"><span class="muted">Έτσι φαίνονται τα γράμματα:</span><br>Η Μαρία φτάνει την Παρασκευή στο Cosmos και μένει τέσσερις νύχτες.</p></section>' +
        '<section class="card" id="st-sync"></section>' +
        '<section class="card" id="st-pw"><h2>' + icon("key-round") + "Κωδικός</h2>" +
        '<form novalidate id="pw-form" class="pw-form">' +
        pwField("pw-cur", "Ο κωδικός που έχετε τώρα") + pwField("pw-new", "Νέος κωδικός", "Τουλάχιστον 8 χαρακτήρες.") + pwField("pw-rep", "Ξανά ο νέος κωδικός") +
        '<div class="pw-actions"><button type="submit" class="btn btn-primary btn-big">' + icon("check") + 'Αλλαγή κωδικού</button>' +
        '<button type="button" class="btn" data-showpw aria-pressed="false">' + icon("eye") + "<span>Εμφάνιση κωδικών</span></button></div></form></section>" +
        '<div id="st-dev-switch"></div><div id="st-dev" class="dev"></div></div></div>';

      el.querySelectorAll("[data-seg=lang] button").forEach((b) => {
        b.onclick = () => {
          if (b.dataset.v === "en") { App.toast("Τα αγγλικά θα προστεθούν στην επόμενη φάση."); return; }
          App.state.lang = "el";
        };
      });
      el.querySelectorAll("[data-seg=size] button").forEach((b) => { b.onclick = () => App.setTextSize(b.dataset.v); });

      const form = el.querySelector("#pw-form");
      const showBtn = form.querySelector("[data-showpw]");
      showBtn.onclick = () => {
        const on = showBtn.getAttribute("aria-pressed") !== "true";
        showBtn.setAttribute("aria-pressed", String(on));
        form.querySelectorAll("input").forEach((i) => { i.type = on ? "text" : "password"; });
        showBtn.querySelector("span").textContent = on ? "Απόκρυψη κωδικών" : "Εμφάνιση κωδικών";
      };
      form.onsubmit = (e) => {
        e.preventDefault();
        const cur = form.querySelector("#pw-cur"), nw = form.querySelector("#pw-new"), rep = form.querySelector("#pw-rep");
        const errs = {};
        if (!cur.value) errs["pw-cur"] = "Γράψτε τον κωδικό που έχετε τώρα.";
        if (!nw.value) errs["pw-new"] = "Γράψτε τον νέο κωδικό.";
        else if (nw.value.length < 8) errs["pw-new"] = "Ο νέος κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.";
        else if (nw.value === cur.value) errs["pw-new"] = "Ο νέος κωδικός είναι ίδιος με τον τωρινό. Διαλέξτε άλλον.";
        if (!rep.value) errs["pw-rep"] = "Γράψτε ξανά τον νέο κωδικό.";
        else if (nw.value && rep.value !== nw.value) errs["pw-rep"] = "Οι δύο νέοι κωδικοί δεν είναι ίδιοι.";
        let first = null;
        [cur, nw, rep].forEach((i) => {
          const msg = errs[i.id] || "";
          form.querySelector("#" + i.id + "-e").textContent = msg;
          i.setAttribute("aria-invalid", msg ? "true" : "false");
          i.closest(".field").classList.toggle("invalid", !!msg);
          if (msg && !first) first = i;
        });
        if (first) { first.focus(); return; }
        form.reset();
        App.toast("Ο κωδικός άλλαξε.");
      };

      this.update();
    },

    update() {
      const el = document.getElementById("content");
      const s = App.state;
      setPressed(el.querySelector("[data-seg=lang]"), s.lang);
      setPressed(el.querySelector("[data-seg=size]"), s.textSize);

      const sync = el.querySelector("#st-sync");
      sync.innerHTML = syncHtml();
      sync.querySelector("[data-sync]").onclick = () => App.syncNow();

      const isAdmin = s.user === "stelios";
      const swWrap = el.querySelector("#st-dev-switch");
      if (!isAdmin) swWrap.innerHTML = "";
      else if (!swWrap.firstChild) {
        swWrap.innerHTML = '<section class="card dev-switch-card"><div class="set-row"><span class="grow"><strong id="dev-l">Λειτουργία προγραμματιστή</strong><br><span class="muted">Αλλάζει μόνο τι φαίνεται στην οθόνη, όχι τι επιτρέπεται.</span></span>' +
          '<button type="button" class="switch" role="switch" id="dev-switch" aria-labelledby="dev-l" aria-checked="false"></button><span class="sw-word" aria-hidden="true"></span></div></section>';
        swWrap.querySelector("#dev-switch").onclick = () => { s.devMode = !s.devMode; App.render(); };
      }
      if (isAdmin) {
        swWrap.querySelector("#dev-switch").setAttribute("aria-checked", String(!!s.devMode));
        swWrap.querySelector(".sw-word").textContent = s.devMode ? "Ναι" : "Όχι";
      }

      const dev = el.querySelector("#st-dev");
      if (isAdmin && s.devMode) {
        dev.innerHTML = devHtml();
        dev.querySelectorAll("[data-dev-fake]").forEach((b) => { b.onclick = () => App.toast("Στο πρωτότυπο δεν γίνεται πραγματικός επανασυγχρονισμός."); });
        dev.querySelectorAll(".set-row .switch").forEach((b) => {
          b.onclick = () => {
            const on = b.getAttribute("aria-checked") !== "true";
            b.setAttribute("aria-checked", String(on));
            b.nextElementSibling.textContent = on ? "Ναι" : "Όχι";
          };
        });
      } else dev.innerHTML = "";
      App.refreshIcons();
    },
  };
})();
