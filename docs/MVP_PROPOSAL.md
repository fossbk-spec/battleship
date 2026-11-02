# Battleship PvP — MVP Development Proposal

- **Version:** 1.0
- **Date:** 2026-11-02
- **Status:** Draft — pending decision

## 1. Context

`battleship-game` (cloned from `Calciferwon/battleship-game`) is a Node/Express/Socket.IO
backend + React/Vite frontend, with Supabase for auth/data. The README describes it as
"feature-complete, production ready," built for "tournament play with classmates."

A code review (Codex, read-only pass, 2026-11-02) found the implementation is structurally
solid but has 2 critical and 4 high-severity authorization/correctness bugs — see
`docs/CODE_REVIEW_2026-11-02.md` (findings summarized in §3 below).

## 2. Competitive landscape (what similar games offer)

Research was limited to public web search; treat specifics as directional, not benchmarked data.

| Capability | PlayBattleship.com | Netflix Battleship (CoolGames) | Sea Battle (mobile) | Open-source GitHub clones (HiDeny, Hackatoan, pacphi, etc.) | This repo |
|---|---|---|---|---|---|
| Real-time 1v1 PvP | Yes | Yes | Yes | Yes (basic) | Yes |
| Quick matchmaking / lobby | Yes, account-free | Yes | Yes | No (room-code or P2P link only) | Yes (lobby + quick match + room codes) |
| AI opponent | Unknown | Unknown | Yes | Some (Hackatoan: 3 difficulty levels) | Yes |
| Tournament / bracket mode | Not found | Not found | Not found | Not found | Yes (buggy — see below) |
| Chat | Unknown | Unknown | Unknown | No | Yes |
| Accounts/profile/stats | No | Unknown | Yes | No | Yes (Supabase auth + stats) |
| Monetization (ads/IAP) | Unknown | Unknown | Yes, flagged as hurting retention | No | None |
| Retention levers (daily login, progression, PvE) | Unknown | Unknown | Unknown | No | Partial (AI/PvE exists; no progression/login streaks) |

**Takeaway:** tournament mode, chat, and account-based stats are not common in either the
free-to-play competitor sites or the open-source clones found. This repo's feature set already
exceeds the typical baseline — the gap to a sellable/usable MVP is **bug fixes and hardening**,
not missing features. Ad/IAP monetization patterns in mobile competitors are not relevant to a
classmates/tournament use case and are out of scope.

## 3. Current repo state (from code review)

**Critical**
1. Tournament match results are not authorized — any authenticated socket can report an
   arbitrary winner for any match (`backend/server.js:687`, `backend/api/game.js:63`).
2. Chat/typing events can target arbitrary Socket.IO rooms — no room-membership check
   (`backend/server.js:375,405`).

**High**
3. Ship placement isn't fully validated (shape/cell-count) (`backend/gameManager.js:162,366`).
4. Attack coordinates aren't validated before indexing the board (`backend/gameManager.js:213`).
5. Bracket generation runs twice and breaks on non-power-of-two player counts
   (`backend/services/tournamentService.js:250`, `backend/server.js:534`, `backend/tournamentManager.js:25`).
6. Tournament game rooms can be created by non-participants, and duplicated (`backend/server.js:620`).

**Medium / quality**
- Implicit (not explicit) authorization on game-state reads; REST room-join race condition;
  socket auth token passed via query string; game logic duplicated between `server.js` and
  `api/socketio.js` (double-maintenance risk for any future auth fix).

None of these require a schema or architecture change — they are authorization checks and
input validation that are currently missing, plus one duplicated code path to consolidate.

## 4. Recommendation: build the MVP from the existing repo, not from scratch

**Rebuild-from-scratch cost:** re-implement real-time socket game loop, Supabase auth wiring,
lobby/room system, tournament bracket logic, chat, profile/stats, sound/UX polish, plus a test
suite and deploy configs for 3 platforms (Vercel/Railway/Render) — easily 2-4x the effort of
fixing 6 localized, well-understood bugs in a codebase that already runs end-to-end.

**Patch-the-repo cost:** ~6 targeted fixes (auth checks + input validation + removing one
duplicate bracket-generation call), one refactor (merge `server.js`/`api/socketio.js` game-logic
paths into one authority), and a QA pass. No new subsystem is needed.

Rewriting only makes sense if the goal were a different tech stack, a different game genre scope,
or if the current architecture were fundamentally wrong (e.g., client-trusted game state, which
it mostly isn't — the server holds `gameManager`/board state; it's missing checks, not missing
architecture). None of those apply here.

**Decision: ship the MVP by hardening the existing repo.**

## 5. Proposed MVP scope

**In scope for v1 (MVP):**
- 1v1 real-time PvP: lobby, quick match, private room by code — fix the join race condition.
- Core game loop: ship placement, attacks, win detection — add the missing validation (findings 3, 4).
- Auth (Supabase) + basic profile/stats — already working, no changes needed.
- Chat — fix room-scoping (finding 2).
- AI opponent (practice mode) — already working, keep as-is; it's a differentiator vs. most
  competitors and clones.

**In scope but gated on the authorization fixes (don't launch until fixed):**
- Tournament/bracket mode — fix findings 1, 5, 6 first. If time-constrained, an acceptable
  trim is: ship 1v1 + AI practice as v1.0, ship tournament mode as v1.1 once hardened — tournament
  is the single most bug-dense subsystem found.

**Out of scope for MVP (defer or cut):**
- Ranked ladder / leaderboard — not present today, not required for a classmates-tournament use
  case, no competitor evidence it's expected at MVP stage.
- Monetization (ads/IAP) — not applicable to this use case.
- Daily-login/progression retention mechanics — relevant to long-lived F2P products, not a
  one-off tournament event.

## 6. Work plan

1. **Security/bug-fix pass** — close the 2 critical + 4 high findings (§3). This is required
   regardless of which scope is chosen for v1.
2. **Consolidate duplicated backend logic** — `server.js` vs `api/socketio.js` should have one
   authoritative implementation of game/tournament handlers to stop future fixes from diverging.
3. **Decide tournament go/no-go for v1.0** based on time budget (see §5 trim option).
4. **QA pass** — extend the existing Vitest suite (currently front-end focused) to cover the
   authorization paths being fixed; manual 2-player playtest of the full match + tournament flow.
5. **Deploy** — existing Vercel/Railway/Render configs; double-check Supabase RLS policies, since
   the backend's service-role key bypasses RLS and currently relies on the app layer for
   authorization (the thing being fixed in step 1).

## 7. Open questions for the project owner

- Is the target audience still "classmates/tournament," or is broader public use intended? This
  affects whether ranked/leaderboard or anti-abuse work belongs in scope.
- Is there a deadline that forces the v1.0-without-tournament trim, or is there room to fix all
  6 findings before first launch?

## References

- Code review: `docs/CODE_REVIEW_2026-11-02.md`
- README feature list: `README.md`
- Competitor scan (web search, 2026-11-02): PlayBattleship.com, Netflix Battleship (CoolGames),
  Sea Battle (mobile), and open-source clones `HiDeny/Battleship`, `Hackatoan/battleship`,
  `pacphi/battleship`, `CPaulline/Battleship`, `keykonquest/Battleship` on GitHub.
