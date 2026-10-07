/**
 * W/Rhinos trips backend (Google Apps Script, attached to a Google Sheet).
 *
 * The Sheet is the database: one tab each for Settings, Trips, Bookings, People and Payments.
 * The pages under wrhinos.com/trips talk to this script, deployed as a web app.
 * Setup steps are in backend/README.md. Pure helpers are tested by backend/test.js (node).
 */

const DEFAULT_SETTINGS = {
  clubName: 'W/Rhinos Cycling Club',
  contactEmail: '',
  siteUrl: 'https://wrhinos.com',
  bankAccountName: '',
  bankSortCode: '',
  bankAccountNumber: '',
  organiserPasscode: '',
};

const SETTING_DEFS = [
  { key: 'clubName', label: 'Club name', help: 'Shown in emails', required: true },
  { key: 'contactEmail', label: 'Contact email', help: 'Replies to trip emails go here', required: true, type: 'email' },
  { key: 'siteUrl', label: 'Website', help: 'https://wrhinos.com (used for the private booking links in emails)', required: true, type: 'url' },
  { key: 'bankAccountName', label: 'Bank account name', help: 'The club account, exactly as the bank shows it. Can wait until you ask for deposits', required: false },
  { key: 'bankSortCode', label: 'Bank sort code', help: '6 digits, e.g. 12-34-56. Can wait until you ask for deposits', required: false, type: 'sortcode' },
  { key: 'bankAccountNumber', label: 'Bank account number', help: '8 digits. Can wait until you ask for deposits', required: false, type: 'account' },
  { key: 'organiserPasscode', label: 'Organiser passcode', help: 'At least 10 characters. Opens the organiser page. Share only with trip organisers', required: true, type: 'passcode' },
];

// The first trip, created by setup. Its details are read from the website so there is one copy of the text.
const SEED_TRIP = {
  id: 'rhine-2027',
  name: 'Castles to Cathedrals: The Rhine Explorer Ride',
  status: 'Draft',
  datesText: 'Fri 28 May – Wed 2 June 2027',
  startDate: '2027-05-28',
  places: 50,
  depositPerPerson: 100,
  depositDays: 7,
  summary: 'Frankfurt to Düsseldorf along the Main and Rhine. Flat, family-friendly, riders aged 10 and up, e-bikes welcome.',
  detailsUrl: 'https://wrhinos.com/trips/content/rhine-2027.md',
  routes: 'Day 1: Frankfurt – St Goar | \nDay 2: St Goar – Bonn | \nDay 3: Bonn – Düsseldorf | ',
  organiser: 'Ram Sugavanam',
  charityFee: 50,
  depositAtSignup: 'No',
  bikeOptions: [
    'Hire a carbon road bike (about €100–180) | hire',
    'Hire a road e-bike (about €180–200) | hire',
    'Hire a hybrid bike | hire',
    'Hire a hybrid e-bike | hire',
    'Bring my own bike | own',
  ].join('\n'),
};

const TABLES = {
  Trips: [
    ['id', 'Trip ID'], ['name', 'Trip name'], ['status', 'Status'], ['datesText', 'Dates'], ['startDate', 'Start date'],
    ['places', 'Places'], ['depositPerPerson', 'Deposit per person (£)'], ['depositDays', 'Days to pay deposit'],
    ['summary', 'One-line summary'], ['details', 'Trip details'], ['routes', 'Route links'], ['organiser', 'Organiser'],
    ['createdAt', 'Created'], ['updatedAt', 'Updated'], ['charityFee', 'Charity fee per rider (£)'],
    ['depositAtSignup', 'Deposit at sign-up?'], ['bikeOptions', 'Bike options'],
  ],
  Expenses: [
    ['id', 'Expense ID'], ['tripId', 'Trip ID'], ['name', 'Expense'], ['split', 'How shared'], ['amount', 'Amount (£)'],
    ['detail', 'Split details (do not edit)'], ['date', 'Date'], ['paidBy', 'Paid by'], ['notes', 'Notes'],
    ['createdAt', 'Created'], ['updatedAt', 'Updated'],
  ],
  Calls: [
    ['id', 'Call ID'], ['tripId', 'Trip ID'], ['stage', 'Stage'], ['reason', 'Reason'], ['perPerson', 'Per person (£)'],
    ['dueDate', 'Due by'], ['createdAt', 'Called on'], ['emailed', 'Emails sent'],
  ],
  Bookings: [
    ['ref', 'Reference'], ['tripId', 'Trip ID'], ['status', 'Status'], ['bookedAt', 'Booked at'], ['leadName', 'Booked by'],
    ['email', 'Email'], ['mobile', 'Mobile'], ['address', 'Address'], ['postcode', 'Postcode'],
    ['emergencyName', 'Emergency contact'], ['emergencyRelation', 'Relationship'], ['emergencyMobile', 'Emergency mobile'],
    ['people', 'People'], ['depositDue', 'Deposit due (£)'], ['roomRequests', 'Room requests'], ['notes', 'Notes from booker'],
    ['organiserNotes', 'Organiser notes'], ['token', 'Link key (do not share)'], ['updatedAt', 'Updated'],
    ['roomType', 'Room preference'],
  ],
  People: [
    ['ref', 'Booking ref'], ['tripId', 'Trip ID'], ['n', 'No.'], ['fullName', 'Name as in passport'], ['dob', 'Date of birth'],
    ['role', 'Going as'], ['under18', 'Under 18'], ['responsibleAdult', 'Responsible adult'], ['mobile', 'Mobile'],
    ['dietary', 'Dietary needs'], ['bikeType', 'Bike type'], ['bikeMake', 'Bike make'], ['bikeColour', 'Bike colour'],
    ['bikeSerial', 'Bike serial'], ['passportNumber', 'Passport number'], ['passportCountry', 'Passport country'],
    ['passportExpiry', 'Passport expiry'], ['safetyInfo', 'Safety / health info'],
    ['bikeChoice', 'Bike choice'], ['bikeHire', 'Hiring a bike'], ['heightCm', 'Height (cm)'], ['insideLegCm', 'Inside leg (cm)'],
    ['frameSize', 'Usual frame size'], ['saddleHeightCm', 'Saddle height (cm)'], ['pedals', 'Pedals'],
  ],
  Payments: [
    ['id', 'Payment ID'], ['ref', 'Booking ref'], ['tripId', 'Trip ID'], ['stage', 'Stage'], ['amount', 'Amount (£)'],
    ['paidOn', 'Paid on'], ['status', 'Status'], ['source', 'Recorded by'], ['note', 'Note'], ['recordedAt', 'Recorded at'],
    ['confirmedAt', 'Confirmed at'],
  ],
};

const TRIP_STATUSES = ['Draft', 'Open', 'Closed'];
const BOOKING_STATUSES = ['Booked', 'Waiting list', 'Cancelled'];
const ROLES = ['Rider', 'Non-rider', 'Support crew'];
const BIKE_TYPES = ['Road', 'Hybrid', 'Gravel', 'Mountain', 'Road e-bike', 'Hybrid e-bike', 'Other', 'Not bringing a bike'];
const STAGES = ['Deposit', 'Interim', 'Final', 'Other'];
const ROOM_TYPES = ['Single room (supplement)', 'Twin share', 'Double'];
const PEDALS = ['Shimano SPD-SL', 'Look Kéo', 'Shimano SPD', 'Speedplay or Wahoo', 'None, flat pedals please'];
const DEFAULT_BIKE_OPTIONS = 'Bring my own bike | own';
const MAX_PEOPLE_PER_BOOKING = 8;

// Payment references are 5 letters shaped like a name (e.g. RAKIM): easy to say, read and type into a bank app.
const REF_CONSONANTS = 'BDGKLMNPRSTV';
const REF_VOWELS = 'AEIOU';
const REF_BLOCKED = ['PENIS', 'BONER', 'SEMEN', 'NIGER', 'PAKIS', 'KIKES', 'DAGOS', 'PUTAS', 'GONAD', 'TITUS',
  'DEBIT', 'TOTAL', 'LEGAL', 'LEVEL', 'MODEL', 'METAL', 'TIMES', 'RATES', 'SALES', 'DATES', 'TAXES', 'BASIS',
  'SAVER', 'BONUS', 'SUPER', 'MOTOR', 'LOGIN', 'RIDER', 'BIKES'];

// ---------- pure helpers (tested in test.js) ----------

