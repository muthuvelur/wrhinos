(function () {
  'use strict';
  var T = window.Trips, $ = T.$, esc = T.esc;
  var pass = '';
  var trips = [];
  var current = null;
  var bookings = [];
  var filter = 'all';

  T.demoBanner();
  // Organisers stay signed in on their own phone or computer until they tap Lock, so the page opens instantly.
  var store = window.localStorage;
  try { pass = store.getItem('wrhinos-org') || sessionStorage.getItem('wrhinos-org') || ''; } catch (e) { /* */ }

  function admin(op, extra) {
    return T.api.post(Object.assign({ action: 'admin', op: op, pass: pass }, extra || {})).then(function (r) {
      if (r && r.auth === false) { lock(r.error); throw new Error(''); }
      return r;
    });
  }
  function views(id) {
    ['loginView', 'tripsView', 'tripView', 'newView'].forEach(function (v) { $(v).hidden = v !== id; });
    $('loading').hidden = true;
    clearTimeout(slowTimer);
    $('logout').hidden = id === 'loginView';
  }
  // While Google is working, keep Lock available and offer a way out if it is very slow.
  var slowTimer = null;
  function busy() {
    $('loading').hidden = false;
    $('logout').hidden = !pass;
    $('loadingMsg').textContent = 'Loading… this can take up to a minute when Google is slow.';
    clearTimeout(slowTimer);
    slowTimer = setTimeout(function () {
      $('loadingMsg').innerHTML = 'Google is being slow. Still trying… <button type="button" class="linkbtn" id="loadingRetry">Start again</button>';
      $('loadingRetry').addEventListener('click', function () { location.reload(); });
    }, 45000);
  }
  function lock(msg) {
    pass = '';
    try { store.removeItem('wrhinos-org'); store.removeItem(OV_KEY); sessionStorage.removeItem('wrhinos-org'); sessionStorage.removeItem(OV_KEY); } catch (e) { /* */ }
    overview = null;
    views('loginView');
    T.errorBox($('loginError'), msg ? [msg] : []);
  }

  // ---------- login ----------
  $('loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    pass = $('pass').value;
    $('loginBtn').disabled = true;
    $('loginView').hidden = true;
    busy();
    fetchOverview().then(function (r) {
      if (!r.ok) { views('loginView'); T.errorBox($('loginError'), [r.error]); return; }
      try { store.setItem('wrhinos-org', pass); } catch (x) { /* */ }
      $('pass').value = '';
      showTrips(r);
    }).catch(function (e) { if (e && e.message) { views('loginView'); T.errorBox($('loginError'), [e.message]); } }).then(function () { $('loginBtn').disabled = false; });
  });
  $('logout').addEventListener('click', function () { lock(''); });
  function showProblems(list, bank, oldScript) {
    var html = oldScript ? '<b>The Google script is an older version</b>, so each trip loads slowly. Paste the latest Code.gs and deploy a new version.' : list && list.length ? '<b>Registrations can’t open until these are fixed in the Settings tab of the Google Sheet:</b><ul>' + list.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>'
      : bank && bank.length ? '<b>Bank details not added yet.</b> Sign-ups work without them. Add them in the Settings tab of the Google Sheet before you tap “Ask for deposits and details”.' : '';
    $('problems').hidden = !html;
    $('problems').innerHTML = html;
  }

  // ---------- everything in one request ----------
  // Google is slow per request, so the page fetches every trip's bookings and money at once ("overview"),
  // keeps it for this browser tab, and opens trips and tabs from it instantly. Any change refreshes it in one go.
  var overview = null;
  var OV_KEY = 'wrhinos-org-overview';
  function fetchOverview() {
    $('syncing').hidden = false;
    return admin('overview').then(function (r) {
      // An older Google script without "overview": fall back to loading each part when needed.
      if (r && !r.ok && /Unknown organiser request/.test(r.error || '')) return admin('trips').then(function (t) { if (t.ok) { t.byTrip = {}; t.oldScript = true; } return t; });
      return r;
    }).then(function (r) {
      if (r && r.ok) {
        if (!Array.isArray(r.trips)) throw new Error('The trips didn’t load. Tap Lock, then sign in again.');
        overview = r;
        try { store.setItem(OV_KEY, JSON.stringify(r)); } catch (e) { /* too big or blocked: just slower */ }
      }
      return r;
    }).then(function (r) { $('syncing').hidden = true; return r; }, function (e) { $('syncing').hidden = true; throw e; });
  }
  function tripData(id) { return overview && overview.byTrip && overview.byTrip[id]; }
  function sortBookings(list) { return (list || []).slice().sort(function (a, b) { return String(a.bookedAt).localeCompare(String(b.bookedAt)); }); }

  // Refresh after a change: one request, then redraw whatever is open.
  function refreshAll(keepRef) {
    return fetchOverview().then(function (r) {
      if (!r.ok) { T.toast(r.error); return; }
      redraw(r, keepRef);
    });
  }
  // quiet: fresh data arrived in the background, so don't redraw anything the organiser may be working in.
  function redraw(r, keepRef, quiet) {
    trips = r.trips;
    renderTripCards();
    if (!current) return;
    current = trips.filter(function (t) { return t.id === current.id; })[0] || current;
    var d = tripData(current.id);
    if (d) { bookings = sortBookings(d.bookings); mon = Object.assign({ ok: true }, d.money); }
    if (quiet) {
      if (!$('bookingsTab').hidden && !document.querySelector('#tripView details[open]')) renderBookings();
      return;
    }
    renderBookings();
    if (mon && !$('expensesTab').hidden) renderExpenses();
    if (mon && !$('moneyTab').hidden) renderMoney();
    if (keepRef) { var el = document.querySelector('details[data-ref="' + keepRef + '"]'); if (el) el.open = true; }
  }

  // ---------- trips ----------
  function showTrips(r, thenId) {
    trips = r.trips;
    showProblems(r.problems, r.bankProblems, r.oldScript);
    renderTripCards();
    if (thenId) openTrip(thenId); else { views('tripsView'); openPrefill(); }
  }
  function loadTrips(thenId) {
    if (overview) showTrips(overview, thenId); else busy();
    return fetchOverview().then(function (r) {
      if (!r.ok) throw new Error(r.error);
      if (thenId || $('tripView').hidden) showTrips(r, thenId); else redraw(r, null, true);
    }).catch(function (e) {
      if (!e.message) return;
      $('tripCards').innerHTML = '<div class="error">' + esc(e.message) + ' <button type="button" class="linkbtn" id="retryTrips">Try again</button></div>';
      $('retryTrips').addEventListener('click', function () { loadTrips(); });
      views('tripsView');
    });
  }
  function renderTripCards() {
      $('tripCards').innerHTML = trips.length ? trips.map(function (t) {
        return '<a href="#" class="card trip-card" data-id="' + esc(t.id) + '"><p class="eyebrow">' + esc(t.datesText) + '</p><h2>' + esc(t.name) + '</h2>' +
          '<div class="row"><span class="chip ' + (t.status === 'Open' ? 'ok' : t.status === 'Draft' ? 'warn' : '') + '">' + esc(t.status) + '</span>' +
          '<span class="small muted">' + (t.places - t.placesLeft) + ' of ' + t.places + ' places taken' + (t.waiting ? ' · ' + t.waiting + ' waiting' : '') + '</span>' +
          (t.claimed ? '<span class="chip warn">' + t.claimed + ' payment' + (t.claimed === 1 ? '' : 's') + ' to check</span>' : '') + '</div></a>';
      }).join('') : '<div class="card muted">No trips yet. Tap “New trip”.</div>';
      Array.prototype.forEach.call(document.querySelectorAll('#tripCards .trip-card'), function (a) {
        a.addEventListener('click', function (e) { e.preventDefault(); openTrip(a.getAttribute('data-id')); });
      });
  }
  $('backTrips').addEventListener('click', function (e) { e.preventDefault(); current = null; views('tripsView'); });
  $('backNew').addEventListener('click', function (e) { e.preventDefault(); views('tripsView'); });

  function openTrip(id) {
    current = trips.filter(function (t) { return t.id === id; })[0];
    if (!current) { views('tripsView'); return; }
    mon = null;
    closeEditor();
    $('callForm').hidden = true;
    $('groupMsgCard').hidden = true;
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
    var d = tripData(id);
    if (d) {
      bookings = sortBookings(d.bookings);
      mon = Object.assign({ ok: true }, d.money);
      renderBookings();
      views('tripView');
    } else loadBookings();
  }

  function setTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { t.setAttribute('aria-selected', t.getAttribute('data-tab') === name ? 'true' : 'false'); });
    $('bookingsTab').hidden = name !== 'bookings';
    $('expensesTab').hidden = name !== 'expenses';
    $('moneyTab').hidden = name !== 'money';
    $('editTab').hidden = name !== 'edit';
    if (name === 'expenses' || name === 'money') loadMoney();
  }
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) { t.addEventListener('click', function () { setTab(t.getAttribute('data-tab')); }); });

  // ---------- trip form (new and edit) ----------
  function tripFormHtml(t) {
    t = t || { status: 'Draft', places: 50, depositPerPerson: 100, depositDays: 7, routesText: '', details: '' };
    var v = function (k) { return esc(t[k] === undefined ? '' : t[k]); };
    return '<form class="stack trip-form" novalidate>' +
      '<div class="card stack">' +
      '<div class="field"><label>Trip name</label><input type="text" data-f="name" value="' + v('name') + '" placeholder="e.g. Lakes &amp; Legends 2027"></div>' +
      (t.id ? '' : '<div class="field"><label>Short web name</label><input type="text" data-f="slug" value="' + v('slug') + '" placeholder="e.g. mallorca-2027"><span class="hint">For the link you share: wrhinos.com/trips/?t=<b>mallorca-2027</b>. Small letters, numbers and dashes. Leave empty to make one from the name.</span></div>') +
      '<div class="grid2"><div class="field"><label>Status</label><select data-f="status">' + ['Draft', 'Open', 'Closed'].map(function (s) { return '<option' + (t.status === s ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
      '<span class="hint">Draft: only organisers see it. Open: people can register. Closed: visible, no registrations.</span></div>' +
      '<div class="field"><label>Organiser</label><input type="text" data-f="organiser" value="' + v('organiser') + '"></div></div>' +
      '<div class="grid2"><div class="field"><label>Dates (as shown to riders)</label><input type="text" data-f="datesText" value="' + v('datesText') + '" placeholder="Fri 28 May – Wed 2 June 2027"></div>' +
      '<div class="field"><label>First day of the trip</label><input type="date" data-f="startDate" value="' + v('startDate') + '"><span class="hint">Used to work out who is under 18.</span></div></div>' +
      '<div class="grid2"><div class="field"><label>Places</label><input type="number" min="1" data-f="places" value="' + v('places') + '"><span class="hint">Everyone counts: riders, non-riders, children, support crew.</span></div>' +
      '<div class="field"><label>Deposit per person (£)</label><input type="number" min="0" step="0.01" data-f="depositPerPerson" value="' + v('depositPerPerson') + '"><span class="hint">Support crew pay no deposit.</span></div></div>' +
      '<div class="grid2"><div class="field"><label>Days to pay the deposit</label><input type="number" min="1" data-f="depositDays" value="' + v('depositDays') + '"></div>' +
      '<div class="field"><label>Charity fee per rider (£)</label><input type="number" min="0" step="0.01" data-f="charityFee" value="' + esc(t.charityFee === undefined ? 50 : t.charityFee) + '"><span class="hint">Added to every rider’s bill and given to a charity the riders choose.</span></div></div>' +
      '<div class="grid2"><div class="field"><label>When is the deposit asked for?</label><select data-f="depositAtSignup">' +
        '<option value="No"' + (t.depositAtSignup !== 'Yes' ? ' selected' : '') + '>Later: sign up first, deposit once the trip is confirmed</option>' +
        '<option value="Yes"' + (t.depositAtSignup === 'Yes' ? ' selected' : '') + '>Straight away, when people sign up</option></select></div></div>' +
      '<div class="field"><label>Bike options</label><textarea data-f="bikeOptions" rows="5">' + esc(t.bikeOptionsText || '') + '</textarea>' +
      '<span class="hint">One per line: what people choose, a | sign, then <b>hire</b> or <b>own</b>. For example: Hire a hybrid e-bike | hire. Hire riders are asked for height, inside leg, frame size, saddle height and pedals.</span></div>' +
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
    var get = function (k) { var el = form.querySelector('[data-f="' + k + '"]'); return el ? el.value : ''; };
    form.querySelector('.preview-btn').addEventListener('click', function () {
      var pv = form.querySelector('.preview');
      pv.innerHTML = T.markdown(get('details'));
      pv.hidden = !pv.hidden;
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var trip = { id: t ? t.id : '' };
      ['name', 'status', 'organiser', 'datesText', 'startDate', 'places', 'depositPerPerson', 'depositDays', 'charityFee', 'depositAtSignup', 'bikeOptions', 'summary', 'routes', 'details', 'slug'].forEach(function (k) { trip[k] = get(k); });
      var btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      admin('saveTrip', { trip: trip }).then(function (r) {
        if (!r.ok) { T.errorBox(form.querySelector('.form-error'), [r.error]); return; }
        T.toast(t ? 'Trip saved' : 'Trip created');
        loadTrips(r.id);
      }).catch(function () { /* */ }).then(function () { btn.disabled = false; });
    });
  }
  // A link like /trips/organiser/?prefill=mallorca-2027 opens "New trip" already filled in from a prepared file
  // on wrhinos.com (trips/content/<name>.json and its details .md). Used once per page load.
  var prefillName = (new URLSearchParams(location.search).get('prefill') || '').replace(/[^a-z0-9-]/g, '');
  function openPrefill() {
    if (!prefillName) return;
    var name = prefillName;
    prefillName = '';
    history.replaceState(null, '', location.pathname);
    fetch('/trips/content/' + name + '.json', { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (p) {
      if (trips.some(function (t) { return t.name === p.name; })) { T.toast('“' + p.name + '” already exists'); return; }
      return (p.detailsFile ? fetch('/trips/content/' + p.detailsFile, { cache: 'no-cache' }).then(function (r) { return r.ok ? r.text() : ''; }) : Promise.resolve(''))
        .then(function (md) {
          p.details = md;
          $('newForm').innerHTML = '<div class="notice small">Filled in from the prepared trip plan. Check everything, change what you like, then tap <b>Create trip</b>. It starts as a Draft; set it to Open when you’re ready.</div>' + tripFormHtml(p);
          wireTripForm($('newForm'), null);
          views('newView');
          window.scrollTo(0, 0);
        });
    }).catch(function () { T.toast('Couldn’t load the prepared trip “' + name + '”'); });
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

  function owes(b) { return current.depositAsked === false ? 0 : Math.max(0, Math.round((b.depositDue - b.totals.confirmed) * 100) / 100); }
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
      current.depositAsked === false ? ['Not yet', 'Deposits asked for'] : [T.money(got) + ' / ' + T.money(due), 'Deposits checked'],
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

  // Phone-friendly blocks: one card per person, labels on the left, nothing that needs sideways scrolling.
  function kv(label, html) { return '<dt>' + label + '</dt><dd>' + (html || '<span class="muted">Not given</span>') + '</dd>'; }
  function tel(n) { return n ? '<a href="tel:' + esc(String(n).replace(/[^0-9+]/g, '')) + '">' + esc(n) + '</a>' : ''; }
  function personCard(b, p) {
    var age = T.ageOn(p.dob, current.startDate);
    var hire = p.bikeHire === 'Yes' ? [p.heightCm && 'height ' + p.heightCm, p.insideLegCm && 'leg ' + p.insideLegCm, p.frameSize && 'frame ' + p.frameSize, p.saddleHeightCm && 'saddle ' + p.saddleHeightCm, p.pedals].filter(Boolean).join(', ') : '';
    return '<div class="person-card"><div class="person-head"><b>' + esc(p.fullName) + '</b><span class="chip">' + esc(p.role) + (age === null ? '' : ' · ' + age) + '</span></div>' +
      '<dl class="kv">' +
      (p.under18 === 'Yes' ? kv('With', esc(p.responsibleAdult)) : '') +
      kv('Bike', esc([p.bikeChoice || p.bikeType, p.bikeMake, p.bikeColour].filter(Boolean).join(', ')) + (hire ? '<br><span class="small muted">' + esc(hire) + '</span>' : '')) +
      kv('Diet', esc(p.dietary)) + kv('Phone', tel(p.mobile)) +
      kv('Passport', p.passportNumber ? esc(p.passportNumber) + ' <span class="small muted">' + esc(p.passportCountry) + ' · expires ' + esc(T.niceDate(p.passportExpiry)) + '</span>' : '<span class="chip warn">Missing</span>') +
      (p.safetyInfo ? kv('Safety', esc(p.safetyInfo)) : '') + '</dl>' +
      ((b.persons || []).length > 1 && b.status !== 'Cancelled' ? '<button type="button" class="linkbtn small" data-act="rmperson" data-n="' + esc(p.n) + '" data-name="' + esc(p.fullName) + '">Remove ' + esc(String(p.fullName).split(' ')[0]) + ' from this booking</button>' : '') +
      '</div>';
  }
  function bookingHtml(b) {
    var claimed = b.payments.filter(function (p) { return p.status === 'Claimed'; });
    var left = owes(b);
    var chip = b.status === 'Booked' && current.depositAsked === false ? '<span class="chip ok">Place held</span>' : b.status === 'Booked' ? (left > 0 ? '<span class="chip ' + (claimed.length ? 'warn' : 'bad') + '">' + (claimed.length ? 'Check payment' : 'Owes ' + T.money(left)) + '</span>' : '<span class="chip ok">Deposit paid</span>')
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
      '<div class="people-list">' + (b.persons || []).map(function (p) { return personCard(b, p); }).join('') + '</div>' +
      '<h4 class="sub">Contact</h4>' +
      '<dl class="kv">' + kv('Email', b.email ? '<a href="mailto:' + esc(b.email) + '">' + esc(b.email) + '</a>' : '') + kv('Mobile', tel(b.mobile)) +
      kv('Address', esc([b.address, b.postcode].filter(Boolean).join(', '))) +
      kv('Emergency', [esc(b.emergencyName), b.emergencyRelation ? '<span class="muted">(' + esc(b.emergencyRelation) + ')</span>' : '', tel(b.emergencyMobile)].filter(Boolean).join(' ')) +
      kv('Room', esc([b.roomType, b.roomRequests ? 'share with ' + b.roomRequests : ''].filter(Boolean).join(', '))) + kv('Notes', esc(b.notes)) + '</dl>' +
      (b.payments.length ? '<div class="table-wrap"><table class="plain"><thead><tr><th>Paid on</th><th>For</th><th>Amount</th><th>Status</th></tr></thead><tbody>' +
        b.payments.map(function (p) { return '<tr><td>' + esc(T.niceDate(p.paidOn)) + '</td><td>' + esc(p.stage) + '</td><td>' + T.money(p.amount) + '</td><td>' + esc(p.status) + (p.source === 'Organiser' ? ' (added by organiser)' : '') + '</td></tr>'; }).join('') +
        '</tbody></table></div>' : '') +
      '<div class="row">' +
      (b.status === 'Booked' && left > b.totals.claimed && b.mobile ? '<a class="btn btn-line btn-small" target="_blank" rel="noopener" href="' + esc(T.waLink(b.mobile, waMsg)) + '">WhatsApp reminder</a>' : '') +
      (b.mobile ? '<a class="btn btn-line btn-small" target="_blank" rel="noopener" href="' + esc(T.waLink(b.mobile, 'Hi ' + first + ', ')) + '">WhatsApp</a>' : '') +
      '<button type="button" class="btn btn-line btn-small" data-act="copylink">Copy their booking link</button>' +
      '<button type="button" class="btn btn-line btn-small" data-act="addpay">Record a payment</button>' +
      (b.status !== 'Cancelled' ? '<button type="button" class="btn btn-line btn-small" data-act="addperson">Add a person</button>' : '') +
      (b.status === 'Waiting list' ? '<button type="button" class="btn btn-primary btn-small" data-act="offer">Give them places</button>' : '') +
      (b.status === 'Cancelled' ? '<button type="button" class="btn btn-line btn-small" data-act="restore">Restore booking</button>' : '<button type="button" class="btn btn-line btn-small" data-act="cancel">Cancel booking</button>') +
      '</div>' +
      '<div class="stack addperson-box" hidden></div>' +
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
    if (overview && overview.byTrip && tripData(current.id)) return refreshAll(keepRef);
    return admin('bookings', { tripId: current.id }).then(function (r) {
      if (!r.ok) return;
      bookings = sortBookings(r.bookings);
      return admin('trips').then(function (tr) {
        if (tr.ok) { trips = tr.trips; current = trips.filter(function (t) { return t.id === current.id; })[0] || current; }
        renderBookings();
        if (keepRef) { var d = document.querySelector('details[data-ref="' + keepRef + '"]'); if (d) d.open = true; }
      });
    });
  }

  function openAddPerson(d, b) {
    var box = d.querySelector('.addperson-box');
    box.innerHTML = T.personHtml(90, {}, false, current, false) + '<div class="error ap-error" hidden></div>' +
      '<div class="row"><button type="button" class="btn btn-primary btn-small" data-act="addperson-save">Add to this booking</button>' +
      '<button type="button" class="btn btn-line btn-small" data-act="addperson-cancel">Cancel</button></div>';
    var card = box.querySelector('.person');
    card.querySelector('h3').textContent = 'New person in ' + b.ref;
    var rm = card.querySelector('.remove-person'); if (rm) rm.remove();
    T.wirePerson(card, current.startDate);
    box.hidden = false;
    card.querySelector('[data-k="fullName"]').focus();
  }
  function saveAddPerson(d, ref, force) {
    var box = d.querySelector('.addperson-box');
    var p = T.readPerson(box.querySelector('.person'));
    var errs = T.checkPeople([{ fullName: 'x x', dob: '1970-01-01', role: 'Non-rider', mobile: '07000000000' }, p], current.startDate).map(function (e) { return e.replace('Person 2', 'New person'); });
    T.errorBox(box.querySelector('.ap-error'), errs);
    if (errs.length) return;
    act(admin('addPerson', { ref: ref, person: p, force: force }), p.fullName + ' added', ref).then(function (r) {
      if (r && r.needsForce) {
        var s = box.querySelector('[data-act="addperson-save"]');
        if (s) { s.textContent = 'Add anyway (over the limit)'; s.setAttribute('data-act', 'addperson-force'); }
      }
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
        else if (a === 'rmperson') {
          if (btn.getAttribute('data-sure') !== '1') { btn.setAttribute('data-sure', '1'); btn.textContent = 'Tap again to remove ' + btn.getAttribute('data-name').split(' ')[0]; return; }
          act(admin('removePerson', { ref: ref, n: Number(btn.getAttribute('data-n')) }), btn.getAttribute('data-name') + ' removed', ref);
        }
        else if (a === 'addperson') openAddPerson(d, b);
        else if (a === 'addperson-save' || a === 'addperson-force') saveAddPerson(d, ref, a === 'addperson-force');
        else if (a === 'addperson-cancel') { var bx = d.querySelector('.addperson-box'); bx.hidden = true; bx.innerHTML = ''; }
        else if (a === 'notes') act(admin('saveNotes', { ref: ref, notes: d.querySelector('.org-notes').value }), 'Notes saved', ref);
      });
      d.querySelector('.addpay-form').addEventListener('submit', function (e) {
        e.preventDefault();
        var f = e.target;
        act(admin('addPayment', { ref: ref, amount: f.querySelector('.ap-amount').value, stage: f.querySelector('.ap-stage').value, paidOn: f.querySelector('.ap-date').value, note: f.querySelector('.ap-note').value }), 'Payment recorded', ref);
      });
    });
  }

  // ================= expenses and money =================
  var M = window.Money;
  var mon = null;          // last 'money' response for the current trip
  var draft = null;        // expense being edited
  var ROOM_TYPES = ['Single', 'Double', 'Twin', 'Triple', 'Family / quad', 'Other'];
  var SPLIT_LABELS = { equal: 'Everyone', select: 'Some people', rooms: 'Rooms', custom: 'Set amounts' };

  // Opening a tab uses what's already loaded; after a change (fresh), everything is refreshed in one request.
  function loadMoney(fresh) {
    if (!current) return Promise.resolve();
    var d = tripData(current.id);
    if (d && !fresh) { mon = Object.assign({ ok: true }, d.money); renderExpenses(); renderMoney(); return Promise.resolve(); }
    if (d) return refreshAll().then(function () { if (mon) { renderExpenses(); renderMoney(); } });
    return admin('money', { tripId: current.id }).then(function (r) {
      if (!r.ok) { T.toast(r.error); return; }
      mon = r;
      renderExpenses();
      renderMoney();
    }).catch(function () { /* */ });
  }
  function personName(key) {
    var p = mon && mon.people.filter(function (x) { return x.key === key; })[0];
    return p ? p.name : '(no longer booked)';
  }
  function stats(el, list) { el.innerHTML = list.map(function (s) { return '<div><b>' + esc(s[0]) + '</b><span>' + esc(s[1]) + '</span></div>'; }).join(''); }

  // ---------- expenses list ----------
  function renderExpenses() {
    var r = mon.result;
    stats($('expStats'), [
      [T.money(r.totals.expenses), 'Expenses entered'],
      [T.money(r.totals.charity), 'Charity fees (£' + (current.charityFee === undefined ? 50 : current.charityFee) + ' per rider)'],
      [T.money(r.totals.cost), 'Total to collect'],
      [r.totals.people, 'People sharing costs'],
    ]);
    var warn = r.expenses.filter(function (e) { return e.unallocated > 0; });
    $('expWarn').hidden = !warn.length;
    $('expWarn').innerHTML = warn.length ? '<b>Not everything is shared out:</b> ' + warn.map(function (e) { return esc(e.name) + ' has ' + T.money(e.unallocated) + ' that nobody is paying (for example a room whose people have cancelled). Edit it to fix.'; }).join(' ') : '';
    $('expList').innerHTML = mon.expenses.length ? mon.expenses.map(function (e) {
      var calc = r.expenses.filter(function (x) { return x.id === e.id; })[0] || {};
      return '<div class="card stack" data-exp="' + esc(e.id) + '"><div class="row" style="justify-content:space-between;align-items:flex-start">' +
        '<div><b style="font-size:17px">' + esc(e.name) + '</b><div class="small muted">' + esc(calc.describe || '') + (calc.people ? ' · ' + calc.people + ' people' : '') +
        (e.paidBy ? ' · paid by ' + esc(e.paidBy) : '') + (e.date ? ' · ' + esc(T.niceDate(e.date)) : '') + '</div></div>' +
        '<div style="text-align:right"><b style="font-size:18px">' + T.money(calc.total || e.amount) + '</b>' +
        (calc.unallocated > 0 ? '<div class="chip warn">' + T.money(calc.unallocated) + ' not shared</div>' : '') + '</div></div>' +
        '<div class="row"><button type="button" class="btn btn-line btn-small" data-edit="' + esc(e.id) + '">Edit</button>' +
        (e.split === 'rooms' ? '<button type="button" class="btn btn-line btn-small" data-copy-exp="' + esc(e.id) + '">Copy rooms to a new expense</button>' : '') + '</div></div>';
    }).join('') : '<div class="card muted">No expenses yet. Add the first one, for example “Hotel – Frankfurt” or “Support company”.</div>';
    Array.prototype.forEach.call(document.querySelectorAll('[data-edit]'), function (b) {
      b.addEventListener('click', function () { openEditor(mon.expenses.filter(function (e) { return e.id === b.getAttribute('data-edit'); })[0]); });
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-copy-exp]'), function (b) {
      b.addEventListener('click', function () {
        var src = mon.expenses.filter(function (e) { return e.id === b.getAttribute('data-copy-exp'); })[0];
        openEditor({ name: '', split: 'rooms', detail: { rooms: JSON.parse(JSON.stringify(src.detail.rooms || [])).map(function (rm) { rm.cost = ''; return rm; }) } }, 'Same rooms as “' + src.name + '”. Enter this hotel’s name and room prices.');
      });
    });
  }
  $('addExpense').addEventListener('click', function () { openEditor(null); });

  // ---------- expense editor ----------
  function openEditor(e, hint) {
    draft = e ? JSON.parse(JSON.stringify(e)) : { name: '', split: 'equal', amount: '', detail: { group: 'all' }, date: '', paidBy: '', notes: '' };
    draft.detail = draft.detail || {};
    draft._hint = hint || '';
    $('expEditor').hidden = false;
    $('addExpense').hidden = true;
    renderEditor();
    $('expEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function closeEditor() { draft = null; $('expEditor').hidden = true; $('expEditor').innerHTML = ''; $('addExpense').hidden = false; }

  function inRooms(exceptIndex) {
    var used = {};
    (draft.detail.rooms || []).forEach(function (r, i) { if (i !== exceptIndex) (r.people || []).forEach(function (k) { used[k] = true; }); });
    return used;
  }
  function peopleOptions(exclude) {
    var byRef = {};
    mon.people.forEach(function (p) { if (!exclude[p.key]) (byRef[p.ref] = byRef[p.ref] || []).push(p); });
    return Object.keys(byRef).map(function (ref) {
      return '<optgroup label="' + esc(ref) + '">' + byRef[ref].map(function (p) { return '<option value="' + esc(p.key) + '">' + esc(p.name) + '</option>'; }).join('') + '</optgroup>';
    }).join('');
  }

  function editorBody() {
    var d = draft.detail;
    if (draft.split === 'equal') {
      return '<div class="grid2"><div class="field"><label for="exAmount">Amount (£)</label><input type="text" inputmode="decimal" id="exAmount" value="' + esc(draft.amount) + '"></div>' +
        '<div class="field"><label for="exGroup">Shared between</label><select id="exGroup">' + Object.keys(M.GROUPS).map(function (g) {
          return '<option value="' + g + '"' + ((d.group || 'all') === g ? ' selected' : '') + '>' + esc(M.GROUPS[g].label) + '</option>'; }).join('') + '</select></div></div>';
    }
    if (draft.split === 'select') {
      var chosen = {};
      (d.people || []).forEach(function (k) { chosen[k] = true; });
      var byRef = {};
      mon.people.forEach(function (p) { (byRef[p.ref] = byRef[p.ref] || []).push(p); });
      return '<div class="field"><label for="exAmount">Amount (£)</label><input type="text" inputmode="decimal" id="exAmount" value="' + esc(draft.amount) + '"></div>' +
        '<div class="row"><button type="button" class="btn btn-line btn-small" id="selAll">Select everyone</button><button type="button" class="btn btn-line btn-small" id="selNone">Clear</button></div>' +
        '<div class="stack">' + Object.keys(byRef).map(function (ref) {
          var ps = byRef[ref];
          return '<div style="border-top:1px solid var(--rule);padding-top:8px"><label class="check"><input type="checkbox" data-family="' + esc(ref) + '"' + (ps.every(function (p) { return chosen[p.key]; }) ? ' checked' : '') + '><b>' + esc(ps[0].name) + (ps.length > 1 ? ' and family' : '') + '</b></label>' +
            (ps.length > 1 ? '<div style="padding-left:34px" class="stack">' + ps.map(function (p) {
              return '<label class="check small"><input type="checkbox" data-person="' + esc(p.key) + '"' + (chosen[p.key] ? ' checked' : '') + '>' + esc(p.name) + ' <span class="muted">(' + esc(p.role) + ')</span></label>';
            }).join('') + '</div>' : '<input type="checkbox" hidden data-person="' + esc(ps[0].key) + '"' + (chosen[ps[0].key] ? ' checked' : '') + '>') + '</div>';
        }).join('') + '</div>';
    }
    if (draft.split === 'rooms') {
      var rooms = d.rooms || [];
      var unassigned = mon.people.filter(function (p) { return !inRooms(-1)[p.key]; });
      return '<div class="row"><button type="button" class="btn btn-line btn-small" id="roomPerBooking">One room per booking</button>' +
        (mon.expenses.some(function (e) { return e.split === 'rooms' && e.id !== draft.id; }) ? '<select id="copyRoomsFrom" style="width:auto;min-height:36px;padding:6px 10px"><option value="">Copy rooms from…</option>' +
          mon.expenses.filter(function (e) { return e.split === 'rooms' && e.id !== draft.id; }).map(function (e) { return '<option value="' + esc(e.id) + '">' + esc(e.name) + '</option>'; }).join('') + '</select>' : '') + '</div>' +
        '<div class="stack" id="roomRows">' + rooms.map(function (r, i) {
          var avail = inRooms(i);
          return '<div class="card stack" style="background:var(--ground)" data-room="' + i + '">' +
            '<div class="grid2"><div class="field"><label>Room</label><input type="text" data-rk="label" value="' + esc(r.label) + '"></div>' +
            '<div class="grid2 keep2"><div class="field"><label>Type</label><select data-rk="type"><option value=""></option>' + ROOM_TYPES.map(function (t) { return '<option' + (r.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>Cost (£)</label><input type="text" inputmode="decimal" data-rk="cost" value="' + esc(r.cost) + '"></div></div></div>' +
            '<div class="row">' + (r.people || []).map(function (k) { return '<span class="chip">' + esc(personName(k)) + ' <button type="button" class="linkbtn" data-unroom="' + esc(k) + '" aria-label="Remove">×</button></span>'; }).join('') +
            '<select data-addto="' + i + '" style="width:auto;min-height:36px;padding:6px 10px"><option value="">+ Add person</option>' + peopleOptions(Object.assign({}, avail, (function () { var o = {}; (r.people || []).forEach(function (k) { o[k] = true; }); return o; })())) + '</select>' +
            '<button type="button" class="linkbtn small" data-delroom="' + i + '" style="margin-left:auto">Remove room</button></div>' +
            '<div class="small muted">' + ((r.people || []).length && M.pence(r.cost) > 0 ? T.money(M.pounds(Math.round(M.pence(r.cost) / r.people.length))) + ' each' : '') + '</div></div>';
        }).join('') + '</div>' +
        '<button type="button" class="btn btn-line btn-small" id="addRoom">+ Add room</button>' +
        (unassigned.length ? '<div class="notice small">' + unassigned.length + (unassigned.length === 1 ? ' person is' : ' people are') + ' not in a room yet: ' + unassigned.slice(0, 12).map(function (p) { return esc(p.name); }).join(', ') + (unassigned.length > 12 ? '…' : '') + '. Anyone not in a room pays nothing for this expense.</div>' : '<div class="success small">Everyone is in a room.</div>');
    }
    var amounts = d.amounts || {};
    return '<div class="stack">' + mon.people.map(function (p) {
      return '<div class="row" style="justify-content:space-between"><span>' + esc(p.name) + ' <span class="small muted">' + esc(p.ref) + '</span></span>' +
        '<input type="text" inputmode="decimal" data-amt="' + esc(p.key) + '" value="' + esc(amounts[p.key] || '') + '" placeholder="£0" style="width:110px;min-height:40px"></div>';
    }).join('') + '</div>';
  }

  function previewText() {
    var e = { split: draft.split, amount: draft.amount, detail: draft.detail };
    var s = M.shares(e, mon.people);
    var keys = Object.keys(s.shares);
    if (!s.total) return 'Enter the amounts to see how it is shared.';
    var vals = keys.map(function (k) { return s.shares[k]; });
    var each = !vals.length ? '' : Math.max.apply(null, vals) - Math.min.apply(null, vals) <= 1 ? T.money(M.pounds(vals[0])) + ' each for ' + keys.length + ' people'
      : 'from ' + T.money(M.pounds(Math.min.apply(null, vals))) + ' to ' + T.money(M.pounds(Math.max.apply(null, vals))) + ' each, ' + keys.length + ' people';
    return '<b>Total ' + T.money(M.pounds(s.total)) + '</b>' + (each ? ': ' + each : '') + (s.unallocated ? '. <span style="color:var(--warn)">' + T.money(M.pounds(s.unallocated)) + ' is not shared by anyone.</span>' : '.');
  }

  function renderEditor() {
    var box = $('expEditor');
    box.innerHTML = '<form class="card stack" id="exForm" novalidate>' +
      '<h2 class="section-title">' + (draft.id ? 'Edit expense' : 'New expense') + '</h2>' +
      (draft._hint ? '<div class="notice small">' + esc(draft._hint) + '</div>' : '') +
      '<div class="field"><label for="exName">What is it?</label><input type="text" id="exName" value="' + esc(draft.name) + '" placeholder="e.g. Hotel – Frankfurt, Support company, Bike lorry"></div>' +
      '<div class="field"><span class="label">How is it shared?</span><div class="filters">' + Object.keys(SPLIT_LABELS).map(function (k) {
        return '<button type="button" class="filter" data-split="' + k + '" aria-pressed="' + (draft.split === k) + '">' + SPLIT_LABELS[k] + '</button>'; }).join('') + '</div>' +
      '<span class="hint">' + { equal: 'One click: split equally, for example the support company or the lorry.', select: 'Split equally between the people you tick, for example the boat for the family group.',
        rooms: 'Each room’s price is split between the people in it. A single pays the whole room.', custom: 'Type what each person pays, for anything unusual.' }[draft.split] + '</span></div>' +
      '<div id="exBody" class="stack">' + editorBody() + '</div>' +
      '<div class="success small" id="exPreview">' + previewText() + '</div>' +
      '<details class="more"' + (draft.paidBy || draft.date || draft.notes ? ' open' : '') + '><summary>Date, who paid it, notes</summary><div class="stack">' +
      '<div class="grid2"><div class="field"><label for="exDate">Date</label><input type="date" id="exDate" value="' + esc(draft.date) + '"></div>' +
      '<div class="field"><label for="exPaidBy">Paid by</label><input type="text" id="exPaidBy" value="' + esc(draft.paidBy) + '" placeholder="e.g. Ram (card), club account"></div></div>' +
      '<div class="field"><label for="exNotes">Notes</label><input type="text" id="exNotes" value="' + esc(draft.notes) + '" placeholder="e.g. invoice 1234"></div></div></details>' +
      '<div class="error" id="exError" hidden></div>' +
      '<div class="row"><button type="submit" class="btn btn-primary">' + (draft.id ? 'Save' : 'Add expense') + '</button>' +
      '<button type="button" class="btn btn-line" id="exCancel">Cancel</button>' +
      (draft.id ? '<button type="button" class="linkbtn" id="exDelete" style="margin-left:auto">Delete</button>' : '') + '</div></form>';
    wireEditor();
  }

  function refreshPreview() { var p = $('exPreview'); if (p) p.innerHTML = previewText(); }
  function rerenderBody() { $('exBody').innerHTML = editorBody(); wireBody(); refreshPreview(); }

  function wireEditor() {
    $('exName').addEventListener('input', function () { draft.name = this.value; });
    $('exDate').addEventListener('input', function () { draft.date = this.value; });
    $('exPaidBy').addEventListener('input', function () { draft.paidBy = this.value; });
    $('exNotes').addEventListener('input', function () { draft.notes = this.value; });
    Array.prototype.forEach.call(document.querySelectorAll('[data-split]'), function (b) {
      b.addEventListener('click', function () {
        draft.split = b.getAttribute('data-split');
        if (draft.split === 'equal' && !draft.detail.group) draft.detail.group = 'all';
        if (draft.split === 'rooms' && !draft.detail.rooms) draft.detail.rooms = [];
        renderEditor();
      });
    });
    $('exCancel').addEventListener('click', closeEditor);
    if ($('exDelete')) $('exDelete').addEventListener('click', function () {
      var b = this;
      if (b.getAttribute('data-sure') !== '1') { b.setAttribute('data-sure', '1'); b.textContent = 'Tap again to delete'; return; }
      admin('deleteExpense', { id: draft.id }).then(function (r) { if (!r.ok) { T.toast(r.error); return; } T.toast('Expense deleted'); closeEditor(); loadMoney(true); });
    });
    $('exForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var exp = { id: draft.id || '', name: draft.name, split: draft.split, amount: draft.amount, detail: draft.detail, date: draft.date, paidBy: draft.paidBy, notes: draft.notes };
      var v = M.validateExpense(exp);
      T.errorBox($('exError'), v.errors);
      if (v.errors.length) return;
      var btn = this.querySelector('[type=submit]');
      btn.disabled = true;
      admin('saveExpense', { tripId: current.id, expense: exp }).then(function (r) {
        if (!r.ok) { T.errorBox($('exError'), [r.error]); return; }
        T.toast(draft.id ? 'Expense saved' : 'Expense added');
        closeEditor();
        return loadMoney(true);
      }).catch(function () { /* */ }).then(function () { btn.disabled = false; });
    });
    wireBody();
  }

  function wireBody() {
    var d = draft.detail;
    var amt = $('exAmount');
    if (amt) amt.addEventListener('input', function () { draft.amount = this.value; refreshPreview(); });
    if ($('exGroup')) $('exGroup').addEventListener('change', function () { d.group = this.value; refreshPreview(); });
    if (draft.split === 'select') {
      var sync = function () {
        d.people = Array.prototype.filter.call(document.querySelectorAll('#exBody [data-person]'), function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-person'); });
        refreshPreview();
      };
      Array.prototype.forEach.call(document.querySelectorAll('#exBody [data-family]'), function (f) {
        f.addEventListener('change', function () {
          Array.prototype.forEach.call(document.querySelectorAll('#exBody [data-person^="' + f.getAttribute('data-family') + '-"]'), function (c) { c.checked = f.checked; });
          sync();
        });
      });
      Array.prototype.forEach.call(document.querySelectorAll('#exBody [data-person]'), function (c) { c.addEventListener('change', sync); });
      $('selAll').addEventListener('click', function () { d.people = mon.people.map(function (p) { return p.key; }); rerenderBody(); });
      $('selNone').addEventListener('click', function () { d.people = []; rerenderBody(); });
    }
    if (draft.split === 'rooms') {
      d.rooms = d.rooms || [];
      $('addRoom').addEventListener('click', function () { d.rooms.push({ label: 'Room ' + (d.rooms.length + 1), type: '', cost: '', people: [] }); rerenderBody(); });
      $('roomPerBooking').addEventListener('click', function () {
        var used = inRooms(-1), byRef = {};
        mon.people.forEach(function (p) { if (!used[p.key]) (byRef[p.ref] = byRef[p.ref] || []).push(p.key); });
        Object.keys(byRef).forEach(function (ref) {
          var n = byRef[ref].length;
          d.rooms.push({ label: personName(byRef[ref][0]) + (n > 1 ? ' + ' + (n - 1) : ''), type: n === 1 ? 'Single' : n === 2 ? 'Double' : n === 3 ? 'Triple' : 'Family / quad', cost: '', people: byRef[ref] });
        });
        rerenderBody();
      });
      if ($('copyRoomsFrom')) $('copyRoomsFrom').addEventListener('change', function () {
        var src = mon.expenses.filter(function (e) { return e.id === this.value; }.bind(this))[0];
        if (!src) return;
        d.rooms = JSON.parse(JSON.stringify(src.detail.rooms || [])).map(function (r) { r.cost = ''; return r; });
        rerenderBody();
        T.toast('Rooms copied: enter this hotel’s prices');
      });
      Array.prototype.forEach.call(document.querySelectorAll('#roomRows [data-room]'), function (row) {
        var i = Number(row.getAttribute('data-room'));
        Array.prototype.forEach.call(row.querySelectorAll('[data-rk]'), function (inp) {
          inp.addEventListener(inp.tagName === 'SELECT' ? 'change' : 'input', function () { d.rooms[i][inp.getAttribute('data-rk')] = inp.value; refreshPreview(); });
          if (inp.getAttribute('data-rk') === 'cost') inp.addEventListener('change', rerenderBody);
        });
        row.querySelector('[data-addto]').addEventListener('change', function () { if (this.value) { d.rooms[i].people.push(this.value); rerenderBody(); } });
        Array.prototype.forEach.call(row.querySelectorAll('[data-unroom]'), function (x) {
          x.addEventListener('click', function () { var k = x.getAttribute('data-unroom'); d.rooms[i].people = d.rooms[i].people.filter(function (y) { return y !== k; }); rerenderBody(); });
        });
        row.querySelector('[data-delroom]').addEventListener('click', function () { d.rooms.splice(i, 1); rerenderBody(); });
      });
    }
    if (draft.split === 'custom') {
      d.amounts = d.amounts || {};
      Array.prototype.forEach.call(document.querySelectorAll('#exBody [data-amt]'), function (inp) {
        inp.addEventListener('input', function () { d.amounts[inp.getAttribute('data-amt')] = inp.value; refreshPreview(); });
      });
    }
  }

  // ---------- money: balances, calls, reminders ----------
  function renderMoney() {
    var r = mon.result;
    stats($('monStats'), [
      [T.money(r.totals.cost), 'Total cost so far'],
      [T.money(r.totals.collected), 'Paid and checked'],
      [T.money(r.totals.claimed), 'Waiting to be checked'],
      [T.money(r.totals.owesNow), 'Owed now'],
    ]);
    $('callList').innerHTML = mon.calls.length ? '<table class="plain"><thead><tr><th>Called</th><th>What</th><th>Due by</th><th>Emails</th></tr></thead><tbody>' + mon.calls.map(function (c) {
      return '<tr><td>' + esc(T.niceDate(c.createdAt)) + '</td><td>' + (c.stage === 'Deposit' ? '<b>Deposits and details</b>' : c.stage === 'Final' ? '<b>Final balance</b>' : '<b>Interim</b> ' + T.money(c.perPerson) + ' per person<br><span class="muted">' + esc(c.reason) + '</span>') + '</td><td>' + esc(T.niceDate(c.dueDate)) + '</td><td>' + esc(c.emailed || '–') + '</td></tr>';
    }).join('') + '</tbody></table>' : '<p class="muted" style="margin:0">' + (r.depositAsked ? 'Only the deposit has been asked for so far.' : 'Nothing asked for yet: people have signed up and their places are held. When the trip is confirmed, tap “Ask for deposits and details”.') + '</p>';
    $('callDeposit').hidden = r.depositAsked || r.finalCalled;
    $('callFinal').hidden = r.finalCalled;
    $('callInterim').hidden = r.finalCalled;
    $('monNote').textContent = r.finalCalled
      ? 'The final balance has been called: everyone owes their full share of the costs, less what they have paid.'
      : 'Until the final balance is called, “owes now” is the deposit' + (r.interimPerPerson ? ' plus ' + T.money(r.interimPerPerson) + ' per person in interim payments' : '') + '. “Cost so far” is their share of the expenses entered.';
    var rows = r.bookings.filter(function (b) { return b.status === 'Booked'; }).sort(function (a, b) { return b.owesNow - a.owesNow; });
    var info = {};
    mon.bookings.forEach(function (b) { info[b.ref] = b; });
    $('balanceList').innerHTML = rows.map(function (b) {
      var bi = info[b.ref] || {};
      var first = String(bi.leadName || '').split(' ')[0];
      var due = Math.max(0, Math.round((b.owesNow - b.claimed) * 100) / 100);
      var msg = 'Hi ' + first + ', a reminder that ' + T.money(due) + ' is due for your W/Rhinos booking on ' + current.name + '. Please pay to the club account using reference ' + b.ref + '. Your breakdown and the bank details: ' + bi.link;
      return '<details class="card booking"><summary><span class="who">' + esc(bi.leadName) + (b.people.length > 1 ? ' +' + (b.people.length - 1) : '') + '</span>' +
        (b.owesNow > 0 ? '<span class="chip ' + (b.claimed >= b.owesNow ? 'warn' : 'bad') + '">' + (b.claimed >= b.owesNow ? 'Check payment' : 'Owes ' + T.money(b.owesNow)) + '</span>' : '<span class="chip ok">Up to date</span>') +
        '<span class="meta">' + esc(b.ref) + ' · cost so far ' + T.money(b.cost) + '</span><span class="meta">paid ' + T.money(b.confirmed) + '</span></summary>' +
        '<div class="body">' + b.people.map(function (p) {
          return '<div><b>' + esc(p.name) + '</b> <span class="small muted">' + esc(p.role) + '</span><table class="plain">' + p.lines.map(function (l) {
            return '<tr><td>' + esc(l.name) + '</td><td style="text-align:right">' + T.money(l.amount) + '</td></tr>'; }).join('') +
            '<tr><td><b>Total</b></td><td style="text-align:right"><b>' + T.money(p.total) + '</b></td></tr></table></div>';
        }).join('') +
        '<dl class="kv"><dt>Cost so far</dt><dd>' + T.money(b.cost) + '</dd><dt>Due so far</dt><dd>' + T.money(b.dueSoFar) + '</dd><dt>Paid and checked</dt><dd>' + T.money(b.confirmed) + '</dd>' +
        (b.claimed ? '<dt>Waiting to check</dt><dd>' + T.money(b.claimed) + '</dd>' : '') + '<dt>Owes now</dt><dd><b>' + T.money(b.owesNow) + '</b></dd></dl>' +
        '<div class="row">' + (due > 0 && bi.mobile ? '<a class="btn btn-line btn-small" target="_blank" rel="noopener" href="' + esc(T.waLink(bi.mobile, msg)) + '">WhatsApp reminder</a>' : '') +
        (due > 0 ? '<button type="button" class="btn btn-line btn-small" data-remind="' + esc(b.ref) + '">Email reminder</button>' : '') + '</div></div></details>';
    }).join('') || '<div class="muted">No confirmed bookings yet.</div>';
    Array.prototype.forEach.call(document.querySelectorAll('[data-remind]'), function (btn) {
      btn.addEventListener('click', function () {
        admin('remind', { tripId: current.id, refs: [btn.getAttribute('data-remind')] }).then(function (x) { T.toast(x.ok ? (T.DEMO ? 'Preview: no email sent' : 'Reminder emailed') : x.error); });
      });
    });
  }

  function owingCount() { return mon.result.bookings.filter(function (b) { return b.status === 'Booked' && b.owesNow > b.claimed; }).length; }
  $('remindAll').addEventListener('click', function () {
    var btn = this, n = owingCount();
    if (!n) { T.toast('Nobody owes anything right now'); return; }
    if (btn.getAttribute('data-sure') !== '1') { btn.setAttribute('data-sure', '1'); btn.textContent = 'Tap again to email ' + n + (n === 1 ? ' booking' : ' bookings'); return; }
    btn.disabled = true;
    admin('remind', { tripId: current.id }).then(function (r) {
      T.toast(r.ok ? (T.DEMO ? 'Preview: ' + n + ' reminders would be emailed' : 'Emailed ' + r.emailed + ' reminders') : r.error);
    }).then(function () { btn.disabled = false; btn.removeAttribute('data-sure'); btn.textContent = 'Email everyone who owes'; });
  });

  function callForm(stage) {
    var f = $('callForm');
    var nextMonth = new Date(Date.now() + 28 * 86400000).toISOString().slice(0, 10);
    var inAWeek = new Date(Date.now() + (current.depositDays || 7) * 86400000).toISOString().slice(0, 10);
    f.innerHTML = (stage === 'Deposit'
      ? '<p class="small" style="margin:0">Do this once the trip is confirmed. Everyone booked is asked for the deposit (' + T.money(current.depositPerPerson) + ' per person, none for support crew), and their booking page asks for the rest of their details: passports, and bike details for anyone bringing their own.</p>' +
        '<div class="field"><label for="cfDue">Deposit due by</label><input type="date" id="cfDue" value="' + inAWeek + '"></div>'
      : stage === 'Interim'
      ? '<p class="small" style="margin:0">Ask everyone (except support crew) for a set amount per person, for example when a hotel needs paying before the trip. The Framework asks us to say why.</p>' +
        '<div class="grid2"><div class="field"><label for="cfPer">Amount per person (£)</label><input type="text" inputmode="decimal" id="cfPer"></div>' +
        '<div class="field"><label for="cfDue">Due by</label><input type="date" id="cfDue" value="' + nextMonth + '"></div></div>' +
        '<div class="field"><label for="cfReason">Reason</label><input type="text" id="cfReason" placeholder="e.g. Hotels need paying 6 weeks before we go"></div>'
      : '<p class="small" style="margin:0">Do this after the trip, once every cost is entered. Everyone is asked for their full share less what they have paid. You can still add or change expenses afterwards; balances update.</p>' +
        '<div class="field"><label for="cfDue">Due by</label><input type="date" id="cfDue" value="' + nextMonth + '"></div>') +
      '<fieldset class="stack"><legend class="label" style="font-weight:600">Then</legend>' +
      '<label class="check"><input type="radio" name="cfHow" value="group" checked>Write a message I can post in the WhatsApp group</label>' +
      '<label class="check"><input type="radio" name="cfHow" value="email">Email everyone who owes their own amount and the bank details</label></fieldset>' +
      '<div class="error" id="cfError" hidden></div>' +
      '<div class="row"><button type="submit" class="btn btn-primary">' + (stage === 'Deposit' ? 'Ask for deposits and details' : stage === 'Interim' ? 'Call interim payment' : 'Call final balance') + '</button><button type="button" class="btn btn-line" id="cfCancel">Cancel</button></div>';
    f.hidden = false;
    f.dataset.stage = stage;
    $('cfCancel').addEventListener('click', function () { f.hidden = true; });
  }
  // ---------- WhatsApp group message ----------
  // One message for the whole group: amounts per person and the club account, never anyone's own balance.
  function groupMessage(call) {
    var bank = mon.bank || {};
    var due = call && call.dueDate ? T.niceDate(call.dueDate) : '';
    var lines = ['W/Rhinos – ' + current.name, ''];
    if (call && call.stage === 'Deposit') {
      lines.push('Great news: the trip is confirmed!', '',
        'Next steps for everyone who has signed up:',
        '1. Pay your deposit: ' + T.money(current.depositPerPerson) + ' per person' + (due ? ', by ' + due : '') + ' (support crew: nothing to pay). The deposit is non-refundable.',
        '2. Open your booking page and add the rest of your details: passports, and bike make and colour if you are bringing your own bike.');
    } else if (call && call.stage === 'Interim') {
      lines.push('Interim payment due: ' + T.money(call.perPerson) + ' per person' + (due ? ', by ' + due : '') + '.',
        'Why: ' + call.reason.replace(/\.$/, '') + '.', '(Support crew: nothing to pay.)');
    } else if (call && call.stage === 'Final') {
      lines.push('Thank you all for a brilliant trip! Every cost is now in, and the final balances are ready.',
        'Please pay your balance' + (due ? ' by ' + due : '') + '. Your booking page shows your share of each cost and exactly what is left to pay.');
    } else {
      lines.push('Friendly reminder: if your booking still owes money' + (due ? ' (due by ' + due + ')' : '') + ', please pay as soon as you can.',
        'Your booking page shows exactly what your booking owes.');
    }
    lines.push('', 'Pay by bank transfer:',
      'Account name: ' + (bank.accountName || ''),
      'Sort code: ' + (bank.sortCode || ''),
      'Account number: ' + (bank.accountNumber || ''),
      'Reference: your booking reference (the 5 letters in your registration email)',
      '', 'Once you have paid, open your booking page and tap "I\'ve paid" so we can check it.',
      'Lost your booking link? Get it again at ' + location.origin + '/trips/ ("Lost your booking link?").');
    return lines.join('\n');
  }
  function showGroupMessage(text) {
    $('groupMsg').value = text;
    $('waGroupMsg').href = 'https://wa.me/?text=' + encodeURIComponent(text);
    $('groupMsgCard').hidden = false;
    $('groupMsgCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  $('groupMsg').addEventListener('input', function () { $('waGroupMsg').href = 'https://wa.me/?text=' + encodeURIComponent(this.value); });
  $('copyGroupMsg').addEventListener('click', function () { T.copy($('groupMsg').value, this); });
  $('closeGroupMsg').addEventListener('click', function () { $('groupMsgCard').hidden = true; });
  $('groupReminder').addEventListener('click', function () {
    var last = mon.calls.length ? mon.calls[mon.calls.length - 1] : null;
    showGroupMessage(groupMessage(last ? { stage: 'Reminder', dueDate: last.dueDate } : null));
  });

  $('callDeposit').addEventListener('click', function () { callForm('Deposit'); });
  $('callInterim').addEventListener('click', function () { callForm('Interim'); });
  $('callFinal').addEventListener('click', function () { callForm('Final'); });
  $('callForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = this, stage = f.dataset.stage;
    var how = (f.querySelector('[name=cfHow]:checked') || {}).value;
    var body = { tripId: current.id, stage: stage, dueDate: $('cfDue').value, email: how === 'email' };
    if (stage === 'Interim') { body.perPerson = Number(String($('cfPer').value).replace(/[£,\s]/g, '')); body.reason = $('cfReason').value.trim(); }
    var btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    admin('call', body).then(function (r) {
      if (!r.ok) { T.errorBox($('cfError'), [r.error]); return; }
      f.hidden = true;
      if (stage === 'Deposit') current.depositAsked = true;
      T.toast((stage === 'Deposit' ? 'Deposits asked for' : stage === 'Final' ? 'Final balance called' : 'Interim payment called') +
        (how === 'email' ? (T.DEMO ? ' (preview: no emails sent)' : ', ' + r.emailed + ' emails sent') : ''));
      return loadMoney(true).then(function () { if (how === 'group') showGroupMessage(groupMessage(body)); });
    }).catch(function () { /* */ }).then(function () { btn.disabled = false; });
  });

  if (pass) {
    // Signed in before on this device: show what was loaded last time straight away, then refresh quietly.
    try { overview = JSON.parse(store.getItem(OV_KEY) || 'null'); } catch (e) { overview = null; }
    loadTrips();
  } else {
    views('loginView');
  }
})();
