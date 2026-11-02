/**
 * Game State Manager
 * Manages all active game rooms, players, and game logic
 */

class GameManager {
  constructor() {
    // Store all active game rooms
    // rooms: { roomId: { players, boards, ships, turn, status, etc. } }
    this.rooms = new Map();

    // Store player to room mapping
    // playerRooms: { userId: roomId }
    this.playerRooms = new Map();

    // Store waiting rooms (public rooms looking for players)
    this.waitingRooms = new Set();
  }

  /**
   * Create a new game room
   */
  createRoom(hostId, hostUsername, isPrivate = false) {
    const roomId = this.generateRoomId();

    const room = {
      id: roomId,
      hostId,
      isPrivate,
      status: 'waiting', // waiting, setup, playing, finished
      players: [
        {
          id: hostId,
          username: hostUsername,
          ready: false,
          ships: [],
          board: this.createEmptyBoard(),
        },
      ],
      currentTurn: null,
      moves: [],
      winner: null,
      createdAt: new Date(),
    };

    this.rooms.set(roomId, room);
    this.playerRooms.set(hostId, roomId);

    if (!isPrivate) {
      this.waitingRooms.add(roomId);
    }

    return room;
  }

  /**
   * Create a tournament match room
   */
  createTournamentRoom(player1Id, player1Username, player2Id, player2Username, tournamentId, matchId) {
    const existing = this.getTournamentRoom(matchId);
    if (existing) return existing;
    const roomId = this.generateRoomId();

    const room = {
      id: roomId,
      hostId: player1Id,
      isPrivate: true,
      isTournament: true,
      tournamentId,
      matchId,
      status: 'setup', // Skip waiting, go straight to setup
      players: [
        {
          id: player1Id,
          username: player1Username,
          ready: false,
          ships: [],
          board: this.createEmptyBoard(),
        },
        {
          id: player2Id,
          username: player2Username,
          ready: false,
          ships: [],
          board: this.createEmptyBoard(),
        },
      ],
      currentTurn: null,
      moves: [],
      winner: null,
      createdAt: new Date(),
    };

    this.rooms.set(roomId, room);
    this.playerRooms.set(player1Id, roomId);
    this.playerRooms.set(player2Id, roomId);

    return room;
  }

  getTournamentRoom(matchId) {
    return [...this.rooms.values()].find((room) => room.isTournament && room.matchId === matchId);
  }

  /**
   * Join an existing room
   */
  joinRoom(roomId, playerId, playerUsername) {
    const room = this.rooms.get(roomId);

    if (!room) {
      throw new Error('Room not found');
    }

    if (room.players.length >= 2) {
      throw new Error('Room is full');
    }

    if (room.status !== 'waiting') {
      throw new Error('Game already started');
    }

    // Add player to room
    room.players.push({
      id: playerId,
      username: playerUsername,
      ready: false,
      ships: [],
      board: this.createEmptyBoard(),
    });

    this.playerRooms.set(playerId, roomId);

    // Remove from waiting rooms (now full)
    this.waitingRooms.delete(roomId);

    // Move to setup phase
    room.status = 'setup';

    return room;
  }

  /**
   * Get all available public rooms
   */
  getAvailableRooms() {
    const available = [];

    for (const roomId of this.waitingRooms) {
      const room = this.rooms.get(roomId);
      if (room && room.players.length < 2) {
        available.push({
          id: room.id,
          hostId: room.hostId,
          hostUsername: room.players[0].username,
          playerCount: room.players.length,
          createdAt: room.createdAt,
        });
      }
    }

    return available;
  }

  /**
   * Place ships for a player
   */
  placeShips(roomId, playerId, ships, board) {
    const room = this.rooms.get(roomId);

    if (!room) {
      throw new Error('Room not found');
    }

    const player = room.players.find((p) => p.id === playerId);

    if (!player) {
      throw new Error('Player not in room');
    }

    // Validate ships (5 ships, correct sizes, no overlaps, etc.)
    if (room.status !== 'setup' || player.ready) {
      throw new Error('Ship placement is not available');
    }
    if (!this.validateShips(ships, board)) {
      throw new Error('Invalid ship placement');
    }

    player.ships = ships;
    player.board = board;
    player.ready = true;

    // Check if both players are ready
    if (room.players.length === 2 && room.players.every((p) => p.ready)) {
      this.startGame(roomId);
    }

    return room;
  }

