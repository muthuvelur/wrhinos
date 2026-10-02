/* Shared code for the W/Rhinos trips pages: backend calls (or a preview backend), formatting and the person form. */
(function () {
  'use strict';

  var BACKEND = String(window.TRIPS_BACKEND_URL || '').trim();
  var DEMO = !BACKEND;
  var ROLES = ['Rider', 'Non-rider', 'Support crew'];
  var BIKE_TYPES = ['Road', 'Hybrid', 'Gravel', 'Mountain', 'Road e-bike', 'Hybrid e-bike', 'Other', 'Not bringing a bike'];
  var STAGES = ['Deposit', 'Interim', 'Final', 'Other'];

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) { n = Math.round((Number(n) || 0) * 100) / 100; return '£' + (Number.isInteger(n) ? n.toLocaleString('en-GB') : n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function niceDate(iso) {
    if (!iso) return '';
    var d = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso);
    return isNaN(d) ? String(iso) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function ageOn(dob, on) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob || '') || !/^\d{4}-\d{2}-\d{2}$/.test(on || '')) return null;
    var a = dob.split('-').map(Number), b = on.split('-').map(Number);
    var age = b[0] - a[0];
    if (b[1] < a[1] || (b[1] === a[1] && b[2] < a[2])) age--;
    return age;
  }
  function waLink(phone, message) {
    var digits = String(phone || '').replace(/[^\d]/g, '');
    var intl = digits.indexOf('0') === 0 ? '44' + digits.slice(1) : digits;
    return 'https://wa.me/' + intl + '?text=' + encodeURIComponent(message);
  }

  // ---------- trip details: a small, safe subset of Markdown ----------
  function inline(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }
  function markdown(text) {
    var lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    var out = [], i = 0;
    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) { i++; continue; }
      var h = line.match(/^(#{2,3})\s+(.*)$/);
      if (h) { out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'); i++; continue; }
      if (/^\s*\|/.test(line)) {
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        var cells = rows.map(function (r) { return r.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); }); });
        var hasHead = cells.length > 1 && cells[1].every(function (c) { return /^:?-{2,}:?$/.test(c) || c === ''; }) && cells[1].some(function (c) { return c; });
        var head = hasHead ? cells[0] : null;
        var body = hasHead ? cells.slice(2) : cells;
        var showHead = head && head.some(function (c) { return c; });
        var cols = (head || body[0] || []).length;
        out.push('<div class="table-wrap"><table' + (cols >= 4 ? ' class="wide"' : '') + '>' +
          (showHead ? '<thead><tr>' + head.map(function (c) { return '<th scope="col">' + inline(c) + '</th>'; }).join('') + '</tr></thead>' : '') +
          '<tbody>' + body.map(function (r) {
            return '<tr>' + r.map(function (c, j) { return '<td' + (showHead && head[j] ? ' data-label="' + esc(head[j]) + '"' : '') + '>' + inline(c) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table></div>');
        continue;
      }
      if (/^\s*[-*]\s+/.test(line)) {
        var items = [];
        while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, '')); i++; }
        out.push('<ul>' + items.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</ul>');
        continue;
      }
      var para = [];
      while (i < lines.length && lines[i].trim() && !/^(#{2,3}\s|\s*\||\s*[-*]\s+)/.test(lines[i])) { para.push(lines[i].trim()); i++; }
      out.push('<p>' + inline(para.join(' ')) + '</p>');
    }
    return out.join('\n');
  }

  // ---------- small UI helpers ----------
  var toastTimer;
  function toast(msg) {
    var t = $('toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 2200);
  }
  function copy(text, btn) {
    var done = function () { if (btn) { var l = btn.textContent; btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = l; }, 1600); } else toast('Copied'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    document.body.removeChild(ta);
  }
  function errorBox(el, errors) {
    if (!errors || !errors.length) { el.hidden = true; el.innerHTML = ''; return; }
    el.innerHTML = errors.length === 1 ? esc(errors[0]) : 'Please check these:<ul>' + errors.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ul>';
    el.hidden = false;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Bookings made on this phone, so the home-screen icon can take people straight back to them.
  var MINE_KEY = 'wrhinos-my-bookings';
  function myBookings() { try { return JSON.parse(localStorage.getItem(MINE_KEY) || '[]'); } catch (e) { return []; } }
  function rememberBooking(b) {
    try {
      var list = myBookings().filter(function (x) { return x.ref !== b.ref; });
      list.unshift({ ref: b.ref, link: b.link, trip: b.trip, dates: b.dates || '' });
      localStorage.setItem(MINE_KEY, JSON.stringify(list.slice(0, 10)));
    } catch (e) { /* storage blocked: the email still has the link */ }
  }

  // ---------- person form (used for registering and for editing) ----------
  function opts(list, selected, placeholder) {
    return (placeholder ? '<option value="">' + esc(placeholder) + '</option>' : '') +
      list.map(function (x) { return '<option' + (x === selected ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('');
  }
  function personHtml(i, p, isLead) {
    p = p || {};
    var id = function (k) { return 'p' + i + '_' + k; };
    var v = function (k) { return esc(p[k] || ''); };
    return '' +
      '<div class="card stack person" data-i="' + i + '">' +
      '<div class="person-head"><h3>' + (isLead ? 'You' : 'Person ' + (i + 1)) + '</h3>' +
      (isLead ? '' : '<button type="button" class="linkbtn remove-person">Remove</button>') + '</div>' +
      '<div class="field"><label for="' + id('fullName') + '">Full name, as in passport</label>' +
      '<input type="text" id="' + id('fullName') + '" data-k="fullName" autocomplete="' + (isLead ? 'name' : 'off') + '" value="' + v('fullName') + '"></div>' +
      '<div class="grid2">' +
      '<div class="field"><label for="' + id('dob') + '">Date of birth</label><input type="date" id="' + id('dob') + '" data-k="dob" value="' + v('dob') + '"></div>' +
      '<div class="field"><label for="' + id('role') + '">Going as</label><select id="' + id('role') + '" data-k="role">' + opts(ROLES, p.role || (isLead ? '' : ''), 'Choose…') + '</select></div>' +
      '</div>' +
      '<div class="field adult-field" hidden><label for="' + id('responsibleAdult') + '">Adult responsible for them on the trip</label>' +
      '<input type="text" id="' + id('responsibleAdult') + '" data-k="responsibleAdult" value="' + v('responsibleAdult') + '">' +
      '<span class="hint">Under 18 on the first day of the trip. Name the parent, or the adult the parents have named in writing.</span></div>' +
      '<div class="grid2">' +
      '<div class="field"><label for="' + id('mobile') + '">Mobile' + (isLead ? '' : ' (optional)') + '</label><input type="tel" id="' + id('mobile') + '" data-k="mobile" autocomplete="' + (isLead ? 'tel' : 'off') + '" value="' + v('mobile') + '"></div>' +
      '<div class="field"><label for="' + id('dietary') + '">Dietary needs</label><input type="text" id="' + id('dietary') + '" data-k="dietary" placeholder="e.g. vegetarian, no beef, none" value="' + v('dietary') + '"></div>' +
      '</div>' +
      '<div class="field bike-type-field"><label for="' + id('bikeType') + '">Bike</label><select id="' + id('bikeType') + '" data-k="bikeType">' + opts(BIKE_TYPES, p.bikeType, 'Choose…') + '</select></div>' +
      '<details class="more bike-more"' + (p.bikeMake || p.bikeColour || p.bikeSerial ? ' open' : '') + '><summary>Bike make, colour and serial number</summary><div class="stack">' +
      '<span class="hint">Helps us load and find bikes in the lorry. You can add it later.</span>' +
      '<div class="grid2"><div class="field"><label for="' + id('bikeMake') + '">Make</label><input type="text" id="' + id('bikeMake') + '" data-k="bikeMake" value="' + v('bikeMake') + '"></div>' +
      '<div class="field"><label for="' + id('bikeColour') + '">Colour</label><input type="text" id="' + id('bikeColour') + '" data-k="bikeColour" value="' + v('bikeColour') + '"></div></div>' +
      '<div class="field"><label for="' + id('bikeSerial') + '">Serial number</label><input type="text" id="' + id('bikeSerial') + '" data-k="bikeSerial" value="' + v('bikeSerial') + '"></div>' +
      '</div></details>' +
      '<details class="more"' + (p.passportNumber ? ' open' : '') + '><summary>Passport details</summary><div class="stack">' +
      '<span class="hint">Needed before the trip. Only the organiser sees them, and they are deleted after the trip. You can add them later from your booking page.</span>' +
      '<div class="grid2"><div class="field"><label for="' + id('passportNumber') + '">Passport number</label><input type="text" id="' + id('passportNumber') + '" data-k="passportNumber" autocomplete="off" value="' + v('passportNumber') + '"></div>' +
      '<div class="field"><label for="' + id('passportCountry') + '">Issuing country</label><input type="text" id="' + id('passportCountry') + '" data-k="passportCountry" value="' + v('passportCountry') + '"></div></div>' +
      '<div class="field"><label for="' + id('passportExpiry') + '">Expiry date</label><input type="date" id="' + id('passportExpiry') + '" data-k="passportExpiry" value="' + v('passportExpiry') + '"></div>' +
      '</div></details>' +
      '<details class="more"' + (p.safetyInfo ? ' open' : '') + '><summary>Anything we should know for their safety (optional)</summary><div class="stack">' +
      '<span class="hint">For example a condition or medication emergency responders would need to know about. Seen only by the Ride Coordinator and Deputy, and deleted within 30 days of the trip.</span>' +
      '<div class="field"><label for="' + id('safetyInfo') + '" class="sr">Safety information</label><textarea id="' + id('safetyInfo') + '" data-k="safetyInfo">' + v('safetyInfo') + '</textarea></div>' +
      '</div></details>' +
      '</div>';
  }
  function readPerson(card) {
    var p = {};
    Array.prototype.forEach.call(card.querySelectorAll('[data-k]'), function (el) { p[el.getAttribute('data-k')] = el.value.trim(); });
    return p;
  }
  // Show the responsible-adult field for under-18s, and hide bike questions for non-riders.
  function wirePerson(card, startDate) {
    var dob = card.querySelector('[data-k="dob"]');
    var role = card.querySelector('[data-k="role"]');
    var update = function () {
      var age = ageOn(dob.value, startDate);
      card.querySelector('.adult-field').hidden = !(age !== null && age < 18);
      var nonRider = role.value === 'Non-rider';
      card.querySelector('.bike-type-field').hidden = nonRider;
      card.querySelector('.bike-more').hidden = nonRider;
    };
    dob.addEventListener('change', update);
    dob.addEventListener('input', update);
    role.addEventListener('change', update);
    update();
  }
  function checkPeople(people, startDate) {
    var errs = [];
    people.forEach(function (p, i) {
      var who = i === 0 ? 'Your details' : 'Person ' + (i + 1);
      if (p.fullName.length < 2) errs.push(who + ': enter the full name as it appears in the passport.');
      if (!p.dob) errs.push(who + ': enter a date of birth.');
      if (!p.role) errs.push(who + ': choose rider, non-rider or support crew.');
      if (p.role && p.role !== 'Non-rider' && !p.bikeType) errs.push(who + ': choose a bike type (or "Not bringing a bike").');
      var age = ageOn(p.dob, startDate);
      if (age !== null && age < 18 && (p.responsibleAdult || '').length < 2) errs.push(who + ' is under 18: name the adult responsible for them on the trip.');
      if (age !== null && age < 10 && p.role === 'Rider') errs.push(who + ': riders must be at least 10 on the first day of the trip.');
      if (i === 0 && age !== null && age < 18) errs.push('The person registering must be 18 or over.');
      if (i === 0 && p.mobile.replace(/\D/g, '').length < 10) errs.push('Your details: enter your mobile number.');
    });
    return errs;
  }

  // ---------- backend calls ----------
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function getJson(params) {
    var url = BACKEND + '?' + Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');
    var attempt = function () { return fetch(url).then(function (r) { return r.json(); }); };
    return attempt().catch(function () { return wait(2000).then(attempt); }).catch(function () { return wait(5000).then(attempt); });
  }
  // Apps Script can be slow to wake up; a repeated request is safe because the backend spots duplicates.
  function postJson(body) {
    var attempt = function () {
      return fetch(BACKEND, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); });
    };
    return attempt().catch(function () { return wait(2500).then(attempt); });
  }
  var api = DEMO ? null : {
    trips: function () { return getJson({ action: 'trips' }); },
    trip: function (id) { return getJson({ action: 'trip', id: id }); },
    post: postJson,
  };

  // ---------- preview backend (used until the Google Sheet is connected) ----------
  if (DEMO) {
    var KEY = 'wrhinos-trips-preview';
    var PASS = 'preview-organiser';
    var load = function () { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } };
    var save = function (db) { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* preview only */ } };
    var uid = function (n) { var s = ''; while (s.length < n) s += Math.random().toString(16).slice(2); return s.slice(0, n); };
    var refGen = function (db) {
      var C = 'BDGKLMNPRSTV', V = 'AEIOU', p = function (s) { return s.charAt(Math.floor(Math.random() * s.length)); }, r;
      do { r = p(C) + p(V) + p(C) + p(V) + p(C); } while (db.bookings.some(function (b) { return b.ref === r; }));
      return r;
    };
    var seed = function () {
      return fetch('/trips/content/rhine-2027.md').then(function (r) { return r.ok ? r.text() : ''; }).catch(function () { return ''; }).then(function (md) {
        var db = {
          trips: [{ id: 'rhine-2027', name: 'Castles to Cathedrals: The Rhine Explorer Ride', status: 'Open', datesText: 'Fri 28 May – Wed 2 June 2027', startDate: '2027-05-28', places: 50, depositPerPerson: 100, depositDays: 7,
            summary: 'Frankfurt to Düsseldorf along the Main and Rhine. Flat, family-friendly, riders aged 10 and up, e-bikes welcome.', details: md,
            routes: 'Day 1: Frankfurt – St Goar | \nDay 2: St Goar – Bonn | \nDay 3: Bonn – Düsseldorf | ', organiser: 'Ram Sugavanam' }],
          bookings: [], payments: [],
        };
        // A few example bookings so the places counter and organiser page have something to show.
        [['Example Family A', 4], ['Example Rider B', 1], ['Example Couple C', 2], ['Example Family D', 3], ['Example Rider E', 1]].forEach(function (x, i) {
          var ref = refGen(db);
          var persons = []; for (var k = 0; k < x[1]; k++) persons.push({ n: k + 1, fullName: x[0] + (k ? ' ' + (k + 1) : ''), role: 'Rider', dob: k > 1 ? '2014-06-01' : '1982-03-0' + (k + 1), under18: k > 1 ? 'Yes' : 'No', responsibleAdult: k > 1 ? x[0] : '', bikeType: 'Hybrid', dietary: 'None', mobile: k ? '' : '0770090012' + i });
          db.bookings.push({ ref: ref, token: uid(20), tripId: 'rhine-2027', status: 'Booked', bookedAt: new Date(Date.now() - (9 - i) * 86400000).toISOString(), leadName: persons[0].fullName, email: 'example' + i + '@example.com', mobile: persons[0].mobile,
            address: '1 Example Road, Birmingham', postcode: 'B1 1AA', emergencyName: 'Example Contact', emergencyRelation: 'Friend', emergencyMobile: '07700900999', people: x[1], depositDue: x[1] * 100, roomRequests: '', notes: '', organiserNotes: '', persons: persons });
          if (i < 3) db.payments.push({ id: uid(8), ref: ref, tripId: 'rhine-2027', stage: 'Deposit', amount: x[1] * 100, paidOn: today(), status: i === 2 ? 'Claimed' : 'Confirmed', source: 'Rider' });
        });
        save(db);
        return db;
      });
    };
    var getDb = function () { var db = load(); return db ? Promise.resolve(db) : seed(); };
    var taken = function (db, id) { return db.bookings.filter(function (b) { return b.tripId === id && b.status === 'Booked'; }).reduce(function (a, b) { return a + b.people; }, 0); };
    var routes = function (t) { return String(t.routes || '').split('\n').map(function (l) { var i = l.lastIndexOf('|'); var label = (i === -1 ? l : l.slice(0, i)).trim(); var url = (i === -1 ? '' : l.slice(i + 1)).trim(); return { label: label, url: /^https:\/\//.test(url) ? url : '' }; }).filter(function (r) { return r.label; }); };
    var pub = function (db, t) { return Object.assign({}, t, { placesLeft: Math.max(0, t.places - taken(db, t.id)), routes: routes(t), waiting: db.bookings.filter(function (b) { return b.tripId === t.id && b.status === 'Waiting list'; }).length }); };
    var totals = function (db, ref) { var c = 0, l = 0; db.payments.forEach(function (p) { if (p.ref !== ref) return; if (p.status === 'Confirmed') c += +p.amount; else if (p.status === 'Claimed') l += +p.amount; }); return { confirmed: c, claimed: l }; };
    var link = function (b) { return location.origin + '/trips/booking/?r=' + b.ref + '&k=' + b.token; };
    var bank = { accountName: 'W/Rhinos Cycling Club', sortCode: '00-00-00', accountNumber: '00000000' };
    var view = function (db, b) {
      var t = db.trips.filter(function (x) { return x.id === b.tripId; })[0];
      return { ok: true, booking: b, people: b.persons, payments: db.payments.filter(function (p) { return p.ref === b.ref && p.status !== 'Rejected'; }), totals: totals(db, b.ref), bank: bank,
        trip: { id: t.id, name: t.name, datesText: t.datesText, startDate: t.startDate, depositDays: t.depositDays, status: t.status, routes: routes(t) } };
    };
    var auth = function (db, x) { return db.bookings.filter(function (b) { return b.ref === String(x.ref || '').toUpperCase() && b.token === x.token; })[0]; };
    api = {
      trips: function () { return getDb().then(function (db) { return { ok: true, trips: db.trips.filter(function (t) { return t.status !== 'Draft'; }).map(function (t) { return pub(db, t); }) }; }); },
      trip: function (id) { return getDb().then(function (db) { var t = db.trips.filter(function (x) { return x.id === id && x.status !== 'Draft'; })[0]; return t ? { ok: true, trip: pub(db, t), ready: true } : { ok: false, error: 'This trip is not open yet, or the link is wrong.' }; }); },
      post: function (body) {
        return wait(500).then(getDb).then(function (db) {
          var b, t;
          if (body.action === 'register') {
            t = db.trips.filter(function (x) { return x.id === body.tripId; })[0];
            if (!t || t.status !== 'Open') return { ok: false, error: 'Registration for this trip is not open.' };
            var errs = checkPeople(body.people, t.startDate);
            if (errs.length) return { ok: false, error: errs.join(' '), errors: errs };
            var left = t.places - taken(db, t.id);
            var status = body.people.length <= left ? 'Booked' : 'Waiting list';
            if (status === 'Waiting list' && body.acceptWaitingList !== true) return { ok: false, full: true, placesLeft: Math.max(0, left), error: left > 0 ? 'Only ' + left + (left === 1 ? ' place is' : ' places are') + ' left and your booking needs ' + body.people.length + '.' : 'The trip is full.' };
            var persons = body.people.map(function (p, i) { var age = ageOn(p.dob, t.startDate); return Object.assign({}, p, { n: i + 1, under18: age !== null && age < 18 ? 'Yes' : 'No' }); });
            b = Object.assign({}, body.lead, { ref: refGen(db), token: uid(20), tripId: t.id, status: status, bookedAt: new Date().toISOString(), leadName: persons[0].fullName, mobile: persons[0].mobile, people: persons.length,
              depositDue: persons.filter(function (p) { return p.role !== 'Support crew'; }).length * t.depositPerPerson, roomRequests: body.roomRequests || '', notes: body.notes || '', organiserNotes: '', persons: persons });
            db.bookings.push(b); save(db);
            return { ok: true, ref: b.ref, status: status, link: link(b), depositDue: b.depositDue, depositDays: t.depositDays, bank: bank, emailSent: false, email: b.email, preview: true };
          }
          if (body.action === 'booking') { b = auth(db, body); return b ? view(db, b) : { ok: false, error: 'This booking link is not recognised.' }; }
          if (body.action === 'claim') {
            b = auth(db, body); if (!b) return { ok: false, error: 'This booking link is not recognised.' };
            if (!(+body.amount > 0) || !body.stage || !body.paidOn) return { ok: false, error: 'Enter the amount, what it was for and the date.' };
            db.payments.push({ id: uid(8), ref: b.ref, tripId: b.tripId, stage: body.stage, amount: +body.amount, paidOn: body.paidOn, status: 'Claimed', source: 'Rider', note: body.note || '' });
            save(db); return view(db, b);
          }
          if (body.action === 'update') {
            b = auth(db, body); if (!b) return { ok: false, error: 'This booking link is not recognised.' };
            t = db.trips.filter(function (x) { return x.id === b.tripId; })[0];
            var e2 = checkPeople(body.people, t.startDate); if (e2.length) return { ok: false, error: e2.join(' '), errors: e2 };
            Object.assign(b, body.lead, { roomRequests: body.roomRequests || '', notes: body.notes || '', leadName: body.people[0].fullName, mobile: body.people[0].mobile,
              persons: body.people.map(function (p, i) { var age = ageOn(p.dob, t.startDate); return Object.assign({}, p, { n: i + 1, under18: age !== null && age < 18 ? 'Yes' : 'No' }); }) });
            save(db); return view(db, b);
          }
          if (body.action === 'admin') {
            if (body.pass !== PASS) return { ok: false, auth: false, error: 'Wrong passcode. In this preview the passcode is: ' + PASS };
            if (body.op === 'login') return { ok: true, problems: ['Preview mode: the Google Sheet is not connected yet, so nothing here is real or shared.'] };
            if (body.op === 'trips') return { ok: true, problems: [], trips: db.trips.map(function (x) { return Object.assign(pub(db, x), { routesText: x.routes, claimed: db.payments.filter(function (p) { return p.tripId === x.id && p.status === 'Claimed'; }).length }); }) };
            if (body.op === 'saveTrip') {
              var tr = body.trip;
              if (!tr.name || !tr.startDate || !(+tr.places > 0)) return { ok: false, error: 'Fill in the name, start date and places.' };
              tr.places = +tr.places; tr.depositPerPerson = +tr.depositPerPerson; tr.depositDays = +tr.depositDays;
              if (tr.id) { Object.assign(db.trips.filter(function (x) { return x.id === tr.id; })[0], tr); }
              else { tr.id = (tr.name + ' ' + tr.startDate.slice(0, 4)).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); db.trips.push(tr); }
              save(db); return { ok: true, id: tr.id };
            }
            if (body.op === 'bookings') return { ok: true, bookings: db.bookings.filter(function (x) { return x.tripId === body.tripId; }).map(function (x) { return Object.assign({}, x, { link: link(x), totals: totals(db, x.ref), payments: db.payments.filter(function (p) { return p.ref === x.ref; }) }); }) };
            if (body.op === 'payment') { var pay = db.payments.filter(function (p) { return p.id === body.id; })[0]; pay.status = body.decision === 'confirm' ? 'Confirmed' : 'Rejected'; save(db); return { ok: true, emailed: false }; }
            if (body.op === 'addPayment') { b = db.bookings.filter(function (x) { return x.ref === body.ref; })[0]; db.payments.push({ id: uid(8), ref: b.ref, tripId: b.tripId, stage: body.stage, amount: +body.amount, paidOn: body.paidOn, status: 'Confirmed', source: 'Organiser', note: body.note || '' }); save(db); return { ok: true }; }
            if (body.op === 'setStatus') {
              b = db.bookings.filter(function (x) { return x.ref === body.ref; })[0];
              t = db.trips.filter(function (x) { return x.id === b.tripId; })[0];
              if (body.status === 'Booked' && b.status !== 'Booked' && b.people > t.places - taken(db, t.id) && body.force !== true) return { ok: false, needsForce: true, error: 'Only ' + Math.max(0, t.places - taken(db, t.id)) + ' places are left and this booking has ' + b.people + ' people.' };
              b.status = body.status; save(db); return { ok: true, emailed: false };
            }
            if (body.op === 'saveNotes') { b = db.bookings.filter(function (x) { return x.ref === body.ref; })[0]; b.organiserNotes = body.notes; save(db); return { ok: true }; }
          }
          return { ok: false, error: 'Unknown request.' };
        });
      },
    };
  }

  function demoBanner() {
    if (!DEMO) return;
    var d = document.createElement('div');
    d.className = 'demo';
    d.innerHTML = '<b>Preview.</b> Registrations are not open yet: nothing you enter here is sent anywhere, it stays on this device.' +
      ' <button type="button" class="linkbtn" id="resetPreview">Reset preview</button>';
    document.body.insertBefore(d, document.body.firstChild);
    $('resetPreview').addEventListener('click', function () { try { localStorage.removeItem('wrhinos-trips-preview'); localStorage.removeItem(MINE_KEY); } catch (e) { /* */ } location.reload(); });
  }

  window.Trips = {
    DEMO: DEMO, api: api, $: $, esc: esc, money: money, today: today, niceDate: niceDate, ageOn: ageOn, waLink: waLink,
    markdown: markdown, toast: toast, copy: copy, errorBox: errorBox, myBookings: myBookings, rememberBooking: rememberBooking,
    personHtml: personHtml, readPerson: readPerson, wirePerson: wirePerson, checkPeople: checkPeople, demoBanner: demoBanner,
    ROLES: ROLES, BIKE_TYPES: BIKE_TYPES, STAGES: STAGES,
  };
})();