function round2_(n) { return Math.round(n * 100) / 100; }
function money_(n) { n = round2_(Number(n) || 0); return '£' + (Number.isInteger(n) ? n : n.toFixed(2)); }
function clean_(v, max) { return String(v === undefined || v === null ? '' : v).trim().replace(/\s+/g, ' ').slice(0, max || 200); }
function cleanMulti_(v, max) { return String(v === undefined || v === null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, max || 2000); }
function safeCell_(s) { s = String(s); return /^[=+\-@]/.test(s) ? "'" + s : s; }
function isEmail_(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

function normaliseMobile_(raw) {
  let d = String(raw || '').replace(/[^\d+]/g, '');
  if (d.indexOf('+44') === 0) d = '0' + d.slice(3);
  else if (d.indexOf('44') === 0 && d.length === 12) d = '0' + d.slice(2);
  return d;
}
function validMobile_(m) { const d = m.replace(/\D/g, ''); return d.length >= 10 && d.length <= 15; }

function isoDate_(v) {
  if (v instanceof Date && !isNaN(v)) {
    return v.getFullYear() + '-' + String(v.getMonth() + 1).padStart(2, '0') + '-' + String(v.getDate()).padStart(2, '0');
  }
  const s = String(v || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s ? s : '';
}

function ageOn_(dob, onDate) {
  const a = isoDate_(dob), b = isoDate_(onDate);
  if (!a || !b) return null;
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  let age = by - ay;
  if (bm < am || (bm === am && bd < ad)) age--;
  return age;
}

function slugify_(name, existing) {
  let base = String(name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '') || 'trip';
  let id = base, i = 2;
  while (existing[id]) id = base + '-' + (i++);
  return id;
}

function generateReference_(existing, rnd) {
  rnd = rnd || Math.random;
  const pick = function (chars) { return chars.charAt(Math.floor(rnd() * chars.length)); };
  for (let attempt = 0; attempt < 500; attempt++) {
    const ref = pick(REF_CONSONANTS) + pick(REF_VOWELS) + pick(REF_CONSONANTS) + pick(REF_VOWELS) + pick(REF_CONSONANTS);
    if (!existing[ref] && REF_BLOCKED.indexOf(ref) === -1) return ref;
  }
  throw new Error('Could not generate a unique reference');
}

function parseRoutes_(text) {
  return String(text || '').split('\n').map(function (line) {
    const i = line.lastIndexOf('|');
    const label = clean_(i === -1 ? line : line.slice(0, i), 120);
    const url = clean_(i === -1 ? '' : line.slice(i + 1), 500);
    return { label: label, url: /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : '' };
  }).filter(function (r) { return r.label; });
}

function placesTaken_(bookings, tripId) {
  return bookings.filter(function (b) { return b.tripId === tripId && b.status === 'Booked'; })
    .reduce(function (a, b) { return a + (Number(b.people) || 0); }, 0);
}

function depositFor_(people, perPerson) {
  return round2_(people.filter(function (p) { return p.role !== 'Support crew'; }).length * (Number(perPerson) || 0));
}

// Bike choices are set per trip, one per line: "Hire a road e-bike (about €180–200) | hire" or "Bring my own bike | own".
function parseBikeOptions_(text) {
  return String(text || DEFAULT_BIKE_OPTIONS).split('\n').map(function (line) {
    const i = line.lastIndexOf('|');
    const label = clean_(i === -1 ? line : line.slice(0, i), 120);
    const kind = clean_(i === -1 ? '' : line.slice(i + 1), 10).toLowerCase();
    return { label: label, hire: kind === 'hire' };
  }).filter(function (o) { return o.label; });
}

function yesNo_(v, dflt) {
  if (v === true || v === 'Yes' || v === 'yes') return 'Yes';
  if (v === false || v === 'No' || v === 'no') return 'No';
  return dflt;
}

function validateTrip_(input, existingIds) {
  const errors = [];
  input = input || {};
  const t = {
    id: clean_(input.id, 60),
    name: clean_(input.name, 120),
    status: TRIP_STATUSES.indexOf(input.status) === -1 ? 'Draft' : input.status,
    datesText: clean_(input.datesText, 120),
    startDate: isoDate_(input.startDate),
    places: Number(input.places),
    depositPerPerson: Number(input.depositPerPerson),
    depositDays: Number(input.depositDays),
    summary: clean_(input.summary, 300),
    details: cleanMulti_(input.details, 40000),
    routes: cleanMulti_(input.routes, 5000),
    organiser: clean_(input.organiser, 80),
    charityFee: input.charityFee === undefined || input.charityFee === '' ? 50 : Number(input.charityFee),
    depositAtSignup: yesNo_(input.depositAtSignup, 'No'),
    bikeOptions: cleanMulti_(input.bikeOptions, 2000),
  };
  if (t.name.length < 3) errors.push('Give the trip a name.');
  if (isNaN(t.charityFee) || t.charityFee < 0 || t.charityFee > 500) errors.push('The charity fee per rider must be from £0 to £500.');
  if (!t.datesText) errors.push('Enter the dates, e.g. Fri 28 May – Wed 2 June 2027.');
  if (!t.startDate) errors.push('Enter the first day of the trip (used to work out who is under 18).');
  if (!Number.isInteger(t.places) || t.places < 1 || t.places > 500) errors.push('Places must be a whole number from 1 to 500.');
  if (isNaN(t.depositPerPerson) || t.depositPerPerson < 0 || t.depositPerPerson > 5000) errors.push('Deposit per person must be from £0 to £5,000.');
  if (!Number.isInteger(t.depositDays) || t.depositDays < 1 || t.depositDays > 60) errors.push('Days to pay the deposit must be from 1 to 60.');
  if (t.bikeOptions && !parseBikeOptions_(t.bikeOptions).length) errors.push('Bike options: one per line, e.g. "Hire a hybrid bike | hire".');
  if (t.id && existingIds && !existingIds[t.id]) errors.push('That trip no longer exists. Reload the organiser page.');
  t.depositPerPerson = round2_(t.depositPerPerson || 0);
  t.charityFee = round2_(t.charityFee || 0);
  return { errors: errors, value: t };
}

// One person's answers. Sign-up asks only what the trip form asks; passports and own-bike details come later.
function validatePerson_(p, i, trip, isLead) {
  const errors = [];
  const who = isLead ? 'Your details' : 'Person ' + (i + 1);
  p = p || {};
  const options = parseBikeOptions_(trip.bikeOptions);
  const choice = options.filter(function (o) { return o.label === clean_(p.bikeChoice, 120); })[0];
  const v = {
    fullName: clean_(p.fullName, 100),
    dob: isoDate_(p.dob),
    role: ROLES.indexOf(p.role) === -1 ? 'Rider' : p.role,
    responsibleAdult: clean_(p.responsibleAdult, 100),
    mobile: normaliseMobile_(p.mobile),
    dietary: clean_(p.dietary, 200),
    bikeChoice: choice ? choice.label : '',
    bikeHire: choice ? (choice.hire ? 'Yes' : 'No') : '',
    heightCm: clean_(p.heightCm, 10),
    insideLegCm: clean_(p.insideLegCm, 10),
    frameSize: clean_(p.frameSize, 20),
    saddleHeightCm: clean_(p.saddleHeightCm, 10),
    pedals: PEDALS.indexOf(p.pedals) === -1 ? '' : p.pedals,
    bikeType: BIKE_TYPES.indexOf(p.bikeType) === -1 ? '' : p.bikeType,
    bikeMake: clean_(p.bikeMake, 60),
    bikeColour: clean_(p.bikeColour, 40),
    bikeSerial: clean_(p.bikeSerial, 60),
    passportNumber: clean_(p.passportNumber, 30).toUpperCase(),
    passportCountry: clean_(p.passportCountry, 60),
    passportExpiry: isoDate_(p.passportExpiry),
    safetyInfo: clean_(p.safetyInfo, 500),
  };
  if (v.fullName.length < 2) errors.push(who + ': enter the full name.');
  if (!v.dob) errors.push(who + ': enter a date of birth.');
  if (v.role === 'Rider' && !v.bikeChoice) errors.push(who + ': choose a bike option.');
  if (v.role === 'Non-rider') { v.bikeChoice = ''; v.bikeHire = ''; }
  if (v.bikeHire !== 'Yes') { v.heightCm = ''; v.insideLegCm = ''; v.frameSize = ''; v.saddleHeightCm = ''; v.pedals = ''; }
  const age = ageOn_(v.dob, trip.startDate);
  if (v.dob && (age === null || age < 0 || age > 110)) errors.push(who + ': check the date of birth.');
  v.under18 = age !== null && age < 18;
  if (v.under18 && v.role === 'Rider' && age < 10) errors.push(who + ': riders must be at least 10 on the first day of the trip.');
  if (v.under18 && v.responsibleAdult.length < 2) errors.push(who + ' is under 18: name the parent or authorised adult responsible for them on the trip.');
  if (isLead && v.under18) errors.push('The person registering must be 18 or over.');
  if (isLead && !validMobile_(v.mobile)) errors.push('Your details: enter a valid phone number.');
  if (!isLead && v.mobile && !validMobile_(v.mobile)) errors.push(who + ': check the phone number, or leave it empty.');
  if (v.passportExpiry && v.passportExpiry < trip.startDate) errors.push(who + ': the passport expires before the trip. Leave the passport fields empty and add a new one later.');
  if (!v.under18) v.responsibleAdult = '';
  return { errors: errors, value: v };
}

const AGREEMENTS = ['charter', 'deposit', 'insurance', 'members'];

function validateRegistration_(input, trip) {
  const errors = [];
  input = input || {};
  const lead = input.lead || {};
  const people = Array.isArray(input.people) ? input.people : [];
  const b = {
    email: clean_(lead.email, 120).toLowerCase(),
    address: cleanMulti_(lead.address, 300).replace(/\n+/g, ', '),
    postcode: clean_(lead.postcode, 12).toUpperCase(),
    emergencyName: clean_(lead.emergencyName, 100),
    emergencyRelation: clean_(lead.emergencyRelation, 60),
    emergencyMobile: normaliseMobile_(lead.emergencyMobile),
    roomType: ROOM_TYPES.indexOf(input.roomType) === -1 ? '' : input.roomType,
    roomRequests: clean_(input.roomRequests, 500),
    notes: clean_(input.notes, 1000),
  };
  if (!isEmail_(b.email)) errors.push('Enter a valid email address.');
  if (b.address.length < 5) errors.push('Enter your home address.');
  if (b.emergencyMobile && !validMobile_(b.emergencyMobile)) errors.push('Check the emergency contact number.');
  if (people.length < 1) errors.push('Add at least one person.');
  if (people.length > MAX_PEOPLE_PER_BOOKING) errors.push('One booking can have up to ' + MAX_PEOPLE_PER_BOOKING + ' people. Make a second booking for the rest.');

  const list = [];
  people.slice(0, MAX_PEOPLE_PER_BOOKING).forEach(function (p, i) {
    const r = validatePerson_(p, i, trip, i === 0);
    r.errors.forEach(function (e) { errors.push(e); });
    list.push(r.value);
  });
  if (list.length && b.emergencyMobile && list.some(function (p) { return p.mobile && p.mobile === b.emergencyMobile; })) {
    errors.push('Your emergency contact must be someone who is not coming on the trip.');
  }
  const names = {};
  list.forEach(function (p) {
    const k = p.fullName.toLowerCase();
    if (k && names[k]) errors.push(p.fullName + ' is in the booking twice.');
    names[k] = true;
  });
  list.forEach(function (p) {
    if (p.under18 && p.responsibleAdult && !list.some(function (q) { return !q.under18 && q.fullName.toLowerCase() === p.responsibleAdult.toLowerCase(); })) {
      // The responsible adult may be in another booking; that's allowed, the organiser checks it.
      p.responsibleAdultElsewhere = true;
    }
  });
  const agree = input.agree || {};
  if (AGREEMENTS.some(function (k) { return agree[k] !== true; })) errors.push('Please tick every box in the small print.');

  b.leadName = list.length ? list[0].fullName : '';
  b.mobile = list.length ? list[0].mobile : '';
  b.people = list.length;
  b.depositDue = depositFor_(list, trip.depositPerPerson);
  return { errors: errors.filter(function (e, i, a) { return a.indexOf(e) === i; }), booking: b, people: list };
}

// What a booking still needs to give us once deposits and details have been asked for.
function missingDetails_(people, booking) {
  const out = [];
  people.forEach(function (p) {
    const first = String(p.fullName);
    if (!p.passportNumber) out.push(first + ': passport details');
    if (p.role !== 'Non-rider' && p.bikeHire === 'No' && !p.bikeMake) out.push(first + ': bike make and colour');
    if (p.bikeHire === 'Yes' && !(p.heightCm && p.insideLegCm)) out.push(first + ': height and inside leg for the hire bike');
  });
  if (!booking.emergencyName || !booking.emergencyMobile) out.push('Emergency contact');
  return out;
}

function findDuplicate_(bookings, peopleByRef, tripId, b, people, nowMs) {
  const dayMs = 24 * 60 * 60 * 1000;
  const names = people.map(function (p) { return p.fullName.toLowerCase(); }).sort().join('|');
  for (let i = 0; i < bookings.length; i++) {
    const x = bookings[i];
    if (x.tripId !== tripId || x.status === 'Cancelled' || String(x.email).toLowerCase() !== b.email) continue;
    if (nowMs - new Date(x.bookedAt).getTime() > dayMs) continue;
    const xn = (peopleByRef[x.ref] || []).map(function (p) { return String(p.fullName).toLowerCase(); }).sort().join('|');
    if (xn === names) return x;
  }
  return null;
}

function paymentTotals_(payments, ref) {
  let confirmed = 0, claimed = 0;
  payments.forEach(function (p) {
    if (p.ref !== ref) return;
    if (p.status === 'Confirmed') confirmed += Number(p.amount) || 0;
    else if (p.status === 'Claimed') claimed += Number(p.amount) || 0;
  });
  return { confirmed: round2_(confirmed), claimed: round2_(claimed) };
}

function validateClaim_(input) {
  const errors = [];
  const amount = round2_(Number(String(input.amount || '').replace(/[£,\s]/g, '')));
  const stage = STAGES.indexOf(input.stage) === -1 ? '' : input.stage;
  const paidOn = isoDate_(input.paidOn);
  if (!(amount > 0) || amount > 20000) errors.push('Enter the amount you paid.');
  if (!stage) errors.push('Choose what the payment was for.');
  if (!paidOn) errors.push('Enter the date you paid.');
  return { errors: errors, value: { amount: amount, stage: stage, paidOn: paidOn, note: clean_(input.note, 300) } };
}

function bookingLink_(siteUrl, ref, token) {
  return String(siteUrl || '').replace(/\/+$/, '') + '/trips/booking/?r=' + ref + '&k=' + token;
}

function buildRegistrationEmail_(b, people, trip, cfg, link) {
  const waiting = b.status === 'Waiting list';
  const lines = [
    'Hello ' + people[0].fullName.split(' ')[0] + ',',
    '',
    waiting
      ? 'Thank you for registering for ' + trip.name + '. The trip is full at the moment, so your booking is on the WAITING LIST. We will email you if places come up. Please do not pay anything yet.'
      : 'Thank you for registering for ' + trip.name + ' (' + trip.datesText + '). Your places are held.',
    '',
    'YOUR BOOKING: ' + b.ref + ' (' + people.length + (people.length === 1 ? ' person' : ' people') + ')',
  ].concat(people.map(function (p) { return '  ' + p.fullName + ' - ' + p.role + (p.under18 ? ' (under 18)' : ''); }));
  if (!waiting && trip.depositAtSignup === 'No') {
    lines.push('', 'NOTHING TO PAY YET. Once the trip is confirmed we will ask for your deposit (' + money_(b.depositDue) + ') and the rest of the details we need, such as passports. We will post in the group and it will show on your booking page.');
  } else if (!waiting && b.depositDue > 0) {
    lines.push('', 'PLEASE PAY THE DEPOSIT WITHIN ' + trip.depositDays + ' DAYS, BY BANK TRANSFER',
      '  Amount:            ' + money_(b.depositDue),
      '  Account name:      ' + cfg.bankAccountName,
      '  Sort code:         ' + cfg.bankSortCode,
      '  Account number:    ' + cfg.bankAccountNumber,
      '  PAYMENT REFERENCE: ' + b.ref,
      '',
      'Use exactly this reference so we can find your payment. The deposit is non-refundable.',
      'Once you have paid, open your booking page and tap "I\'ve paid".');
  }
  lines.push('', 'YOUR BOOKING PAGE (keep this email):', link, '',
    'It shows what you have paid and what is due, and you can update your details there, for example passport or bike details you did not have to hand.',
    'Anyone with this link can see your booking, so please do not share it.', '',
    'Questions? Reply to this email.', '', cfg.clubName);
  return {
    subject: (waiting ? 'Waiting list: ' : 'Booking ' + b.ref + ': ') + trip.name,
    body: lines.join('\n'),
  };
}

function buildConfirmedEmail_(b, payment, trip, cfg, link) {
  return {
    subject: 'Payment received for ' + trip.name + ' (' + b.ref + ')',
    body: ['Hello ' + String(b.leadName).split(' ')[0] + ',', '',
      'We have received your ' + payment.stage.toLowerCase() + ' payment of ' + money_(payment.amount) + ' for ' + trip.name + '. Thank you!', '',
      'See everything you have paid on your booking page:', link, '', cfg.clubName].join('\n'),
  };
}

function buildPlaceOfferedEmail_(b, trip, cfg, link) {
  return {
    subject: 'A place has come up: ' + trip.name + ' (' + b.ref + ')',
    body: ['Hello ' + String(b.leadName).split(' ')[0] + ',', '',
      'Good news: places have come up on ' + trip.name + ' (' + trip.datesText + ') and your booking is now confirmed.', '',
      'PLEASE PAY THE DEPOSIT WITHIN ' + trip.depositDays + ' DAYS, BY BANK TRANSFER',
      '  Amount:            ' + money_(b.depositDue),
      '  Account name:      ' + cfg.bankAccountName,
      '  Sort code:         ' + cfg.bankSortCode,
      '  Account number:    ' + cfg.bankAccountNumber,
      '  PAYMENT REFERENCE: ' + b.ref, '',
      'Your booking page:', link, '',
      'If you can no longer come, please reply so we can offer the place to someone else.', '', cfg.clubName].join('\n'),
  };
}

function payLines_(amount, ref, cfg) {
  return ['  Amount:            ' + money_(amount),
    '  Account name:      ' + cfg.bankAccountName,
    '  Sort code:         ' + cfg.bankSortCode,
    '  Account number:    ' + cfg.bankAccountNumber,
    '  PAYMENT REFERENCE: ' + ref];
}

// Sent to each booking that owes money when the organiser calls an interim payment or the final balance.
function buildCallEmail_(b, row, call, trip, cfg, link) {
  const final = call.stage === 'Final';
  const lines = ['Hello ' + String(b.leadName).split(' ')[0] + ',', ''];
  if (call.stage === 'Deposit') {
    lines.push('Good news: ' + trip.name + ' is confirmed! To keep your place, please pay your deposit and add the rest of your details',
      '(passports, and bike details if you are bringing your own) on your booking page.', '',
      'The deposit is non-refundable.');
  } else if (final) {
    lines.push('Thank you for riding ' + trip.name + '. All the costs are now in, and your final balance is ready.', '',
      'Total cost for your booking: ' + money_(row.cost), 'Already paid: ' + money_(row.confirmed));
  } else {
    lines.push('An interim payment is now due for ' + trip.name + '.', '', 'Why: ' + call.reason, money_(call.perPerson) + ' per person.');
  }
  lines.push('', 'PLEASE PAY ' + money_(row.owesNow) + (call.dueDate ? ' BY ' + call.dueDate : '') + ', BY BANK TRANSFER');
  return {
    subject: (call.stage === 'Deposit' ? 'Trip confirmed, deposit due: ' : final ? 'Final balance: ' : 'Payment due: ') + trip.name + ' (' + b.ref + ')',
    body: lines.concat(payLines_(row.owesNow, b.ref, cfg), ['',
      'Your booking page shows exactly what each cost was and your share of it:', link, '',
      'Once you have paid, tap "I\'ve paid" on that page.', '', cfg.clubName]).join('\n'),
  };
}

function buildReminderEmail_(b, row, trip, cfg, link) {
  return {
    subject: 'Reminder: payment due for ' + trip.name + ' (' + b.ref + ')',
    body: ['Hello ' + String(b.leadName).split(' ')[0] + ',', '',
      'A friendly reminder that ' + money_(row.owesNow) + ' is due for your booking on ' + trip.name + '.', '']
      .concat(payLines_(row.owesNow, b.ref, cfg), ['',
        'If you have already paid, tap "I\'ve paid" on your booking page so we can match it:', link, '',
        'Any questions, just reply to this email.', '', cfg.clubName]).join('\n'),
  };
}

function buildLinksEmail_(list, cfg) {
  return {
    subject: 'Your W/Rhinos booking link' + (list.length > 1 ? 's' : ''),
    body: ['Hello,', '', 'Here ' + (list.length > 1 ? 'are your booking links' : 'is your booking link') + ', as requested:', '']
      .concat(list.map(function (x) { return x.trip + ' (' + x.ref + ')\n' + x.link + '\n'; }), [
        'Keep this email so you can find your booking again. Anyone with the link can see your booking, so please do not share it.', '',
        'If you did not ask for this, you can ignore this email.', '', cfg.clubName]).join('\n'),
  };
}

// Bank details are only needed once money is asked for, so sign-ups can open before the club account exists.
function parseSettings_(vals) {
  const problems = [];
  const bankProblems = [];
  const cfg = {};
  SETTING_DEFS.forEach(function (d) {
    let v = String(vals[d.key] === undefined || vals[d.key] === null ? '' : vals[d.key]).trim();
    if (d.required && !v) problems.push('"' + d.label + '" is empty.');
    if (v && d.type === 'email' && !isEmail_(v)) problems.push('"' + d.label + '" is not a valid email address.');
    if (v && d.type === 'url' && !/^https:\/\/[^\s"'<>]+$/i.test(v)) problems.push('"' + d.label + '" must start with https://');
    if (v && d.type === 'sortcode') {
      const digits = v.replace(/\D/g, '');
      if (digits.length !== 6) bankProblems.push('"' + d.label + '" must have 6 digits.');
      else v = digits.slice(0, 2) + '-' + digits.slice(2, 4) + '-' + digits.slice(4);
    }
    if (v && d.type === 'account') {
      const digits = v.replace(/\D/g, '');
      if (digits.length !== 8) bankProblems.push('"' + d.label + '" must have 8 digits.');
      else v = digits;
    }
    if (v && d.type === 'passcode' && v.length < 10) problems.push('"' + d.label + '" must be at least 10 characters.');
    cfg[d.key] = v;
  });
  if (/^0+(-0+)*$/.test(cfg.bankSortCode || '') || /^0+$/.test(cfg.bankAccountNumber || '')) {
    bankProblems.push('The bank details are example ones (zeros). Enter the club account details.');
  }
  if (!cfg.bankAccountName || !cfg.bankSortCode || !cfg.bankAccountNumber) {
    bankProblems.push('The club bank details are not filled in yet. Sign-ups can open; add them before asking for deposits.');
  }
  cfg.problems = problems;
  cfg.bankProblems = bankProblems;
  cfg.bankReady = !bankProblems.length;
  return cfg;
}

// ---------- sheet access ----------

let SETTINGS = null;

function ss_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('This script is not attached to a Google Sheet. Open your Sheet, choose Extensions > Apps Script and paste the code there.');
  return ss;
}

function schema_(name) {
  const cols = TABLES[name];
  const idx = {};
  cols.forEach(function (c, i) { idx[c[0]] = i + 1; });
  return { keys: cols.map(function (c) { return c[0]; }), headers: cols.map(function (c) { return c[1]; }), idx: idx };
}

function sheet_(name) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  const S = schema_(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, S.headers.length).setValues([S.headers]).setFontWeight('bold').setBackground('#161616').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(2, 1, sh.getMaxRows() - 1, S.headers.length).setNumberFormat('@');
  } else if (sh.getLastColumn() < S.headers.length) {
    // A newer version of this script added columns at the end: add their headings, keep everything else.
    const from = sh.getLastColumn() + 1;
    sh.getRange(1, from, 1, S.headers.length - from + 1).setValues([S.headers.slice(from - 1)])
      .setFontWeight('bold').setBackground('#161616').setFontColor('#ffffff');
    sh.getRange(2, from, sh.getMaxRows() - 1, S.headers.length - from + 1).setNumberFormat('@');
  }
  return sh;
}

// Everything money for one trip, worked out by Money.gs (the same code the website uses).
function tripMoney_(trip) {
  const id = trip.id;
  const of = function (name) { return readTable_(name).filter(function (x) { return x.tripId === id; }); };
  const bookings = of('Bookings'), people = of('People'), payments = of('Payments'), expenses = of('Expenses'), calls = of('Calls');
  const t = { charityFee: trip.charityFee === '' || trip.charityFee === undefined ? 50 : Number(trip.charityFee), depositAtSignup: trip.depositAtSignup === 'Yes' ? 'Yes' : 'No' };
  return { bookings: bookings, people: people, payments: payments, expenses: expenses, calls: calls,
    result: Money.balances(t, bookings, people, payments, expenses, calls) };
}

function readTable_(name) {
  const sh = sheet_(name);
  const S = schema_(name);
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, S.keys.length).getValues().map(function (r, i) {
    const o = { _row: i + 2 };
    S.keys.forEach(function (k, j) { o[k] = r[j] instanceof Date ? r[j].toISOString() : String(r[j]); });
    return o;
  }).filter(function (o) { return o[S.keys[0]]; });
}

