// Run with: node backend/test.js
const assert = require('assert');
const C = require('./Code.gs');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error('FAIL: ' + name + '\n  ' + e.message); process.exitCode = 1; }
}

const trip = { id: 'rhine-2027', name: 'Rhine', datesText: 'May 2027', startDate: '2027-05-28', places: 50, depositPerPerson: 100, depositDays: 7 };
const adult = (o) => Object.assign({ fullName: 'Asha Rider', dob: '1980-04-02', role: 'Rider', mobile: '07700 900123', bikeType: 'Road' }, o);
const lead = { email: 'Asha@Example.com ', address: '1 High Street, Birmingham', postcode: 'b15 3sd', emergencyName: 'Ravi Home', emergencyRelation: 'Brother', emergencyMobile: '07700 900999' };
const agree = { members: true, readDetails: true, insurance: true, costs: true, privacy: true };

test('age on trip start', () => {
  assert.strictEqual(C.ageOn_('2009-05-28', '2027-05-28'), 18);
  assert.strictEqual(C.ageOn_('2009-05-29', '2027-05-28'), 17);
  assert.strictEqual(C.ageOn_('bad', '2027-05-28'), null);
});

test('iso dates reject nonsense', () => {
  assert.strictEqual(C.isoDate_('2027-02-30'), '');
  assert.strictEqual(C.isoDate_('28/05/2027'), '');
  assert.strictEqual(C.isoDate_(new Date(2027, 4, 28)), '2027-05-28');
});

test('mobile normalising', () => {
  assert.strictEqual(C.normaliseMobile_('+44 7700 900123'), '07700900123');
  assert.strictEqual(C.normaliseMobile_('447700900123'), '07700900123');
  assert.strictEqual(C.normaliseMobile_('07700-900-123'), '07700900123');
});

test('valid single registration', () => {
  const r = C.validateRegistration_({ lead, people: [adult()], agree }, trip);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.booking.email, 'asha@example.com');
  assert.strictEqual(r.booking.postcode, 'B15 3SD');
  assert.strictEqual(r.booking.depositDue, 100);
  assert.strictEqual(r.booking.leadName, 'Asha Rider');
  assert.strictEqual(r.people[0].under18, false);
});

test('family: child needs a responsible adult, deposit per person, support crew pays no deposit', () => {
  const kid = { fullName: 'Kavi Rider', dob: '2014-01-01', role: 'Rider', bikeType: 'Hybrid' };
  let r = C.validateRegistration_({ lead, people: [adult(), kid], agree }, trip);
  assert.ok(r.errors.some((e) => /under 18/.test(e)));
  kid.responsibleAdult = 'Asha Rider';
  const crew = { fullName: 'Sam Support', dob: '1975-01-01', role: 'Support crew', bikeType: 'Not bringing a bike' };
  r = C.validateRegistration_({ lead, people: [adult(), kid, crew], agree }, trip);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.people[1].under18, true);
  assert.strictEqual(r.booking.depositDue, 200);
  assert.strictEqual(r.people[1].responsibleAdultElsewhere, undefined);
});

test('responsible adult in another booking is allowed but flagged', () => {
  const kid = { fullName: 'Kavi Rider', dob: '2014-01-01', role: 'Rider', bikeType: 'Hybrid', responsibleAdult: 'Uncle Raj' };
  const r = C.validateRegistration_({ lead, people: [adult(), kid], agree }, trip);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.people[1].responsibleAdultElsewhere, true);
});

test('riders under 10 refused, non-riders under 10 allowed', () => {
  const tiny = { fullName: 'Tiny One', dob: '2019-01-01', role: 'Rider', bikeType: 'Other', responsibleAdult: 'Asha Rider' };
  let r = C.validateRegistration_({ lead, people: [adult(), tiny], agree }, trip);
  assert.ok(r.errors.some((e) => /at least 10/.test(e)));
  tiny.role = 'Non-rider';
  r = C.validateRegistration_({ lead, people: [adult(), tiny], agree }, trip);
  assert.deepStrictEqual(r.errors, []);
});

test('the person registering must be an adult', () => {
  const r = C.validateRegistration_({ lead, people: [adult({ dob: '2012-01-01', responsibleAdult: 'X Y' })], agree }, trip);
  assert.ok(r.errors.some((e) => /18 or over/.test(e)));
});

