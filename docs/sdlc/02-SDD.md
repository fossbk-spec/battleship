# Software Design Document — Battleship PvP MVP

**Version:** 1.1  
**Date:** 2026-11-02

## Architecture

For v1.0, `backend/server.js` is the one authoritative Socket.IO game entry point. It uses `backend/gameManager.js` for in-memory lobby, 1v1, and chat state and `backend/tournamentManager.js` / `backend/services/tournamentService.js` for tournament state and Supabase persistence. The React/Vite client authenticates with Supabase and uses `frontend/src/services/socket.js` for gameplay. Existing `realtimeGameService` REST gameplay calls require migration to this socket contract before release (`backend/server.js:45-66,196-240,534-543`; `backend/gameManager.js:8-14`; `frontend/src/services/realtimeGameService.js:1-90`).

```text
Browser: React UI -> Zustand stores -> socket.js -> server.js + Socket.IO
                                                   |-> gameManager (rooms in memory)
                                                   |-> tournamentManager / tournamentService -> Supabase
                  -> Supabase Auth / profile reads --------------------------> Supabase
                  -> Express /api/profile -> profileRoutes ------------------> Supabase
```

Retire and delete the unmounted duplicate `backend/api/socketio.js` and the `createRoom`, `joinRoom`, `placeShips`, `attack`, `getGameState`, `leaveRoom`, `sendMessage`, and `completeTournamentMatch` actions in `backend/api/game.js` for v1.0. Its `getRooms` action is also REST game state and must leave the exposed contract. Keep health/docs metadata in `backend/api/index.js` and Express `backend/routes/profileRoutes.js`; `api/game.js` does not currently define those non-game routes (`backend/api/index.js:18-84`; `backend/server.js:35-45`; `backend/api/game.js:39-69`). This is a temporary scope cut. If v2 needs stateless/serverless or external-client gameplay, design a thin adapter over the same `gameManager` rules; do not restore the independent `api/game.js` implementation (`docs/MVP_SCOPE_REVIEW.md`, Decision).

## Data model

The following is a **query-derived model** for the kept path, not a verified SQL schema. `database/schema.sql` is still missing. Add a minimal schema file and verify its tables, types, keys, triggers, and RLS against the deployed Supabase schema before release (`README.md`, Database Setup; `docs/MVP_SCOPE_REVIEW.md`, MVP scope item 9).

| Store / table | Fields observed and relationships | Source |
| --- | --- | --- |
| In-memory `rooms` map | `id`, `hostId`, `isPrivate`, `isTournament`, `tournamentId`, `matchId`, `status`, `players[{id,username,ready,ships,board}]`, `currentTurn`, `moves`, `winner`, `createdAt`; `playerRooms` maps user to room. | `backend/gameManager.js:8-94` |
| `profiles` | `id`, `user_id`, `username`, `avatar_url`, `wins`, `losses`, `games_played`; referenced by auth users, tournaments, and profile routes. | `backend/middleware/socketAuth.js:41-45`; `backend/routes/profileRoutes.js` |
| `games` (completion record) | Minimal finished 1v1 result: `player1_id`, `player2_id`, `winner_id`, `status`, `ended_at`, plus deployed-schema required columns. Profile stats/recent games read this table. Verify the deployed mechanism that updates profile counters from completion. | `backend/server.js:232-240`; `backend/routes/profileRoutes.js:67-84,133-137`; `backend/api/game.js:468-489` (retired write) |
| `tournaments` | `id`, `name`, `description`, `max_players`, `created_by`, `registration_ends_at`, `status`, `started_at`, `ended_at`, `winner_id`, `bracket_data`, `current_round`, `created_at`. | `backend/services/tournamentService.js:13-55,239-352`; `backend/tournamentManager.js:47-48` |
| `tournament_participants` | `id`, `tournament_id`, `user_id`, `seed`, `current_round`, `eliminated`, `placement`, `joined_at`. | `backend/services/tournamentService.js:77-175`; `backend/tournamentManager.js:220,296-297` |
| `tournament_matches` | `id`, `tournament_id`, `round`, `match_number`, `bracket_position`, `player1_id`, `player2_id`, `winner_id`, `status`, `next_match_id`, `started_at`, `completed_at`. | `backend/tournamentManager.js:66-160,279-282,539-542` |