function rowFrom_(name, obj) {
  return schema_(name).keys.map(function (k) {
    const v = obj[k] === undefined || obj[k] === null ? '' : obj[k];
    return typeof v === 'string' ? safeCell_(v) : String(v);
  });
}

function appendRows_(name, objs) {
  if (!objs.length) return;
  const sh = sheet_(name);
  const rows = objs.map(function (o) { return rowFrom_(name, o); });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setNumberFormat('@').setValues(rows);
}

function updateRow_(name, row, obj) {
  sheet_(name).getRange(row, 1, 1, schema_(name).keys.length).setNumberFormat('@').setValues([rowFrom_(name, obj)]);
}

function deleteRows_(name, rows) {
  const sh = sheet_(name);
  rows.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
}

function readSettings_() {
  const sh = ss_().getSheetByName('Settings');
  if (!sh) return parseSettings_({});
  const vals = {};
  const rows = sh.getRange(2, 1, SETTING_DEFS.length, 2).getValues();
  SETTING_DEFS.forEach(function (d, i) { vals[d.key] = rows[i][1]; });
  return parseSettings_(vals);
}

function settings_() { if (!SETTINGS) SETTINGS = readSettings_(); return SETTINGS; }

function tripById_(id) {
  return readTable_('Trips').filter(function (t) { return t.id === id; })[0] || null;
}

