import tournamentService from './services/tournamentService.js';
import { supabase } from './config/supabase.js';

/**
 * Tournament Manager
 * Handles tournament lifecycle, bracket generation, and match management
 */
class TournamentManager {
  constructor() {
    this.activeTournaments = new Map(); // tournamentId -> tournament state
  }

  /**
   * Generate tournament bracket and create match records
   * @param {String} tournamentId
   * @returns {Object} Bracket data with matches
   */
  async generateBracket(tournamentId) {
    const tournament = await tournamentService.getTournamentById(tournamentId);
    
    if (tournament.status !== 'active') {
      throw new Error('Tournament must be active to generate bracket');
    }

    const participants = tournament.participants;
    const playerCount = participants.length;

    // Seed participants randomly for Phase 1
    const seededParticipants = this.seedParticipantsRandom(participants);

    // Update seeds in database
    for (const participant of seededParticipants) {
      await tournamentService.updateParticipantSeed(participant.id, participant.seed);
    }

    // Calculate total rounds
    const totalRounds = Math.log2(playerCount);

    // Generate bracket structure with actual match records
    const matches = await this.createBracketMatches(tournamentId, seededParticipants, totalRounds);

    // Generate bracket structure for storage
    const bracket = this.structureBracketData(matches, totalRounds, playerCount);

    // Store bracket data in tournament
    await tournamentService.updateTournament(tournamentId, tournament.created_by, {
      bracket_data: bracket,
      current_round: 1,
    });

    // Store in active tournaments cache
    this.activeTournaments.set(tournamentId, {
      ...tournament,
      bracket_data: bracket,
      current_round: 1,
    });

    return bracket;
  }

  /**
   * Create actual match records in database
   * @param {String} tournamentId
   * @param {Array} seededParticipants
   * @param {Number} totalRounds
   * @returns {Array} All created matches
   */
  async createBracketMatches(tournamentId, seededParticipants, totalRounds) {
    const allMatches = [];
    
    // Round 1: Create matches with actual players
    const round1Matches = [];
    for (let i = 0; i < seededParticipants.length; i += 2) {
      const player1 = seededParticipants[i];
      const player2 = seededParticipants[i + 1];
      
      const matchNumber = (i / 2) + 1;
      const bracketPosition = `R1-M${matchNumber}`;
      
      const { data, error } = await supabase
        .from('tournament_matches')
        .insert({
          tournament_id: tournamentId,
          round: 1,
          match_number: matchNumber,
          bracket_position: bracketPosition,
          player1_id: player1.user_id,
          player2_id: player2.user_id,
          status: 'ready',
        })
        .select()
        .single();
      
      if (error) throw error;
      round1Matches.push(data);
    }
    allMatches.push(...round1Matches);
    
    // Subsequent rounds: Create placeholder matches
    const subsequentMatches = [];
    for (let round = 2; round <= totalRounds; round++) {
      const matchCount = Math.pow(2, totalRounds - round);
      
      for (let matchNum = 1; matchNum <= matchCount; matchNum++) {
        const bracketPosition = this.getBracketPosition(round, matchNum, totalRounds);
        
        const { data, error } = await supabase
          .from('tournament_matches')
          .insert({
            tournament_id: tournamentId,
            round,
            match_number: matchNum,
            bracket_position: bracketPosition,
            status: 'pending',
          })
          .select()
          .single();
        
        if (error) throw error;
        subsequentMatches.push(data);
      }
    }
    allMatches.push(...subsequentMatches);
    
    // Link matches (set next_match_id)
    await this.linkMatches(allMatches, totalRounds);
    
    return allMatches;
  }

