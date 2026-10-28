# Calibr

A simple, private budgeting app. Set a monthly limit for each category, log what you spend, and always know what's left.

## Features

- **Budget** — monthly limits per category, a "left this month" total, a safe-to-spend-per-day figure, and unassigned income. Optional per-category rollover of unspent money.
- **Fast entry** — one tap to add; category chips, remembered notes that auto-pick the category, Today/Yesterday shortcuts, and undo for every change.
- **Activity** — everything this month grouped by day, with search and type/category filters. Tap to edit.
- **Insights** — spending vs. last month, net, daily average, where the money went, a 6-month income/spending trend, and biggest expenses.
- **Recurring & bills** — weekly, bi-weekly, monthly or yearly; added automatically when due, with a "coming up" list.
- **Goals** — savings goals with progress and the monthly amount needed to hit a target date.
- **Your data** — stays on your device. Export/restore JSON backups, export CSV. 22 currencies, light/dark/auto theme, works offline, swipe between months.

## Run locally

```
python3 -m http.server 8000
```

Then open http://localhost:8000. No build step or dependencies.

## Tests

```
node --test tests/*.test.mjs
```

The budgeting rules (rollover, recurring dates, migration, trends, CSV) live in `logic.js` with no DOM access so they can be tested in Node.

## Hosting (GitHub Pages)

Pushes to `main` run the tests and deploy via `.github/workflows/pages.yml`.
One-time setup: repo **Settings → Pages → Source: GitHub Actions**.
The app is served at `https://<your-username>.github.io/Calibr/`.

## Install on your phone

- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** menu → Install app / Add to Home screen

Updates: push to `main`; the installed app picks them up the next time it opens online.

## Data & privacy

Everything is stored in your browser's local storage on that device; nothing is uploaded. Because of that, a different browser or phone starts empty — use **Settings → Export backup** to move or protect your data.
