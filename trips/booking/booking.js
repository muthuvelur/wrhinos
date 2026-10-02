(function () {
  'use strict';
  var T = window.Trips, $ = T.$, esc = T.esc;
  var q = new URLSearchParams(location.search);
  var auth = { ref: (q.get('r') || '').toUpperCase().replace(/[^A-Z]/g, ''), token: (q.get('k') || '').replace(/[^a-f0-9]/g, '') };
  var data = null;
  var copyValues = {};

  T.demoBanner();

  function call(body) { return T.api.post(Object.assign(body, auth)); }

  function render(r) {
    data = r;
    var b = r.booking, t = r.trip || {};
    document.title = 'My booking: ' + (t.name || 'W/Rhinos');
    $('bDates').textContent = t.datesText || '';
    $('bTrip').textContent = t.name || 'Your booking';
    $('bRef').textContent = b.ref;
    $('bCount').textContent = b.people + (b.people === 1 ? ' person' : ' people');
    var st = $('bStatus');
    st.textContent = b.status;
    st.className = 'chip ' + (b.status === 'Booked' ? 'ok' : b.status === 'Waiting list' ? 'warn' : 'bad');
    $('waitingNote').hidden = b.status !== 'Waiting list';
    $('cancelledNote').hidden = b.status !== 'Cancelled';

    var left = Math.max(0, Math.round((b.depositDue - r.totals.confirmed - r.totals.claimed) * 100) / 100);
    $('mDue').textContent = T.money(b.depositDue);
    $('mPaid').textContent = T.money(r.totals.confirmed);
    $('mClaimed').textContent = T.money(r.totals.claimed);
    $('moneyNote').textContent = b.status !== 'Booked' ? '' : left > 0
      ? T.money(left) + ' of your deposit is still to pay, within ' + t.depositDays + ' days of registering. Interim and final amounts will appear here when the organiser calls them.'
      : r.totals.confirmed < b.depositDue
        ? 'Thanks. The organiser will check your payment against the bank statement, then it moves to “Paid and checked”.'
        : 'Deposit paid, thank you. Interim and final amounts will appear here when the organiser calls them.';
    $('paymentsWrap').hidden = !r.payments.length;
    $('payments').innerHTML = r.payments.map(function (p) {
      return '<tr><td>' + esc(T.niceDate(p.paidOn)) + '</td><td>' + esc(p.stage) + '</td><td>' + T.money(p.amount) + '</td><td><span class="chip ' + (p.status === 'Confirmed' ? 'ok' : 'warn') + '">' + (p.status === 'Confirmed' ? 'Checked' : 'Being checked') + '</span></td></tr>';
    }).join('');

    $('payCard').hidden = b.status !== 'Booked';
    $('pName').textContent = r.bank.accountName;
    $('pSort').textContent = r.bank.sortCode;
    $('pAcc').textContent = r.bank.accountNumber;
    $('pRef').textContent = b.ref;
    copyValues = { name: r.bank.accountName, sort: String(r.bank.sortCode).replace(/\D/g, ''), account: String(r.bank.accountNumber).replace(/\D/g, ''), ref: b.ref };
    $('cAmount').value = left > 0 ? String(left) : '';
    $('cStage').innerHTML = T.STAGES.map(function (s) { return '<option>' + s + '</option>'; }).join('');
    $('cStage').value = left > 0 ? 'Deposit' : 'Interim';
    $('cDate').value = T.today();

    $('routesCard').hidden = !(t.routes && t.routes.length);
    $('routes').innerHTML = (t.routes || []).map(function (x) {
      return '<li><span>' + esc(x.label) + '</span>' + (x.url ? '<a class="btn btn-line btn-small" href="' + esc(x.url) + '" target="_blank" rel="noopener">Open route</a>' : '<span class="small muted">Coming soon</span>') + '</li>';
    }).join('');

    $('peopleList').innerHTML = r.people.map(function (p) {
      var missing = [];
      if (!p.passportNumber) missing.push('passport');
      if (p.role !== 'Non-rider' && p.bikeType !== 'Not bringing a bike' && !p.bikeMake) missing.push('bike make');
      return '<div style="border-top:1px solid var(--rule);padding-top:10px"><div class="row" style="justify-content:space-between"><b>' + esc(p.fullName) + '</b><span class="chip">' + esc(p.role) + (p.under18 === 'Yes' ? ' · under 18' : '') + '</span></div>' +
        '<div class="small muted">' + [p.bikeType, p.bikeMake, p.dietary ? 'Diet: ' + p.dietary : ''].filter(Boolean).map(esc).join(' · ') +
        (p.under18 === 'Yes' && p.responsibleAdult ? '<br>Responsible adult: ' + esc(p.responsibleAdult) : '') + '</div>' +
        (missing.length ? '<div class="small" style="color:var(--warn);margin-top:4px">Still needed: ' + missing.join(', ') + '</div>' : '') + '</div>';
    }).join('');

    $('contact').innerHTML = [
      ['Email', b.email], ['Mobile', b.mobile], ['Address', [b.address, b.postcode].filter(Boolean).join(', ')],
      ['Emergency', [b.emergencyName, b.emergencyRelation ? '(' + b.emergencyRelation + ')' : '', b.emergencyMobile].filter(Boolean).join(' ')],
      ['Rooms', b.roomRequests || '—'],
    ].map(function (kv) { return '<dt>' + kv[0] + '</dt><dd>' + esc(kv[1]) + '</dd>'; }).join('');
    $('tripLink').href = '/trips/?t=' + encodeURIComponent(t.id || '');

    T.rememberBooking({ ref: b.ref, link: location.href, trip: t.name, dates: t.datesText });
    $('loading').hidden = true;
    $('editView').hidden = true;
    $('view').hidden = false;
  }

  function load() {
    if (!/^[A-Z]{5}$/.test(auth.ref) || auth.token.length < 10) { fail('This booking link isn’t complete. Open it again from your email, or copy the whole link.'); return; }
    call({ action: 'booking' }).then(function (r) { if (!r || !r.ok) throw new Error((r && r.error) || ''); render(r); }).catch(function (e) { fail(e.message || 'We couldn’t load your booking just now.'); });
  }
  function fail(msg) {
    $('loading').hidden = true;
    $('loadError').innerHTML = esc(msg) + ' <button type="button" class="linkbtn" onclick="location.reload()">Try again</button>';
    $('loadError').hidden = false;
  }

  // ---------- I've paid ----------
  $('paidBtn').addEventListener('click', function () { $('claimForm').hidden = false; $('paidBtn').hidden = true; $('cAmount').focus(); });
  $('claimCancel').addEventListener('click', function () { $('claimForm').hidden = true; $('paidBtn').hidden = false; T.errorBox($('claimError'), []); });
  $('claimForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var amount = Number(String($('cAmount').value).replace(/[£,\s]/g, ''));
    if (!(amount > 0)) { T.errorBox($('claimError'), ['Enter the amount you paid.']); return; }
    if (!$('cDate').value) { T.errorBox($('claimError'), ['Enter the date you paid.']); return; }
    $('claimSubmit').disabled = true;
    call({ action: 'claim', amount: amount, stage: $('cStage').value, paidOn: $('cDate').value, note: $('cNote').value.trim() }).then(function (r) {
      if (!r || !r.ok) { T.errorBox($('claimError'), [(r && r.error) || 'That didn’t save. Please try again.']); return; }
      $('claimForm').hidden = true; $('paidBtn').hidden = false; $('cNote').value = '';
      render(r);
      T.toast('Thanks, the organiser will check it');
    }).catch(function () { T.errorBox($('claimError'), ['That didn’t save. Check your connection and try again.']); })
      .then(function () { $('claimSubmit').disabled = false; });
  });

  // ---------- edit ----------
  function openEdit() {
    var b = data.booking;
    $('editPeople').innerHTML = data.people.map(function (p, i) { return T.personHtml(i, p, i === 0); }).join('');
    Array.prototype.forEach.call($('editPeople').children, function (card) { T.wirePerson(card, data.trip.startDate); });
    ['email', 'address', 'postcode', 'emergencyName', 'emergencyRelation', 'emergencyMobile', 'roomRequests', 'notes'].forEach(function (k) { $(k).value = b[k] || ''; });
    T.errorBox($('editError'), []);
    $('view').hidden = true; $('editView').hidden = false;
    window.scrollTo(0, 0);
  }
  function closeEdit() { $('editView').hidden = true; $('view').hidden = false; window.scrollTo(0, 0); }
  $('editBtn').addEventListener('click', openEdit);
  $('editBack').addEventListener('click', function (e) { e.preventDefault(); closeEdit(); });
  $('editCancel').addEventListener('click', closeEdit);
  $('editForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var people = Array.prototype.map.call($('editPeople').children, T.readPerson);
    var errs = T.checkPeople(people, data.trip.startDate);
    T.errorBox($('editError'), errs);
    if (errs.length) return;
    $('saveBtn').disabled = true;
    call({ action: 'update', people: people, roomRequests: $('roomRequests').value.trim(), notes: $('notes').value.trim(),
      lead: { email: $('email').value.trim(), address: $('address').value.trim(), postcode: $('postcode').value.trim(), emergencyName: $('emergencyName').value.trim(), emergencyRelation: $('emergencyRelation').value.trim(), emergencyMobile: $('emergencyMobile').value.trim() },
    }).then(function (r) {
      if (!r || !r.ok) { T.errorBox($('editError'), r && r.errors ? r.errors : [(r && r.error) || 'That didn’t save. Please try again.']); return; }
      render(r); window.scrollTo(0, 0); T.toast('Saved');
    }).catch(function () { T.errorBox($('editError'), ['That didn’t save. Check your connection and try again.']); })
      .then(function () { $('saveBtn').disabled = false; });
  });

  Array.prototype.forEach.call(document.querySelectorAll('.copy[data-copy]'), function (btn) {
    btn.addEventListener('click', function () { T.copy(copyValues[btn.getAttribute('data-copy')] || '', btn); });
  });

  // ---------- home screen ----------
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (standalone) $('homeCard').hidden = true;
  else if (ios) $('homeText').innerHTML = 'Add it to your home screen and it opens like an app, straight to your booking. In Safari, tap the <b>Share</b> button, then <b>Add to Home Screen</b>.';
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); deferred = e; $('installBtn').hidden = false; });
  $('installBtn').addEventListener('click', function () {
    if (!deferred) return;
    deferred.prompt();
    deferred.userChoice.then(function () { deferred = null; $('installBtn').hidden = true; });
  });

  load();
})();