  /**
   * Link matches together by setting next_match_id
   * @param {Array} matches
   * @param {Number} totalRounds
   */
  async linkMatches(matches, totalRounds) {
    // Group by round
    const byRound = {};
    matches.forEach(m => {
      if (!byRound[m.round]) byRound[m.round] = [];
      byRound[m.round].push(m);
    });
    
    // Link each round to next
    for (let round = 1; round < totalRounds; round++) {
      const currentRound = byRound[round].sort((a, b) => a.match_number - b.match_number);
      const nextRound = byRound[round + 1].sort((a, b) => a.match_number - b.match_number);
      
      for (let i = 0; i < currentRound.length; i++) {
        const match = currentRound[i];
        const nextMatchIndex = Math.floor(i / 2);
        const nextMatch = nextRound[nextMatchIndex];
        
        const winnerSlot = (i % 2 === 0) ? 'player1' : 'player2';
        
        await supabase
          .from('tournament_matches')
          .update({
            next_match_id: nextMatch.id,
            winner_proceeds_to: winnerSlot,
          })
          .eq('id', match.id);
      }
    }
  }

  /**
   * Get bracket position label
   * @param {Number} round
   * @param {Number} matchNum
   * @param {Number} totalRounds
   * @returns {String}
   */
  getBracketPosition(round, matchNum, totalRounds) {
    if (round === totalRounds) return 'FINAL';
    if (round === totalRounds - 1) return `SF-M${matchNum}`;
    if (round === totalRounds - 2) return `QF-M${matchNum}`;
    return `R${round}-M${matchNum}`;
  }

  /**
   * Structure bracket data for storage
   * @param {Array} matches
   * @param {Number} totalRounds
   * @param {Number} playerCount
   * @returns {Object}
   */
  structureBracketData(matches, totalRounds, playerCount) {
    const rounds = [];
    const byRound = {};
    
    matches.forEach(m => {
      if (!byRound[m.round]) byRound[m.round] = [];
      byRound[m.round].push(m);
    });
    
    for (let round = 1; round <= totalRounds; round++) {
      rounds.push({
        round,
        matches: byRound[round] || [],
      });
    }
    
    return {
      totalRounds,
      rounds,
      participantCount: playerCount,
    };
  }

  /**
   * Seed participants randomly
   * @param {Array} participants
   * @returns {Array} Seeded participants
   */
  seedParticipantsRandom(participants) {
    const shuffled = [...participants].sort(() => Math.random() - 0.5);
    return shuffled.map((participant, index) => ({
      ...participant,
      seed: index + 1,
    }));
  }



  /**
   * Get current round matches that are ready to play
   * @param {String} tournamentId
   * @returns {Array} Ready matches
   */
  async getCurrentRoundMatches(tournamentId) {
    const { data, error} = await supabase
      .from('tournament_matches')
      .select(`
        *,
        player1:profiles!tournament_matches_player1_id_fkey(id, username, avatar_url),
        player2:profiles!tournament_matches_player2_id_fkey(id, username, avatar_url)
      `)
      .eq('tournament_id', tournamentId)
      .eq('status', 'ready')
      .order('round')
      .order('match_number');

    if (error) throw error;
    return data || [];
  }

