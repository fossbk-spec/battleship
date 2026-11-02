# Code Review — 2026-11-02

- **Scope:** backend/server.js, backend/index.js, backend/gameManager.js,
  backend/tournamentManager.js, backend/api/*.js, backend/middleware/*.js,
  backend/services/*.js, backend/config/supabase.js, frontend/src/stores/*.js,
  frontend/src/services/*.js, frontend/src/hooks/*.js, frontend/src/utils/*.js
- **Method:** automated read-only pass (Codex, gpt-6-luna, low reasoning effort), no runtime
  testing performed. Findings are static-analysis observations and should be confirmed by
  manual testing before being treated as fully verified.

## Critical

- **Unauthenticated users can control tournament results.** Any authenticated socket can submit
  `tournament:matchComplete` with an arbitrary `matchId` and `winnerId`; the handler records it
  without checking that the caller is a player in that match or that the winner is one of its
  players. The REST `completeTournamentMatch` action needs the same authorization review.
  `backend/server.js:687` · `backend/api/game.js:63`

- **Socket chat and typing events can target arbitrary rooms.** They broadcast using
  client-supplied `gameId` without checking room membership, so a connected user can inject
  messages or typing indicators into other Socket.IO rooms.
  `backend/server.js:375` · `backend/server.js:405`

## High

- **Ship placements are not validated against the submitted board.** `validateShips` checks
  fleet sizes, bounds, and overlap, but not straight-line shape, exact cell count, or whether the
  board matches the ship coordinates. `placeShips` then trusts the supplied board and ship data,
  allowing malformed fleets and inconsistent game state.
  `backend/gameManager.js:162` · `backend/gameManager.js:366`

- **Coordinates are unchecked before indexing the board.** `makeAttack` reads
  `defender.board[y][x]`; invalid, missing, or non-integer coordinates can throw or bypass
  expected game behavior.
  `backend/gameManager.js:213`

- **Tournament bracket generation conflicts and fails for non-power-of-two player counts.**
  `startTournament` already generates a bracket through `tournamentService.startTournament`,
  then the socket handler calls `tournamentManager.generateBracket` again. That manager uses
  `Math.log2(playerCount)` and assumes pairs exist; odd counts can dereference a missing
  participant, and repeated inserts can conflict.
  `backend/services/tournamentService.js:250` · `backend/server.js:534` · `backend/tournamentManager.js:25`

- **Tournament game rooms can be created by nonparticipants and duplicated.**
  `tournament:createGame` does not verify the caller is in the match or that the match is ready,
  and it creates a fresh room every time.
  `backend/server.js:620`

## Medium

- **Game state is readable for any authenticated user who knows a room ID.**
  `getGameStateForPlayer` checks that the requested user is in the room, but the socket handler
  responds with an error only when the room is missing; an outsider receives `null` without a
  proper authorization check, making the endpoint's access rule unclear and brittle.
  `backend/server.js:326` · `backend/gameManager.js:412`

- **REST room joining is race-prone.** It checks `status` and `player2_id`, then updates by room
  ID alone. Concurrent joins can overwrite each other and both report success.
  `backend/api/game.js:145`

- **The backend service-role key bypasses RLS.** This is appropriate only when every server
  operation enforces authorization itself; several tournament operations and client-supplied
  state updates do not. The key is read from the server environment and not visibly hard-coded
  or sent to the frontend.
  `backend/config/supabase.js:6`

- **Socket authentication accepts query-string tokens.** Tokens in URLs can end up in logs and
  telemetry; prefer the Socket.IO `auth` payload or authorization header.
  `backend/middleware/socketAuth.js:9`

## Notable quality issues

- Backend logic is duplicated between `server.js` and `api/socketio.js`, increasing the chance
  that fixes and authorization checks diverge.
- The frontend tournament store contains a `checkAndFixAllRounds` action that exposes bracket
  repair operations to the client-facing service.
  `frontend/src/stores/tournamentStore.js:320`
- The frontend Supabase anon key is public by design; security depends on correct Supabase RLS
  policies, which were outside the requested file set.
  `frontend/src/services/supabase.js:3`