  /**
   * Start the game (both players ready)
   */
  startGame(roomId) {
    const room = this.rooms.get(roomId);

    if (!room) {
      throw new Error('Room not found');
    }

    // Randomly choose who goes first
    const firstPlayerIndex = Math.random() < 0.5 ? 0 : 1;
    room.currentTurn = room.players[firstPlayerIndex].id;
    room.status = 'playing';

    return room;
  }

  /**
   * Process an attack
   */
  makeAttack(roomId, attackerId, x, y) {
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x > 9 || y < 0 || y > 9) {
      throw new Error('Attack coordinates must be integers from 0 to 9');
    }
    const room = this.rooms.get(roomId);

    if (!room) {
      throw new Error('Room not found');
    }

    if (room.status !== 'playing') {
      throw new Error('Game not in progress');
    }

    if (room.currentTurn !== attackerId) {
      throw new Error('Not your turn');
    }

    // Get defender (the other player)
    const defender = room.players.find((p) => p.id !== attackerId);

    if (!defender) {
      throw new Error('Opponent not found');
    }

    // Check if cell already attacked
    const cell = defender.board[y][x];
    if (cell === 'hit' || cell === 'miss') {
      throw new Error('Cell already attacked');
    }

    // Process attack
    let result = {
      hit: false,
      sunk: false,
      shipId: null,
      gameOver: false,
      winner: null,
    };

    if (cell === 'ship') {
      // Hit!
      defender.board[y][x] = 'hit';
      result.hit = true;

      // Find which ship was hit
      const hitShip = defender.ships.find((ship) =>
        ship.positions.some((pos) => pos.x === x && pos.y === y)
      );

      if (hitShip) {
        result.shipId = hitShip.id;

        // Add hit to ship
        if (!hitShip.hits) {
          hitShip.hits = [];
        }
        hitShip.hits.push({ x, y });

        // Check if ship is sunk
        if (hitShip.hits.length === hitShip.size) {
          hitShip.sunk = true;
          result.sunk = true;
        }

        // Check if all ships are sunk (game over)
        if (defender.ships.every((s) => s.sunk)) {
          result.gameOver = true;
          result.winner = attackerId;
          room.status = 'finished';
          room.winner = attackerId;
          room.endedAt = new Date();
        }
      }
    } else {
      // Miss
      defender.board[y][x] = 'miss';
      result.hit = false;
    }

    // Record move
    room.moves.push({
      playerId: attackerId,
      position: { x, y },
      result: result.hit ? 'hit' : 'miss',
      shipSunk: result.sunk ? result.shipId : null,
      timestamp: new Date(),
    });

    // Switch turns if game not over
    if (!result.gameOver) {
      room.currentTurn = defender.id;
    }

