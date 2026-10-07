# Trips backend: setup and use

The trips pages (`wrhinos.com/trips`) store everything in a Google Sheet through a Google Apps Script web app (`Code.gs`).
Until it is connected, the pages run in **preview mode**: everything works, but data stays on the device that entered it.

| Tab in the Sheet | What it holds |
|---|---|
| Settings | Club name, contact email, club bank details, organiser passcode |
| Trips | One row per trip: status, dates, places, deposit, details text, route links |
| Bookings | One row per booking: reference, status (Booked / Waiting list / Cancelled), contact, emergency contact, deposit due |
| People | One row per person going: name, date of birth, role, bike, diet, passport, safety info |
| Payments | Deposits and other payments: claimed by riders, confirmed by the organiser |
| Expenses | Each trip cost (hotels, support company, lorry...) and how it is shared |
| Payment requests | Each time organisers asked for money (deposits, interim, final balance) |
| <Trip> – People, Bookings, Payments, Expenses, Payment requests | Read-only tabs per trip, filled automatically from the main tabs. Use these to read, sort or copy a trip's data |

Organisers normally work from `wrhinos.com/trips/organiser/`, not the Sheet. The Sheet is the record, and is handy for
sorting and exporting (for example the dietary list for a hotel).

## One-time setup (about 15 minutes)

Use a **club Google account** (not a personal one), because trip emails are sent from it and the club should own the data.

1. Go to https://sheets.google.com and create a blank sheet called **W/Rhinos Trips**.
2. **Extensions > Apps Script**. Delete everything in the editor, paste in all of `backend/Code.gs`, and save.
   Then click **+** next to Files > **Script**, name it **Money**, and paste in all of `trips/money.js` (the same
   money maths the website uses). Save.
3. Choose the function **setup** in the toolbar and click **Run**. Approve the permissions (Google warns that the app is
   unverified because it is your own script: click Advanced, then Go to project).
4. Fill in the **Settings** tab: contact email and an **organiser passcode** of at least 10 characters. The club bank
   details can wait: sign-ups work without them, and they are only needed before "Ask for deposits and details".
5. Run **setup** again. It says what is still missing, or that settings look good. The Rhine trip is created as a Draft.
6. **Deploy > New deployment**, gear icon > **Web app**. Execute as **Me**, Who has access **Anyone**. Deploy, and copy the
   **Web app URL**.
7. Put that URL in `trips/config.js`: `window.TRIPS_BACKEND_URL = 'https://script.google.com/macros/s/.../exec';`
8. Open `wrhinos.com/trips/organiser/`, sign in with the passcode, open the trip, check its details, set Status to **Open**.
9. Make a test booking, check it arrives in the Sheet and the email arrives, then cancel it from the organiser page.

After changing `Code.gs` or `trips/money.js` later (paste the new version into Code / Money): **Deploy > Manage deployments > edit > Version: New version > Deploy** (the URL stays the same).

## Organiser routine

- **Sign-up first, deposits later** (the default, set per trip under Trip details > "When is the deposit asked for?").
  Sign-up asks only the trip form questions: name, date of birth, address, phone, emergency contact, bike choice
  (hire options are set per trip under "Bike options"; hire riders give height, inside leg, frame size, saddle height and
  pedals), room preference, dietary needs and the small print. Places are held, nothing is paid.
- **When the trip is confirmed:** Money tab > **Ask for deposits and details**. Everyone's booking page then shows a
  "Next steps" list (pay the deposit, add passports, add own-bike make and colour) and you get a WhatsApp group message
  to post (or email everyone instead).
- **Payments to check:** riders tap "I've paid". Check the club bank statement, then tap **In the bank ✓** (the rider gets
  a "payment received" email) or **Not found**.
- **Record a payment** for cash or anything paid without the rider tapping "I've paid".
- **Deposit overdue** lists bookings past the deposit deadline. Use the **WhatsApp reminder** button (opens WhatsApp with
  the message written) or cancel the booking to free the places.
- **Waiting list:** when places free up, tap **Give them places**. They get an email with the deposit details.
- **Expenses:** Expenses tab > Add expense. Name it (e.g. Hotel – Frankfurt) and choose how it is shared:
  - **Everyone**: one click, equally, e.g. the support company. Or everyone except support crew, riders only, or
    everyone bringing a bike (e.g. the lorry).
  - **Some people**: tick who shares it, e.g. the boat for the family group.
  - **Rooms**: add each room, its price and who is in it. "One room per booking" fills them in one go, and
    "Copy rooms from" reuses the last hotel's rooms so only the prices need typing.
  - **Set amounts**: type each person's amount.
  Expenses can be edited or deleted any time; everyone's balance updates straight away. The charity fee (default £50
  per rider) is added automatically.
- **Money tab:** total cost, money in, who owes what (with each person's line-by-line breakdown).
  - **Call an interim payment** (an amount per person and the reason) when a supplier needs paying before the trip.
  - **Call the final balance** after the trip, once every cost is in.
  - **Email everyone who owes** sends each booking its own amount and the bank details. WhatsApp and email buttons
    on each booking nudge one person.
- **Lost links:** riders use "Lost your booking link?" on wrhinos.com/trips: the link is emailed to the address they
  registered with (at most once per 10 minutes per address). Organisers can also copy any rider's link.
- **New trip:** fill in the form; it starts as a Draft that only organisers can see. Set it to Open when ready.

## Notes

- Places count everyone: riders, non-riders, children and support crew. Support crew pay no deposit.
- A family books together: one reference, one deposit, one private link. Bookings that do not fit go on the waiting list
  together, never split.
- Each booking has a private link (`/trips/booking/?r=REF&k=KEY`). Anyone with it can see and edit that booking, so the
  link is only ever emailed to the booker and shown to organisers.
- The organiser passcode locks for 15 minutes after 8 wrong attempts.
- Passport and health details are visible only to organisers. Delete them after each trip, as the privacy notice promises
  (planned: automatic deletion 30 days after the trip).
- Gmail lets a script send about 100 emails a day.
- `Code.gs` in this public repo has example bank details only. Real details live only in the Sheet's Settings tab.
- Run `node backend/test.js` and `node backend/money.test.js` after any change.