test('emergency contact cannot be someone on the trip', () => {
  const r = C.validateRegistration_({ lead: Object.assign({}, lead, { emergencyMobile: '07700900123' }), people: [adult()], agree }, trip);
  assert.ok(r.errors.some((e) => /not coming on the trip/.test(e)));
});

test('all agreement boxes required, error shown once', () => {
  const r = C.validateRegistration_({ lead, people: [adult()], agree: { members: true } }, trip);
  assert.strictEqual(r.errors.filter((e) => /tick every box/.test(e)).length, 1);
});

test('passport expiring before the trip is rejected; empty passport is fine', () => {
  let r = C.validateRegistration_({ lead, people: [adult({ passportNumber: '123', passportExpiry: '2027-01-01' })], agree }, trip);
  assert.ok(r.errors.some((e) => /expires before/.test(e)));
  r = C.validateRegistration_({ lead, people: [adult({ passportNumber: '', passportExpiry: '' })], agree }, trip);
  assert.deepStrictEqual(r.errors, []);
});

test('non-riders need no bike; riders do', () => {
  let r = C.validateRegistration_({ lead, people: [adult({ bikeType: '' })], agree }, trip);
  assert.ok(r.errors.some((e) => /bike type/.test(e)));
  r = C.validateRegistration_({ lead, people: [adult({ role: 'Non-rider', bikeType: '' })], agree }, trip);
  assert.deepStrictEqual(r.errors, []);
});

test('same person twice and booking size limit', () => {
  let r = C.validateRegistration_({ lead, people: [adult(), adult({ mobile: '' })], agree }, trip);
  assert.ok(r.errors.some((e) => /twice/.test(e)));
  const many = Array.from({ length: 9 }, (_, i) => adult({ fullName: 'Person ' + i, mobile: i ? '' : '07700900123' }));
  r = C.validateRegistration_({ lead, people: many, agree }, trip);
  assert.ok(r.errors.some((e) => /up to 8/.test(e)));
});

test('places taken counts only Booked on this trip', () => {
  const bookings = [
    { tripId: 'rhine-2027', status: 'Booked', people: '4' },
    { tripId: 'rhine-2027', status: 'Waiting list', people: '3' },
    { tripId: 'rhine-2027', status: 'Cancelled', people: '2' },
    { tripId: 'other', status: 'Booked', people: '5' },
  ];
  assert.strictEqual(C.placesTaken_(bookings, 'rhine-2027'), 4);
});

test('references are name-shaped, unique and never blocked words', () => {
  const seen = {};
  for (let i = 0; i < 3000; i++) {
    const r = C.generateReference_(seen);
    assert.ok(/^[BDGKLMNPRSTV][AEIOU][BDGKLMNPRSTV][AEIOU][BDGKLMNPRSTV]$/.test(r));
    assert.ok(!seen[r]);
    assert.ok(C.REF_BLOCKED.indexOf(r) === -1);
    seen[r] = true;
  }
});

test('trip ids come from the name and stay unique', () => {
  assert.strictEqual(C.slugify_('Castles to Cathedrals: Rhine 2027', {}), 'castles-to-cathedrals-rhine-2027');
  assert.strictEqual(C.slugify_('Lakes & Légends 2027', { 'lakes-legends-2027': true }), 'lakes-legends-2027-2');
});

test('route links: label | url, unsafe links dropped', () => {
  const r = C.parseRoutes_('Day 1: Frankfurt – St Goar | https://ridewithgps.com/routes/123\nDay 2 | javascript:alert(1)\n\nDay 3 |');
  assert.strictEqual(r.length, 3);
  assert.strictEqual(r[0].url, 'https://ridewithgps.com/routes/123');
  assert.strictEqual(r[0].label, 'Day 1: Frankfurt – St Goar');
  assert.strictEqual(r[1].url, '');
  assert.strictEqual(r[2].label, 'Day 3');
});

test('trip validation', () => {
  let v = C.validateTrip_({ name: 'Rhine', datesText: 'May', startDate: '2027-05-28', places: '50', depositPerPerson: '100', depositDays: '7' });
  assert.deepStrictEqual(v.errors, []);
  assert.strictEqual(v.value.status, 'Draft');
  v = C.validateTrip_({ name: 'R', datesText: '', startDate: 'x', places: '0', depositPerPerson: '-1', depositDays: '0' });
  assert.strictEqual(v.errors.length, 6);
  v = C.validateTrip_({ id: 'gone', name: 'Rhine', datesText: 'May', startDate: '2027-05-28', places: 50, depositPerPerson: 100, depositDays: 7 }, { other: {} });
  assert.ok(v.errors.some((e) => /no longer exists/.test(e)));
});

