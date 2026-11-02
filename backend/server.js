import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import { socketAuthMiddleware } from './middleware/socketAuth.js';
import profileRoutes from './routes/profileRoutes.js';
import gameManager from './gameManager.js';
import tournamentService from './services/tournamentService.js';
import tournamentManager from './tournamentManager.js';
import { supabase } from './config/supabase.js';

// Load environment variables
dotenv.config();

const app = express();
const httpServer = createServer(app);

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());

// Socket.IO setup
const io = new Server(httpServer, {
  cors: corsOptions,
});

// Apply Socket.IO authentication middleware
io.use(socketAuthMiddleware);

// Basic health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API Routes
app.use('/api/profile', profileRoutes);

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log(`✅ User connected: ${socket.id} (User ID: ${socket.userId})`);

  // Join a room for this user (useful for direct messaging)
  socket.join(`user:${socket.userId}`);

  // Send welcome message
  socket.emit('welcome', {
    message: 'Connected to Battleship server',
    userId: socket.userId,
    username: socket.username,
  });

  // ============ LOBBY EVENTS ============

  /**
   * Get list of available rooms
   */
  socket.on('lobby:getRooms', () => {
    try {
      const rooms = gameManager.getAvailableRooms();
      socket.emit('lobby:roomList', rooms);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  /**
   * Create a new game room
   */
  socket.on('lobby:createRoom', ({ isPrivate = false }) => {
    try {
      const room = gameManager.createRoom(
        socket.userId,
        socket.username,
        isPrivate
      );

      // Join the socket.io room
      socket.join(room.id);

      // Send room data to creator
      socket.emit('lobby:roomCreated', {
        roomId: room.id,
        isPrivate: room.isPrivate,
      });

      // Broadcast updated room list to lobby
      if (!isPrivate) {
        io.emit('lobby:roomList', gameManager.getAvailableRooms());
      }

      console.log(`🎮 Room created: ${room.id} by ${socket.username}`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  /**
   * Join an existing room
   */
  socket.on('lobby:joinRoom', ({ roomId }) => {
    try {
      const room = gameManager.joinRoom(roomId, socket.userId, socket.username);

      // Join the socket.io room
      socket.join(roomId);

      // Send room data to joiner
      socket.emit('lobby:roomJoined', { roomId });

      // Notify both players that game is ready for setup
      io.to(roomId).emit('game:setupPhase', {
        roomId: room.id,
        players: room.players.map((p) => ({
          id: p.id,
          username: p.username,
        })),
      });

      // Broadcast updated room list (room is now full)
      io.emit('lobby:roomList', gameManager.getAvailableRooms());

      console.log(`🎮 ${socket.username} joined room: ${roomId}`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  /**
   * Quick match - join first available room or create new one
   */
  socket.on('lobby:quickMatch', () => {
    try {
      const availableRooms = gameManager.getAvailableRooms();

      if (availableRooms.length > 0) {
        // Join first available room
        const roomId = availableRooms[0].id;
        socket.emit('lobby:joinRoom', { roomId });
      } else {
        // Create new public room
        socket.emit('lobby:createRoom', { isPrivate: false });
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // ============ GAME EVENTS ============

  /**
   * Place ships
   */
  socket.on('game:placeShips', ({ roomId, ships, board }) => {
    try {
      const room = gameManager.placeShips(roomId, socket.userId, ships, board);

      // Send confirmation to player
      socket.emit('game:shipsPlaced', { success: true });

      // Check if both players are ready
      if (room.status === 'playing') {
        // Both players ready - start game!
        const gameStates = room.players.map((p) =>
          gameManager.getGameStateForPlayer(roomId, p.id)
        );

        // Send game state to each player
        room.players.forEach((player, index) => {
          io.to(`user:${player.id}`).emit('game:start', gameStates[index]);
        });

        console.log(`🎮 Game started in room: ${roomId}`);
      } else {
        // Notify other player that this player is ready
        socket.to(roomId).emit('game:opponentReady', {
          playerId: socket.userId,
        });
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  /**
   * Make an attack
   */
  socket.on('game:attack', async ({ roomId, x, y }) => {
    try {
      const { room, result } = gameManager.makeAttack(
        roomId,
        socket.userId,
        x,
        y
      );

      // Send result to attacker
      const attackerState = gameManager.getGameStateForPlayer(
        roomId,
        socket.userId
      );
      socket.emit('game:attackResult', {
        x,
        y,
        result,
        gameState: attackerState,
      });

      // Get defender
      const defender = room.players.find((p) => p.id !== socket.userId);

      // Send result to defender
      const defenderState = gameManager.getGameStateForPlayer(
        roomId,
        defender.id
      );
      io.to(`user:${defender.id}`).emit('game:attacked', {
        x,
        y,
        result,
        gameState: defenderState,
      });

      // If game over, notify both
      if (result.gameOver) {
        const room = gameManager.getRoom(roomId);
        
        io.to(roomId).emit('game:over', {
          winner: result.winner,
          winnerUsername: room.players.find((p) => p.id === result.winner)
            ?.username,
        });

        console.log(
          `🏆 Game over in room ${roomId}. Winner: ${result.winner}`
        );

        // If this is a tournament game, record the match result
        if (room && room.isTournament && room.matchId) {
          (async () => {
            try {
              console.log(`🏆 Recording tournament match result: Match ${room.matchId}, Winner ${result.winner}`);
              
              const { roundComplete } = await tournamentManager.recordMatchResult(
                room.matchId,
                result.winner
              );

              const match = await tournamentManager.getMatch(room.matchId);
              const tournament = await tournamentService.getTournamentById(match.tournament_id);

              // Emit updated bracket to all tournament participants
              const bracket = await tournamentManager.getTournamentState(match.tournament_id);
              io.to(`tournament:${match.tournament_id}`).emit('tournament:bracketUpdated', {
                tournamentId: match.tournament_id,
                bracket,
              });

              // Check if round is complete
              if (roundComplete) {
                const nextRound = match.round + 1;
                const nextRoundMatches = await tournamentManager.getCurrentRoundMatches(
                  match.tournament_id,
                  nextRound
                );

                if (nextRoundMatches && nextRoundMatches.length > 0) {
                  // Notify about next round
                  io.to(`tournament:${match.tournament_id}`).emit('tournament:nextRound', {
                    tournamentId: match.tournament_id,
                    round: nextRound,
                  });

                  // Notify players about their next matches
                  for (const nextMatch of nextRoundMatches) {
                    if (nextMatch.player1_id && nextMatch.player2_id) {
                      const player1 = nextMatch.player1;
                      const player2 = nextMatch.player2;

                      io.to(`user:${nextMatch.player1_id}`).emit('tournament:yourMatch', {
                        tournamentId: match.tournament_id,
                        match: nextMatch,
                        opponent: player2,
                      });

                      io.to(`user:${nextMatch.player2_id}`).emit('tournament:yourMatch', {
                        tournamentId: match.tournament_id,
                        match: nextMatch,
                        opponent: player1,
                      });
                    }
                  }
                }
              }

              // Check if tournament is complete
              if (tournament.status === 'completed') {
                io.to(`tournament:${match.tournament_id}`).emit('tournament:completed', {
                  tournamentId: match.tournament_id,
                  winnerId: tournament.winner_id,
                  winner: tournament.participants?.find(p => p.user_id === tournament.winner_id),
                });
              }
            } catch (tournamentError) {
              console.error('Error recording tournament match result:', tournamentError);
            }
          })();
        } else if (room && room.players.length === 2) {
          // The deployed games/profiles schema and RPC must be verified before release.
          // The RPC inserts the result and increments both profiles atomically once per room.
          const { error: persistenceError } = await supabase.rpc('record_completed_game', {
            p_completion_key: room.id,
            p_player1_id: room.players[0].id,
            p_player2_id: room.players[1].id,
            p_winner_id: result.winner,
            p_ended_at: room.endedAt.toISOString(),
          });
          if (persistenceError) throw persistenceError;
        }
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  /**
   * Get current game state
   */
  socket.on('game:getState', ({ roomId }) => {
    try {
      const room = gameManager.getRoom(roomId);
      if (!room) throw new Error('Game not found');
      if (!room.players.some((player) => player.id === socket.userId)) {
        throw new Error('Access denied: you are not a player in this game');
      }
      const gameState = gameManager.getGameStateForPlayer(roomId, socket.userId);

      if (!gameState) {
        socket.emit('error', { message: 'Game not found' });
        return;
      }

      socket.emit('game:state', gameState);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  /**
   * Leave game
   */
  socket.on('game:leave', ({ roomId }) => {
    try {
      const room = gameManager.leaveRoom(socket.userId);

      if (room) {
        // Notify opponent
        socket.to(roomId).emit('game:opponentLeft', {
          playerId: socket.userId,
          username: socket.username,
        });

        // Leave socket.io room
        socket.leave(roomId);

        // Broadcast updated room list
        io.emit('lobby:roomList', gameManager.getAvailableRooms());

        console.log(`🚪 ${socket.username} left room: ${roomId}`);
      }

      socket.emit('game:left', { success: true });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // ============ CHAT EVENTS ============

  /**
   * Send chat message
   */
  socket.on('chat:sendMessage', ({ gameId, message }) => {
    try {
      const room = gameManager.getRoom(gameId);
      if (!room?.players.some((player) => player.id === socket.userId) || !socket.rooms.has(gameId)) {
        throw new Error('Access denied: you are not in this game room');
      }
      // Validate message
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        socket.emit('error', { message: 'Invalid message' });
        return;
      }

      if (message.length > 200) {
        socket.emit('error', { message: 'Message too long (max 200 characters)' });
        return;
      }

      // Send message to room (including sender)
      io.to(gameId).emit('chat:message', {
        userId: socket.userId,
        username: socket.username,
        message: message.trim(),
        timestamp: new Date().toISOString(),
      });

      console.log(`💬 Chat message in ${gameId} from ${socket.username}: ${message.trim()}`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  /**
   * Typing indicator
   */
  socket.on('chat:typing', ({ gameId, isTyping }) => {
    try {
      const room = gameManager.getRoom(gameId);
      if (!room?.players.some((player) => player.id === socket.userId) || !socket.rooms.has(gameId)) {
        throw new Error('Access denied: you are not in this game room');
      }
      // Broadcast typing status to room (except sender)
      socket.to(gameId).emit('chat:typing', {
        userId: socket.userId,
        isTyping,
      });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // ============ TOURNAMENT EVENTS ============

  /**
   * Get all tournaments
   */
  socket.on('tournament:getAll', async ({ status = null }) => {
    try {
      const tournaments = await tournamentService.getTournaments(status);
      socket.emit('tournament:list', tournaments);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  /**
   * Get tournament details
   */
  socket.on('tournament:getDetails', async ({ tournamentId }) => {
    try {
      const tournament = await tournamentService.getTournamentById(tournamentId);
      socket.emit('tournament:details', tournament);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  /**
   * Create a new tournament
   */
  socket.on('tournament:create', async (tournamentData) => {
    try {
      const tournament = await tournamentService.createTournament(
        socket.userId,
        tournamentData
      );

      // Send confirmation to creator
      socket.emit('tournament:created', tournament);

      // Broadcast to all users that a new tournament is available
      io.emit('tournament:new', tournament);

      console.log(`🏆 Tournament created: ${tournament.id} by ${socket.username}`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  /**
   * Join a tournament
   */
  socket.on('tournament:join', async ({ tournamentId }) => {
    try {
      const participant = await tournamentService.joinTournament(
        tournamentId,
        socket.userId
      );

      // Join tournament socket room
      socket.join(`tournament:${tournamentId}`);

      // Send confirmation to user
      socket.emit('tournament:joined', { tournamentId, participant });

      // Notify all tournament participants
      io.to(`tournament:${tournamentId}`).emit('tournament:playerJoined', {
        tournamentId,
        participant,
        player: {
          id: socket.userId,
          username: socket.username,
        },
      });

      // Broadcast updated tournament list
      const tournaments = await tournamentService.getTournaments();
      io.emit('tournament:list', tournaments);

      console.log(`🏆 ${socket.username} joined tournament: ${tournamentId}`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  /**
   * Leave a tournament
   */
  socket.on('tournament:leave', async ({ tournamentId }) => {
    try {
      await tournamentService.leaveTournament(tournamentId, socket.userId);

      // Leave tournament socket room
      socket.leave(`tournament:${tournamentId}`);

      // Send confirmation
      socket.emit('tournament:left', { tournamentId });

      // Notify remaining participants
      io.to(`tournament:${tournamentId}`).emit('tournament:playerLeft', {
        tournamentId,
        playerId: socket.userId,
        username: socket.username,
      });

      // Broadcast updated tournament list
      const tournaments = await tournamentService.getTournaments();
      io.emit('tournament:list', tournaments);

      console.log(`🏆 ${socket.username} left tournament: ${tournamentId}`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  /**
   * Start a tournament
   */
  socket.on('tournament:start', async ({ tournamentId }) => {
    try {
      // Update tournament status
      const started = await tournamentService.startTournament(tournamentId, socket.userId);

      // Get full tournament details with matches
      const tournament = await tournamentManager.getTournamentState(tournamentId);
      const bracket = started.bracket_data || tournament.matches;

      // Notify all participants that tournament has started
      io.to(`tournament:${tournamentId}`).emit('tournament:started', {
        tournamentId,
        bracket,
        tournament,
      });

      // Get current round matches (first round)
      const currentMatches = await tournamentManager.getCurrentRoundMatches(tournamentId);

      // Notify players of their matches
      for (const match of currentMatches) {
        if (match.player1_id) {
          io.to(`user:${match.player1_id}`).emit('tournament:yourMatch', {
            tournamentId,
            match,
            opponent: match.player2,
          });
        }
        if (match.player2_id) {
          io.to(`user:${match.player2_id}`).emit('tournament:yourMatch', {
            tournamentId,
            match,
            opponent: match.player1,
          });
        }
      }

      console.log(`🏆 Tournament started: ${tournamentId}`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  /**
   * Get tournament bracket
   */
  socket.on('tournament:getBracket', async ({ tournamentId }) => {
    try {
      const tournamentState = await tournamentManager.getTournamentState(tournamentId);
      socket.emit('tournament:bracket', {
        tournamentId,
        matches: tournamentState.matches || [],
        bracket_data: tournamentState.bracket_data,
      });
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  /**
   * Start a tournament match
   */
  socket.on('tournament:startMatch', async ({ matchId }) => {
    try {
      const match = await tournamentManager.getMatch(matchId);
      if (!match || ![match.player1_id, match.player2_id].includes(socket.userId)) {
        throw new Error('Access denied: you are not a match participant');
      }
      const matchData = await tournamentManager.startTournamentMatch(matchId);
      
      // Notify both players
      io.to(`user:${matchData.player1Id}`)
        .to(`user:${matchData.player2Id}`)
        .emit('tournament:matchStarting', {
          matchId,
          tournamentId: matchData.tournamentId,
          round: matchData.round,
        });
      
      socket.emit('tournament:matchStarted', matchData);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  /**
   * Create a game room for tournament match
   */
  socket.on('tournament:createGame', async ({ matchId }) => {
    try {
      const match = await tournamentManager.getMatch(matchId);
      
      if (!match) {
        throw new Error('Match not found');
      }
      if (socket.userId !== match.player1_id && socket.userId !== match.player2_id) {
        throw new Error('Access denied: you are not a match participant');
      }
      const existingRoom = gameManager.getTournamentRoom(matchId);
      if (match.status === 'completed') throw new Error('Match is already completed');
      if (!existingRoom && (match.status !== 'ready' || !match.player1_id || !match.player2_id)) {
        throw new Error('Match is not ready for a game room');
      }

      // Get player usernames
      const player1 = match.player1;
      const player2 = match.player2;

      if (!player1 || !player2) {
        throw new Error('Match players not found');
      }

      // Create a tournament room
      const room = gameManager.createTournamentRoom(
        match.player1_id,
        player1.username,
        match.player2_id,
        player2.username,
        match.tournament_id,
        matchId
      );

      // Join both players to the socket room
      socket.join(room.id);
      
      // Find opponent socket and join them too
      const opponentId = match.player1_id === socket.userId ? match.player2_id : match.player1_id;
      const opponentSocket = Array.from(io.sockets.sockets.values()).find(
        s => s.userId === opponentId
      );
      
      if (opponentSocket) {
        opponentSocket.join(room.id);
      }

      // Emit room created event
      socket.emit('tournament:gameCreated', {
        roomId: room.id,
        room: { id: room.id, status: room.status, players: room.players.map(({ id, username }) => ({ id, username })) },
        matchId,
        tournamentId: match.tournament_id,
      });

      // Notify opponent
      if (opponentSocket) {
        opponentSocket.emit('tournament:gameCreated', {
          roomId: room.id,
          room: { id: room.id, status: room.status, players: room.players.map(({ id, username }) => ({ id, username })) },
          matchId,
          tournamentId: match.tournament_id,
        });
      }

      console.log(`🏆 Tournament game room created: ${room.id} for match ${matchId}`);
    } catch (error) {
      console.error('Error creating tournament game:', error);
      socket.emit('error', { message: error.message });
    }
  });

  /**
   * Record tournament match result
   */
  socket.on('tournament:matchComplete', async ({ matchId, winnerId }) => {
    try {
      const submittedMatch = await tournamentManager.getMatch(matchId);
      if (!submittedMatch || ![submittedMatch.player1_id, submittedMatch.player2_id].includes(socket.userId)) {
        throw new Error('Access denied: you are not a match participant');
      }
      if (![submittedMatch.player1_id, submittedMatch.player2_id].includes(winnerId)) {
        throw new Error('Winner must be a match participant');
      }
      if (submittedMatch.status === 'completed') {
        if (submittedMatch.winner_id !== winnerId) throw new Error('Match already completed with another winner');
        socket.emit('tournament:matchCompleted', { matchId, winnerId, round: submittedMatch.round, alreadyCompleted: true });
        return;
      }
      if (!['ready', 'in_progress'].includes(submittedMatch.status)) throw new Error('Match is not ready for completion');
      const { roundComplete, alreadyCompleted } = await tournamentManager.recordMatchResult(
        matchId,
        winnerId
      );
      if (alreadyCompleted) {
        socket.emit('tournament:matchCompleted', { matchId, winnerId, round: submittedMatch.round, alreadyCompleted: true });
        return;
      }

      // Get updated tournament state
      const match = await tournamentManager.getMatch(matchId);
      const tournament = await tournamentService.getTournamentById(match.tournament_id);

      // Notify all participants of updated bracket
      io.to(`tournament:${match.tournament_id}`).emit('tournament:matchCompleted', {
        matchId,
        winnerId,
        round: match.round,
      });

      // Broadcast bracket update
      const tournamentState = await tournamentManager.getTournamentState(match.tournament_id);
      io.to(`tournament:${match.tournament_id}`).emit('tournament:bracketUpdated', {
        tournamentId: match.tournament_id,
        matches: tournamentState.matches,
      });

      // If round complete, notify about next round or completion
      if (roundComplete) {
        if (tournament.status === 'completed') {
          // Tournament finished
          io.to(`tournament:${match.tournament_id}`).emit('tournament:completed', {
            tournamentId: match.tournament_id,
            winnerId,
            winner: tournament.participants.find(p => p.user_id === winnerId),
          });
          console.log(`🏆 Tournament completed: ${match.tournament_id}, Winner: ${winnerId}`);
        } else {
          // Next round starting
          const nextRoundMatches = await tournamentManager.getCurrentRoundMatches(match.tournament_id);
          
          io.to(`tournament:${match.tournament_id}`).emit('tournament:nextRound', {
            tournamentId: match.tournament_id,
            round: tournament.current_round,
          });

          // Notify players of their new matches
          for (const nextMatch of nextRoundMatches) {
            if (nextMatch.player1_id) {
              io.to(`user:${nextMatch.player1_id}`).emit('tournament:yourMatch', {
                tournamentId: match.tournament_id,
                match: nextMatch,
                opponent: nextMatch.player2,
              });
            }
            if (nextMatch.player2_id) {
              io.to(`user:${nextMatch.player2_id}`).emit('tournament:yourMatch', {
                tournamentId: match.tournament_id,
                match: nextMatch,
                opponent: nextMatch.player1,
              });
            }
          }
        }
      }
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  /**
   * Cancel a tournament
   */
  socket.on('tournament:cancel', async ({ tournamentId }) => {
    try {
      await tournamentService.cancelTournament(tournamentId, socket.userId);

      // Notify all participants
      io.to(`tournament:${tournamentId}`).emit('tournament:cancelled', {
        tournamentId,
      });

      // Broadcast updated tournament list
      const tournaments = await tournamentService.getTournaments();
      io.emit('tournament:list', tournaments);

      console.log(`🏆 Tournament cancelled: ${tournamentId}`);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  /**
   * Get user's tournaments
   */
  socket.on('tournament:getUserTournaments', async () => {
    try {
      const tournaments = await tournamentService.getUserTournaments(socket.userId);
      socket.emit('tournament:userTournaments', tournaments);
    } catch (error) {
      socket.emit('error', { message: error.message });
    }
  });

  // ============ DISCONNECT ============

  socket.on('disconnect', () => {
    console.log(`❌ User disconnected: ${socket.id} (User ID: ${socket.userId})`);

    // Handle player leaving game
    const room = gameManager.getRoomByPlayer(socket.userId);

    if (room) {
      // Player was in a game
      gameManager.leaveRoom(socket.userId);

      // Notify opponent
      socket.to(room.id).emit('game:opponentLeft', {
        playerId: socket.userId,
        username: socket.username,
      });

      // Broadcast updated room list
      io.emit('lobby:roomList', gameManager.getAvailableRooms());

      console.log(`🚪 ${socket.username} disconnected from room: ${room.id}`);
    }
  });
});

// Start server
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Socket.IO ready for connections`);
  console.log(`🌍 CORS origin: ${corsOptions.origin}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  httpServer.close(() => {
    console.log('HTTP server closed');
  });
});

export { io, app };