    return { room, result };
  }

  /**
   * Get room by ID
   */
  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  /**
   * Get room by player ID
   */
  getRoomByPlayer(playerId) {
    const roomId = this.playerRooms.get(playerId);
    return roomId ? this.rooms.get(roomId) : null;
  }

  /**
   * Leave room
   */
  leaveRoom(playerId) {
    const roomId = this.playerRooms.get(playerId);

    if (!roomId) {
      return null;
    }

    const room = this.rooms.get(roomId);

    if (!room) {
      return null;
    }

    // Remove player from room
    room.players = room.players.filter((p) => p.id !== playerId);
    this.playerRooms.delete(playerId);

    // If room is now empty, delete it
    if (room.players.length === 0) {
      this.rooms.delete(roomId);
      this.waitingRooms.delete(roomId);
    } else if (room.status === 'playing' || room.status === 'setup') {
      // If game was in progress, end it (opponent wins by forfeit)
      room.status = 'finished';
      room.winner = room.players[0].id;
      room.winReason = 'opponent_left';
      this.waitingRooms.delete(roomId);
    }

    return room;
  }

  /**
   * Create empty 10x10 board
   */
  createEmptyBoard() {
    return Array(10).fill(null).map(() => Array(10).fill('empty'));
  }

  /**
   * Validate ship placement
   */
  validateShips(ships, board) {
    // Must have exactly 5 ships
    if (!Array.isArray(ships) || ships.length !== 5 || !Array.isArray(board) || board.length !== 10 || !board.every((row) => Array.isArray(row) && row.length === 10)) {
      return false;
    }

    // Check each ship has required properties and valid positions
    const expectedSizes = [5, 4, 3, 3, 2]; // Carrier, Battleship, Cruiser, Submarine, Destroyer
    const sizes = ships.map((s) => s?.size).sort((a, b) => b - a);

    if (JSON.stringify(sizes) !== JSON.stringify(expectedSizes)) {
      return false;
    }

    // Check for overlaps and bounds
    const occupied = new Set();

    for (const ship of ships) {
      if (!Array.isArray(ship.positions) || ship.positions.length !== ship.size) return false;
      const positions = ship.positions;
      if (!positions.every((pos) => pos && Number.isInteger(pos.x) && Number.isInteger(pos.y))) return false;
      const horizontal = positions.every((pos) => pos.y === positions[0].y);
      const vertical = positions.every((pos) => pos.x === positions[0].x);
      if (!horizontal && !vertical) return false;
      const axis = positions.map((pos) => horizontal ? pos.x : pos.y).sort((a, b) => a - b);
      if (axis.some((value, index) => index && value !== axis[index - 1] + 1)) return false;
      for (const pos of ship.positions) {
        // Check bounds
        if (pos.x < 0 || pos.x > 9 || pos.y < 0 || pos.y > 9) {
          return false;
        }

        // Check overlaps
        const key = `${pos.x},${pos.y}`;
        if (occupied.has(key)) {
          return false;
        }
        occupied.add(key);
      }
    }

    if (occupied.size !== 17) return false;
    return board.every((row, y) => row.every((cell, x) =>
      cell === (occupied.has(`${x},${y}`) ? 'ship' : 'empty')
    ));
  }

  /**
   * Generate unique room ID
   */
  generateRoomId() {
    return `room_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get game state for a specific player (hide opponent's ships)
   */
  getGameStateForPlayer(roomId, playerId) {
    const room = this.rooms.get(roomId);

    if (!room) {
      return null;
    }

    const player = room.players.find((p) => p.id === playerId);
    const opponent = room.players.find((p) => p.id !== playerId);

    if (!player) {
      return null;
    }

    return {
      roomId: room.id,
      status: room.status,
      isMyTurn: room.currentTurn === playerId,
      currentTurn: room.currentTurn,

      // My data (full visibility)
      myId: playerId,
      myUsername: player.username,
      myBoard: player.board,
      myShips: player.ships,
      myReady: player.ready,

      // Opponent data (ships hidden)
      opponentId: opponent?.id || null,
      opponentUsername: opponent?.username || null,
      opponentBoard: opponent ? this.hideShips(opponent.board) : null,
      opponentShips: opponent ? this.hideShipsData(opponent.ships) : [],
      opponentReady: opponent?.ready || false,

      // Game data
      moves: room.moves,
      winner: room.winner,
    };
  }

  /**
   * Hide ship positions on board (for opponent view)
   */
  hideShips(board) {
    return board.map((row) =>
      row.map((cell) => (cell === 'ship' ? 'empty' : cell))
    );
  }

  /**
   * Hide ship position data (for opponent view)
   */
  hideShipsData(ships) {
    return ships.map((ship) => ({
      id: ship.id,
      name: ship.name,
      size: ship.size,
      color: ship.color,
      sunk: ship.sunk || false,
      hits: ship.hits || [],
      // Don't send positions
    }));
  }
}

// Create singleton instance
const gameManager = new GameManager();

export default gameManager;
