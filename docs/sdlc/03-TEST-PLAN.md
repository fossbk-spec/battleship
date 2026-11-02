# Test Plan — Battleship PvP MVP

**Version:** 1.1  
**Date:** 2026-11-02

## Objective and strategy

Verify that a two-player match, AI practice, chat, and any enabled tournament can be used without unauthorized state changes or malformed game state. The six critical/high code-review findings are mandatory regression cases. The review was static and did not run the application, so each case first reproduces current behavior in an isolated test/staging environment, then becomes a passing release test after its fix. Do not use production users or tournament records for negative tests.

## Test levels and environment

| Level | Scope and tools | Exit evidence |
| --- | --- | --- |
| Unit | `gameManager` fleet validation, coordinate validation, turn transitions; tournament bracket generation and advancement with controlled Supabase stubs. | Deterministic assertions for valid and invalid inputs. |
| Integration | Authenticated Socket.IO clients for players A/B and outsider C against `server.js`, with a test Supabase project and retry cases. | Recorded socket events and database state after each action. |
| Existing frontend tests | Run Vitest for components and helpers, then add store/service contract tests where they guard a real regression. | Green suite and coverage report, with backend gaps stated separately. |
| Manual end to end | Two separate accounts/browsers for room create/join, placement, full match, disconnect, chat; AI practice; four- and odd-player tournament attempts; verify profile/stat updates and deployed CORS/auth. | Signed playtest checklist and defects. |

Use distinct Supabase Auth identities A, B, C; create disposable rooms/tournaments; reset tables between cases. Assert **no database mutation and no broadcast** for rejected actions. Record Socket.IO error and event recipients. Each regression case runs once against `backend/server.js`, the sole v1.0 game handler (`docs/MVP_SCOPE_REVIEW.md`, Decision). The release gate is all six review cases plus the new stats and tournament-count cases passing on that path; a disabled tournament can be deferred only if inaccessible to users and explicitly scheduled for v1.1.

## Required regression cases for the six review findings

| ID / finding | Setup and steps | Expected pass after fix |
| --- | --- | --- |
| TC-01 Unauthorized tournament result (`backend/server.js:687`) | Create a ready match for A/B. Authenticated C emits `tournament:matchComplete {matchId,winnerId:A}`. Then A attempts a winner ID for C. | C is denied; invalid winner is rejected; match status, winner, bracket, and notifications remain unchanged. A valid authorized completion advances exactly once. |
| TC-02 Cross-room chat/typing (`backend/server.js:375,405`) | A/B join room R1; C joins R2. C sends `chat:sendMessage {gameId:R1,message:'intrusion'}` and `chat:typing {gameId:R1,isTyping:true}`. | R1 receives neither event; C receives a controlled error; room membership is checked for both event types; legitimate R1 chat still reaches A/B. |
| TC-03 Malformed fleet/board (`backend/gameManager.js:162,366`) | Submit a fleet with correct `size` labels but diagonal/gapped positions, missing/extra positions, noninteger positions, and a board whose ship cells disagree with positions; then submit a valid fleet. | Every malformed submission is rejected without changing readiness or board; valid straight contiguous fleet with exactly 17 occupied cells is accepted. |
| TC-04 Invalid attack coordinates (`backend/gameManager.js:213`) | In an active A/B game on A's turn, emit attacks with missing, null, negative, 10, fractional, string, and very large `x`/`y`; follow with a valid attack. | Each invalid input produces a controlled validation error; no uncaught exception, board change, move, turn change, or opponent event; valid attack still works. |
| TC-05 Duplicate bracket (`backend/services/tournamentService.js:250`; `backend/server.js:534-540`; `backend/tournamentManager.js:25`) | Start a four-player tournament and count bracket rows before/after; repeat/retry start. | Exactly one bracket and expected match count per round; retry is idempotent or explicitly rejected without extra rows. |
| TC-06 Unauthorized/duplicate tournament room (`backend/server.js:620`) | Ready A/B match. C emits `tournament:createGame {matchId}`; A emits once, then A/B repeat and race the same request; try a pending/completed match. | C and invalid states are denied; one room ID is associated with the match; retries return that room or a controlled conflict; no duplicate rooms or overwritten player-room mapping. |
| TC-07 Game-completion stats write (`backend/server.js:232-240`; `backend/routes/profileRoutes.js:67-84,133-137`) | Finish a socket 1v1 match. Read the completed `games` record and both players' profile stats; retry/replay the completion path. | One finished record contains both players, winner, and end timestamp; winner's wins and both games played rise once, loser's losses rise once, and profile recent games includes the result. No double count on retry. Verify deployed trigger or atomic counter-write mechanism. |
| TC-08 Unsupported tournament count (`backend/services/tournamentService.js:231-253`; `backend/server.js:534-540`) | Attempt `tournament:start` with three and five registered players, then with four. | Three/five receive a clear socket error before status or match inserts; four starts once. No bye rows or missing-player dereference. |

## Additional release checks

- **State secrecy/ownership:** outsider `game:getState` is rejected; A's response omits B's unhit ship coordinates and full board (`backend/server.js:326-335`; `backend/gameManager.js:412`).
- **Turn policy:** confirm the documented hit/miss rule against the one socket engine, including terminal shots (`backend/gameManager.js:275-303`).
- **Token/RLS:** reject invalid/expired tokens; verify query-string token removal or logging controls; test direct anon-client access under actual Supabase RLS policies (`backend/middleware/socketAuth.js:9`; `backend/config/supabase.js:6`).
- **API routing:** confirm `/api/profile/search` and `/api/profile/leaderboard` reach their intended handlers despite `/:userId` preceding them (`backend/routes/profileRoutes.js`).
- **Reliability:** disconnect during setup/play, reconnect behavior, duplicate attacks, duplicate result submissions, and server restart behavior are explicit and observed.

## Existing automated coverage and gaps

Checked-in frontend tests are `frontend/src/test/GameBoard.test.jsx` and `frontend/src/test/gameHelpers.test.js`, with `setup.js`. These cover component/helper behavior but do not exercise authenticated socket handlers, Supabase RLS, tournament bracket persistence, or the cases above. No backend test files are present in the inspected tree. The README's broad testing claim should be interpreted as frontend-focused until these gaps are closed. Run the existing suite as a baseline, add focused backend regression tests, and retain manual two-player/tournament playtests because socket ordering and deployed RLS are integration concerns.

## Entry, exit, and defect handling

Entry: staging Supabase project and test accounts available, deterministic fixtures seeded, turn rule recorded, power-of-two tournament policy enforced, and patched socket handler deployable. Exit: all mandatory cases pass on `server.js`; no critical/high defect remains; full 1v1 and tournament flow (if enabled) pass manually; stats write, RLS, and CORS verified in deployment target. Log failures with event payload, actor, room/match ID, expected versus actual state, and reproducible steps; retest the fix and nearby flows.

## References

- `docs/CODE_REVIEW_2026-11-02.md`, six Critical/High findings and Medium findings.
- `docs/MVP_SCOPE_REVIEW.md`, resolved Decision and MVP scope.
- `docs/MVP_PROPOSAL.md`, §§3, 5-6.
- `README.md`, Testing and Game Rules.
- `backend/server.js`; `backend/gameManager.js`; `backend/tournamentManager.js`; `backend/services/tournamentService.js`; `backend/routes/profileRoutes.js`.
- `frontend/src/test/GameBoard.test.jsx`; `frontend/src/test/gameHelpers.test.js`; `frontend/src/test/setup.js`.
