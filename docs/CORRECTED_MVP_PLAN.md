# Battleship PvP — Corrected MVP Fix Plan (for review)

- **Version:** 1.0 (draft, pending owner review)
- **Date:** 2026-11-03
- **Status:** NOT YET APPROVED — written for the owner to check before any more Codex work.

## Context — why this document exists

Earlier in this session, three rounds of architecture analysis (and one round of Codex
implementation built on top of them) were wrong, in sequence:

1. "Socket.IO (`server.js`) is the live engine, REST (`api/game.js`) is a dead duplicate" — wrong;
   led to `api/game.js` being deleted, which would have broken the real app. Caught and reverted.
2. "REST serves lobby/1v1/chat, Socket.IO serves tournament" — also wrong.
3. Final pass, verified file-by-file rather than inferred: **every reachable frontend feature
   goes through `backend/api/game.js` (REST) and direct Supabase calls. `backend/server.js` and
   everything it owns (`gameManager.js`, `tournamentManager.js`, `routes/profileRoutes.js`) is
   unreachable from the current frontend** — confirmed by grepping every frontend file for
   `socket.js` / `socket.io-client` imports (zero matches outside `socket.js` itself).

This document is being saved as a file (per your standing instruction to keep proposals/reviews
as versioned `.md`, not just chat) specifically so the repeated-correction history is on record,
and so you can check the claims below against ground truth I don't have access to (real deployed
Supabase schema, real Vercel env var values) before anything else gets implemented.

## Verified facts (checked directly in this session, not inferred)

- `backend/api/index.js` (original, pre-session code) contained the comment: *"Socket.IO has
  been replaced with REST API + Supabase Realtime for better serverless compatibility."*
- `backend/deploy.sh` runs `vercel --prod --name battleship-backend` — the backend is deployed to
  Vercel as serverless functions (`api/*.js`), not Railway/Render.
- `backend/railway.json` / `backend/render.yaml` are deploy configs for `server.js`, which no
  frontend code currently reaches.
- `database/schema.sql` (referenced by README setup steps) is listed in the root `.gitignore`
  under "Sensitive/Secret files" — deliberately excluded, not missing by accident.
- `frontend/src/services/realtimeGameService.js` builds its REST base URL from `VITE_SOCKET_URL`.
  `frontend/src/components/TournamentGamePlay.jsx`'s one REST call (`completeTournamentMatch`)
  uses a different env var, `VITE_BACKEND_URL`, for the same backend. Both must point at the same
  deployed Vercel backend for the app to behave consistently today.
- `gameStoreRealtime.js:303`'s `createTournamentGame` (which references the nonexistent
  `realtimeGameService.socket`) is dead code — `TournamentMatchWaiting.jsx` actually imports
  `createTournamentGame` from `stores/gameStore.js` (a different file, local-state-only, no
  network call), confirmed by checking the import statement directly.
- All 9 REST actions defined in `api/game.js` (`getRooms`, `createRoom`, `joinRoom`, `leaveRoom`,
  `placeShips`, `attack`, `getGameState`, `sendMessage`, `completeTournamentMatch`) have at least
  one confirmed caller in the frontend — checked by grepping every `apiRequest(...)` call site.

## Points of doubt — NOT verified, need your confirmation (please check these)

- **I cannot see the real deployed Vercel environment variables.** The plan assumes
  `VITE_SOCKET_URL` and `VITE_BACKEND_URL` are set to different values in production (which would
  explain the half-broken state), but I have no way to confirm this — it's equally possible both
  already point to the same URL and the app works fine today despite the naming confusion. **Please
  check your actual Vercel project's environment variables for the frontend before I touch
  `realtimeGameService.js`.**
- **I cannot see the real deployed Supabase schema or RLS policies.** Everything in
  `docs/sdlc/02-SDD.md`'s data model and this plan's assumptions about table shapes is inferred
  from the code that queries Supabase, not from an actual schema inspection. If the real schema
  differs (extra columns, different constraints, existing triggers), the validation fixes below
  could be mismatched.
- **I have not run the app.** I don't have a Supabase project or Vercel CLI session to actually
  exercise `vercel dev` and click through a real two-player match. Everything above is static
  analysis (grep/read), which is exactly the method that produced two wrong conclusions earlier in
  this session — I'm more confident this time because I traced actual import chains and env var
  usage end-to-end rather than inferring from file/component naming, but "more confident" is not
  "proven by running it."
