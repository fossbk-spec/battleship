# Software Requirements Specification — Battleship PvP MVP

**Version:** 1.0 (baseline draft)  
**Date:** 2026-11-02

## Purpose and scope

This specification covers the existing React/Vite client, Node/Express/Socket.IO server, serverless REST game API, and Supabase Auth/PostgreSQL used for 1v1 Battleship, AI practice, profiles, chat, and optional tournament play. It distinguishes implemented behavior from release requirements: the six critical/high findings in the code review are unresolved acceptance gates, not claims of current correctness. The README's “production ready” label is therefore not an MVP acceptance decision.

## Actors

| Actor | Goal / access |
| --- | --- |
| Guest | Sign up or sign in; view public profile endpoints where exposed. |
| Authenticated player | Create/join rooms, play 1v1 or AI practice, chat with room members, view own match state and statistics. |
| Tournament creator | Configure and start/cancel a tournament; participate when registered. |
| Tournament participant | Register, play assigned matches, and view bracket progression. |
| Supabase | Verify identities and persist REST-path rooms/games/events, profiles, and tournament records. |
| Operator | Configure secrets, deploy services, monitor failures, and decide tournament launch scope. |

## Functional requirements

| ID | Requirement and acceptance condition | Basis |
| --- | --- | --- |
| FR-01 | Authenticate protected REST actions with a Supabase bearer token and Socket.IO connections with a verified token; reject absent/invalid credentials. | `backend/api/game.js:20-35`; `backend/middleware/socketAuth.js:9-39` |
| FR-02 | Allow players to list public waiting rooms, create public/private rooms, join an available two-player room by ID, leave, and request quick match. Joining must assign at most one second player, even under concurrent REST requests. | `backend/server.js:66-155`; `backend/api/game.js:79-265` |
| FR-03 | Run a 10×10 game with one each of ships of lengths 5, 4, 3, 3, and 2. Accept only five straight, contiguous, nonoverlapping, in-bounds ships with exact position counts and a board consistent with those positions; only room players may place ships. | `backend/gameManager.js:162-183,366-402`; README Game Rules |
| FR-04 | Start when both players are ready; enforce turn and duplicate-shot rules; accept only integer coordinates 0–9; report hit/miss/sunk/win; keep each opponent's unhit ship locations secret. The Socket.IO and REST variants currently have different turn rules and must have an explicitly chosen canonical rule before release. | `backend/gameManager.js:194-282`; `backend/api/game.js:400-585` |
| FR-05 | Expose only the requesting participant's game view; reject outsider room-state requests explicitly. REST responses must redact the opponent's full board and ship list. | `backend/gameManager.js:412`; `backend/server.js:326`; `backend/api/game.js:562-585` |
| FR-06 | Permit room chat and typing indicators only from members of that game room; cap chat messages at 200 characters. | `backend/server.js:375-415` |
| FR-07 | Support AI practice mode in the client, without requiring a second user. | `frontend/src/stores/aiGameStore.js`; `frontend/src/services/aiOpponent.js` |
| FR-08 | Provide basic profile read/update, user search, and win/loss/game history stats. | `backend/routes/profileRoutes.js`; `frontend/src/stores/authStore.js` |
| FR-09 | Allow tournament creation, registration, bracket display, match play, advancement, and completion only when tournament mode passes its release gate. Generate one bracket per tournament and handle the accepted player-count policy, including non-power-of-two registrations or a clear pre-start rejection. | `backend/server.js:422-785`; `backend/services/tournamentService.js:225-270`; `backend/tournamentManager.js:15-126` |
| FR-10 | Only a match participant or trusted server game-completion path may cause match completion; winner must equal a match player, match must be ready/in progress, and repeated submissions must be idempotent. Only assigned participants may create one game room for a ready tournament match. | `backend/server.js:620-753`; `backend/api/game.js:619-695` |

## Non-functional requirements

| ID | Requirement / measurable release check |
| --- | --- |
| NFR-P1 | In a representative two-player local/staging playtest, lobby updates, placement acknowledgments, and attack results should arrive within 1 second at the 95th percentile; measure and record this before setting production SLOs. No performance result is asserted here. |
| NFR-P2 | Support a complete 10×10 match without unbounded event/room growth; load-test the expected classroom concurrency once audience size is known. |
| NFR-S1 | Recheck authenticated identity against room membership or match participants on **every** state-changing and state-reading endpoint, including socket chat/typing, `tournament:matchComplete`, `tournament:createGame`, REST `completeTournamentMatch`, and `getGameState`. Never rely on client-supplied user or winner IDs for authority. |
| NFR-S2 | Validate payload shape, board/ship consistency, coordinate bounds, tournament state, and transition preconditions before indexing arrays or writing Supabase. Return controlled 4xx/socket errors without mutation for invalid input. |
| NFR-S3 | Keep the backend service-role key server-side; verify Supabase RLS for direct client queries; remove query-string token fallback or prove it cannot be logged. Redact opponent ship data in every game-state response. | 
| NFR-R1 | A match result and bracket advancement must be applied once. Duplicate requests, reconnects, and retries must not create duplicate rooms or bracket rows. |
| NFR-R2 | A disconnect must have a defined outcome (reconnect or forfeit) and preserve a coherent winner and statistics; exercise the full flow manually. |
| NFR-M1 | Maintain one authoritative implementation of each game/tournament authorization rule across `server.js`, `api/socketio.js`, and REST as applicable; regression tests must cover every exposed path. |

## Constraints and assumptions

- Existing stack: React 19/Vite 7/Zustand in the client; Node 18+/Express 4/Socket.IO 4; Supabase Auth and PostgreSQL. Deployment configuration targets Vercel for frontend/serverless API and Railway/Render for the persistent socket server (README; `backend/api/index.js`).
- `gameManager` state is process memory (`backend/gameManager.js:8-14`); socket matches need a persistent Node process and do not automatically survive restart or horizontal scaling. The REST path persists separate state in Supabase.
- The REST and socket game paths differ in turn behavior (`backend/gameManager.js:280`; `backend/api/game.js:480`); product rules must be reconciled in design/implementation.
- The repository has no checked-in `database/schema.sql` despite the README setup instruction; the SDD's database model is inferred from queries and must be verified against the deployed schema.
- Tournament participation count and launch deadline remain owner decisions (MVP proposal §7).

## Out of scope for the MVP

Ranked ladder/leaderboard as a product feature, monetization (ads/in-app purchases), and daily-login or progression mechanics are deferred per MVP proposal §5. An existing public `GET /api/profile/leaderboard` endpoint is documented as current behavior; its presence does not commit the MVP to a ranked ladder. Tournament mode may move to v1.1 if the six findings cannot be closed before v1.0.

## References

- `README.md`, Core Features, Game Rules, Tech Stack, Deployment.
- `docs/MVP_PROPOSAL.md`, §§3, 5-7.
- `docs/CODE_REVIEW_2026-11-02.md`, Critical, High, Medium, Notable quality issues.
- `backend/server.js`; `backend/gameManager.js`; `backend/api/game.js`; `backend/middleware/socketAuth.js`; `backend/routes/profileRoutes.js`.
- `frontend/src/stores/aiGameStore.js`; `frontend/src/services/aiOpponent.js`.
