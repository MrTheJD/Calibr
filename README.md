# Calibr

A simple, intuitive budgeting app. Set a monthly limit per category, log expenses, and see at a glance what's left.

- Installable PWA, works offline
- All data stays on your device (localStorage); export to JSON from the limits editor
- No build step or dependencies

## Run

```
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Hosting (GitHub Pages)

Pushes to `main` deploy automatically via `.github/workflows/pages.yml`.

One-time setup: repo **Settings → Pages → Source: GitHub Actions**.

The app is then served at `https://<your-username>.github.io/Calibr/`.

## Install on your phone

- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** menu → Install app / Add to Home screen

Updates: push to `main`; the installed app picks them up the next time it opens online.