function publicTrip_(t, bookings) {
  const left = Math.max(0, Number(t.places) - placesTaken_(bookings, t.id));
  return {
    id: t.id, name: t.name, status: t.status, datesText: t.datesText, startDate: t.startDate,
    places: Number(t.places), placesLeft: left, depositPerPerson: Number(t.depositPerPerson), depositDays: Number(t.depositDays),
    summary: t.summary, details: t.details, routes: parseRoutes_(t.routes), organiser: t.organiser,
    charityFee: t.charityFee === '' || t.charityFee === undefined ? 50 : Number(t.charityFee),
    depositAtSignup: t.depositAtSignup === 'Yes' ? 'Yes' : 'No', bikeOptionsText: t.bikeOptions || '',
    bikeOptions: parseBikeOptions_(t.bikeOptions), roomTypes: ROOM_TYPES, pedals: PEDALS,
    waiting: bookings.filter(function (b) { return b.tripId === t.id && b.status === 'Waiting list'; }).length,
  };
}

// ---------- web endpoints ----------

function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'trips') {
      const bookings = readTable_('Bookings');
      const trips = readTable_('Trips').filter(function (t) { return t.status !== 'Draft'; })
        .map(function (t) { const x = publicTrip_(t, bookings); delete x.details; return x; });
      return json_({ ok: true, trips: trips, club: settings_().clubName });
    }
    if (p.action === 'trip') {
      const t = tripById_(String(p.id || ''));
      if (!t || t.status === 'Draft') return json_({ ok: false, error: 'This trip is not open yet, or the link is wrong.' });
      return json_({ ok: true, trip: publicTrip_(t, readTable_('Bookings')), ready: !settings_().problems.length });
    }
    return json_({ ok: true, service: 'W/Rhinos trips' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'The trips system is not available right now. Please try again in a minute.' });
  }
}

