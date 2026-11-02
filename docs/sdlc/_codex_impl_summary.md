Implemented the Phase 3 backend fixes. The retired REST game path and duplicate socket file are removed; the kept Socket.IO engine now checks match and room membership, validates fleets and attack coordinates, protects opponent ship positions, and creates one tournament bracket and room per match. Non-tournament 1v1 completion uses an idempotent Supabase RPC to record the game and update both profiles atomically.

**Files changed**

- Deleted [backend/api/game.js](C:/Antigravity/battleship-game/backend/api/game.js) and [backend/api/socketio.js](C:/Antigravity/battleship-game/backend/api/socketio.js).
- Updated [backend/api/index.js](C:/Antigravity/battleship-game/backend/api/index.js), [backend/gameManager.js](C:/Antigravity/battleship-game/backend/gameManager.js), [backend/middleware/socketAuth.js](C:/Antigravity/battleship-game/backend/middleware/socketAuth.js), [backend/server.js](C:/Antigravity/battleship-game/backend/server.js), [backend/services/tournamentService.js](C:/Antigravity/battleship-game/backend/services/tournamentService.js), and [backend/tournamentManager.js](C:/Antigravity/battleship-game/backend/tournamentManager.js).
- Added [backend/database/schema.sql](C:/Antigravity/battleship-game/backend/database/schema.sql) and [backend/test/gameManager.test.js](C:/Antigravity/battleship-game/backend/test/gameManager.test.js).

**Verification:** Four focused backend tests pass; Node syntax checks and `git diff --check` pass. I skipped frontend Vitest because its dependencies are not installed. No server, browser, package install, or Supabase connection was used.

**Human verification needed:** The SQL schema and `record_completed_game` RPC are inferred from code. Check them against deployed Supabase, especially profile IDs, RLS, and whether an existing trigger also increments stats. The repository’s `.gitignore` ignores `backend/database/schema.sql`; it exists locally but will need a force-add to commit.