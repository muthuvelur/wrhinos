(function () {
  'use strict';
  var T = window.Trips, $ = T.$, esc = T.esc;
  var pass = '';
  var trips = [];
  var current = null;
  var bookings = [];
  var filter = 'all';

  T.demoBanner();
  try { pass = sessionStorage.getItem('wrhinos-org') || ''; } catch (e) { /* */ }

  function admin(op, extra) {
    return T.api.post(Object.assign({ action: 'admin', op: op, pass: pass }, extra || {})).then(function (r) {
      if (r && r.auth === false) { lock(r.error); throw new Error(''); }
      return r;
    });
  }
  function views(id) {
    ['loginView', 'tripsView', 'tripView', 'newView'].forEach(function (v) { $(v).hidden = v !== id; });
    $('loading').hidden = true;
    $('logout').hidden = id === 'loginView';
  }
  function busy() { $('loading').hidden = false; }
  function lock(msg) {
    pass = '';
    try { sessionStorage.removeItem('wrhinos-org'); } catch (e) { /* */ }
    views('loginView');
    T.errorBox($('loginError'), msg ? [msg] : []);
  }

  // ---------- login ----------
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    pass = $('pass').value;
    $('loginBtn').disabled = true;
    admin('login').then(function (r) {
      if (!r.ok) { T.errorBox($('loginError'), [r.error]); return; }
      try { sessionStorage.setItem('wrhinos-org', pass); } catch (x) { /* */ }
      $('pass').value = '';
      showProblems(r.problems);
      loadTrips();
    }).catch(function () { /* handled */ }).then(function () { $('loginBtn').disabled = false; });
  });
  $('logout').addEventListener('click', function () { lock(''); });
  function showProblems(list) {
    $('problems').hidden = !(list && list.length);
    $('problems').innerHTML = list && list.length ? '<b>Registrations can’t open until these are fixed in the Settings tab of the Google Sheet:</b><ul>' + list.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' : '';
  }

  // ---------- trips ----------
  function loadTrips(thenId) {
    busy();
    return admin('trips').then(function (r) {
      if (!r.ok) throw new Error(r.error);
      trips = r.trips;
      if (r.problems) showProblems(r.problems);
      $('tripCards').innerHTML = trips.length ? trips.map(function (t) {
        return '<a href="#" class="card trip-card" data-id="' + esc(t.id) + '"><p class="eyebrow">' + esc(t.datesText) + '</p><h2>' + esc(t.name) + '</h2>' +
          '<div class="row"><span class="chip ' + (t.status === 'Open' ? 'ok' : t.status === 'Draft' ? 'warn' : '') + '">' + esc(t.status) + '</span>' +
          '<span class="small muted">' + (t.places - t.placesLeft) + ' of ' + t.places + ' places taken' + (t.waiting ? ' · ' + t.waiting + ' waiting' : '') + '</span>' +
          (t.claimed ? '<span class="chip warn">' + t.claimed + ' payment' + (t.claimed === 1 ? '' : 's') + ' to check</span>' : '') + '</div></a>';
      }).join('') : '<div class="card muted">No trips yet. Tap “New trip”.</div>';
      Array.prototype.forEach.call(document.querySelectorAll('#tripCards .trip-card'), function (a) {
        a.addEventListener('click', function (e) { e.preventDefault(); openTrip(a.getAttribute('data-id')); });
      });
      if (thenId) openTrip(thenId); else views('tripsView');
    }).catch(function (e) { if (e.message) { T.toast(e.message); views('tripsView'); } });
  }
  $('backTrips').addEventListener('click', function (e) { e.preventDefault(); loadTrips(); });
  $('backNew').addEventListener('click', function (e) { e.preventDefault(); views('tripsView'); });

  function openTrip(id) {
    current = trips.filter(function (t) { return t.id === id; })[0];
    if (!current) { views('tripsView'); return; }
    $('oDates').textContent = current.datesText;
    $('oName').textContent = current.name;
    $('oStatus').textContent = current.status;
    $('oStatus').className = 'chip ' + (current.status === 'Open' ? 'ok' : current.status === 'Draft' ? 'warn' : '');
    var url = location.origin + '/trips/?t=' + encodeURIComponent(current.id);
    $('oPublic').href = url;
    $('oCopy').onclick = function () { T.copy(url, null); };
    setTab('bookings');
    $('editTab').innerHTML = tripFormHtml(current);
    wireTripForm($('editTab'), current);
    loadBookings();
  }

  function setTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { t.setAttribute('aria-selected', t.getAttribute('data-tab') === name ? 'true' : 'false'); });
    $('bookingsTab').hidden = name !== 'bookings';
    $('editTab').hidden = name !== 'edit';
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { t.addEventListener('click', function () { setTab(t.getAttribute('data-tab')); }); });

  // ---------- trip form (new and edit) ----------
  function tripFormHtml(t) {
    t = t || { status: 'Draft', places: 50, depositPerPerson: 100, depositDays: 7, routesText: '', details: '' };
    var v = function (k) { return esc(t[k] === undefined ? '' : t[k]); };
    return '<form class="stack trip-form" novalidate>' +
      '<div class="card stack">' +
      '<div class="field"><label>Trip name</label><input type="text" data-f="name" value="' + v('name') + '" placeholder="e.g. Lakes &amp; Legends 2027"></div>' +
      '<div class="grid2"><div class="field"><label>Status</label><select data-f="status">' + ['Draft', 'Open', 'Closed'].map(function (s) { return '<option' + (t.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
      '<span class="hint">Draft: only organisers see it. Open: people can register. Closed: visible, no registrations.</span></div>' +
      '<div class="field"><label>Organiser</label><input type="text" data-f="organiser" value="' + v('organiser') + '"></div></div>' +
      '<div class="grid2"><div class="field"><label>Dates (as shown to riders)</label><input type="text" data-f="datesText" value="' + v('datesText') + '" placeholder="Fri 28 May – Wed 2 June 2027"></div>' +
      '<div class="field"><label>First day of the trip</label><input type="date" data-f="startDate" value="' + v('startDate') + '"><span class="hint">Used to work out who is under 18.</span></div></div>' +
      '<div class="grid2"><div class="field"><label>Places</label><input type="number" min="1" data-f="places" value="' + v('places') + '"><span class="hint">Everyone counts: riders, non-riders, children, support crew.</span></div>' +
      '<div class="field"><label>Deposit per person (£)</label><input type="number" min="0" step="0.01" data-f="depositPerPerson" value="' + v('depositPerPerson') + '"><span class="hint">Support crew pay no deposit.</span></div></div>' +
      '<div class="field"><label>Days to pay the deposit</label><input type="number" min="1" data-f="depositDays" value="' + v('depositDays') + '"></div>' +
      '<div class="field"><label>One-line summary</label><input type="text" data-f="summary" value="' + v('summary') + '"></div>' +
      '</div>' +
      '<div class="card stack"><div class="field"><label>Route links</label><textarea data-f="routes" rows="4" placeholder="Day 1: Frankfurt – St Goar | https://ridewithgps.com/routes/…">' + esc(t.routesText || '') + '</textarea>' +
      '<span class="hint">One per line: a label, a | sign, then the RideWithGPS (or Komoot, Strava) link. Leave the link empty to show “Coming soon”.</span></div></div>' +
      '<div class="card stack"><div class="field"><label>Trip details</label><textarea data-f="details" rows="16" style="font-family:var(--mono);font-size:14px">' + esc(t.details || '') + '</textarea>' +
      '<span class="hint">Plain text. <b>## Heading</b> for a section, <b>- </b> at the start of a line for a bullet, <b>**bold**</b>, links as [text](https://…). Tables: rows like | Day | Ride |.</span></div>' +
      '<div class="row"><button type="button" class="btn btn-line btn-small preview-btn">Preview</button></div><article class="md preview" hidden></article></div>' +
      '<div class="error form-error" hidden></div>' +
      '<div class="row"><button type="submit" class="btn btn-primary">' + (t.id ? 'Save trip' : 'Create trip') + '</button></div>' +
      '</form>';
  }
  function wireTripForm(box, t) {
    var form = box.querySelector('form');
    var get = function (k) { return form.querySelector('[data-f="' + k + '"]').value; };
    form.querySelector('.preview-btn').addEventListener('click', function () {
      var pv = form.querySelector('.preview');
      pv.innerHTML = T.markdown(get('details'));
      pv.hidden = !pv.hidden;
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var trip = { id: t ? t.id : '' };
      ['name', 'status', 'organiser', 'datesText', 'startDate', 'places', 'depositPerPerson', 'depositDays', 'summary', 'routes', 'details'].forEach(function (k) { trip[k] = get(k); });
      var btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      admin('saveTrip', { trip: trip }).then(function (r) {
        if (!r.ok) { T.errorBox(form.querySelector('.form-error'), [r.error]); return; }
        T.toast(t ? 'Trip saved' : 'Trip created');
        loadTrips(r.id);
      }).catch(function () { /* */ }).then(function () { btn.disabled = false; });
    });
  }
  $('newTrip').addEventListener('click', function () {
    $('newForm').innerHTML = tripFormHtml(null);
    wireTripForm($('newForm'), null);
    views('newView');
    window.scrollTo(0, 0);
  });

  // ---------- bookings ----------
  function loadBookings() {
    busy();
    admin('bookings', { tripId: current.id }).then(function (r) {
      if (!r.ok) throw new Error(r.error);
      bookings = r.bookings.sort(function (a, b) { return String(a.bookedAt).localeCompare(String(b.bookedAt)); });
      renderBookings();
      views('tripView');
    }).catch(function (e) { if (e.message) T.toast(e.message); });
  }

  function owes(b) { return Math.max(0, Math.round((b.depositDue - b.totals.confirmed) * 100) / 100); }
  var FILTERS = [
    ['all', 'All', function (b) { return b.status !== 'Cancelled'; }],
    ['check', 'Payments to check', function (b) { return b.payments.some(function (p) { return p.status === 'Claimed'; }); }],
    ['unpaid', 'Deposit not paid', function (b) { return b.status === 'Booked' && owes(b) > 0; }],
    ['overdue', 'Deposit overdue', function (b) { return b.status === 'Booked' && owes(b) > 0 && Date.now() - new Date(b.bookedAt).getTime() > current.depositDays * 86400000; }],
    ['waiting', 'Waiting list', function (b) { return b.status === 'Waiting list'; }],
    ['cancelled', 'Cancelled', function (b) { return b.status === 'Cancelled'; }],
  ];

  function renderBookings() {
    var booked = bookings.filter(function (b) { return b.status === 'Booked'; });
    var taken = booked.reduce(function (a, b) { return a + b.people; }, 0);
    var due = booked.reduce(function (a, b) { return a + b.depositDue; }, 0);
    var got = bookings.reduce(function (a, b) { return a + b.totals.confirmed; }, 0);
    var waitingPeople = bookings.filter(function (b) { return b.status === 'Waiting list'; }).reduce(function (a, b) { return a + b.people; }, 0);
    $('stats').innerHTML = [
      [taken + ' / ' + current.places, 'Places taken'],
      [Math.max(0, current.places - taken), 'Places left'],
      [waitingPeople, 'People waiting'],
      [T.money(got) + ' / ' + T.money(due), 'Deposits checked'],
    ].map(function (s) { return '<div><b>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div>'; }).join('');
    $('filters').innerHTML = FILTERS.map(function (f) {
      var n = bookings.filter(f[2]).length;
      return '<button type="button" class="filter" data-f="' + f[0] + '" aria-pressed="' + (filter === f[0]) + '">' + f[1] + ' (' + n + ')</button>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('#filters .filter'), function (b) {
      b.addEventListener('click', function () { filter = b.getAttribute('data-f'); renderBookings(); });
    });
    var fn = FILTERS.filter(function (f) { return f[0] === filter; })[0][2];
    var term = $('search').value.trim().toLowerCase();
    var list = bookings.filter(fn).filter(function (b) {
      if (!term) return true;
      return [b.ref, b.email, b.leadName].concat((b.persons || []).map(function (p) { return p.fullName; })).join(' ').toLowerCase().indexOf(term) !== -1;
    });
    $('bookingList').innerHTML = list.length ? list.map(bookingHtml).join('') : '<div class="card muted">Nothing here.</div>';
    wireBookings();
  }
  $('search').addEventListener('input', function () { renderBookings(); });

  function bookingHtml(b) {
    var claimed = b.payments.filter(function (p) { return p.status === 'Claimed'; });
    var left = owes(b);
    var chip = b.status === 'Booked' ? (left > 0 ? '<span class="chip ' + (claimed.length ? 'warn' : 'bad') + '">' + (claimed.length ? 'Check payment' : 'Owes ' + T.money(left)) + '</span>' : '<span class="chip ok">Deposit paid</span>')
      : '<span class="chip ' + (b.status === 'Waiting list' ? 'warn' : '') + '">' + esc(b.status) + '</span>';
    var first = String(b.leadName).split(' ')[0];
    var waMsg = 'Hi ' + first + ', a reminder about your W/Rhinos booking for ' + current.name + ': your deposit of ' + T.money(left - b.totals.claimed) +
      ' is due. Please pay to the club account using reference ' + b.ref + '. Your booking page: ' + b.link;
    return '<details class="card booking" data-ref="' + esc(b.ref) + '"><summary>' +
      '<span class="who">' + esc(b.leadName) + (b.people > 1 ? ' +' + (b.people - 1) : '') + '</span>' + chip +
      '<span class="meta">' + esc(b.ref) + ' · ' + b.people + (b.people === 1 ? ' person' : ' people') + ' · booked ' + esc(T.niceDate(b.bookedAt)) + '</span>' +
      '<span class="meta">' + T.money(b.totals.confirmed) + ' of ' + T.money(b.depositDue) + '</span></summary>' +
      '<div class="body">' +
      (b.organiserNotes ? '<div class="notice small">' + esc(b.organiserNotes) + '</div>' : '') +
      (claimed.length ? '<div class="stack">' + claimed.map(function (p) {
        return '<div class="notice row" style="justify-content:space-between"><span><b>' + T.money(p.amount) + '</b> ' + esc(p.stage) + ', paid ' + esc(T.niceDate(p.paidOn)) + (p.note ? '<br><span class="small">' + esc(p.note) + '</span>' : '') + '</span>' +
          '<span class="row"><button type="button" class="btn btn-ok btn-small" data-act="confirm" data-id="' + esc(p.id) + '">In the bank ✓</button>' +
          '<button type="button" class="btn btn-line btn-small" data-act="reject" data-id="' + esc(p.id) + '">Not found</button></span></div>';
      }).join('') + '</div>' : '') +
      '<div class="table-wrap"><table class="plain"><thead><tr><th>Name</th><th>Going as</th><th>Age</th><th>Bike</th><th>Diet</th><th>Passport</th></tr></thead><tbody>' +
      (b.persons || []).map(function (p) {
        var age = T.ageOn(p.dob, current.startDate);
        return '<tr><td>' + esc(p.fullName) + (p.under18 === 'Yes' ? '<br><span class="small muted">with ' + esc(p.responsibleAdult) + '</span>' : '') + '</td><td>' + esc(p.role) + '</td><td>' + (age === null ? '' : age) + '</td>' +
          '<td>' + esc([p.bikeType, p.bikeMake, p.bikeColour].filter(Boolean).join(', ')) + '</td><td>' + esc(p.dietary) + '</td>' +
          '<td>' + (p.passportNumber ? esc(p.passportNumber) + '<br><span class="small muted">' + esc(p.passportCountry) + ' ' + esc(T.niceDate(p.passportExpiry)) + '</span>' : '<span class="chip warn">Missing</span>') + '</td></tr>' +
          (p.safetyInfo ? '<tr><td colspan="6" class="small"><b>Safety:</b> ' + esc(p.safetyInfo) + '</td></tr>' : '');
      }).join('') + '</tbody></table></div>' +
      '<dl class="kv"><dt>Email</dt><dd>' + esc(b.email) + '</dd><dt>Mobile</dt><dd>' + esc(b.mobile) + '</dd><dt>Address</dt><dd>' + esc(b.address) + ', ' + esc(b.postcode) + '</dd>' +
      '<dt>Emergency</dt><dd>' + esc(b.emergencyName) + ' (' + esc(b.emergencyRelation) + ') ' + esc(b.emergencyMobile) + '</dd>' +
      '<dt>Rooms</dt><dd>' + esc(b.roomRequests || '—') + '</dd><dt>Notes</dt><dd>' + esc(b.notes || '—') + '</dd></dl>' +
      (b.payments.length ? '<div class="table-wrap"><table class="plain"><thead><tr><th>Paid on</th><th>For</th><th>Amount</th><th>Status</th></tr></thead><tbody>' +
        b.payments.map(function (p) { return '<tr><td>' + esc(T.niceDate(p.paidOn)) + '</td><td>' + esc(p.stage) + '</td><td>' + T.money(p.amount) + '</td><td>' + esc(p.status) + (p.source === 'Organiser' ? ' (added by organiser)' : '') + '</td></tr>'; }).join('') +
        '</tbody></table></div>' : '') +
      '<div class="row">' +
      (b.status === 'Booked' && left > b.totals.claimed && b.mobile ? '<a class="btn btn-line btn-small" target="_blank" rel="noopener" href="' + esc(T.waLink(b.mobile, waMsg)) + '">WhatsApp reminder</a>' : '') +
      (b.mobile ? '<a class="btn btn-line btn-small" target="_blank" rel="noopener" href="' + esc(T.waLink(b.mobile, 'Hi ' + first + ', ')) + '">WhatsApp</a>' : '') +
      '<button type="button" class="btn btn-line btn-small" data-act="copylink">Copy their booking link</button>' +
      '<button type="button" class="btn btn-line btn-small" data-act="addpay">Record a payment</button>' +
      (b.status === 'Waiting list' ? '<button type="button" class="btn btn-primary btn-small" data-act="offer">Give them places</button>' : '') +
      (b.status === 'Cancelled' ? '<button type="button" class="btn btn-line btn-small" data-act="restore">Restore booking</button>' : '<button type="button" class="btn btn-line btn-small" data-act="cancel">Cancel booking</button>') +
      '</div>' +
      '<form class="stack addpay-form" hidden novalidate><div class="grid2"><div class="field"><label>Amount (£)</label><input type="text" inputmode="decimal" class="ap-amount" value="' + (left || '') + '"></div>' +
      '<div class="field"><label>For</label><select class="ap-stage">' + T.STAGES.map(function (s) { return '<option>' + s + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="grid2"><div class="field"><label>Paid on</label><input type="date" class="ap-date" value="' + T.today() + '"></div><div class="field"><label>Note</label><input type="text" class="ap-note" placeholder="e.g. cash at the club ride"></div></div>' +
      '<div class="row"><button type="submit" class="btn btn-primary btn-small">Save payment</button></div></form>' +
      '<div class="field"><label>Organiser notes (riders don’t see these)</label><textarea class="org-notes" rows="2">' + esc(b.organiserNotes || '') + '</textarea>' +
      '<div><button type="button" class="btn btn-line btn-small" data-act="notes">Save notes</button></div></div>' +
      '</div></details>';
  }

  function act(promise, okMsg, keepRef) {
    return promise.then(function (r) {
      if (!r.ok) { T.toast(r.error); return r; }
      T.toast(okMsg + (r.emailed ? ' and emailed them' : ''));
      return reload(keepRef).then(function () { return r; });
    });
  }
  function reload(keepRef) {
    return admin('bookings', { tripId: current.id }).then(function (r) {
      if (!r.ok) return;
      bookings = r.bookings.sort(function (a, b) { return String(a.bookedAt).localeCompare(String(b.bookedAt)); });
      return admin('trips').then(function (tr) {
        if (tr.ok) { trips = tr.trips; current = trips.filter(function (t) { return t.id === current.id; })[0] || current; }
        renderBookings();
        if (keepRef) { var d = document.querySelector('details[data-ref="' + keepRef + '"]'); if (d) d.open = true; }
      });
    });
  }

  function wireBookings() {
    Array.prototype.forEach.call(document.querySelectorAll('#bookingList details.booking'), function (d) {
      var ref = d.getAttribute('data-ref');
      var b = bookings.filter(function (x) { return x.ref === ref; })[0];
      d.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-act]');
        if (!btn) return;
        var a = btn.getAttribute('data-act');
        if (a === 'confirm' || a === 'reject') act(admin('payment', { id: btn.getAttribute('data-id'), decision: a }), a === 'confirm' ? 'Payment confirmed' : 'Marked as not found', ref);
        else if (a === 'copylink') T.copy(b.link, btn);
        else if (a === 'addpay') { var f = d.querySelector('.addpay-form'); f.hidden = !f.hidden; }
        else if (a === 'offer') act(admin('setStatus', { ref: ref, status: 'Booked' }), 'Places given', ref).then(function (r) {
          if (r && r.needsForce) {
            btn.textContent = 'Give places anyway (over the limit)';
            btn.setAttribute('data-act', 'force');
          }
        });
        else if (a === 'force') act(admin('setStatus', { ref: ref, status: 'Booked', force: true }), 'Places given', ref);
        else if (a === 'cancel') {
          if (btn.getAttribute('data-sure') !== '1') { btn.setAttribute('data-sure', '1'); btn.textContent = 'Tap again to cancel ' + ref; return; }
          act(admin('setStatus', { ref: ref, status: 'Cancelled' }), 'Booking cancelled', ref);
        }
        else if (a === 'restore') act(admin('setStatus', { ref: ref, status: 'Waiting list' }), 'Moved to the waiting list', ref);
        else if (a === 'notes') act(admin('saveNotes', { ref: ref, notes: d.querySelector('.org-notes').value }), 'Notes saved', ref);
      });
      d.querySelector('.addpay-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.target;
        act(admin('addPayment', { ref: ref, amount: f.querySelector('.ap-amount').value, stage: f.querySelector('.ap-stage').value, paidOn: f.querySelector('.ap-date').value, note: f.querySelector('.ap-note').value }), 'Payment recorded', ref);
      });
    });
  }

  if (pass) {
    admin('login').then(function (r) { if (r.ok) { showProblems(r.problems); loadTrips(); } }).catch(function () { /* */ });
  } else {
    views('loginView');
  }
})();
