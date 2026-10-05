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

    var mo = r.money, row = mo && mo.row;
    var dueSoFar = row ? row.dueSoFar : b.depositDue;
    var left = Math.max(0, Math.round((dueSoFar - r.totals.confirmed - r.totals.claimed) * 100) / 100);
    var finalCalled = mo && mo.finalCalled;
    var asked = !mo || mo.depositAsked !== false || dueSoFar > 0;
    $('mDue').textContent = T.money(dueSoFar);
    $('mDueLabel').textContent = finalCalled ? 'Your total cost' : !asked ? 'Asked for so far' : (mo && mo.calls.some(function (c) { return c.stage !== 'Deposit'; }) ? 'Asked for so far' : 'Deposit');

    // Next steps: once the trip is confirmed, pay the deposit and fill in what sign-up didn't ask for.
    var todo = [];
    if (b.status === 'Booked' && asked) {
      if (left > 0) todo.push('Pay ' + T.money(left) + ' by bank transfer (details below), then tap “I’ve paid”');
      (mo && mo.missing || []).forEach(function (m) { todo.push(m.indexOf(': ') > -1 ? m.replace(': ', ': add ') : 'Add an ' + m.toLowerCase()); });
    }
    $('nextCard').hidden = !todo.length;
    document.querySelector('#moneyCard .money').hidden = !asked && !r.payments.length;
    $('nextList').innerHTML = todo.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('');
    $('nextEdit').hidden = !(mo && mo.missing && mo.missing.length);
    $('mPaid').textContent = T.money(r.totals.confirmed);
    $('mOwes').textContent = T.money(left);
    $('mOwesLabel').textContent = r.totals.claimed ? 'To pay now (after ' + T.money(r.totals.claimed) + ' being checked)' : 'To pay now';
    $('callNotes').innerHTML = b.status !== 'Booked' || !mo ? '' : mo.calls.map(function (c) {
      return '<div class="notice small"><b>' + (c.stage === 'Deposit' ? 'Trip confirmed: deposit now due' : c.stage === 'Final' ? 'Final balance called' : 'Interim payment: ' + T.money(c.perPerson) + ' per person') + '</b>' +
        (c.dueDate ? ', due by ' + esc(T.niceDate(c.dueDate)) : '') + (c.reason ? '. ' + esc(c.reason) : '') + '</div>';
    }).join('');
    $('moneyNote').textContent = b.status !== 'Booked' ? '' : !asked
      ? 'Nothing to pay yet. Once the trip is confirmed we’ll ask for your deposit of ' + T.money(b.depositDue) + ' and a few more details, like passports. It will show here, and we’ll post in the group.'
      : left > 0
      ? (finalCalled ? 'This is your final balance: your share of what the trip actually cost, less what you have paid.'
        : mo && mo.calls.length ? 'Please pay the amount above by the due date.' : 'Please pay your deposit within ' + t.depositDays + ' days of registering.') +
        ' Use your reference so we can find it, then tap “I’ve paid”.'
      : r.totals.claimed
        ? 'Thanks. The organiser will check your payment against the bank statement, then it moves to “Paid and checked”.'
        : finalCalled ? 'All paid, thank you!' : 'You’re up to date, thank you. Any interim or final payment will appear here when the organiser asks for it.';

    // Breakdown of the costs entered so far: the trip runs at cost, so everyone can see where their money goes.
    var people = row ? row.people.filter(function (p) { return p.lines.length; }) : [];
    $('breakdown').hidden = !people.length;
    $('breakdownBody').innerHTML = !people.length ? '' :
      '<p class="small muted" style="margin:0">Your share of the costs entered so far' + (finalCalled ? '' : '. The final amount is confirmed after the trip, once every cost is in') + '.</p>' +
      people.map(function (p) {
        return '<div><b>' + esc(p.name) + '</b><table class="plain">' + p.lines.map(function (l) {
          return '<tr><td>' + esc(l.name) + '</td><td style="text-align:right">' + T.money(l.amount) + '</td></tr>'; }).join('') +
          '<tr><td><b>Total</b></td><td style="text-align:right"><b>' + T.money(p.total) + '</b></td></tr></table></div>';
      }).join('') +
      (row.people.length > 1 ? '<div class="row" style="justify-content:space-between"><b>Your booking in total</b><b>' + T.money(row.cost) + '</b></div>' : '') +
      '<details class="more"><summary>All trip costs</summary><table class="plain">' + mo.expenses.map(function (e) {
        return '<tr><td>' + esc(e.name) + '<br><span class="small muted">' + esc(e.describe) + '</span></td><td style="text-align:right">' + T.money(e.total) + '</td></tr>'; }).join('') +
        (mo.charityFee > 0 ? '<tr><td>Charity fee<br><span class="small muted">' + T.money(mo.charityFee) + ' per rider, to a charity the riders choose</span></td><td></td></tr>' : '') + '</table></details>';
    $('paymentsWrap').hidden = !r.payments.length;
    $('payments').innerHTML = r.payments.map(function (p) {
      return '<tr><td>' + esc(T.niceDate(p.paidOn)) + '</td><td>' + esc(p.stage) + '</td><td>' + T.money(p.amount) + '</td><td><span class="chip ' + (p.status === 'Confirmed' ? 'ok' : 'warn') + '">' + (p.status === 'Confirmed' ? 'Checked' : 'Being checked') + '</span></td></tr>';
    }).join('');

    $('payCard').hidden = b.status !== 'Booked' || !asked;
    $('pName').textContent = r.bank.accountName;
    $('pSort').textContent = r.bank.sortCode;
    $('pAcc').textContent = r.bank.accountNumber;
    $('pRef').textContent = b.ref;
    copyValues = { name: r.bank.accountName, sort: String(r.bank.sortCode).replace(/\D/g, ''), account: String(r.bank.accountNumber).replace(/\D/g, ''), ref: b.ref };
    $('cAmount').value = left > 0 ? String(left) : '';
    $('cStage').innerHTML = T.STAGES.map(function (s) { return '<option>' + s + '</option>'; }).join('');
    $('cStage').value = finalCalled ? 'Final' : mo && mo.calls.some(function (c) { return c.stage === 'Interim'; }) && r.totals.confirmed >= b.depositDue ? 'Interim' : 'Deposit';
    $('cDate').value = T.today();

    $('routesCard').hidden = !(t.routes && t.routes.length);
    $('routes').innerHTML = (t.routes || []).map(function (x) {
      return '<li><span>' + esc(x.label) + '</span>' + (x.url ? '<a class="btn btn-line btn-small" href="' + esc(x.url) + '" target="_blank" rel="noopener">Open route</a>' : '<span class="small muted">Coming soon</span>') + '</li>';
    }).join('');

    $('peopleList').innerHTML = r.people.map(function (p) {
      var sizing = p.bikeHire === 'Yes' ? [p.heightCm ? p.heightCm + ' cm tall' : '', p.insideLegCm ? 'inside leg ' + p.insideLegCm + ' cm' : '', p.pedals].filter(Boolean).join(', ') : '';
      return '<div style="border-top:1px solid var(--rule);padding-top:10px"><div class="row" style="justify-content:space-between"><b>' + esc(p.fullName) + '</b><span class="chip">' + esc(p.role) + (p.under18 === 'Yes' ? ' · under 18' : '') + '</span></div>' +
        '<div class="small muted">' + [p.bikeChoice || p.bikeType, sizing, p.bikeMake, p.dietary ? 'Diet: ' + p.dietary : ''].filter(Boolean).map(esc).join(' · ') +
        (p.under18 === 'Yes' && p.responsibleAdult ? '<br>Responsible adult: ' + esc(p.responsibleAdult) : '') +
        (p.passportNumber ? '<br>Passport added ✓' : '') + '</div></div>';
    }).join('');

    $('contact').innerHTML = [
      ['Email', b.email], ['Phone', b.mobile], ['Address', [b.address, b.postcode].filter(Boolean).join(', ')],
      ['Emergency', [b.emergencyName, b.emergencyRelation ? '(' + b.emergencyRelation + ')' : '', b.emergencyMobile].filter(Boolean).join(' ') || '—'],
      ['Room', [b.roomType, b.roomRequests ? 'sharing with ' + b.roomRequests : ''].filter(Boolean).join(', ') || '—'],
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
    $('loadError').innerHTML = esc(msg) + ' <button type="button" class="linkbtn" onclick="location.reload()">Try again</button>' +
      '<br><a href="/trips/#lost">Lost your link? We can email it to you.</a>';
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
    $('editPeople').innerHTML = data.people.map(function (p, i) { return T.personHtml(i, p, i === 0, data.trip, true); }).join('');
    Array.prototype.forEach.call($('editPeople').children, function (card) { T.wirePerson(card, data.trip.startDate); });
    ['email', 'emergencyName', 'emergencyRelation', 'emergencyMobile', 'roomRequests', 'notes'].forEach(function (k) { $(k).value = b[k] || ''; });
    $('address').value = [b.address, b.postcode].filter(Boolean).join(', ');
    $('roomType').innerHTML = '<option value="">No preference</option>' + (data.trip.roomTypes || ['Single room (supplement)', 'Twin share', 'Double']).map(function (r) {
      return '<option' + (b.roomType === r ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('');
    T.errorBox($('editError'), []);
    $('view').hidden = true; $('editView').hidden = false;
    window.scrollTo(0, 0);
  }
  function closeEdit() { $('editView').hidden = true; $('view').hidden = false; window.scrollTo(0, 0); }
  $('editBtn').addEventListener('click', openEdit);
  $('nextEdit').addEventListener('click', openEdit);
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
      roomType: $('roomType').value,
      lead: { email: $('email').value.trim(), address: $('address').value.trim(), emergencyName: $('emergencyName').value.trim(), emergencyRelation: $('emergencyRelation').value.trim(), emergencyMobile: $('emergencyMobile').value.trim() },
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
