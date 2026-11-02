import test from 'node:test';
import assert from 'node:assert/strict';
import gameManager from '../gameManager.js';

const ships = () => [5, 4, 3, 3, 2].map((size, index) => ({
  id: index,
  size,
  positions: Array.from({ length: size }, (_, x) => ({ x, y: index })),
}));
const boardFor = (fleet) => {
  const board = gameManager.createEmptyBoard();
  for (const ship of fleet) for (const { x, y } of ship.positions) board[y][x] = 'ship';
  return board;
};

test('accepts an exact fleet and matching board', () => {
  const fleet = ships();
  assert.equal(gameManager.validateShips(fleet, boardFor(fleet)), true);
});

test('rejects malformed fleets and mismatched boards', () => {
  const fleet = ships();
  const board = boardFor(fleet);
  const invalid = [
    { ...fleet[0], positions: fleet[0].positions.slice(1) },
    { ...fleet[0], positions: [{ x: 0, y: 0 }, { x: 1, y: 1 }, ...fleet[0].positions.slice(2)] },
    { ...fleet[0], positions: [{ x: 9, y: 0 }, ...fleet[0].positions.slice(1)] },
    { ...fleet[0], positions: [{ x: 0.5, y: 0 }, ...fleet[0].positions.slice(1)] },
  ];
  for (const ship of invalid) assert.equal(gameManager.validateShips([ship, ...fleet.slice(1)], board), false);
  board[0][0] = 'empty';
  assert.equal(gameManager.validateShips(fleet, board), false);
});

test('rejects invalid attack coordinates without changing game state', () => {
  const room = gameManager.createRoom('p1', 'One', true);
  gameManager.joinRoom(room.id, 'p2', 'Two');
  for (const player of room.players) {
    const fleet = ships();
    gameManager.placeShips(room.id, player.id, fleet, boardFor(fleet));
  }
  const before = JSON.stringify(room);
  for (const [x, y] of [[null, 0], [-1, 0], [10, 0], [0.1, 0], ['1', 0], [0, undefined]]) {
    assert.throws(() => gameManager.makeAttack(room.id, room.currentTurn, x, y), /coordinates/);
  }
  assert.equal(JSON.stringify(room), before);
  const state = gameManager.getGameStateForPlayer(room.id, 'p1');
  assert.equal(state.opponentBoard[0][0], 'empty');
  assert.equal(state.opponentShips[0].positions, undefined);
  gameManager.rooms.delete(room.id);
  gameManager.playerRooms.delete('p1');
  gameManager.playerRooms.delete('p2');
});

test('reuses one room for a tournament match', () => {
  const room = gameManager.createTournamentRoom('a', 'A', 'b', 'B', 't1', 'm1');
  const retry = gameManager.createTournamentRoom('a', 'A', 'b', 'B', 't1', 'm1');
  assert.equal(retry.id, room.id);
  assert.equal(gameManager.getTournamentRoom('m1'), room);
  gameManager.rooms.delete(room.id);
  gameManager.playerRooms.delete('a');
  gameManager.playerRooms.delete('b');
});
