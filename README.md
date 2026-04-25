# Crypto Knowledge Rating & Dynamic Profile Card

A dependency-light MVP for a Farcaster Mini App that lets people rate each other's Web3 knowledge, view a live leaderboard, and share FIFA-style profile cards that stay tied to current data.

## What is included

- Peer-to-peer scoring across four categories
- Global leaderboard ranked by average reputation
- Shareable player profile pages with `fc:miniapp` and `fc:frame` metadata
- Dynamic player cards generated on the server
- Local JSON persistence so ratings survive refreshes
- A development manifest at `/.well-known/farcaster.json`

## Run locally

This workspace does not currently have `npm` available, so the app is designed to run with the bundled Node runtime directly:

```powershell
& 'C:\Users\Gaming\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' server.js
```

Then open [http://localhost:3000](http://localhost:3000).

## Project structure

- [server.js](C:/Users/Gaming/Documents/Codex/2026-04-25/project-crypto-knowledge-rating-dynamic-profile/server.js)
- [public/index.html](C:/Users/Gaming/Documents/Codex/2026-04-25/project-crypto-knowledge-rating-dynamic-profile/public/index.html)
- [public/app.js](C:/Users/Gaming/Documents/Codex/2026-04-25/project-crypto-knowledge-rating-dynamic-profile/public/app.js)
- [public/styles.css](C:/Users/Gaming/Documents/Codex/2026-04-25/project-crypto-knowledge-rating-dynamic-profile/public/styles.css)
- [data/users.json](C:/Users/Gaming/Documents/Codex/2026-04-25/project-crypto-knowledge-rating-dynamic-profile/data/users.json)
- [data/ratings.json](C:/Users/Gaming/Documents/Codex/2026-04-25/project-crypto-knowledge-rating-dynamic-profile/data/ratings.json)

## Production follow-up

For a real Farcaster deploy, the next upgrades are:

1. Replace JSON files with Postgres or another database.
2. Wire in Farcaster Quick Auth so raters are verified sessions instead of manual FID input.
3. Replace the placeholder `accountAssociation` values in the manifest with a signed domain claim.
4. Swap the local server for Next.js or Vercel functions if you want native Vercel OG and deploy tooling.