function doPost(e) {
  let body = {};
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'Bad request.' }); }
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
    switch (body.action) {
      case 'register': return json_(register_(body));
      case 'booking': return json_(getBooking_(body));
      case 'claim': return json_(claimPayment_(body));
      case 'update': return json_(updateBooking_(body));
      case 'resend': return json_(resendLinks_(body));
      case 'admin': return json_(admin_(body));
      default: return json_({ ok: false, error: 'Unknown request.' });
    }
  } catch (err) {
    console.error(err);
    const email = settings_().contactEmail;
    return json_({ ok: false, error: 'Sorry, something went wrong. Please try again' + (email ? ', or email ' + email : '') + '.' });
  } finally {
    try { lock.releaseLock(); } catch (x) { /* not locked */ }
  }
}

// Gmail allows about 100 script emails a day. Each send can say how many it needs to leave spare, so that a flood of
// sign-ups can't use up the allowance that organiser emails and warnings need.
function sendMail_(to, mail, keepSpare) {
  const cfg = settings_();
  try {
    if (MailApp.getRemainingDailyQuota() <= (keepSpare || 0)) { console.error('Daily email allowance nearly used up; not sent: ' + mail.subject); return false; }
    MailApp.sendEmail({ to: to, subject: mail.subject, body: mail.body, replyTo: cfg.contactEmail, name: cfg.clubName });
    return true;
  } catch (err) { console.error(err); return false; }
}

// ---------- flood protection ----------
const SIGNUP_LIMIT = 15;            // new bookings allowed in any 10-minute window
const SIGNUP_WINDOW_SECONDS = 600;
const RESEND_LIMIT_PER_HOUR = 30;   // "Lost your link?" emails across everyone
const EMAIL_SPARE_FOR_SIGNUPS = 15; // sign-up emails stop when fewer than this many are left today

// Counts events in a fixed time window, shared by every visitor. Returns true while under the limit.
function underLimit_(name, limit, windowSeconds) {
  const cache = CacheService.getScriptCache();
  const key = name + ':' + Math.floor(Date.now() / (windowSeconds * 1000));
  return Number(cache.get(key) || 0) < limit;
}
function countEvent_(name, windowSeconds) {
  const cache = CacheService.getScriptCache();
  const key = name + ':' + Math.floor(Date.now() / (windowSeconds * 1000));
  cache.put(key, String(Number(cache.get(key) || 0) + 1), windowSeconds + 60);
}

// The first time a limit is hit in an hour, tell the organisers so they can check the bookings for fakes.
function warnOrganisers_(what) {
  const cache = CacheService.getScriptCache();
  if (cache.get('warned:' + what)) return;
  cache.put('warned:' + what, '1', 3600);
  const cfg = settings_();
  if (!cfg.contactEmail) return;
  sendMail_(cfg.contactEmail, {
    subject: 'W/Rhinos trips: unusual activity (' + what + ')',
    body: ['The trips booking system has just hit its safety limit: ' + what + '.', '',
      'This can be real (a very popular trip) or someone trying to flood the sign-ups.',
      'Please look at the latest bookings on the organiser page (wrhinos.com/organiser) and cancel any that look fake.', '',
      'The limit resets by itself within a few minutes. Nothing else needs doing.'].join('\n'),
  });
}

// An email can hold one live booking per trip; the family goes in that one booking.
function existingForEmail_(bookings, tripId, email) {
  return bookings.filter(function (x) { return x.tripId === tripId && x.status !== 'Cancelled' && String(x.email).toLowerCase() === email; })[0] || null;
}

function register_(input) {
  if (input.website) return { ok: false, error: 'Rejected.' };
  const cfg = settings_();
  if (cfg.problems.length) { console.error(cfg.problems.join(' ')); return { ok: false, error: 'Registration is not open yet. Please check back soon.' }; }
  const trip = tripById_(String(input.tripId || ''));
  if (!trip || trip.status !== 'Open') return { ok: false, error: 'Registration for this trip is not open.' };
  if (trip.depositAtSignup === 'Yes' && !cfg.bankReady) { console.error(cfg.bankProblems.join(' ')); return { ok: false, error: 'Registration is not open yet. Please check back soon.' }; }

  const v = validateRegistration_(input, trip);
  if (v.errors.length) return { ok: false, error: v.errors.join(' '), errors: v.errors };

  const bookings = readTable_('Bookings');
  const peopleByRef = {};
  readTable_('People').forEach(function (p) { (peopleByRef[p.ref] = peopleByRef[p.ref] || []).push(p); });
  const dup = findDuplicate_(bookings, peopleByRef, trip.id, v.booking, v.people, Date.now());
  if (dup) {
    return { ok: true, duplicate: true, ref: dup.ref, status: dup.status, link: bookingLink_(cfg.siteUrl, dup.ref, dup.token), depositDue: Number(dup.depositDue),
      depositDays: Number(trip.depositDays), depositAtSignup: trip.depositAtSignup === 'Yes' ? 'Yes' : 'No', bank: bank_(cfg), email: dup.email };
  }

  const same = existingForEmail_(bookings, trip.id, v.booking.email);
  if (same) {
    return { ok: false, alreadyRegistered: true, error: 'This email address already has a booking for this trip (reference ' + same.ref + '). ' +
      'To change it, open your booking link from the confirmation email. Lost it? Use "Lost your booking link?" on wrhinos.com/trips. ' +
      'To add someone to your booking, ask the organiser.' };
  }

  if (!underLimit_('signups', SIGNUP_LIMIT, SIGNUP_WINDOW_SECONDS)) {
    warnOrganisers_('more than ' + SIGNUP_LIMIT + ' sign-ups in 10 minutes');
    return { ok: false, busy: true, error: 'Lots of people are signing up right now. Please wait a few minutes and press Register again. Your details are still filled in.' };
  }

  const left = Number(trip.places) - placesTaken_(bookings, trip.id);
  const b = v.booking;
  b.status = v.people.length <= left ? 'Booked' : 'Waiting list';
  if (input.acceptWaitingList !== true && b.status === 'Waiting list') {
    return { ok: false, full: true, placesLeft: Math.max(0, left), error: left > 0
      ? 'Only ' + left + (left === 1 ? ' place is' : ' places are') + ' left and your booking needs ' + v.people.length + '.'
      : 'The trip is full.' };
  }
  const existing = {};
  bookings.forEach(function (x) { existing[x.ref] = true; });
  b.ref = generateReference_(existing);
  b.token = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
  b.tripId = trip.id;
  b.bookedAt = new Date().toISOString();
  b.updatedAt = b.bookedAt;
  b.organiserNotes = v.people.some(function (p) { return p.responsibleAdultElsewhere; }) ? 'CHECK: a responsible adult is not in this booking' : '';

  appendRows_('Bookings', [b]);
  countEvent_('signups', SIGNUP_WINDOW_SECONDS);
  appendRows_('People', v.people.map(function (p, i) {
    const row = Object.assign({}, p, { ref: b.ref, tripId: trip.id, n: i + 1, under18: p.under18 ? 'Yes' : 'No' });
    delete row.responsibleAdultElsewhere;
    return row;
  }));

  const link = bookingLink_(cfg.siteUrl, b.ref, b.token);
  const sent = sendMail_(b.email, buildRegistrationEmail_(b, v.people, trip, cfg, link), EMAIL_SPARE_FOR_SIGNUPS);
  if (!sent) warnOrganisers_('the daily email allowance is nearly used up, so confirmation emails are paused until tomorrow');
  return { ok: true, ref: b.ref, status: b.status, link: link, depositDue: b.depositDue, depositDays: Number(trip.depositDays),
    depositAtSignup: trip.depositAtSignup === 'Yes' ? 'Yes' : 'No', bank: bank_(cfg), emailSent: sent, email: b.email };
}

