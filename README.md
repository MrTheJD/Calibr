# Calibr

A simple, private budgeting app. Set a monthly limit for each category, log what you spend, and always know what's left.

## Features

- **Location-based capture** — type the amount; Calibr checks where you are against an offline places list and suggests the category. Confident guesses are filed automatically; anything uncertain goes to a "needs a category" list you clear with one tap each. It learns from your choices and never uploads your location. See [Smart capture](#smart-capture).
- **Fluctuating pay** — set "My pay is: different each time" and Calibr plans on the average of your *lower* recent months (or a number you choose), shows what has actually arrived against that plan, lets you save any surplus in an Income buffer and draw from it in a slow month, and has a **lean-month planner** that keeps essentials fully funded and shrinks flexible categories to fit what you can count on. Limits can also be changed for a single month. See [Variable income](#variable-income).
- **Budget** — monthly limits per category, a "left this month" total, a safe-to-spend-per-day figure, and unassigned income. Optional per-category rollover of unspent money.
- **Fast entry** — one tap to add; category chips, remembered notes that auto-pick the category, Today/Yesterday shortcuts, and undo for every change.
- **Activity** — everything this month grouped by day, with search and type/category filters. Tap to edit.
- **Insights** — spending vs. last month, net, daily average, where the money went, a 6-month income/spending trend, and biggest expenses.
- **Recurring & bills** — weekly, bi-weekly, monthly or yearly; added automatically when due, with a "coming up" list.
- **Goals** — savings goals with progress and the monthly amount needed to hit a target date.
- **Your data** — stays on your device. Export/restore JSON backups, export CSV. 22 currencies, light/dark/auto theme, works offline, swipe between months.

## Variable income

- **Plan on the low end.** With variable pay, the plan is the average of the lower half of your last six completed months (needs two months with income; until then it uses your starting estimate). You can override it in Settings. Limits and "unassigned" are measured against the plan, so a good month is a bonus and a slow month is expected.
- **Received vs plan.** The Budget screen shows what has arrived this month. Above plan: "Save it in your buffer". Below: how much is still to come, with a lean-month planner and a "Use buffer" button.
- **Income buffer.** A goal that absorbs surplus. Money drawn back out is logged as income marked "From buffer": it covers the gap to the plan but is never counted as earnings, so it can't inflate future plans.
- **Lean month.** Mark categories *Essential*; in a lean month they stay fully funded and the rest shrink proportionally to the money you tell Calibr you can count on. This only changes that month and can be reset. You can also change any single category's limit for one month from its detail screen.
- **Insights** show how much your pay varies and offer to switch a steady-pay setup to variable planning when the history is bumpy.

## Smart capture

1. **Amount:** the add sheet opens with the last amount pre-filled and selected, so you can just type over it.
2. **Where you are:** Calibr reads GPS only while the add sheet is open and nothing leaves your device (the approximate spot of each purchase, about 10 m, is saved with it so Calibr can learn; Settings → Forget removes those) and looks up nearby places in an offline *pack*.
3. **Decision:** it scores each possible category from distance, GPS accuracy, the kind of place, and what *you* did there before. It files automatically only if the score clears your threshold (Settings → Smart capture: Very sure / Fairly sure / Pretty sure), the top choice clearly beats the runner-up, and the GPS fix is decent. Otherwise the purchase waits in review with 2–3 suggestions.
4. **Stores that sell everything** (Walmart, Target, Costco, drugstores, convenience stores) always start in review; once your history at that store is consistent they are filed automatically.
5. **Earned trust:** a built-in guess from the places list alone is deliberately not enough at the default setting; a place is auto-filed after a few visits you confirmed. In simulation (`tools/simulate.mjs`, synthetic user, 15 m GPS noise, 3% inconsistent choices) this cut wrong auto-filings in dense Midtown Manhattan from ~12% to ~3%, and ~6% to ~5% in a suburb (mostly stores like Walmart whose category varies per visit). Real-world accuracy will differ; Calibr measures it on you (below).
6. **Safety net:** auto-filed entries are tagged and undoable, and a "Check" card lets you confirm or fix them. Calibr counts your confirmations and corrections, and automatically raises its bar if you correct too many.

### Places packs

Packs are compact offline files of nearby shops/restaurants (built from [Overture Maps](https://overturemaps.org); its sources are licensed CDLA-Permissive-2.0, Apache-2.0 or CC0-1.0, and the attribution is kept in each pack and shown in Settings). Without a pack Calibr still works: it learns the places you visit and asks you the first few times.

Build one for your area from your phone: GitHub repo → **Actions** → **Build places pack** → **Run workflow**, enter a name (`austin`) and place (`Austin, Texas`). It commits the pack and redeploys the site. Or locally:

```
pip install "duckdb==1.4.2"
python tools/build_pack.py --name austin --place "Austin, Texas" --radius-km 6
```

Typical size is 0.2–1.5 MB gzipped per city. The app picks the right pack from your location and caches it for offline use.

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
