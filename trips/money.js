/*
 * W/Rhinos trip money: how expenses are shared and what each booking owes.
 * The same file runs in the browser (trips pages), in Google Apps Script (paste it in as Money.gs) and in node tests.
 * All sums are worked in pence so shares always add up exactly to the expense.
 */
var Money = (function () {
  'use strict';

  var GROUPS = {
    all: { label: 'Everyone', test: function () { return true; } },
    notSupport: { label: 'Everyone except support crew', test: function (p) { return p.role !== 'Support crew'; } },
    riders: { label: 'Riders only', test: function (p) { return p.role === 'Rider'; } },
    bikes: { label: 'Everyone bringing a bike', test: function (p) { return p.role !== 'Non-rider' && p.bikeType && p.bikeType !== 'Not bringing a bike'; } },
  };
  var SPLITS = ['equal', 'select', 'rooms', 'custom'];

  function pence(n) { return Math.round((Number(String(n === undefined || n === null ? '' : n).replace(/[£,\s]/g, '')) || 0) * 100); }
  function pounds(p) { return Math.round(p) / 100; }
  function personKey(ref, n) { return ref + '-' + n; }

  // Split a whole number of pence between keys as evenly as possible; leftover pennies go to the first keys.
  function allocate(totalPence, keys) {
    var out = {};
    if (!keys.length) return out;
    var sorted = keys.slice().sort();
    var base = Math.floor(totalPence / sorted.length);
    var rest = totalPence - base * sorted.length;
    sorted.forEach(function (k, i) { out[k] = base + (i < rest ? 1 : 0); });
    return out;
  }

  function parseDetail(d) {
    if (d && typeof d === 'object') return d;
    try { return JSON.parse(d || '{}') || {}; } catch (e) { return {}; }
  }

  // Total cost of an expense, in pence. Room expenses add up their rooms; custom ones add up the amounts.
  function expenseTotal(e) {
    var d = parseDetail(e.detail);
    if (e.split === 'rooms') return (d.rooms || []).reduce(function (a, r) { return a + pence(r.cost); }, 0);
    if (e.split === 'custom') return Object.keys(d.amounts || {}).reduce(function (a, k) { return a + pence(d.amounts[k]); }, 0);
    return pence(e.amount);
  }

  // Who pays what for one expense. `people` are the people in confirmed bookings: {key, role, bikeType}.
  function shares(e, people) {
    var d = parseDetail(e.detail);
    var byKey = {};
    people.forEach(function (p) { byKey[p.key] = p; });
    var res = { shares: {}, unallocated: 0, total: expenseTotal(e) };
    var add = function (alloc) { Object.keys(alloc).forEach(function (k) { res.shares[k] = (res.shares[k] || 0) + alloc[k]; }); };
    if (e.split === 'equal' || e.split === 'select') {
      var keys = e.split === 'equal'
        ? people.filter((GROUPS[d.group] || GROUPS.all).test).map(function (p) { return p.key; })
        : (d.people || []).filter(function (k) { return byKey[k]; });
      if (keys.length) add(allocate(res.total, keys)); else res.unallocated = res.total;
    } else if (e.split === 'rooms') {
      (d.rooms || []).forEach(function (r) {
        var occ = (r.people || []).filter(function (k) { return byKey[k]; });
        if (occ.length) add(allocate(pence(r.cost), occ)); else res.unallocated += pence(r.cost);
      });
    } else if (e.split === 'custom') {
      Object.keys(d.amounts || {}).forEach(function (k) {
        if (byKey[k]) res.shares[k] = (res.shares[k] || 0) + pence(d.amounts[k]);
        else res.unallocated += pence(d.amounts[k]);
      });
    }
    return res;
  }

  function describe(e, people) {
    var d = parseDetail(e.detail);
    if (e.split === 'equal') return 'Shared equally: ' + (GROUPS[d.group] || GROUPS.all).label.toLowerCase();
    if (e.split === 'select') return 'Shared equally between ' + (d.people || []).length + ' people';
    if (e.split === 'rooms') return (d.rooms || []).length + ' rooms, each split between the people in it';
    return 'Set amounts per person';
  }

  function validateExpense(input) {
    var errors = [];
    input = input || {};
    var e = {
      id: String(input.id || ''),
      name: String(input.name || '').trim().replace(/\s+/g, ' ').slice(0, 100),
      split: SPLITS.indexOf(input.split) === -1 ? '' : input.split,
      amount: pounds(pence(input.amount)),
      date: /^\d{4}-\d{2}-\d{2}$/.test(input.date || '') ? input.date : '',
      paidBy: String(input.paidBy || '').trim().slice(0, 80),
      notes: String(input.notes || '').trim().slice(0, 500),
      detail: {},
    };
    var d = parseDetail(input.detail);
    if (e.name.length < 2) errors.push('Give the expense a name, e.g. Hotel – Frankfurt.');
    if (!e.split) errors.push('Choose how to share it.');
    if (e.split === 'equal') {
      e.detail = { group: GROUPS[d.group] ? d.group : 'all' };
      if (!(e.amount > 0)) errors.push('Enter the amount.');
    } else if (e.split === 'select') {
      e.detail = { people: (d.people || []).map(String).filter(function (k, i, a) { return k && a.indexOf(k) === i; }) };
      if (!(e.amount > 0)) errors.push('Enter the amount.');
      if (!e.detail.people.length) errors.push('Tick the people who share this expense.');
    } else if (e.split === 'rooms') {
      var seen = {};
      e.detail = { rooms: (d.rooms || []).map(function (r, i) {
        var room = { label: String(r.label || 'Room ' + (i + 1)).trim().slice(0, 40), type: String(r.type || '').trim().slice(0, 30), cost: pounds(pence(r.cost)), people: (r.people || []).map(String) };
        if (!(room.cost > 0)) errors.push(room.label + ': enter the room cost.');
        if (!room.people.length) errors.push(room.label + ': add who is in the room.');
        room.people.forEach(function (k) { if (seen[k]) errors.push('Someone is in two rooms in this expense (' + room.label + ').'); seen[k] = true; });
        return room;
      }) };
      if (!e.detail.rooms.length) errors.push('Add at least one room.');
      e.amount = pounds(expenseTotal(e));
    } else if (e.split === 'custom') {
      var amounts = {};
      Object.keys(d.amounts || {}).forEach(function (k) { var p = pence(d.amounts[k]); if (p > 0) amounts[k] = pounds(p); });
      e.detail = { amounts: amounts };
      if (!Object.keys(amounts).length) errors.push('Enter an amount for at least one person.');
      e.amount = pounds(expenseTotal(e));
    }
    if (e.amount > 200000) errors.push('That amount looks too large. Check it.');
    return { errors: errors.filter(function (x, i, a) { return a.indexOf(x) === i; }), value: e };
  }

  /*
   * Everything money for one trip.
   * bookings: rows with ref, status, depositDue; people: rows with ref, n, fullName, role, bikeType;
   * payments: rows with ref, amount, status; expenses: rows with id, name, split, amount, detail; calls: rows with stage, perPerson.
   */
  function balances(trip, bookings, people, payments, expenses, calls) {
    var charityP = pence(trip.charityFee);
    var live = {};
    bookings.forEach(function (b) { if (b.status === 'Booked') live[b.ref] = b; });
    var active = people.filter(function (p) { return live[p.ref]; }).map(function (p) {
      return { key: personKey(p.ref, p.n), ref: p.ref, n: Number(p.n), name: p.fullName, role: p.role, bikeType: p.bikeType };
    });
    var person = {};
    active.forEach(function (p) { person[p.key] = { key: p.key, ref: p.ref, n: p.n, name: p.name, role: p.role, lines: [], total: 0 }; });

    var expenseRows = expenses.map(function (e) {
      var s = shares(e, active);
      Object.keys(s.shares).forEach(function (k) {
        person[k].lines.push({ expenseId: e.id, name: e.name, amount: pounds(s.shares[k]) });
        person[k].total += s.shares[k];
      });
      return { id: e.id, name: e.name, total: pounds(s.total), unallocated: pounds(s.unallocated), people: Object.keys(s.shares).length, describe: describe(e, active) };
    });
    Object.keys(person).forEach(function (k) {
      var p = person[k];
      if (charityP > 0 && p.role === 'Rider') { p.lines.push({ expenseId: 'charity', name: 'Charity fee', amount: pounds(charityP) }); p.total += charityP; }
    });

    var interimPerPerson = calls.filter(function (c) { return c.stage === 'Interim'; }).reduce(function (a, c) { return a + pence(c.perPerson); }, 0);
    var finalCalled = calls.some(function (c) { return c.stage === 'Final'; });

    var rows = bookings.map(function (b) {
      var mine = active.filter(function (p) { return p.ref === b.ref; }).map(function (p) { return person[p.key]; });
      var cost = mine.reduce(function (a, p) { return a + p.total; }, 0);
      var confirmed = 0, claimed = 0;
      payments.forEach(function (x) {
        if (x.ref !== b.ref) return;
        if (x.status === 'Confirmed') confirmed += pence(x.amount); else if (x.status === 'Claimed') claimed += pence(x.amount);
      });
      var paying = mine.filter(function (p) { return p.role !== 'Support crew'; }).length;
      var dueSoFar = b.status !== 'Booked' ? 0 : finalCalled ? cost : pence(b.depositDue) + interimPerPerson * paying;
      return {
        ref: b.ref, status: b.status, people: mine.map(function (p) { return { key: p.key, n: p.n, name: p.name, role: p.role, total: pounds(p.total), lines: p.lines }; }),
        cost: pounds(cost), confirmed: pounds(confirmed), claimed: pounds(claimed), dueSoFar: pounds(dueSoFar),
        owesNow: pounds(Math.max(0, dueSoFar - confirmed)), balance: pounds(cost - confirmed),
      };
    });

    var sum = function (list, f) { return pounds(list.reduce(function (a, x) { return a + pence(f(x)); }, 0)); };
    var bookedRows = rows.filter(function (r) { return r.status === 'Booked'; });
    return {
      bookings: rows,
      expenses: expenseRows,
      finalCalled: finalCalled,
      interimPerPerson: pounds(interimPerPerson),
      totals: {
        expenses: sum(expenseRows, function (e) { return e.total; }),
        unallocated: sum(expenseRows, function (e) { return e.unallocated; }),
        charity: pounds(active.filter(function (p) { return p.role === 'Rider'; }).length * charityP),
        cost: sum(bookedRows, function (r) { return r.cost; }),
        collected: sum(rows, function (r) { return r.confirmed; }),
        claimed: sum(rows, function (r) { return r.claimed; }),
        owesNow: sum(bookedRows, function (r) { return r.owesNow; }),
        people: active.length,
      },
    };
  }

  return {
    GROUPS: GROUPS, SPLITS: SPLITS, pence: pence, pounds: pounds, personKey: personKey, allocate: allocate, parseDetail: parseDetail,
    expenseTotal: expenseTotal, shares: shares, describe: describe, validateExpense: validateExpense, balances: balances,
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Money;