function bank_(cfg) { return { accountName: cfg.bankAccountName, sortCode: cfg.bankSortCode, accountNumber: cfg.bankAccountNumber }; }

function authBooking_(input) {
  const ref = String(input.ref || '').toUpperCase();
  const token = String(input.token || '');
  if (!/^[A-Z]{5}$/.test(ref) || !/^[a-f0-9]{20}$/.test(token)) return null;
  const b = readTable_('Bookings').filter(function (x) { return x.ref === ref; })[0];
  return b && b.token === token ? b : null;
}

function bookingView_(b) {
  const cfg = settings_();
  const trip = tripById_(b.tripId);
  const people = readTable_('People').filter(function (p) { return p.ref === b.ref; })
    .sort(function (x, y) { return Number(x.n) - Number(y.n); })
    .map(function (p) { const o = Object.assign({}, p); delete o._row; return o; });
  const payments = readTable_('Payments').filter(function (p) { return p.ref === b.ref && p.status !== 'Rejected'; })
    .map(function (p) { return { id: p.id, stage: p.stage, amount: Number(p.amount), paidOn: p.paidOn, status: p.status }; });
  const totals = paymentTotals_(payments, b.ref);
  const booking = {};
  ['ref', 'tripId', 'status', 'bookedAt', 'leadName', 'email', 'mobile', 'address', 'postcode', 'emergencyName',
    'emergencyRelation', 'emergencyMobile', 'people', 'depositDue', 'roomType', 'roomRequests', 'notes'].forEach(function (k) { booking[k] = b[k]; });
  booking.people = Number(b.people);
  booking.depositDue = Number(b.depositDue);
  let money = null;
  if (trip) {
    const m = tripMoney_(trip);
    const row = m.result.bookings.filter(function (x) { return x.ref === b.ref; })[0];
    money = {
      row: row, finalCalled: m.result.finalCalled, depositAsked: m.result.depositAsked, missing: missingDetails_(people, b), charityFee: Number(trip.charityFee === '' ? 50 : trip.charityFee),
      calls: m.calls.map(function (c) { return { stage: c.stage, reason: c.reason, perPerson: Number(c.perPerson) || 0, dueDate: c.dueDate, createdAt: c.createdAt }; }),
      expenses: m.result.expenses.map(function (e) { return { id: e.id, name: e.name, total: e.total, describe: e.describe }; }),
    };
  }
  return {
    ok: true, booking: booking, people: people, payments: payments, totals: totals, bank: bank_(cfg), money: money,
    trip: trip ? { id: trip.id, name: trip.name, datesText: trip.datesText, startDate: trip.startDate, depositDays: Number(trip.depositDays), status: trip.status, routes: parseRoutes_(trip.routes),
      depositAtSignup: trip.depositAtSignup === 'Yes' ? 'Yes' : 'No', bikeOptions: parseBikeOptions_(trip.bikeOptions), roomTypes: ROOM_TYPES, pedals: PEDALS } : null,
  };
}

function getBooking_(input) {
  const b = authBooking_(input);
  return b ? bookingView_(b) : { ok: false, error: 'This booking link is not recognised. Check you copied the whole link from your email.' };
}

function claimPayment_(input) {
  const b = authBooking_(input);
  if (!b) return { ok: false, error: 'This booking link is not recognised.' };
  if (b.status !== 'Booked') return { ok: false, error: 'Please wait until your place is confirmed before paying.' };
  const v = validateClaim_(input);
  if (v.errors.length) return { ok: false, error: v.errors.join(' ') };
  appendRows_('Payments', [Object.assign({ id: Utilities.getUuid().slice(0, 8), ref: b.ref, tripId: b.tripId, status: 'Claimed', source: 'Rider', recordedAt: new Date().toISOString() }, v.value)]);
  return bookingView_(b);
}

function updateBooking_(input) {
  const b = authBooking_(input);
  if (!b) return { ok: false, error: 'This booking link is not recognised.' };
  const trip = tripById_(b.tripId);
  const existing = readTable_('People').filter(function (p) { return p.ref === b.ref; }).sort(function (x, y) { return Number(x.n) - Number(y.n); });
  const people = Array.isArray(input.people) ? input.people : [];
  if (people.length !== existing.length) return { ok: false, error: 'To add or remove people, please contact the organiser.' };
  const v = validateRegistration_({
    lead: input.lead, people: people, roomRequests: input.roomRequests, notes: input.notes,
    roomType: input.roomType,
    agree: { charter: true, deposit: true, insurance: true, members: true },
  }, trip);
  if (v.errors.length) return { ok: false, error: v.errors.join(' '), errors: v.errors };
  const nb = Object.assign({}, b, v.booking, { leadName: v.booking.leadName, depositDue: b.depositDue, people: b.people, updatedAt: new Date().toISOString() });
  updateRow_('Bookings', b._row, nb);
  existing.forEach(function (row, i) {
    const p = Object.assign({}, v.people[i], { ref: b.ref, tripId: b.tripId, n: i + 1, under18: v.people[i].under18 ? 'Yes' : 'No' });
    delete p.responsibleAdultElsewhere;
    updateRow_('People', row._row, p);
  });
  return bookingView_(Object.assign(nb, { _row: b._row }));
}

// "Lost your link?": email every booking link for that address. The reply never says whether the address is booked,
// and each address can ask once every 10 minutes, so it can't be used to find out who is going or to spam someone.
function resendLinks_(input) {
  const email = clean_(input.email, 120).toLowerCase();
  const done = { ok: true, message: 'If that email has a booking, we have sent the link to it. Check your inbox (and spam folder) in a few minutes.' };
  if (!isEmail_(email) || input.website) return { ok: false, error: 'Enter the email address you registered with.' };
  const cache = CacheService.getScriptCache();
  const key = 'resend:' + email;
  if (cache.get(key)) return done;
  cache.put(key, '1', 600);
  if (!underLimit_('resends', RESEND_LIMIT_PER_HOUR, 3600)) {
    warnOrganisers_('more than ' + RESEND_LIMIT_PER_HOUR + ' "Lost your link" requests in an hour');
    return done;
  }
  countEvent_('resends', 3600);
  const cfg = settings_();
  const trips = {};
  readTable_('Trips').forEach(function (t) { trips[t.id] = t; });
  const list = readTable_('Bookings').filter(function (b) { return String(b.email).toLowerCase() === email && b.status !== 'Cancelled'; })
    .map(function (b) { return { ref: b.ref, trip: trips[b.tripId] ? trips[b.tripId].name : 'Trip', link: bookingLink_(cfg.siteUrl, b.ref, b.token) }; });
  if (list.length) sendMail_(email, buildLinksEmail_(list, cfg), EMAIL_SPARE_FOR_SIGNUPS);
  return done;
}

// ---------- organiser ----------

