# Shop app

Your HTML pages + a small Node server + one SQLite file (`data/shop.db`).
The pages keep working as they are; `server.js` adds the database and a login.

## Run it (any computer with Node 22.13 or newer)

1. `cp .env.example .env` then open `.env` and set `APP_PASSWORD`.
2. `npm start`
3. Open http://localhost:3000 and log in.

No `npm install` is needed: there are no packages.

## Your old data

`data/shop.db` already contains the data from your localStorage backup of 2026-10-20
(244 products, 52 sales, 7 invoices, 10 expenses, 7 purchase invoices, 9 receivables,
4 payables, 14 todos, 18 contacts). Nothing to import.

(If you ever need to load another backup: run the app, open /import.html and choose the file.)

## Put it on GitHub (private repo)

    git init -b main
    git add -A
    git commit -m "shop app"
    git remote add origin https://github.com/YOU/YOUR-PRIVATE-REPO.git
    git push -u origin main

`.env` (your password) is git-ignored and never uploaded. `data/shop.db` IS uploaded: that is your data.

## Use it on another device

    git clone https://github.com/YOU/YOUR-PRIVATE-REPO.git
    cd YOUR-PRIVATE-REPO
    cp .env.example .env     # set the same password
    npm start

### Keeping data in sync through GitHub

Set `AUTO_SYNC=1` in `.env`. Then the server:
- pulls the latest `shop.db` when it starts,
- commits and pushes `shop.db` about a minute after you save something,
- pushes once more when you stop it (Ctrl+C).

IMPORTANT: run it on ONE device at a time. `shop.db` is a binary file, so if two
devices change it separately git cannot merge them (the push fails and you must pick one).
Stop the server on the first device before starting it on the next.

### Reaching it from anywhere without running it yourself

GitHub only stores the files; it cannot run Node. If you want to open the shop from any
device without starting anything, run this same folder on an always-on machine or any host
that runs Node 22.13+ and keeps its disk between restarts (a VPS, an Iranian Node host,
a PC at the shop with port forwarding). Use HTTPS in front of it. Then every device just
opens the URL and logs in.

## Notes
- All data lives in `data/shop.db`; copy that file to back it up.
- If saving shows a red "Changed on another device or tab", reload the page and redo that change.
- The login cookie lasts 30 days. Use a long password.
