# MVP Scope Review — optimize for a shippable MVP, defer complex upgrades

- **Version:** 1.0
- **Date:** 2026-11-02
- **Reviewer scope:** this reviews `docs/sdlc/01-SRS.md` through `05-RISK-REGISTER.md` against the
  actual code, with a bias toward the smallest correct MVP. It does not change any file under
  `backend/` or `frontend/`.

## Finding: the SDLC set scopes in a much bigger fix than the MVP needs

The code review and SDLC docs correctly found 6 critical/high bugs, but they described the fix as
"apply the fix on every exposed path" (Socket.IO `server.js`, the unmounted duplicate
`api/socketio.js`, **and** the serverless REST `api/game.js`). I checked the actual code to see how
much that implies:

- `backend/api/game.js` imports **neither** `gameManager.js` **nor** `tournamentManager.js` /
  `tournamentService.js`. It is a fully independent reimplementation of ship validation, attack
  resolution, and tournament-match completion, written directly against Supabase — not a thin
  wrapper around the same engine the Socket.IO path uses.
- That means every one of the 6 findings that touches game/tournament logic (ship validation,
  coordinate validation, tournament authorization, bracket handling) would need to be **fixed
  twice, in two unrelated codebases**, to close the finding "everywhere." The SDLC Test Plan
  already implicitly assumes this by asking to "exercise `api/socketio.js` if deployed" and test
  both transports for most cases.
- `backend/api/socketio.js` is not mounted by `server.js` at all (per `02-SDD.md`) — it's dead code
  that duplicates a subset of the Socket.IO handlers for no currently-served purpose.
- One real asymmetry: only `api/game.js` currently writes completed non-tournament games to the
  Supabase `games` table, which is what feeds the `profiles.wins/losses/games_played` stats
  (`FR-08`). The Socket.IO path (`gameManager.js`/`server.js`) never persists a finished 1v1 match —
  it's purely in-memory. Tournament data is the exception: `tournamentManager.js` (used by the
  Socket.IO path) already writes `tournaments`/`tournament_matches` directly to Supabase, so
  tournament persistence is **not** missing on the socket side.

**Conclusion:** maintaining two independently-coded game engines in parallel is the single biggest
source of both bug surface (R-09, R-15 in the Risk Register exist *because* of this) and fix cost
in the current plan. This is exactly the kind of complexity the MVP should shed, not carry forward.

## Recommendation: pick one authoritative game engine for v1.0, retire the other

**Keep:** `backend/server.js` + `gameManager.js` + `tournamentManager.js`/`tournamentService.js`
(the Socket.IO path) as the single source of truth for lobby, 1v1 play, chat, and tournaments. It
already covers every gameplay feature in scope, and tournament persistence already works.