function checkPasscode_(pass) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('adminFails') || 0);
  if (fails >= 8) return 'Too many wrong passcodes. Wait 15 minutes and try again.';
  const real = settings_().organiserPasscode;
  if (!real || real.length < 10) return 'Set an organiser passcode (10+ characters) in the Settings tab first.';
  if (String(pass || '') !== real) { cache.put('adminFails', String(fails + 1), 900); return 'Wrong passcode.'; }
  return '';
}

function admin_(input) {
  const err = checkPasscode_(input.pass);
  if (err) return { ok: false, error: err, auth: false };
  const cfg = settings_();
  switch (input.op) {
    case 'login': return { ok: true, problems: cfg.problems, bankProblems: cfg.bankProblems };
    case 'trips': {
      const bookings = readTable_('Bookings');
      const payments = readTable_('Payments');
      const calls = readTable_('Calls');
      return {
        ok: true, problems: cfg.problems, bankProblems: cfg.bankProblems,
        trips: readTable_('Trips').map(function (t) {
          const x = publicTrip_(t, bookings);
          x.routesText = t.routes;
          x.claimed = payments.filter(function (p) { return p.tripId === t.id && p.status === 'Claimed'; }).length;
          x.depositAsked = t.depositAtSignup === 'Yes' || calls.some(function (c) { return c.tripId === t.id && c.stage === 'Deposit'; });
          return x;
        }),
      };
    }
    case 'saveTrip': {
      const trips = readTable_('Trips');
      const ids = {};
      trips.forEach(function (t) { ids[t.id] = t; });
      const v = validateTrip_(input.trip, input.trip && input.trip.id ? ids : null);
      if (v.errors.length) return { ok: false, error: v.errors.join(' ') };
      const t = v.value;
      const now = new Date().toISOString();
      if (t.id) {
        const old = ids[t.id];
        const taken = placesTaken_(readTable_('Bookings'), t.id);
        if (t.places < taken) return { ok: false, error: taken + ' places are already booked, so places cannot go below ' + taken + '.' };
        updateRow_('Trips', old._row, Object.assign({}, old, t, { createdAt: old.createdAt, updatedAt: now }));
      } else {
        t.id = slugify_(t.name + ' ' + t.startDate.slice(0, 4), ids);
        appendRows_('Trips', [Object.assign(t, { createdAt: now, updatedAt: now })]);
      }
      return { ok: true, id: t.id };
    }
    case 'bookings': {
      const tripId = String(input.tripId || '');
      const people = readTable_('People').filter(function (p) { return p.tripId === tripId; });
      const payments = readTable_('Payments').filter(function (p) { return p.tripId === tripId; });
      const bookings = readTable_('Bookings').filter(function (b) { return b.tripId === tripId; }).map(function (b) {
        const o = Object.assign({}, b);
        delete o._row;
        o.link = bookingLink_(cfg.siteUrl, b.ref, b.token);
        delete o.token;
        o.people = Number(b.people);
        o.depositDue = Number(b.depositDue);
        o.totals = paymentTotals_(payments, b.ref);
        o.persons = people.filter(function (p) { return p.ref === b.ref; }).sort(function (x, y) { return Number(x.n) - Number(y.n); })
          .map(function (p) { const q = Object.assign({}, p); delete q._row; return q; });
        o.payments = payments.filter(function (p) { return p.ref === b.ref; }).map(function (p) { const q = Object.assign({}, p); delete q._row; return q; });
        return o;
      });
      return { ok: true, bookings: bookings };
    }
    case 'payment': {
      const pay = readTable_('Payments').filter(function (p) { return p.id === input.id; })[0];
      if (!pay) return { ok: false, error: 'Payment not found. Reload the page.' };
      const status = input.decision === 'confirm' ? 'Confirmed' : input.decision === 'reject' ? 'Rejected' : '';
      if (!status) return { ok: false, error: 'Unknown decision.' };
      const was = pay.status;
      updateRow_('Payments', pay._row, Object.assign({}, pay, { status: status, confirmedAt: status === 'Confirmed' ? new Date().toISOString() : '' }));
      let emailed = false;
      if (status === 'Confirmed' && was !== 'Confirmed' && input.email !== false) {
        const b = readTable_('Bookings').filter(function (x) { return x.ref === pay.ref; })[0];
        const trip = b && tripById_(b.tripId);
        if (b && trip) emailed = sendMail_(b.email, buildConfirmedEmail_(b, { stage: pay.stage, amount: Number(pay.amount) }, trip, cfg, bookingLink_(cfg.siteUrl, b.ref, b.token)));
      }
      return { ok: true, emailed: emailed };
    }
    case 'addPayment': {
      const b = readTable_('Bookings').filter(function (x) { return x.ref === String(input.ref || '').toUpperCase(); })[0];
      if (!b) return { ok: false, error: 'Booking not found.' };
      const v = validateClaim_(input);
      if (v.errors.length) return { ok: false, error: v.errors.join(' ') };
      const now = new Date().toISOString();
      appendRows_('Payments', [Object.assign({ id: Utilities.getUuid().slice(0, 8), ref: b.ref, tripId: b.tripId, status: 'Confirmed', source: 'Organiser', recordedAt: now, confirmedAt: now }, v.value)]);
      return { ok: true };
    }
    case 'setStatus': {
      const b = readTable_('Bookings').filter(function (x) { return x.ref === String(input.ref || ''); })[0];
      if (!b) return { ok: false, error: 'Booking not found.' };
      const status = BOOKING_STATUSES.indexOf(input.status) === -1 ? '' : input.status;
      if (!status) return { ok: false, error: 'Unknown status.' };
      const trip = tripById_(b.tripId);
      if (status === 'Booked' && b.status !== 'Booked') {
        const left = Number(trip.places) - placesTaken_(readTable_('Bookings'), trip.id);
        if (Number(b.people) > left && input.force !== true) {
          return { ok: false, needsForce: true, error: 'Only ' + Math.max(0, left) + ' places are left and this booking has ' + b.people + ' people.' };
        }
      }
      updateRow_('Bookings', b._row, Object.assign({}, b, { status: status, updatedAt: new Date().toISOString() }));
      let emailed = false;
      if (status === 'Booked' && b.status === 'Waiting list' && input.email !== false) {
        emailed = sendMail_(b.email, buildPlaceOfferedEmail_(Object.assign({}, b, { status: status }), trip, cfg, bookingLink_(cfg.siteUrl, b.ref, b.token)));
      }
      return { ok: true, emailed: emailed };
    }
    case 'saveNotes': {
      const b = readTable_('Bookings').filter(function (x) { return x.ref === String(input.ref || ''); })[0];
      if (!b) return { ok: false, error: 'Booking not found.' };
      updateRow_('Bookings', b._row, Object.assign({}, b, { organiserNotes: clean_(input.notes, 1000) }));
      return { ok: true };
    }
    case 'money': {
      const trip = tripById_(String(input.tripId || ''));
      if (!trip) return { ok: false, error: 'Trip not found.' };
      const m = tripMoney_(trip);
      const live = {};
      m.bookings.forEach(function (b) { if (b.status === 'Booked') live[b.ref] = b; });
      return {
        ok: true, result: m.result, bank: bank_(cfg),
        expenses: m.expenses.map(function (e) { return { id: e.id, name: e.name, split: e.split, amount: Number(e.amount), detail: Money.parseDetail(e.detail), date: e.date, paidBy: e.paidBy, notes: e.notes }; }),
        calls: m.calls.map(function (c) { return { id: c.id, stage: c.stage, reason: c.reason, perPerson: Number(c.perPerson) || 0, dueDate: c.dueDate, createdAt: c.createdAt, emailed: c.emailed }; }),
        people: m.people.filter(function (p) { return live[p.ref]; }).map(function (p) {
          return { key: Money.personKey(p.ref, p.n), ref: p.ref, n: Number(p.n), name: p.fullName, role: p.role, bikeType: p.bikeType, bikeHire: p.bikeHire, under18: p.under18 };
        }),
        bookings: m.bookings.map(function (b) { return { ref: b.ref, status: b.status, leadName: b.leadName, email: b.email, mobile: b.mobile, link: bookingLink_(cfg.siteUrl, b.ref, b.token) }; }),
      };
    }
    case 'saveExpense': {
      const trip = tripById_(String(input.tripId || ''));
      if (!trip) return { ok: false, error: 'Trip not found.' };
      const v = Money.validateExpense(input.expense);
      if (v.errors.length) return { ok: false, error: v.errors.join(' ') };
      const e = v.value;
      const now = new Date().toISOString();
      const row = Object.assign({}, e, { tripId: trip.id, detail: JSON.stringify(e.detail), updatedAt: now });
      if (e.id) {
        const old = readTable_('Expenses').filter(function (x) { return x.id === e.id && x.tripId === trip.id; })[0];
        if (!old) return { ok: false, error: 'That expense no longer exists. Reload the page.' };
        updateRow_('Expenses', old._row, Object.assign(row, { createdAt: old.createdAt }));
      } else {
        row.id = Utilities.getUuid().slice(0, 8);
        row.createdAt = now;
        appendRows_('Expenses', [row]);
      }
      return { ok: true, id: row.id };
    }
    case 'deleteExpense': {
      const old = readTable_('Expenses').filter(function (x) { return x.id === input.id; })[0];
      if (!old) return { ok: false, error: 'That expense no longer exists.' };
      deleteRows_('Expenses', [old._row]);
      return { ok: true };
    }
    case 'call': {
      if (!cfg.bankReady) return { ok: false, error: 'Add the club bank details in the Settings tab of the Google Sheet first, so people know where to pay.' };
      const trip = tripById_(String(input.tripId || ''));
      if (!trip) return { ok: false, error: 'Trip not found.' };
      const stage = ['Deposit', 'Interim', 'Final'].indexOf(input.stage) === -1 ? '' : input.stage;
      const call = { id: Utilities.getUuid().slice(0, 8), tripId: trip.id, stage: stage, reason: clean_(input.reason, 300),
        perPerson: round2_(Number(input.perPerson) || 0), dueDate: isoDate_(input.dueDate), createdAt: new Date().toISOString() };
      if (!stage) return { ok: false, error: 'Choose deposit, interim or final.' };
      if (stage === 'Deposit' && readTable_('Calls').some(function (c) { return c.tripId === trip.id && c.stage === 'Deposit'; })) return { ok: false, error: 'Deposits have already been asked for.' };
      if (stage === 'Interim' && (!(call.perPerson > 0) || call.reason.length < 3)) return { ok: false, error: 'An interim payment needs an amount per person and a reason, e.g. "Hotels need paying 6 weeks before".' };
      if (stage === 'Final' && readTable_('Calls').some(function (c) { return c.tripId === trip.id && c.stage === 'Final'; })) return { ok: false, error: 'The final balance has already been called. Use "Remind everyone who owes" instead.' };
      if (!call.dueDate) return { ok: false, error: 'Choose the date it is due by.' };
      appendRows_('Calls', [call]);
      let sent = 0;
      if (input.email !== false) {
        const m = tripMoney_(trip);
        m.bookings.forEach(function (b) {
          const row = m.result.bookings.filter(function (x) { return x.ref === b.ref; })[0];
          if (b.status !== 'Booked' || !row || !(row.owesNow > row.claimed)) return;
          if (sendMail_(b.email, buildCallEmail_(b, row, call, trip, cfg, bookingLink_(cfg.siteUrl, b.ref, b.token)))) sent++;
        });
        const saved = readTable_('Calls').filter(function (c) { return c.id === call.id; })[0];
        if (saved) updateRow_('Calls', saved._row, Object.assign({}, saved, { emailed: String(sent) }));
      }
      return { ok: true, emailed: sent };
    }
    case 'remind': {
      const trip = tripById_(String(input.tripId || ''));
      if (!trip) return { ok: false, error: 'Trip not found.' };
      const m = tripMoney_(trip);
      const only = Array.isArray(input.refs) ? input.refs : null;
      let sent = 0;
      m.bookings.forEach(function (b) {
        const row = m.result.bookings.filter(function (x) { return x.ref === b.ref; })[0];
        if (b.status !== 'Booked' || !row || !(row.owesNow > row.claimed) || (only && only.indexOf(b.ref) === -1)) return;
        if (sendMail_(b.email, buildReminderEmail_(b, row, trip, cfg, bookingLink_(cfg.siteUrl, b.ref, b.token)))) sent++;
      });
      return { ok: true, emailed: sent };
    }
    default: return { ok: false, error: 'Unknown organiser request.' };
  }
}

