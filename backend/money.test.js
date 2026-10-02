// Run with: node backend/money.test.js
const assert = require('assert');
const M = require('../trips/money.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; } catch (e) { console.error('FAIL: ' + name + '\n  ' + e.message); process.exitCode = 1; }
}

const trip = { charityFee: 50 };
const bookings = [
  { ref: 'RAKIM', status: 'Booked', depositDue: 300 },
  { ref: 'BOLAN', status: 'Booked', depositDue: 100 },
  { ref: 'SUDEV', status: 'Booked', depositDue: 0 },
  { ref: 'GONE', status: 'Cancelled', depositDue: 100 },
  { ref: 'WAITS', status: 'Waiting list', depositDue: 100 },
];
const people = [
  { ref: 'RAKIM', n: 1, fullName: 'Parent', role: 'Rider', bikeType: 'Hybrid' },
  { ref: 'RAKIM', n: 2, fullName: 'Child', role: 'Rider', bikeType: 'Hybrid' },
  { ref: 'RAKIM', n: 3, fullName: 'Partner', role: 'Non-rider', bikeType: '' },
  { ref: 'BOLAN', n: 1, fullName: 'Solo', role: 'Rider', bikeType: 'Road e-bike' },
  { ref: 'SUDEV', n: 1, fullName: 'Crew', role: 'Support crew', bikeType: 'Not bringing a bike' },
  { ref: 'GONE', n: 1, fullName: 'Left', role: 'Rider', bikeType: 'Road' },
  { ref: 'WAITS', n: 1, fullName: 'Waiter', role: 'Rider', bikeType: 'Road' },
];
const sumShares = (s) => Object.values(s.shares).reduce((a, b) => a + b, 0);

test('allocate: pennies add up exactly and spread fairly', () => {
  const a = M.allocate(1000, ['c', 'a', 'b']);
  assert.deepStrictEqual(a, { a: 334, b: 333, c: 333 });
  const big = M.allocate(700000, Array.from({ length: 58 }, (_, i) => 'p' + i));
  assert.strictEqual(Object.values(big).reduce((x, y) => x + y, 0), 700000);
  assert.ok(Math.max(...Object.values(big)) - Math.min(...Object.values(big)) <= 1);
});

test('pence parsing', () => {
  assert.strictEqual(M.pence('£1,234.56'), 123456);
  assert.strictEqual(M.pence(0.1 + 0.2), 30);
  assert.strictEqual(M.pence(''), 0);
});

const active = people.filter((p) => ['RAKIM', 'BOLAN', 'SUDEV'].includes(p.ref)).map((p) => ({ key: M.personKey(p.ref, p.n), role: p.role, bikeType: p.bikeType }));

test('equal split: groups', () => {
  const all = M.shares({ split: 'equal', amount: 100, detail: { group: 'all' } }, active);
  assert.strictEqual(Object.keys(all.shares).length, 5);
  assert.strictEqual(sumShares(all), 10000);
  assert.strictEqual(Object.keys(M.shares({ split: 'equal', amount: 100, detail: { group: 'notSupport' } }, active).shares).length, 4);
  assert.strictEqual(Object.keys(M.shares({ split: 'equal', amount: 100, detail: { group: 'riders' } }, active).shares).length, 3);
  const bikes = M.shares({ split: 'equal', amount: 90, detail: JSON.stringify({ group: 'bikes' }) }, active);
  assert.deepStrictEqual(Object.keys(bikes.shares).sort(), ['BOLAN-1', 'RAKIM-1', 'RAKIM-2']);
  assert.strictEqual(bikes.shares['BOLAN-1'], 3000);
});

test('selected people only, ignoring anyone no longer booked', () => {
  const s = M.shares({ split: 'select', amount: 30, detail: { people: ['RAKIM-2', 'BOLAN-1', 'GONE-1'] } }, active);
  assert.deepStrictEqual(s.shares, { 'BOLAN-1': 1500, 'RAKIM-2': 1500 });
  assert.strictEqual(s.unallocated, 0);
});

test('rooms: each room split between its occupants; a single pays the whole room', () => {
  const e = { split: 'rooms', detail: { rooms: [
    { label: 'Family room', cost: 180, people: ['RAKIM-1', 'RAKIM-2', 'RAKIM-3'] },
    { label: 'Single', cost: 95, people: ['BOLAN-1'] },
    { label: 'Empty', cost: 50, people: ['GONE-1'] },
  ] } };
  const s = M.shares(e, active);
  assert.strictEqual(s.total, 32500);
  assert.strictEqual(s.shares['RAKIM-1'], 6000);
  assert.strictEqual(s.shares['BOLAN-1'], 9500);
  assert.strictEqual(s.unallocated, 5000);
  assert.strictEqual(s.shares['SUDEV-1'], undefined);
});

test('custom amounts', () => {
  const s = M.shares({ split: 'custom', detail: { amounts: { 'RAKIM-1': '12.50', 'GONE-1': 5 } } }, active);
  assert.deepStrictEqual(s.shares, { 'RAKIM-1': 1250 });
  assert.strictEqual(s.unallocated, 500);
  assert.strictEqual(s.total, 1750);
});

test('nobody in the group leaves the whole cost unallocated', () => {
  const s = M.shares({ split: 'equal', amount: 40, detail: { group: 'riders' } }, []);
  assert.strictEqual(s.unallocated, 4000);
});

