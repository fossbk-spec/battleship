# Software Development Plan — Battleship PvP MVP

**Version:** 1.1  
**Date:** 2026-11-02

## Goal and release policy

Harden the existing React/Node/Supabase implementation for a classmates 1v1 release. Tournament mode is included in v1.0 only if the six critical/high findings and its end-to-end QA pass; otherwise disable it for v1.0 and deliver it as v1.1. This formalizes MVP proposal §6. A README statement of “production ready” does not override the security gate.

## Phases and gates

| Phase | Entry criteria | Work and deliverables | Exit criteria |
| --- | --- | --- | --- |
| 1. Requirements | README, review, and proposal available. | Baseline SRS; record the resolved temporary REST-game retirement and power-of-two tournament policy; resolve owner questions on target audience and deadline; choose turn rule, tournament v1.0 decision, and expected concurrency. Map the six findings to acceptance tests (`docs/MVP_SCOPE_REVIEW.md`, Decision and MVP scope). | SRS and release scope approved; every high-risk behavior has an observable criterion. |
| 2. Design | Requirements decisions recorded. | Use `server.js` + `gameManager.js` + `tournamentManager.js`/`tournamentService.js` as the single Socket.IO engine. Define room/match authorization, idempotent bracket/room creation, redacted game-state DTOs, pre-start rejection of non-power-of-two counts, and one game-completion write to Supabase for profile stats. Inspect deployed schema/RLS; `database/schema.sql` is missing (`backend/server.js:196-240,534-543`; `backend/services/tournamentService.js:220-253`; `backend/routes/profileRoutes.js:67-84,133-137`). | Socket contract, data ownership, completion-write schema, and migration needs agreed; security boundaries reviewed. |
| 3. Implementation | Design and test fixtures ready. | Delete `backend/api/socketio.js`; remove `createRoom`, `joinRoom`, `placeShips`, `attack`, `getGameState`, `leaveRoom`, `sendMessage`, and `completeTournamentMatch` (and game-state `getRooms`) from `backend/api/game.js`. Remove `/api/game` dispatch and stale documentation from `api/index.js`; retain health/docs and `profileRoutes.js`. Migrate any active frontend REST gameplay calls. Fix socket authorization, chat, fleet/board and attack validation, duplicate bracket/room creation, state secrecy, and token-query fallback. Implement non-power-of-two tournament start rejection and an idempotent game-over Supabase result/stats write (`backend/api/index.js:39-84`; `backend/api/game.js:39-69`; `backend/server.js:232-240,534-540`). | Code review confirms one exposed game engine and each fix; schema/config changes tracked; focused tests added. |
| 4. Testing | Implemented build deployed to isolated staging; A/B/C test identities and fixtures ready. | Execute `03-TEST-PLAN.md`: six review cases plus game-completion stats and tournament-count cases on `server.js`; verify RLS, 1v1 and AI playtests, and tournament progression if enabled. Log defects. | All mandatory cases pass; no critical/high defect remains; tournament either passes full gate or is disabled for v1.0; documented residual risks accepted. |
| 5. Deployment | Testing exit met; secrets and rollback prepared. | Build frontend, deploy the frontend and persistent Socket.IO backend on Railway/Render as applicable, with remaining health/docs/profile routes; set CORS and Supabase credentials; verify health, auth, RLS, two-account match, profile stats, and tournament scope on deployed stack. | Smoke tests pass, monitoring/log access exists, rollback to prior release tested or documented, release version and enabled features recorded. |
| 6. Maintenance | Release live with owner/operator assigned. | Triage auth/game defects, monitor errors and match completion, review event/room retention and service-role use, update tests and contracts with each change; schedule v1.1 tournament if deferred. | Each maintenance change repeats relevant regression and deployment gates; incidents and schema/contract drift are recorded. |

## Sequencing and dependencies

1. Close the two critical authorization findings before allowing tournament or cross-room chat. These checks must be enforced at the socket server, independent of client UI state (`backend/server.js:375,405,687`).
2. Close four high findings: exact ship/board validation, coordinate bounds, single bracket generator with non-power-of-two start rejection, and one authorized room per tournament match (`backend/gameManager.js:162-213,366`; `backend/server.js:534,620`; `backend/services/tournamentService.js:231-253`).
3. Retire the duplicate socket file and REST game actions, migrate live callers, then test the one supported socket entry point. Add the game-over result write so profile stats continue to update (`backend/api/socketio.js`; `backend/api/game.js:39-69`; `backend/server.js:232-240`; `backend/routes/profileRoutes.js:67-84,133-137`).
4. Make a go/no-go decision for tournament mode before release candidate testing. If deferred, remove user access and tournament-related completion paths from the v1.0 deployment surface, then schedule a separate v1.1 gate.
5. Perform staging and deployment QA; inspect Supabase RLS and service-role operations because server-side authorization is the control when the service role bypasses RLS (`backend/config/supabase.js:6`).

## Roles, change control, and artifacts

The project owner decides audience, deadline, and tournament scope; the REST-game retirement and power-of-two start rule are already resolved (`docs/MVP_SCOPE_REVIEW.md`, Decision and MVP scope). The developer owns code and focused regression tests; reviewer checks authorization and state invariants; tester/operator executes staging playtests and deployment smoke checks. One person may fill multiple roles, but the release decision must be recorded. Changes to the turn rule, fleet format, socket payloads, or database columns require SRS/SDD and test-plan updates in the same change. Track each code-review finding by its test-case ID from `03-TEST-PLAN.md` and do not mark it closed from static review alone.

## Schedule and contingency

No deadline or team capacity is supplied, so this plan uses gates rather than invented dates. The critical path is authorization fixes → validation/bracket fixes → integration QA → deployed RLS/smoke verification. If time is insufficient, ship 1v1 plus AI only after its own security and gameplay checks; defer tournament to v1.1 rather than relaxing the gate. Reserve time for schema/RLS discovery and two-account playtesting, since neither is covered by the existing frontend Vitest suite.

## References

- `docs/MVP_PROPOSAL.md`, §§3, 5-7 (source phased work plan and release trim).
- `docs/CODE_REVIEW_2026-11-02.md`, Critical, High, Medium, Notable quality issues.
- `docs/MVP_SCOPE_REVIEW.md`, resolved Decision and MVP scope.
- `README.md`, Development Status, Testing, Deployment.
- `docs/sdlc/01-SRS.md`; `docs/sdlc/02-SDD.md`; `docs/sdlc/03-TEST-PLAN.md`.
- `backend/server.js`; `backend/api/socketio.js`; `backend/api/game.js`; `backend/config/supabase.js`.