test('payment totals: confirmed vs claimed, rejected ignored', () => {
  const t = C.paymentTotals_([
    { ref: 'RAKIM', status: 'Confirmed', amount: '100' },
    { ref: 'RAKIM', status: 'Claimed', amount: '50.5' },
    { ref: 'RAKIM', status: 'Rejected', amount: '999' },
    { ref: 'OTHER', status: 'Confirmed', amount: '10' },
  ], 'RAKIM');
  assert.deepStrictEqual(t, { confirmed: 100, claimed: 50.5 });
});

test('payment claims', () => {
  assert.deepStrictEqual(C.validateClaim_({ amount: '£1,200.50', stage: 'Deposit', paidOn: '2027-01-10' }).errors, []);
  assert.strictEqual(C.validateClaim_({ amount: '£1,200.50', stage: 'Deposit', paidOn: '2027-01-10' }).value.amount, 1200.5);
  assert.strictEqual(C.validateClaim_({ amount: '0', stage: 'Nope', paidOn: '' }).errors.length, 3);
});

test('duplicate registration within a day returns the first booking', () => {
  const bookings = [{ ref: 'RAKIM', tripId: 'rhine-2027', status: 'Booked', email: 'asha@example.com', bookedAt: new Date().toISOString() }];
  const byRef = { RAKIM: [{ fullName: 'Asha Rider' }] };
  const r = C.validateRegistration_({ lead, people: [adult()], agree }, trip);
  assert.strictEqual(C.findDuplicate_(bookings, byRef, 'rhine-2027', r.booking, r.people, Date.now()).ref, 'RAKIM');
  assert.strictEqual(C.findDuplicate_(bookings, byRef, 'other-trip', r.booking, r.people, Date.now()), null);
});

test('emails: deposit details when booked, none when waiting', () => {
  const cfg = { clubName: 'W/Rhinos Cycling Club', bankAccountName: 'W/Rhinos', bankSortCode: '12-34-56', bankAccountNumber: '12345678' };
  const people = [{ fullName: 'Asha Rider', role: 'Rider', under18: false }];
  const booked = C.buildRegistrationEmail_({ ref: 'RAKIM', status: 'Booked', depositDue: 100 }, people, trip, cfg, 'https://x');
  assert.ok(/PAYMENT REFERENCE: RAKIM/.test(booked.body) && /£100/.test(booked.body) && /https:\/\/x/.test(booked.body));
  const waiting = C.buildRegistrationEmail_({ ref: 'RAKIM', status: 'Waiting list', depositDue: 100 }, people, trip, cfg, 'https://x');
  assert.ok(/WAITING LIST/.test(waiting.body) && !/PAYMENT REFERENCE/.test(waiting.body));
});

test('settings: example bank details and short passcode are flagged', () => {
  let s = C.parseSettings_({ clubName: 'W', contactEmail: 'a@b.co', siteUrl: 'https://wrhinos.com', bankAccountName: 'W', bankSortCode: '00-00-00', bankAccountNumber: '00000000', organiserPasscode: 'short' });
  assert.ok(s.problems.some((p) => /example/.test(p)));
  assert.ok(s.problems.some((p) => /10 characters/.test(p)));
  s = C.parseSettings_({ clubName: 'W', contactEmail: 'a@b.co', siteUrl: 'https://wrhinos.com', bankAccountName: 'W', bankSortCode: '123456', bankAccountNumber: '1234 5678', organiserPasscode: 'long-enough-pass' });
  assert.deepStrictEqual(s.problems, []);
  assert.strictEqual(s.bankSortCode, '12-34-56');
});

test('sheet cells cannot start formulas', () => {
  assert.strictEqual(C.safeCell_('=HYPERLINK("x")'), '\'=HYPERLINK("x")');
  assert.strictEqual(C.safeCell_('Asha'), 'Asha');
});

console.log(passed + ' checks passed' + (process.exitCode ? ', some FAILED' : ''));
