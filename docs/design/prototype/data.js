/* Fake data for the clickable prototype. Everything is generated relative to
   the real "today", from a fixed seed, so the same day always shows the same
   bookings. Stay dates are plain YYYY-MM-DD strings; checkout day is free. */
(function () {
  "use strict";

  // ---------- dates ----------
  function pad(n) { return String(n).padStart(2, "0"); }
  function toIso(d) { return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  function parse(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); }
  function addDays(iso, n) { const d = parse(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); }
  function diffDays(a, b) { return Math.round((parse(b) - parse(a)) / 86400000); }
  function localToday() { const n = new Date(); return n.getFullYear() + "-" + pad(n.getMonth() + 1) + "-" + pad(n.getDate()); }
  function monthStart(iso, offset) { const d = parse(iso); return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1))); }

  const dates = { pad, toIso, parse, addDays, diffDays, monthStart };

  // ---------- seeded random ----------
  function rng(seed) {
    let s = seed >>> 0;
    return function () {
      s += 0x6d2b79f5; let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- apartments ----------
  // Capacities are placeholders until Stelios confirms them.
  const rooms = [
    { id: "onar", name: "Onar", color: "#0F766E", soft: "#E6F4F2", capacity: 3, large: false, sortOrder: 1 },
    { id: "cosmos", name: "Cosmos", color: "#4338CA", soft: "#ECEBFB", capacity: 4, large: true, sortOrder: 2 },
    { id: "iris", name: "Iris", color: "#BE185D", soft: "#FCE8F0", capacity: 3, large: false, sortOrder: 3 },
    { id: "helios", name: "Helios", color: "#A65F00", soft: "#FFF1DC", capacity: 4, large: true, sortOrder: 4 },
  ];

  const guests = [
    "Μαρία Κωνσταντίνου", "Νίκος Παπαδόπουλος", "Anna Schmidt", "John Miller", "Sophie Martin",
    "Γιώργος Αλεξίου", "Ελένη Δημητρίου", "Luca Rossi", "Emma Johansson", "Δημήτρης Νικολάου",
    "Katarzyna Nowak", "Pierre Dubois", "Αθηνά Σταύρου", "Tom Becker", "Χρήστος Μαυρίδης",
    "Laura García", "Κώστας Ιωάννου", "Hannah Weber", "Σοφία Γεωργίου", "Michael O'Brien",
    "Βασίλης Αντωνίου", "Julia Novak", "Παναγιώτα Λάμπρου", "Oliver Brown", "Ειρήνη Καραγιάννη",
    "Marco Bianchi", "Αλέξανδρος Πέτρου", "Ingrid Larsen", "Στέλλα Μιχαηλίδου", "David Cohen",
    "Μαρίνα Τσακίρη", "Felix Wagner", "Ευάγγελος Ραφαηλίδης", "Chloé Lefèvre", "Άννα Παππά",
    "James Wilson", "Θοδωρής Καλλέργης", "Elena Petrova", "Δέσποινα Μανωλά", "Sven Andersson",
  ];
  // Names used by the fixed bookings below; kept out of the random pool so nobody appears twice.
  const fixedNames = ["Hannah Weber", "Γιώργος Αλεξίου", "Ελένη Δημητρίου", "Νίκος Παπαδόπουλος", "Sophie Martin",
    "Laura García", "Luca Rossi", "Αθηνά Σταύρου", "Katarzyna Nowak", "Tom Becker"];
  const pool = guests.filter((g) => !fixedNames.includes(g));
  const notes = [
    "Έρχονται με το πλοίο των 14:00.",
    "Θα ήθελαν βρεφικό κρεβάτι.",
    "Επέτειος γάμου, ζήτησαν ήσυχο διαμέρισμα.",
    "Late arrival around 23:00.",
    "Θα φέρουν σκυλάκι, μικρό.",
    "",
    "",
    "",
  ];
  const channels = ["Airbnb", "Airbnb", "Airbnb", "Booking.com", "Booking.com", "Booking.com", "Απευθείας"];

  function generate() {
    const today = localToday();
    const start = monthStart(today, -1);
    const end = addDays(monthStart(today, 3), -1); // last day of the 3rd month ahead
    const rand = rng(20261010);
    const pick = (arr) => arr[Math.floor(rand() * arr.length)];
    let seq = 0;
    const bookings = [];

    function makeBooking(roomId, checkin, nights, extra) {
      seq += 1;
      const r = rand();
      const adults = r < 0.25 ? 1 : 2;
      const children = rand() < 0.25 ? 1 + Math.floor(rand() * 2) : 0;
      const infants = rand() < 0.1 ? 1 : 0;
      const nightly = 75 + Math.floor(rand() * 60);
      const b = {
        id: "b" + seq,
        guest: pool[(seq * 7) % pool.length],
        checkin,
        checkout: addDays(checkin, nights),
        adults,
        children,
        infants,
        channel: pick(channels),
        amount: nightly * nights,
        notes: pick(notes),
        status: "confirmed",
        roomId,
        bookedRoomId: rand() < 0.8 ? roomId : pick(rooms).id,
      };
      Object.assign(b, extra || {});
      bookings.push(b);
      return b;
    }

    // Fixed bookings near today so every usability task has something to find.
    const T = (n) => addDays(today, n);
    const fixed = {
      onar: [
        { in: T(-3), out: T(0), extra: { guest: "Hannah Weber", adults: 2, children: 0 } },
        { in: T(0), out: T(4), extra: { guest: "Γιώργος Αλεξίου", adults: 2, children: 1, channel: "Booking.com" } },
      ],
      cosmos: [
        { in: T(-2), out: T(2), extra: { guest: "Ελένη Δημητρίου", adults: 2, children: 2 } },
        { in: T(3), out: T(9), extra: { guest: "Νίκος Παπαδόπουλος", adults: 2, children: 1, channel: "Απευθείας", notes: "Τακτικός πελάτης, τρίτη φορά." } },
      ],
      iris: [
        { in: T(1), out: T(5), extra: { guest: "Sophie Martin", adults: 2, children: 0, channel: "Airbnb", notes: "Late arrival around 23:00." } },
        // Pending booking's space, freed below.
        { in: T(12), out: T(16), extra: { guest: "Laura García", adults: 3, children: 0, channel: "Booking.com", status: "pending", unassign: true } },
      ],
      helios: [
        { in: T(-4), out: T(0), extra: { guest: "Luca Rossi", adults: 2, children: 0 } },
        { in: T(1), out: T(3), extra: { guest: "Αθηνά Σταύρου", adults: 1, children: 0, channel: "Απευθείας" } },
        // New 4-person booking that needs an apartment; Helios is kept free for it.
        { in: T(4), out: T(9), extra: { guest: "Katarzyna Nowak", adults: 2, children: 2, channel: "Airbnb", bookedRoomId: "iris", unassign: true, notes: "Θα ήθελαν βρεφικό κρεβάτι." } },
      ],
    };
    // New 2-person booking that needs an apartment; Onar is kept free for it.
    fixed.onar.push({ in: T(7), out: T(10), extra: { guest: "Tom Becker", adults: 2, children: 0, channel: "Booking.com", bookedRoomId: "onar", unassign: true } });

    rooms.forEach((room) => {
      const anchors = fixed[room.id].slice().sort((a, b) => a.in.localeCompare(b.in));
      let cursor = addDays(start, Math.floor(rand() * 3));
      const fill = (until) => {
        for (;;) {
          const gap = rand() < 0.35 ? 0 : 1 + Math.floor(rand() * 3);
          const nights = 2 + Math.floor(rand() * 6);
          const cin = addDays(cursor, gap);
          const cout = addDays(cin, nights);
          if (cout > until) return;
          makeBooking(room.id, cin, nights);
          cursor = cout;
        }
      };
      anchors.forEach((a) => {
        fill(a.in);
        const b = makeBooking(room.id, a.in, diffDays(a.in, a.out), a.extra);
        cursor = a.out;
        if (b.unassign) { b.roomId = null; delete b.unassign; }
      });
      fill(end);
    });

    bookings.sort((a, b) => a.checkin.localeCompare(b.checkin) || a.id.localeCompare(b.id));

    return { today, start, end, rooms, bookings, income: generateIncome(today, rand) };
  }

  // Income for this year per apartment per month (for the Money screen), in
  // euros. Past months are "actual", future months are confirmed bookings.
  function generateIncome(today, rand) {
    const year = Number(today.slice(0, 4));
    const currentMonth = Number(today.slice(5, 7)) - 1;
    const season = [0.15, 0.1, 0.2, 0.45, 0.7, 0.9, 1, 1, 0.85, 0.55, 0.2, 0.25];
    const months = [];
    for (let m = 0; m < 12; m++) {
      const perRoom = {};
      rooms.forEach((r) => {
        const base = (r.large ? 3900 : 3200) * season[m];
        let value = Math.round((base * (0.85 + rand() * 0.3)) / 10) * 10;
        if (m === currentMonth) value = Math.round(value * 0.7 / 10) * 10;
        if (m > currentMonth) value = Math.round(value * (m === currentMonth + 1 ? 0.45 : 0.15) / 10) * 10;
        perRoom[r.id] = value;
      });
      months.push({ month: m, perRoom, kind: m < currentMonth ? "actual" : m === currentMonth ? "current" : "expected" });
    }
    return { year, currentMonth, months };
  }

  // ---------- rules ----------
  function party(b) { return b.adults + b.children; } // infants do not count
  function nights(b) { return diffDays(b.checkin, b.checkout); }
  function overlaps(a, b) { return a.checkin < b.checkout && b.checkin < a.checkout; }

  /** Who is in `roomId` during `booking`'s stay (other than the booking itself). */
  function clashes(db, booking, roomId) {
    return db.bookings.filter((o) => o.id !== booking.id && o.roomId === roomId && o.status !== "cancelled" && overlaps(o, booking));
  }

  /** Empty single nights left next to the stay in this room (fewer is better). */
  function gapNights(db, booking, roomId) {
    const others = db.bookings.filter((o) => o.id !== booking.id && o.roomId === roomId);
    let gaps = 0;
    const before = others.filter((o) => o.checkout <= booking.checkin).sort((a, b) => b.checkout.localeCompare(a.checkout))[0];
    const after = others.filter((o) => o.checkin >= booking.checkout).sort((a, b) => a.checkin.localeCompare(b.checkin))[0];
    if (before && diffDays(before.checkout, booking.checkin) === 1) gaps++;
    if (after && diffDays(booking.checkout, after.checkin) === 1) gaps++;
    return gaps;
  }

  /** Ranks apartments for a booking using the ordered rules from the phase plan. */
  function rankRooms(db, booking) {
    const p = party(booking);
    const rows = db.rooms.map((room) => {
      const busy = clashes(db, booking, room.id);
      const fits = p <= room.capacity;
      const sizeMatch = p >= 3 ? room.large : !room.large;
      return {
        room,
        current: booking.roomId === room.id,
        free: busy.length === 0,
        busy,
        fits,
        sizeMatch,
        booked: booking.bookedRoomId === room.id,
        gaps: gapNights(db, booking, room.id),
      };
    });
    const key = (r) => [r.free ? 0 : 1, r.fits ? 0 : 1, r.sizeMatch ? 0 : 1, r.booked ? 0 : 1, r.gaps, r.room.sortOrder];
    const ranked = rows.slice().sort((a, b) => {
      const ka = key(a), kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return 0;
    });
    const best = ranked.find((r) => r.free && r.fits && !r.current);
    if (best && !(rows.find((r) => r.current && r.free && r.fits && r.sizeMatch))) {
      best.recommended = true;
      best.reason = p >= 3 && best.room.large ? "χωράει " + p + " άτομα"
        : best.booked ? "εκεί έκλεισε ο επισκέπτης"
        : p <= 2 && !best.room.large ? "κρατά τα μεγάλα ελεύθερα για οικογένειες"
        : "ελεύθερο όλες τις νύχτες";
    }
    return rows; // in apartment order, flags attached
  }

  window.PROTO = { dates, generate, party, nights, overlaps, clashes, rankRooms, localToday };
})();