- **Tournament mode's real-world status is unknown.** The code paths for tournament creation,
  bracket display, and match play via direct Supabase + Realtime channels look complete, but I
  have no evidence anyone has successfully played a full tournament end-to-end. It's possible
  there are more problems in that flow beyond what static reading can find.
- **Possible route conflict on Vercel:** `backend/api/health.js` and the `/health`/`/api/health`
  branch inside `backend/api/index.js` both seem to handle a health check. `backend/vercel.json`
  doesn't route `/api/health` to `api/health.js` explicitly (only `/health` isn't listed either) —
  need to double check Vercel's default file-based routing doesn't silently pick one over the
  other in a way that differs from what `vercel.json`'s explicit `routes` array implies.
- **Scope of my frontend search.** I checked every `.jsx` component's top-level imports and the
  main stores/services, but I did not read every one of the ~85 frontend files line-by-line.
  There's residual risk of a network call I haven't seen, especially inside large files like
  `frontend/src/services/tournamentService.js` (1367 lines), which I only grepped for imports, not
  read in full.

## Proposed fix scope (pending your go-ahead)

1. **Fix `backend/api/game.js`** (the real, deployed backend) for the 6 original findings from
   `docs/CODE_REVIEW_2026-11-02.md`:
   - `completeTournamentMatch` (`:619`): add a check that the authenticated caller is a match
     participant (currently only checks `winnerId` is a participant).
   - `joinRoom` (`:138-195`): replace check-then-write with a conditional update to close the race.
   - `placeShips` (`:269-396`): port the fleet/board validation already written and tested in
     `backend/gameManager.js`'s `validateShips(ships, board)`.
   - `attack` (`:400-531`): port the same integer-0-9 coordinate check already added to
     `gameManager.js`'s `makeAttack`.
   - `getGameState` (`:535-585`): confirm/add explicit non-participant rejection and opponent-board
     redaction.
2. **Fix the env-var split**: standardize `realtimeGameService.js` on `VITE_BACKEND_URL` (matching
   `TournamentGamePlay.jsx`); update `.env.example` accordingly. **Blocked on your confirmation of
   the point of doubt above** — if production already has both vars set to the same value, this
   is a low-risk cleanup; if not, it's the actual fix for a live bug.
3. **Correct stale docs**: README's "Backend: Railway or Render" → Vercel; fix local-dev
   instructions (`vercel dev` instead of `node server.js` for backend).
4. **Mark the orphaned Socket.IO stack as out of scope**, don't delete: add a one-line "not
   currently used by the deployed frontend" comment at the top of `server.js`, leave the rest
   alone. (Deleting look-alive infrastructure already caused one real regression this session.)
5. **Deployment target**: Vercel for both frontend and backend (already discussed and agreed) —
   no new work, just stop treating Railway/Render as a live option in docs.

## Suggested improvements beyond the minimal fix (for your consideration, not yet scoped)

- **Unify on one backend base-URL env var app-wide** and delete the unused one, rather than just
  routing around the confusion — reduces future chance of the same class of bug.
- **Add a short "Architecture" section to README** with the actual verified request-flow table
  from this document, so the next person (human or AI) doesn't have to re-derive it from scratch.
- **Add minimal integration tests that actually hit `vercel dev` + a disposable Supabase project**
  for the 6 fixed behaviors, not just unit tests of extracted validation logic — the unit tests
  Codex already wrote for `gameManager.js` are testing code that isn't reachable in production;
  equivalent tests should target `api/game.js` instead.
- **Decide explicitly, later, what to do with the orphaned Socket.IO stack**: finish wiring it up
  for a real use case, or remove `server.js`/`gameManager.js`/`tournamentManager.js`/
  `routes/profileRoutes.js`/`railway.json`/`render.yaml` entirely once you're confident nothing
  needs them. Not urgent, but leaving them in place indefinitely risks a fourth round of the same
  confusion for a future reviewer.
- **No CI currently runs on this repo** (confirmed — no `.github/workflows`). Even a minimal
  lint/syntax-check workflow would catch something like the earlier accidental route-mismatch
  before it reaches a human reviewer.

## What happens after you review this

If you approve scope items 1–5 above (and resolve the points of doubt, especially the env var
values), the next step is to brief Codex (build profile) with exactly this scope, file by file,
reusing the validation logic already proven in `gameManager.js`. Claude reviews the resulting diff
before anything is committed — same split as the rest of this project.