// ---------- sheet menu and setup ----------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('W/Rhinos trips')
    .addItem('Check settings', 'checkSettings')
    .addItem('First-time setup', 'setup')
    .addToUi();
}

// Never a pop-up box: when run from the code editor, a box in the Sheet tab waits unseen until the run times out.
// The message goes to the editor's Execution log and to a note in the corner of the Sheet instead.
function notify_(title, message) {
  console.log(title + ': ' + message);
  try { ss_().toast(message, title, 60); } catch (e) { /* log only */ }
}

function checkSettings() {
  const cfg = readSettings_();
  notify_(cfg.problems.length ? 'Please fix these in the Settings tab' : 'Settings look good',
    cfg.problems.length ? '- ' + cfg.problems.join('\n- ') : 'The trips pages can take registrations.' +
      (cfg.bankReady ? '' : ' Bank details are not added yet: fine for sign-ups, needed before asking for deposits.'));
}

function setup() {
  const ss = ss_();
  if (!ss.getSheetByName('Settings')) {
    const sh = ss.insertSheet('Settings', 0);
    sh.getRange(1, 1, 1, 3).setValues([['Setting', 'Value', 'What to enter']]).setFontWeight('bold').setBackground('#c21f2a').setFontColor('#ffffff');
    sh.getRange(2, 2, SETTING_DEFS.length, 1).setNumberFormat('@');
    sh.getRange(2, 1, SETTING_DEFS.length, 3).setValues(SETTING_DEFS.map(function (d) { return [d.label, DEFAULT_SETTINGS[d.key], d.help]; }));
    sh.setColumnWidth(1, 200); sh.setColumnWidth(2, 300); sh.setColumnWidth(3, 460);
    sh.setFrozenRows(1);
  }
  Object.keys(TABLES).forEach(function (name) { sheet_(name); });
  const trips = readTable_('Trips');
  if (!trips.length) {
    let details = '';
    try { details = UrlFetchApp.fetch(SEED_TRIP.detailsUrl).getContentText(); } catch (e) { details = 'Trip details to follow.'; }
    const now = new Date().toISOString();
    const t = Object.assign({}, SEED_TRIP, { details: details, createdAt: now, updatedAt: now });
    delete t.detailsUrl;
    appendRows_('Trips', [t]);
  }
  ['Trips', 'Bookings', 'People', 'Payments'].forEach(function (name) {
    const sh = sheet_(name);
    const col = schema_(name).idx.status;
    if (!col) return;
    const list = name === 'Trips' ? TRIP_STATUSES : name === 'Bookings' ? BOOKING_STATUSES : ['Claimed', 'Confirmed', 'Rejected'];
    sh.getRange(2, col, sh.getMaxRows() - 1, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(list, true).build());
  });
  // Replace any older keep-warm timer with one every 5 minutes.
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'keepWarm') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('keepWarm').timeBased().everyMinutes(5).create();
  const cfg = readSettings_();
  notify_('Setup done', cfg.problems.length
    ? 'Tabs are ready. Now fill in the Settings tab:\n- ' + cfg.problems.join('\n- ')
    : 'Tabs are ready and settings look good. Next: Deploy > New deployment > Web app (see README).');
}

// Google puts idle web apps to sleep, which makes the next visitor wait 20+ seconds. The timer runs the editor's
// copy of the script, not the deployed one the website uses, so it calls the website's own address to wake that.
function keepWarm() {
  try {
    const url = ScriptApp.getService().getUrl();
    if (url) UrlFetchApp.fetch(url + '?action=ping', { muteHttpExceptions: true, followRedirects: true });
    else readSettings_();
  } catch (e) { /* only here to keep the web app warm */ }
}

if (typeof module !== 'undefined') {
  module.exports = {
    round2_: round2_, money_: money_, normaliseMobile_: normaliseMobile_, isoDate_: isoDate_, ageOn_: ageOn_, slugify_: slugify_,
    generateReference_: generateReference_, parseRoutes_: parseRoutes_, placesTaken_: placesTaken_, depositFor_: depositFor_,
    validateTrip_: validateTrip_, validatePerson_: validatePerson_, validateRegistration_: validateRegistration_,
    findDuplicate_: findDuplicate_, paymentTotals_: paymentTotals_, validateClaim_: validateClaim_, bookingLink_: bookingLink_,
    buildRegistrationEmail_: buildRegistrationEmail_, buildPlaceOfferedEmail_: buildPlaceOfferedEmail_, parseSettings_: parseSettings_,
    buildCallEmail_: buildCallEmail_, buildReminderEmail_: buildReminderEmail_, buildLinksEmail_: buildLinksEmail_,
    safeCell_: safeCell_, REF_BLOCKED: REF_BLOCKED, parseBikeOptions_: parseBikeOptions_, missingDetails_: missingDetails_,
    existingForEmail_: existingForEmail_, underLimit_: underLimit_, countEvent_: countEvent_, SIGNUP_LIMIT: SIGNUP_LIMIT,
  };
}