Boards are 10 rows by 10 columns. The socket engine uses `empty`, `ship`, `hit`, `miss`; ship objects have `id`, `size`, `positions[{x,y}]`, later `hits` and `sunk` (`backend/gameManager.js:213-279`). REST-only `game_rooms`, `game_events`, and `chat_messages` are outside the kept server path; confirm no remaining client or deployed-schema dependency before omitting them from `database/schema.sql` (`backend/api/game.js:99-131,589-615`; `frontend/src/services/realtimeGameService.js:389`).

## REST API contract

The v1.0 REST surface contains health/docs metadata and profiles. `backend/api/index.js` currently advertises and forwards `/api/game`; remove those stale advertisements and routing during retirement (`backend/api/index.js:39-84`). `backend/api/health.js` and `backend/api/test.js` are separate serverless endpoints. Express mounts `/api/profile` (`backend/server.js:35-45`).

| Method / route | Request | Success response | Source |
| --- | --- | --- | --- |
| `GET /`, `/api` | None | API metadata | `backend/api/index.js:31-56` |
| `GET /health`, `/api/health` | None | Health JSON | `backend/api/index.js:21-29`; `backend/server.js:35-43` |
| `GET /docs`, `/api/docs` | None | API documentation, updated to list only supported routes | `backend/api/index.js:58-79` |
| `GET /api/profile/:userId`, `/:userId/stats` | User ID | Profile; `{profile,stats,recentGames}` | `backend/routes/profileRoutes.js:1-145` |
| `PUT /api/profile` | Bearer token; `{username?,avatar_url?}` | Updated profile | `backend/routes/profileRoutes.js:150-222` |
| `GET /api/profile/search`, `/leaderboard` | `q` or `limit` | Matching or ranked profiles | `backend/routes/profileRoutes.js:225-280` |

Profile reads use optional auth; profile update requires a bearer token. Route ordering places `/:userId` before `/search` and `/leaderboard`, so those static routes may be shadowed; verify during API testing (`backend/routes/profileRoutes.js:1-35,225-280`).

## Socket.IO event contract

The persistent server authenticates at handshake, creates `user:<userId>` rooms, then sends `welcome {message,userId,username}`. `C→S` means client emits; `S→C` means server emits. All errors are `error {message}`. This table is the sole v1.0 gameplay contract (`backend/server.js:45-66`).