  /**
   * Get match by ID
   * @param {String} matchId
   * @returns {Object} Match data
   */
  async getMatch(matchId) {
    const { data, error } = await supabase
      .from('tournament_matches')
      .select(`
        *,
        player1:profiles!tournament_matches_player1_id_fkey(id, username, avatar_url),
        player2:profiles!tournament_matches_player2_id_fkey(id, username, avatar_url),
        winner:profiles!tournament_matches_winner_id_fkey(id, username, avatar_url)
      `)
      .eq('id', matchId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Record match result and advance winner
   * @param {String} matchId
   * @param {String} winnerId
   */
  async recordMatchResult(matchId, winnerId) {
    const match = await this.getMatch(matchId);
    if (![match.player1_id, match.player2_id].includes(winnerId)) {
      throw new Error('Winner must be a match participant');
    }
    if (match.status === 'completed') {
      if (match.winner_id !== winnerId) throw new Error('Match already completed with another winner');
      return { roundComplete: false, alreadyCompleted: true };
    }
    if (!['ready', 'in_progress'].includes(match.status)) throw new Error('Match is not ready for completion');
    
    // Update match with winner
    const { data: updated, error: updateError } = await supabase
      .from('tournament_matches')
      .update({
        winner_id: winnerId,
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('id', matchId)
      .in('status', ['ready', 'in_progress'])
      .select('id');

    if (updateError) throw updateError;
    if (!updated?.length) return { roundComplete: false, alreadyCompleted: true };

    // Update loser as eliminated
    const loserId = match.player1_id === winnerId ? match.player2_id : match.player1_id;
    const tournament = await tournamentService.getTournamentById(match.tournament_id);
    const loserParticipant = tournament.participants.find(p => p.user_id === loserId);
    
    if (loserParticipant) {
      await tournamentService.updateParticipant(loserParticipant.id, {
        eliminated: true,
        current_round: match.round,
      });
    }

    // Advance winner to next match if not final round
    if (match.next_match_id) {
      await this.advanceWinner(match.next_match_id, match.winner_proceeds_to, winnerId);
    }

    // Check if round is complete
    const roundComplete = await this.isRoundComplete(match.tournament_id, match.round);
    
    if (roundComplete) {
      // Check if tournament is complete (was final round)
      const totalRounds = Math.log2(tournament.participants.length);
      if (match.round === totalRounds) {
        await this.completeTournament(match.tournament_id, winnerId);
      } else {
        // Advance to next round
        await this.advanceToNextRound(match.tournament_id);
      }
    }

    return { roundComplete };
  }

  /**
   * Advance winner to next match
   * @param {String} nextMatchId
   * @param {String} playerSlot - 'player1' or 'player2'
   * @param {String} winnerId
   */
  async advanceWinner(nextMatchId, playerSlot, winnerId) {
    const updateField = playerSlot === 'player1' ? 'player1_id' : 'player2_id';
    
    const { error } = await supabase
      .from('tournament_matches')
      .update({ [updateField]: winnerId })
      .eq('id', nextMatchId);

    if (error) throw error;

    // Check if both players are now set
    const { data: nextMatch } = await supabase
      .from('tournament_matches')
      .select('player1_id, player2_id')
      .eq('id', nextMatchId)
      .single();

    if (nextMatch && nextMatch.player1_id && nextMatch.player2_id) {
      // Both players set, mark match as ready
      await supabase
        .from('tournament_matches')
        .update({ status: 'ready' })
        .eq('id', nextMatchId);
    }
  }

  /**
   * Check if current round is complete
   * @param {String} tournamentId
   * @param {Number} round
   * @returns {Boolean}
   */
  async isRoundComplete(tournamentId, round) {
    const { data, error } = await supabase
      .from('tournament_matches')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('round', round)
      .neq('status', 'completed');

    if (error) throw error;
    return data.length === 0;
  }

  /**
   * Advance tournament to next round
   * @param {String} tournamentId
   */
  async advanceToNextRound(tournamentId) {
    const tournament = await tournamentService.getTournamentById(tournamentId);
    const nextRound = tournament.current_round + 1;

    await tournamentService.updateTournament(tournamentId, tournament.created_by, {
      current_round: nextRound,
    });

    return nextRound;
  }

  /**
   * Complete tournament
   * @param {String} tournamentId
   * @param {String} winnerId
   */
  async completeTournament(tournamentId, winnerId) {
    const tournament = await tournamentService.getTournamentById(tournamentId);
    
    // Update winner's participant record
    const winnerParticipant = tournament.participants.find(p => p.user_id === winnerId);
    if (winnerParticipant) {
      await tournamentService.updateParticipant(winnerParticipant.id, {
        placement: 1,
        eliminated: false,
      });
    }

    // Get final match to determine 2nd place
    const { data: finalMatches } = await supabase
      .from('tournament_matches')
      .select('*')
      .eq('tournament_id', tournamentId)
      .eq('bracket_position', 'FINAL')
      .single();

    if (finalMatches) {
      const secondPlaceId = finalMatches.player1_id === winnerId 
        ? finalMatches.player2_id 
        : finalMatches.player1_id;
      
      const secondPlaceParticipant = tournament.participants.find(p => p.user_id === secondPlaceId);
      if (secondPlaceParticipant) {
        await tournamentService.updateParticipant(secondPlaceParticipant.id, {
          placement: 2,
        });
      }
    }

    // Get semi-final losers for 3rd place
    const totalRounds = Math.log2(tournament.participants.length);
    if (totalRounds >= 2) {
      const { data: semiFinalsMatches } = await supabase
        .from('tournament_matches')
        .select('*')
        .eq('tournament_id', tournamentId)
        .like('bracket_position', 'SF-%');

      let placement = 3;
      for (const match of semiFinalsMatches || []) {
        if (match.winner_id) {
          const loserId = match.player1_id === match.winner_id 
            ? match.player2_id 
            : match.player1_id;
          
          const loserParticipant = tournament.participants.find(p => p.user_id === loserId);
          if (loserParticipant) {
            await tournamentService.updateParticipant(loserParticipant.id, {
              placement,
            });
            placement++;
          }
        }
      }
    }

    // Complete tournament
    await tournamentService.completeTournament(tournamentId, winnerId);

    // Remove from active tournaments
    this.activeTournaments.delete(tournamentId);

    return true;
  }

  /**
   * Get tournament state (includes bracket from database)
   * @param {String} tournamentId
   * @returns {Object} Tournament state
   */
  async getTournamentState(tournamentId) {
    // Try cache first
    if (this.activeTournaments.has(tournamentId)) {
      return this.activeTournaments.get(tournamentId);
    }

    // Fetch from database
    const tournament = await tournamentService.getTournamentById(tournamentId);
    
    // Get matches from database
    const { data: matches } = await supabase
      .from('tournament_matches')
      .select(`
        *,
        player1:profiles!tournament_matches_player1_id_fkey(id, username, avatar_url),
        player2:profiles!tournament_matches_player2_id_fkey(id, username, avatar_url)
      `)
      .eq('tournament_id', tournamentId)
      .order('round')
      .order('match_number');

    tournament.matches = matches || [];
    
    if (tournament.status === 'active') {
      this.activeTournaments.set(tournamentId, tournament);
    }

    return tournament;
  }

  /**
   * Get user's current match in tournament
   * @param {String} tournamentId
   * @param {String} userId
   * @returns {Object|null} Current match or null
   */
  async getUserCurrentMatch(tournamentId, userId) {
    const { data, error } = await supabase
      .rpc('get_user_current_match', {
        tournament_id_param: tournamentId,
        user_id_param: userId,
      });

    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  }

  /**
   * Check if user can start their match
   * @param {String} tournamentId
   * @param {String} userId
   * @returns {Boolean}
   */
  async canUserStartMatch(tournamentId, userId) {
    const match = await this.getUserCurrentMatch(tournamentId, userId);
    return match !== null && match.status === 'ready';
  }

  /**
   * Start a tournament match (create game)
   * @param {String} matchId
   * @returns {Object} Game data
   */
  async startTournamentMatch(matchId) {
    const match = await this.getMatch(matchId);
    
    if (match.status !== 'ready') {
      throw new Error('Match is not ready to start');
    }

    // Update match status
    await supabase
      .from('tournament_matches')
      .update({
        status: 'in_progress',
        started_at: new Date().toISOString(),
      })
      .eq('id', matchId);

    // Return match data (game will be created by game manager)
    return {
      matchId,
      tournamentId: match.tournament_id,
      player1Id: match.player1_id,
      player2Id: match.player2_id,
      round: match.round,
    };
  }

  /**
   * Link game to tournament match
   * @param {String} matchId
   * @param {String} gameId
   */
  async linkGameToMatch(matchId, gameId) {
    const { error } = await supabase
      .from('tournament_matches')
      .update({ game_id: gameId })
      .eq('id', matchId);

    if (error) throw error;
  }
}

export default new TournamentManager();
