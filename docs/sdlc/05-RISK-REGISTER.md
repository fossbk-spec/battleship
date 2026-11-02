# Risk Register — Battleship PvP MVP

**Version:** 1.1  
**Date:** 2026-11-02

## Scoring and ownership

Likelihood and impact are qualitative (Low/Medium/High) until staging evidence and owner priorities are available. High impact means a security breach, invalid match result, or release blockage. The owner owns scope/schedule decisions; the backend developer owns technical mitigations; the tester verifies closure. The six code-review findings remain open until their `03-TEST-PLAN.md` cases pass. Retirement risks below close only after the planned code deletion is verified (`docs/MVP_SCOPE_REVIEW.md`, Decision).

| ID | Risk / evidence | Likelihood | Impact | Mitigation and closure evidence |
| --- | --- | --- | --- | --- |
| R-01 | Authenticated outsider can submit a tournament winner through the socket handler (`backend/server.js:687`). | High | High | Authorize caller against match/recorded game result, validate winner and status, make update idempotent. Pass TC-01 on the socket path. |
| R-02 | Chat and typing can be injected into another room by supplying its ID (`backend/server.js:375,405`). | High | High | Check socket and game membership before either broadcast; pass TC-02 on the socket path. |
| R-03 | Malformed fleet or board can change game outcome (`backend/gameManager.js:162,366`). | High | High | Validate exact 17 cells, straight contiguous shapes, bounds, uniqueness, board parity; reject mutation; pass TC-03. |
| R-04 | Invalid coordinates may throw or corrupt attack state (`backend/gameManager.js:213`). | High | High | Require integer 0–9 coordinates before board indexing; pass TC-04. |
| R-05 | Duplicate bracket generation and non-power-of-two registrations can break pairing or partially insert rows (`backend/services/tournamentService.js:231-253`; `backend/server.js:534-540`; `backend/tournamentManager.js:25`). | High | High | Use one idempotent generator; reject unsupported counts before mutation with a clear error; pass TC-05 and TC-08. Bye logic is deferred to v1.1+. |
| R-06 | Nonparticipant can create tournament room; retries create duplicates and overwrite player-room map (`backend/server.js:620`). | High | High | Require assigned participant and ready match; persist/return one room per match; pass TC-06. |
| R-07 | Broader public audience would increase abuse, capacity, and support requirements (`docs/MVP_SCOPE_REVIEW.md`, MVP scope: Public-audience hardening). | Medium | High | **Deferred to v1.1+:** classmates MVP; reassess with owner before public expansion and add rate limits, abuse controls, and capacity targets then. |
| R-08 | Unknown deadline may force a premature tournament launch (`docs/MVP_PROPOSAL.md`, section 7). | High | High | Record date and capacity; use v1.0 1v1+AI trim if tournament gate cannot be met; keep tournament inaccessible until v1.1. |
| R-09 | Dual-path divergence from independent REST gameplay and duplicate socket handlers (`backend/api/game.js:39-69`; `backend/api/socketio.js`; `backend/server.js:45-66`). | High | High | **Resolved by design once retirement is implemented:** deleting REST game actions and `api/socketio.js` leaves `server.js` as the only game authority. Verify deletion and caller migration at implementation gate (`docs/MVP_SCOPE_REVIEW.md`, Decision). |
| R-10 | Supabase service-role bypasses RLS; direct frontend queries depend on unverified policies (`backend/config/supabase.js:6`; `frontend/src/services/tournamentService.js`). | Medium | High | Inspect deployed schema/RLS, test anon and authenticated direct access, minimize service-role scope, require app-layer authorization. |
| R-11 | Socket outsider receives null rather than explicit denial and player-filtered state needs secrecy verification (`backend/server.js:326-335`; `backend/gameManager.js:412`). | High | High | Enforce participant-only reads and redacted response DTO; add state-secrecy integration test. |
| R-12 | Concurrent REST joins overwrite `player2_id` (`backend/api/game.js:145-195`). | Medium | Medium | **Not applicable once retirement is implemented:** REST `joinRoom` is deleted; Socket.IO room joins execute serially on the single in-process event loop (`backend/server.js:66-145`; `docs/MVP_SCOPE_REVIEW.md`, Decision). Verify endpoint removal. |
| R-13 | In-memory Socket.IO games disappear on process restart; scaling to multiple instances splits room state (`backend/gameManager.js:8-14`). | Medium | Medium | **Deferred to v1.1+:** operate one persistent instance for classmates MVP; document restart/forfeit behavior and revisit shared persistence or adapter before scaling (`docs/MVP_SCOPE_REVIEW.md`, MVP scope). |
| R-14 | Missing checked-in SQL schema and limited backend automated tests delay integration and RLS verification (`README.md`, Database Setup; `frontend/src/test/`). | High | Medium | Verify deployed schema/RLS, add minimal `database/schema.sql`, focused backend tests, and staging fixtures. |
| R-15 | Turn-rule mismatch between socket and REST engines (`backend/gameManager.js:298-300`; `backend/api/game.js:480`). | High | Medium | **Resolved by design once retirement is implemented:** deleting REST `attack` leaves the `gameManager` turn rule as the only rule; test hit/miss/terminal turns on that path (`docs/MVP_SCOPE_REVIEW.md`, Decision). |
| R-16 | Profile stats stop updating if the new Socket.IO game-over write is missed when REST gameplay is retired (`backend/server.js:232-240`; `backend/api/game.js:468-489`; `backend/routes/profileRoutes.js:67-84,133-137`). | Medium | Medium | Add an idempotent completed-match write and verify deployed trigger or atomic counter updates; pass TC-07 for winner, loser, recent games, and retry behavior. |

## Review cadence and release trigger

Review this register at each SDLC phase exit and after each defect. Update likelihood from test/production evidence and link closed risks to test runs. R-09, R-12, and R-15 close at the implementation gate after REST-game and duplicate-socket removal is verified; the design decision is resolved, but deletion has not happened yet. R-01 through R-06 and TC-08 block a tournament-enabled v1.0 build; R-02 through R-04, R-11, and R-16 block 1v1 release. R-07 and R-13 are deferred to v1.1+ for the classmates MVP. R-08 requires an owner deadline decision before scope freeze. Any new high-impact authorization finding reopens the testing gate.

## References

- `docs/CODE_REVIEW_2026-11-02.md`, Critical, High, Medium, Notable quality issues.
- `docs/MVP_SCOPE_REVIEW.md`, resolved Decision and MVP scope.
- `docs/MVP_PROPOSAL.md`, sections 5-7.
- `README.md`, Database Setup, Testing, Deployment.
- `docs/sdlc/01-SRS.md`; `docs/sdlc/02-SDD.md`; `docs/sdlc/03-TEST-PLAN.md`; `docs/sdlc/04-DEV-PLAN.md`.
- `backend/server.js`; `backend/api/game.js`; `backend/api/socketio.js`; `backend/gameManager.js`; `backend/tournamentManager.js`; `backend/services/tournamentService.js`; `backend/config/supabase.js`.