| C→S event and payload | S→C result and payload |
| --- | --- |
| `lobby:getRooms` (none) | `lobby:roomList` array of `{id,hostId,hostUsername,playerCount,createdAt}` |
| `lobby:createRoom {isPrivate?}` | `lobby:roomCreated {roomId,isPrivate}`; public `lobby:roomList` broadcast |
| `lobby:joinRoom {roomId}` | `lobby:roomJoined {roomId}`; `game:setupPhase {roomId,players:[{id,username}]}` to room; room list broadcast |
| `lobby:quickMatch` (none) | Currently emits `lobby:joinRoom {roomId}` or `lobby:createRoom {isPrivate:false}` **to the client**, rather than invoking the server handlers; client behavior must be confirmed. |
| `game:placeShips {roomId,ships,board}` | `game:shipsPlaced {success:true}`; `game:opponentReady {playerId}` or per-player `game:start <player-filtered state>` |
| `game:attack {roomId,x,y}` | Attacker `game:attackResult {x,y,result,gameState}`; defender `game:attacked` same shape; room `game:over {winner,winnerUsername}` when finished |
| `game:getState {roomId}` | `game:state <player-filtered state>`; currently outsider gets null rather than explicit denial |
| `game:leave {roomId}` | `game:left {success:true}`; room list broadcast |
| `chat:sendMessage {gameId,message}` | Room `chat:message {userId,username,message,timestamp}` |
| `chat:typing {gameId,isTyping}` | Other room sockets `chat:typing {userId,isTyping}` |
| `tournament:getAll {status?}` / `getDetails {tournamentId}` | `tournament:list` array / `tournament:details` object |
| `tournament:create {name,description?,maxPlayers?,registrationEndsAt?}` | `tournament:created` object; global `tournament:new` object |
| `tournament:join {tournamentId}` / `leave {tournamentId}` | `tournament:joined {tournamentId,participant}` / `tournament:left {tournamentId}`; `tournament:playerJoined` / `playerLeft`; updated `tournament:list` |
| `tournament:start {tournamentId}` | For a power-of-two count of at least two registered players, `tournament:started {tournamentId,bracket,tournament}` and per-player `tournament:yourMatch {tournamentId,match,opponent}`; otherwise a clear `error {message}` before state changes (`backend/server.js:534-543`; `backend/services/tournamentService.js:220-253`). |
| `tournament:getBracket {tournamentId}` | `tournament:bracket {tournamentId,matches,bracket_data}` |
| `tournament:startMatch {matchId}` | `tournament:matchStarting {matchId,tournamentId,round}` to both players; caller `tournament:matchStarted <matchData>` |
| `tournament:createGame {matchId}` | Both players `tournament:gameCreated {roomId,room,matchId,tournamentId}` |
| `tournament:matchComplete {matchId,winnerId}` | `tournament:matchCompleted {matchId,winnerId,round}`, `tournament:bracketUpdated {tournamentId,matches}`, then `tournament:nextRound {tournamentId,round}` / `tournament:completed {tournamentId,winnerId,winner}` and next `yourMatch` events |
| `tournament:cancel {tournamentId}` / `getUserTournaments` | `tournament:cancelled {tournamentId}` and list / `tournament:userTournaments` array |

## Key sequences

1. **Match creation:** an authenticated socket creates or joins a room; `gameManager` stores it in memory and `server.js` places sockets in the room (`backend/server.js:66-145`; `backend/gameManager.js:8-94`).
2. **Ship placement:** each participant submits `ships` and `board`; `gameManager` validates the fleet, marks both ready, and starts play with a first turn (`backend/server.js:147-190`; `backend/gameManager.js:162-213`).
3. **Attack and completion:** `gameManager` validates participant, turn, coordinates, and prior shots; it updates the in-memory board and winner, then `server.js` emits player-filtered results. At `result.gameOver`, add one idempotent Supabase write of the completed match with both players, winner, and timestamp to the deployed `games` schema, before or alongside `game:over`. Verify that this write updates `profiles.wins/losses/games_played` through the deployed stats mechanism; if no trigger exists, update those counters atomically as part of completion. This is a small persistence write within the same engine (`backend/gameManager.js:213-303`; `backend/server.js:196-240`; `backend/routes/profileRoutes.js:67-84,133-137`). Keep opponent unhit ships out of emitted state.
4. **Tournament progression:** reject start before mutation unless registered count is a power of two; one bracket generator seeds players and inserts matches. Assigned players create one room and complete an authorized match; `tournamentManager` persists the result and advances the winner. Remove the duplicate generator call at `server.js:540` after `tournamentService.startTournament` already generates a bracket (`backend/services/tournamentService.js:220-253`; `backend/server.js:534-543`; `backend/tournamentManager.js:18-160`). Bye logic is deferred to v1.1+.

## References

- `README.md`, Tech Stack and Game Rules.
- `docs/MVP_PROPOSAL.md`, §§3, 5-6.
- `docs/CODE_REVIEW_2026-11-02.md`.
- `docs/MVP_SCOPE_REVIEW.md`, Recommendation, MVP scope, and resolved Decision.
- `backend/server.js`; `backend/api/index.js`; `backend/api/game.js`; `backend/api/socketio.js`; `backend/gameManager.js`; `backend/tournamentManager.js`; `backend/services/tournamentService.js`; `backend/routes/profileRoutes.js`.
- `frontend/src/services/realtimeGameService.js`; `frontend/src/services/socket.js`; `frontend/src/services/tournamentService.js`; `frontend/src/stores/gameStoreRealtime.js`.