**Retire for v1.0 (delete, don't fix-and-maintain):**
- `backend/api/socketio.js` — unmounted duplicate, delete outright.
- The game-logic actions in `backend/api/game.js` (`createRoom`, `joinRoom`, `placeShips`,
  `attack`, `getGameState`, `leaveRoom`, `sendMessage`, `completeTournamentMatch`). Keep
  `api/index.js`'s health/docs routes and anything profile-related; those aren't duplicated
  elsewhere.

**One small addition needed, not a deferral:** add a single write in the Socket.IO path's
game-over handling (`gameManager.js`/`server.js`) that records the finished match (winner, players,
timestamp) so `profiles.wins/losses/games_played` keeps updating. This is a few lines, not a second
engine — without it, FR-08 (stats) silently breaks once the REST game path is gone.

**Effect on the rest of the SDLC set once this is approved:**
- `02-SDD.md`'s "two distinct game-state paths" section collapses to one; the REST API contract
  table shrinks to health/profile only.
- `03-TEST-PLAN.md` drops every "repeat against `api/socketio.js` if active" / "check REST action
  as well" instruction — each regression case runs once, not twice.
- `05-RISK-REGISTER.md`: R-09 (dual-path divergence) and R-15 (turn-rule mismatch between
  transports) close **by construction**, not by testing effort, because there's only one rule
  left. R-12 (REST join race) also disappears — Socket.IO's single in-process event loop
  serializes room joins naturally, no atomic-update fix needed.
- Net effect: the 6-finding fix list is now fixed **once** instead of twice, which is roughly half
  the implementation and integration-test work the current Test Plan describes.

## MVP scope: keep now vs. defer later

**Keep for MVP (needed to ship safely):**
1. Tournament match-result authorization (TC-01) — socket path only, per above.
2. Chat/typing room-scoping (TC-02) — socket path only.
3. Ship/board validation (TC-03) — `gameManager.js` only.
4. Attack coordinate validation (TC-04) — `gameManager.js` only.
5. Single bracket generator, called once (part of TC-05) — remove the duplicate
   `tournamentManager.generateBracket` call already identified; this is a one-line fix, not complex.
6. Authorized/deduplicated tournament room creation (TC-06) — socket path only.
7. State secrecy (redact opponent board) — socket path only, small DTO fix.
8. Socket auth token off the query string — small, mechanical.
9. A minimal `database/schema.sql` committed for the tables the kept path actually uses
   (`profiles`, `tournaments`, `tournament_participants`, `tournament_matches`, plus whatever
   table the new game-completion write targets) — smaller than today's inferred model, since the
   REST-only tables (`game_rooms`, `games`, `game_events`, `chat_messages`) may turn out to be
   unnecessary once the REST game path is retired. Verify against what's actually used before
   committing the file.
10. The game-completion stats write described above (new, small).

**Defer to v1.1+ (complex, not needed for a classmates-tournament MVP):**
- **Odd-player-count tournament byes.** Supporting non-power-of-two brackets correctly is real
  bracket-math work. For MVP, simplest correct behavior is: reject tournament start unless
  registered players are a power of two, with a clear error. Add byes later if needed.
- **Horizontal scaling / surviving process restart for in-memory Socket.IO state (R-13).** A
  single persistent Node process is fine for a classmates tournament. Don't build a Socket.IO
  Redis adapter or game-state recovery for v1.0.
- **Public-audience hardening** (rate limiting, abuse resistance, capacity planning — R-07).
  Only in scope if the owner confirms the audience is broader than classmates; don't build it
  speculatively.
- **REST game API as a deliberate serverless/scaling path.** If there's a future reason to want a
  stateless REST game API again (e.g., multi-region scale), design it as a thin layer over the
  same `gameManager` logic then — don't resurrect today's independent reimplementation.
- **Ranked ladder/leaderboard, monetization, daily-login/progression** — already correctly
  out-of-scope per `01-SRS.md`; no change.
- `GET /api/profile/leaderboard` route-shadowing bug — real, but low severity and isolated; fine
  to fix in the same pass as the stats-write addition, not worth its own gate.

## Decision (resolved 2026-11-02)

Owner confirmed: **temporarily retire the REST game-logic path** for v1.0. "Temporarily" means
this is a v1.0 scope cut, not a permanent architecture decision — if a stateless/serverless game
path is needed later (e.g., multi-region scale, an external client integration), it should be
redesigned as a thin layer over `gameManager`'s logic at that time, not resurrected as-is from
`api/game.js`. The SDLC docs (`02-SDD.md`, `03-TEST-PLAN.md`, `04-DEV-PLAN.md`, `05-RISK-REGISTER.md`)
need amending to reflect single-engine scope before implementation starts, per `04-DEV-PLAN.md`'s
own change-control rule (scope changes require SRS/SDD/test-plan updates in the same change).

## References

- `docs/CODE_REVIEW_2026-11-02.md`
- `docs/MVP_PROPOSAL.md`
- `docs/sdlc/01-SRS.md`, `02-SDD.md`, `03-TEST-PLAN.md`, `04-DEV-PLAN.md`, `05-RISK-REGISTER.md`
- Verified directly in code: `backend/api/game.js` (no import of `gameManager`/`tournamentManager`/
  `tournamentService`), `backend/gameManager.js` (no Supabase writes), `backend/tournamentManager.js`
  (writes `tournaments`/`tournament_matches` directly), `backend/routes/profileRoutes.js` (reads
  `profiles.wins/losses/games_played`, does not write them).
