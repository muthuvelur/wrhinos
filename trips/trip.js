(function () {
  'use strict';
  var T = window.Trips, $ = T.$, esc = T.esc;
  var trip = null;
  var busy = false;
  var copyValues = {};
  var tripId = (new URLSearchParams(location.search).get('t') || '').replace(/[^a-z0-9-]/g, '');

  T.demoBanner();

  function show(id) {
    ['listView', 'tripView', 'registerView', 'resultView'].forEach(function (v) { $(v).hidden = v !== id; });
    $('actionbar').hidden = id !== 'tripView' || !trip || trip.status !== 'Open';
    $('loading').hidden = true;
  }

  function placesText(t) {
    if (t.status !== 'Open') return { big: 'Registration closed', note: t.status === 'Closed' ? 'This trip is not taking registrations.' : '' };
    if (t.placesLeft <= 0) return { big: 'Full', note: 'You can still register: you’ll join the waiting list' + (t.waiting ? ', with ' + t.waiting + (t.waiting === 1 ? ' booking' : ' bookings') + ' ahead of you' : '') + '.' };
    return { big: t.placesLeft + '<small>of ' + t.places + ' places left</small>', note: 'Places go first come, first served. ' + (t.depositAtSignup === 'Yes'
      ? 'Your deposit of ' + T.money(t.depositPerPerson) + ' per person is due within ' + t.depositDays + ' days of registering.'
      : 'Nothing to pay when you sign up: we ask for the deposit once the trip is confirmed.') };
  }

  // ---------- list ----------
  function renderMine() {
    var mine = T.myBookings();
    $('mine').hidden = !mine.length;
    $('mineList').innerHTML = mine.map(function (b) {
      var chip = b.status === 'Cancelled' ? ' <span class="chip">Cancelled</span>' : b.status === 'Waiting list' ? ' <span class="chip warn">Waiting list</span>' : '';
      return '<div class="row" style="justify-content:space-between;flex-wrap:nowrap"><a href="' + esc(b.link) + '" style="text-decoration:none;color:inherit;min-width:0"><b>' + esc(b.trip) + '</b>' + chip +
        '<br><span class="small muted">' + esc(b.dates) + ' · ' + esc(b.ref) + '</span></a>' +
        '<span class="row" style="flex:none;gap:6px"><a class="btn btn-line btn-small" href="' + esc(b.link) + '">Open</a>' +
        '<button type="button" class="linkbtn small" data-forget="' + esc(b.ref) + '" aria-label="Remove from this list">Remove</button></span></div>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('[data-forget]'), function (btn) {
      btn.addEventListener('click', function () { T.forgetBooking(btn.getAttribute('data-forget')); renderMine(); });
    });
  }

  function loadList() {
    // Shows the quick copy at once; the live list replaces it when Google answers.
    T.api.trips(function (fresh) { renderList(fresh); }).then(function (r) {
      if (!r || !r.ok) throw new Error(r && r.error);
      renderList(r);
      show('listView');
    }).catch(failed);
  }
  function renderList(r) {
      renderMine();
      var list = r.trips.slice().sort(function (a, b) { return String(a.startDate || '9999').localeCompare(String(b.startDate || '9999')); });
      $('tripList').innerHTML = list.length ? list.map(function (t) {
        return '<a class="card trip-card" href="?t=' + encodeURIComponent(t.id) + '">' +
          '<p class="eyebrow">' + esc(t.datesText) + '</p><h2>' + esc(t.name) + '</h2>' +
          '<p class="muted" style="margin:0">' + esc(t.summary) + '</p>' +
          '<div class="row" style="justify-content:space-between"><span class="chip ' + (t.status !== 'Open' ? '' : t.placesLeft > 0 ? 'ok' : 'warn') + '">' +
          (t.status !== 'Open' ? 'Closed' : t.placesLeft > 0 ? t.placesLeft + ' of ' + t.places + ' places left' : 'Full: waiting list') + '</span>' +
          '<span class="small" style="color:var(--accent);font-weight:700">View trip →</span></div></a>';
      }).join('') : '<div class="card muted">No trips are open for registration yet. Check back soon.</div>';
  }

  // ---------- one trip ----------
  function renderTrip() {
    document.title = trip.name + ' | W/Rhinos';
    $('tDates').textContent = trip.datesText;
    $('tName').textContent = trip.name;
    $('tSummary').textContent = trip.summary;
    var p = placesText(trip);
    $('placesBig').innerHTML = p.big;
    $('placesNote').textContent = p.note;
    var used = trip.places ? Math.min(100, Math.round((trip.places - trip.placesLeft) / trip.places * 100)) : 0;
    $('placesMeter').style.width = used + '%';
    $('registerTop').hidden = trip.status !== 'Open';
    $('registerTop').textContent = trip.placesLeft > 0 ? 'Register' : 'Join the waiting list';
    $('abRegister').textContent = $('registerTop').textContent;
    $('abPlaces').textContent = trip.status !== 'Open' ? '' : trip.placesLeft > 0 ? trip.placesLeft + ' of ' + trip.places + ' places left' : 'Trip full';
    $('abNote').textContent = trip.placesLeft > 0 ? 'First come, first served' : 'Waiting list open';
    $('routesCard').hidden = !trip.routes.length;
    $('routes').innerHTML = trip.routes.map(function (r) {
      return '<li><span>' + esc(r.label) + '</span>' + (r.url ? '<a class="btn btn-line btn-small" href="' + esc(r.url) + '" target="_blank" rel="noopener">Open route</a>' : '<span class="small muted">Coming soon</span>') + '</li>';
    }).join('');
    $('tDetails').innerHTML = T.markdown(trip.details);
    $('rTrip').textContent = trip.name;
    if (!$('roomTypes').children.length) {
      $('roomTypes').innerHTML = (trip.roomTypes || ['Single room (supplement)', 'Twin share', 'Double']).map(function (r) {
        return '<label class="check"><input type="radio" name="roomType" value="' + esc(r) + '">' + esc(r) + '</label>';
      }).join('');
    }
  }

  function loadTrip() {
    $('loadingText').textContent = 'Loading the trip…';
    // The quick copy shows at once; when the live trip arrives, places and any organiser changes update in place.
    T.api.trip(tripId, function (fresh) {
      trip = fresh.trip;
      renderTrip();
      updateSummary();
      if (trip.status !== 'Open' && !$('registerView').hidden) route();
    }).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || '');
      trip = r.trip;
      renderTrip();
      route();
    }).catch(failed);
  }

  function route() {
    if (location.hash === '#register' && trip.status === 'Open') { show('registerView'); if (!$('people').children.length) addPerson(); updateSummary(); window.scrollTo(0, 0); }
    else if ($('resultView').dataset.done) show('resultView');
    else show('tripView');
  }

  function failed(e) {
    $('loading').hidden = true;
    $('loadError').innerHTML = esc((e && e.message) || 'We couldn’t load the trips just now.') + ' <button type="button" class="linkbtn" onclick="location.reload()">Try again</button>';
    $('loadError').hidden = false;
  }

  // ---------- registration form ----------
  function addPerson(p) {
    var i = $('people').children.length;
    if (i >= 8) { T.toast('One booking can have up to 8 people. Make a second booking for the rest.'); return; }
    var div = document.createElement('div');
    div.innerHTML = T.personHtml(i, p, i === 0, trip, false);
    var card = div.firstChild;
    $('people').appendChild(card);
    T.wirePerson(card, trip.startDate);
    var rm = card.querySelector('.remove-person');
    if (rm) rm.addEventListener('click', function () { card.remove(); renumber(); updateSummary(); });
    card.querySelector('[data-k="role"]').addEventListener('change', updateSummary);
    if (i > 0) { card.querySelector('[data-k="fullName"]').focus(); }
    updateSummary();
  }
  function renumber() {
    Array.prototype.forEach.call($('people').children, function (card, i) {
      card.setAttribute('data-i', i);
      card.querySelector('h3').textContent = i === 0 ? 'You' : 'Person ' + (i + 1);
    });
  }
  function people() { return Array.prototype.map.call($('people').children, T.readPerson); }
  function updateSummary() {
    if (!trip) return;
    var list = people();
    var paying = list.filter(function (p) { return p.role !== 'Support crew'; }).length;
    var n = list.length;
    var full = trip.placesLeft < n;
    $('regSummary').innerHTML = '<b>' + n + (n === 1 ? ' person' : ' people') + '</b> · ' +
      (full ? 'Not enough places left (' + Math.max(0, trip.placesLeft) + '), so this booking would join the waiting list.'
        : trip.depositAtSignup === 'Yes'
          ? 'Deposit ' + T.money(paying * trip.depositPerPerson) + ' (' + T.money(trip.depositPerPerson) + ' per person' + (paying < n ? ', none for support crew' : '') + '), due within ' + trip.depositDays + ' days.'
          : 'Nothing to pay now. Once the trip is confirmed we’ll ask for the deposit (' + T.money(trip.depositPerPerson) + ' per person' + (paying < n ? ', none for support crew' : '') + ') and a few more details, like passports.');
  }

  function collect() {
    return {
      action: 'register', tripId: trip.id,
      lead: {
        email: $('email').value.trim(), address: $('address').value.trim(),
        emergencyName: $('emergencyName').value.trim(), emergencyMobile: $('emergencyMobile').value.trim(),
      },
      people: people(),
      roomType: (document.querySelector('[name=roomType]:checked') || {}).value || '',
      roomRequests: $('roomRequests').value.trim(), notes: $('notes').value.trim(),
      agree: { charter: $('a_charter').checked, deposit: $('a_deposit').checked, insurance: $('a_insurance').checked, members: $('a_members').checked },
      website: $('website').value,
    };
  }
  function check(d) {
    var errs = T.checkPeople(d.people, trip.startDate);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.lead.email)) errs.push('Enter a valid email address.');
    if (d.lead.address.length < 5) errs.push('Enter your home address.');
    if (d.lead.emergencyMobile && d.lead.emergencyMobile.replace(/\D/g, '').length < 10) errs.push('Emergency contact: the phone number needs at least 10 digits, like 07700 900123. Or leave it empty.');
    if (Object.keys(d.agree).some(function (k) { return !d.agree[k]; })) errs.push('Please tick every box in the small print.');
    return errs;
  }

  function setBusy(on) {
    busy = on;
    $('submitBtn').disabled = on;
    $('joinWaiting').disabled = on;
    $('submitSpin').hidden = !on;
    $('submitText').textContent = on ? 'Registering…' : 'Register';
  }

  function submit(acceptWaitingList) {
    if (busy) return;
    var d = collect();
    var errs = check(d);
    T.errorBox($('regError'), errs);
    var badEmergency = !!d.lead.emergencyMobile && d.lead.emergencyMobile.replace(/\D/g, '').length < 10;
    $('emergencyMobile').classList.toggle('invalid', badEmergency);
    if (errs.length === 1 && badEmergency) { $('emergencyMobile').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('emergencyMobile').focus(); }
    if (errs.length) return;
    d.acceptWaitingList = acceptWaitingList === true;
    setBusy(true);
    var slow = setTimeout(function () { $('slowHint').hidden = false; }, 4000);
    T.api.post(d).then(function (r) {
      if (r && r.full && !d.acceptWaitingList) {
        $('fullText').innerHTML = '<b>' + esc(r.error) + '</b><br>You can join the waiting list as one booking, so your group stays together. We’ll email you if places come up. Nothing to pay until then.';
        $('fullPanel').hidden = false;
        $('submitCard').hidden = true;
        $('fullPanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      if (!r || !r.ok) {
        T.errorBox($('regError'), r && r.errors ? r.errors : [(r && r.error) || 'Something went wrong. Please try again.']);
        if (r && r.alreadyRegistered) {
          var a = document.createElement('a');
          a.href = '/trips/#lost';
          a.textContent = 'Email me my booking link';
          a.style.display = 'inline-block';
          a.style.marginTop = '8px';
          a.style.fontWeight = '700';
          $('regError').appendChild(document.createElement('br'));
          $('regError').appendChild(a);
        }
        return;
      }
      showResult(r);
    }).catch(function () {
      T.errorBox($('regError'), ['We couldn’t confirm your registration on screen, but it may have gone through. Check your email first. If nothing has arrived in a few minutes, press Register again: it won’t create a second booking.']);
    }).then(function () { clearTimeout(slow); $('slowHint').hidden = true; setBusy(false); });
  }

  function showResult(r) {
    var waiting = r.status === 'Waiting list';
    $('resTrip').textContent = trip.name;
    $('resTitle').textContent = waiting ? 'You’re on the waiting list' : r.depositAtSignup === 'Yes' ? 'You’re booked' : 'You’re signed up';
    $('resLead').innerHTML = waiting
      ? 'Your booking reference is <b>' + esc(r.ref) + '</b>. We’ll email you if places come up. Please don’t pay anything yet.'
      : 'Your places are held. Booking reference <b>' + esc(r.ref) + '</b>.' + (r.duplicate ? ' (You had already registered these people, so this is your existing booking.)' : '') +
        (r.depositAtSignup === 'Yes' ? '' : ' Nothing to pay yet: once the trip is confirmed we’ll ask for the deposit and a few more details, and your booking page will show you what to do.');
    $('payCard').hidden = waiting || !(r.depositDue > 0) || r.depositAtSignup !== 'Yes';
    $('resDays').textContent = r.depositDays || trip.depositDays;
    $('resAmount').textContent = T.money(r.depositDue);
    $('resAccName').textContent = r.bank.accountName;
    $('resSort').textContent = r.bank.sortCode;
    $('resAcc').textContent = r.bank.accountNumber;
    $('resRef').textContent = r.ref;
    copyValues = { amount: Number(r.depositDue).toFixed(2), name: r.bank.accountName, sort: String(r.bank.sortCode).replace(/\D/g, ''), account: String(r.bank.accountNumber).replace(/\D/g, ''), ref: r.ref };
    $('resLink').textContent = r.link;
    $('openBooking').href = r.link;
    var sentTo = r.email || $('email').value.trim();
    var what = r.depositAtSignup === 'Yes' && r.status !== 'Waiting list' ? 'this link and the payment details' : 'this link';
    $('resEmail').textContent = r.preview ? 'In the real system ' + what + ' would also be emailed to you.'
      : r.emailSent === false ? 'We couldn’t send the confirmation email, so please save this link now (a screenshot is fine).'
        : 'We’ve also emailed ' + what + ' to ' + sentTo + '. Check your spam folder if it doesn’t arrive.';
    T.rememberBooking({ ref: r.ref, link: r.link, trip: trip.name, dates: trip.datesText });
    $('resultView').dataset.done = '1';
    history.replaceState(null, '', location.pathname + location.search);
    show('resultView');
    window.scrollTo(0, 0);
  }

  // ---------- wiring ----------
  $('addPerson').addEventListener('click', function () { addPerson(); });
  $('people').addEventListener('input', function (e) { if (e.target.getAttribute('data-k') === 'dob') updateSummary(); });
  $('regForm').addEventListener('submit', function (e) { e.preventDefault(); submit(false); });
  $('joinWaiting').addEventListener('click', function () { submit(true); });
  $('cancelWaiting').addEventListener('click', function () { $('fullPanel').hidden = true; $('submitCard').hidden = false; });
  $('backToTrip').addEventListener('click', function (e) { e.preventDefault(); history.pushState(null, '', location.pathname + location.search); route(); window.scrollTo(0, 0); });
  window.addEventListener('hashchange', function () { if (trip) route(); });
  Array.prototype.forEach.call(document.querySelectorAll('.copy[data-copy]'), function (b) {
    b.addEventListener('click', function () { T.copy(copyValues[b.getAttribute('data-copy')] || '', b); });
  });
  $('copyLink').addEventListener('click', function () { T.copy($('resLink').textContent, $('copyLink')); });

  $('lostForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var email = $('lostEmail').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { T.errorBox($('lostError'), ['Enter the email address you registered with.']); return; }
    T.errorBox($('lostError'), []);
    $('lostBtn').disabled = true;
    T.api.post({ action: 'resend', email: email, website: $('website').value }).then(function (r) {
      if (!r || !r.ok) { T.errorBox($('lostError'), [(r && r.error) || 'That didn’t work. Please try again.']); return; }
      $('lostDone').textContent = r.message;
      $('lostDone').hidden = false;
      $('lostEmail').value = '';
    }).catch(function () { T.errorBox($('lostError'), ['That didn’t work. Check your connection and try again.']); })
      .then(function () { $('lostBtn').disabled = false; });
  });

  if (tripId) loadTrip(); else loadList();
})();