test('validate expense', () => {
  assert.deepStrictEqual(M.validateExpense({ name: 'Support company', split: 'equal', amount: '£7,000', detail: { group: 'notSupport' } }).errors, []);
  assert.strictEqual(M.validateExpense({ name: 'X', split: 'equal', amount: '' }).errors.length, 2);
  const rooms = M.validateExpense({ name: 'Hotel – Bonn', split: 'rooms', detail: { rooms: [{ label: 'R1', cost: 120, people: ['A-1', 'A-2'] }, { label: 'R2', cost: 0, people: ['A-1'] }] } });
  assert.ok(rooms.errors.some((e) => /R2: enter the room cost/.test(e)));
  assert.ok(rooms.errors.some((e) => /two rooms/.test(e)));
  const ok = M.validateExpense({ name: 'Hotel – Bonn', split: 'rooms', amount: 1, detail: { rooms: [{ label: 'R1', cost: 120.5, people: ['A-1', 'A-2'] }, { label: 'R2', cost: 95, people: ['B-1'] }] } });
  assert.deepStrictEqual(ok.errors, []);
  assert.strictEqual(ok.value.amount, 215.5);
  assert.strictEqual(M.validateExpense({ name: 'Boat', split: 'select', amount: 20, detail: { people: [] } }).errors.length, 1);
});

const expenses = [
  { id: 'e1', name: 'Support company', split: 'equal', amount: 400, detail: { group: 'notSupport' } },
  { id: 'e2', name: 'Hotel – Frankfurt', split: 'rooms', detail: { rooms: [
    { label: 'Family', cost: 150, people: ['RAKIM-1', 'RAKIM-2', 'RAKIM-3'] },
    { label: 'Single', cost: 90, people: ['BOLAN-1'] },
    { label: 'Crew twin', cost: 80, people: ['SUDEV-1'] },
  ] } },
];
const payments = [
  { ref: 'RAKIM', amount: 300, status: 'Confirmed' },
  { ref: 'RAKIM', amount: 50, status: 'Claimed' },
  { ref: 'BOLAN', amount: 999, status: 'Rejected' },
  { ref: 'GONE', amount: 100, status: 'Confirmed' },
];

test('balances: costs, charity for riders only, deposits due before any call', () => {
  const r = M.balances(trip, bookings, people, payments, expenses, []);
  const rakim = r.bookings.find((b) => b.ref === 'RAKIM');
  // support 400 / 4 = 100 each for 3 people, family room 150, charity 50 x 2 riders
  assert.strictEqual(rakim.cost, 300 + 150 + 100);
  assert.strictEqual(rakim.confirmed, 300);
  assert.strictEqual(rakim.claimed, 50);
  assert.strictEqual(rakim.dueSoFar, 300);
  assert.strictEqual(rakim.owesNow, 0);
  assert.strictEqual(rakim.balance, 250);
  const child = rakim.people.find((p) => p.n === 2);
  assert.deepStrictEqual(child.lines.map((l) => l.name), ['Support company', 'Hotel – Frankfurt', 'Charity fee']);
  const crew = r.bookings.find((b) => b.ref === 'SUDEV');
  assert.strictEqual(crew.cost, 80);
  assert.strictEqual(r.bookings.find((b) => b.ref === 'GONE').cost, 0);
  assert.strictEqual(r.bookings.find((b) => b.ref === 'WAITS').dueSoFar, 0);
  assert.strictEqual(r.totals.expenses, 720);
  assert.strictEqual(r.totals.unallocated, 0);
  assert.strictEqual(r.totals.charity, 150);
  assert.strictEqual(r.totals.cost, 720 + 150);
});

test('balances: interim call per paying person, then the final balance', () => {
  let r = M.balances(trip, bookings, people, payments, expenses, [{ stage: 'Interim', perPerson: 100 }]);
  const rakim = r.bookings.find((b) => b.ref === 'RAKIM');
  assert.strictEqual(rakim.dueSoFar, 600);
  assert.strictEqual(rakim.owesNow, 300);
  assert.strictEqual(r.bookings.find((b) => b.ref === 'SUDEV').dueSoFar, 0);
  r = M.balances(trip, bookings, people, payments, expenses, [{ stage: 'Interim', perPerson: 100 }, { stage: 'Final' }]);
  assert.ok(r.finalCalled);
  assert.strictEqual(r.bookings.find((b) => b.ref === 'RAKIM').owesNow, 250);
  assert.strictEqual(r.bookings.find((b) => b.ref === 'SUDEV').owesNow, 80);
});

test('balances: every penny of every expense lands on someone', () => {
  const many = Array.from({ length: 58 }, (_, i) => ({ ref: 'R' + i, n: 1, fullName: 'P' + i, role: 'Rider', bikeType: 'Road' }));
  const bk = many.map((p) => ({ ref: p.ref, status: 'Booked', depositDue: 100 }));
  const r = M.balances({ charityFee: 0 }, bk, many, [], [{ id: 'x', name: 'Support', split: 'equal', amount: 7000, detail: { group: 'all' } }], []);
  assert.strictEqual(r.totals.cost, 7000);
  assert.strictEqual(r.bookings.reduce((a, b) => a + M.pence(b.cost), 0), 700000);
});

console.log(passed + ' money checks passed' + (process.exitCode ? ', some FAILED' : ''));
