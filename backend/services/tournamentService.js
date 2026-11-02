import { supabase } from '../config/supabase.js';

/**
 * Tournament Service
 * Handles all database operations for tournaments
 */
class TournamentService {
  /**
   * Create a new tournament
   * @param {String} userId - Creator's user ID
   * @param {Object} tournamentData - Tournament configuration
   * @returns {Object} Created tournament
   */
  async createTournament(userId, tournamentData) {
    const { name, description, maxPlayers = 8, registrationEndsAt } = tournamentData;

    // Validate max players is power of 2
    if (![4, 8, 16, 32].includes(maxPlayers)) {
      throw new Error('Max players must be 4, 8, 16, or 32');
    }

    const { data, error } = await supabase
      .from('tournaments')
      .insert({
        name,
        description,
        max_players: maxPlayers,
        created_by: userId,
        registration_ends_at: registrationEndsAt || null,
        status: 'registration',
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get all tournaments
   * @param {String} status - Optional status filter
   * @returns {Array} List of tournaments
   */
  async getTournaments(status = null) {
    let query = supabase
      .from('tournaments')
      .select(`
        *,
        created_by_profile:profiles!tournaments_created_by_fkey(id, username, avatar_url),
        participants:tournament_participants(count)
      `)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query;

    if (error) throw error;

    // Format the response
    return data.map(tournament => ({
      ...tournament,
      creator: tournament.created_by_profile,
      participant_count: tournament.participants[0]?.count || 0,
    }));
  }

  /**
   * Get tournament by ID with full details
   * @param {String} tournamentId
   * @returns {Object} Tournament details
   */
  async getTournamentById(tournamentId) {
    const { data, error } = await supabase
      .from('tournaments')
      .select(`
        *,
        created_by_profile:profiles!tournaments_created_by_fkey(id, username, avatar_url),
        participants:tournament_participants(
          id,
          user_id,
          seed,
          current_round,
          eliminated,
          placement,
          joined_at,
          profile:profiles(id, username, avatar_url)
        )
      `)
      .eq('id', tournamentId)
      .single();

    if (error) throw error;

    // Format the response
    return {
      ...data,
      creator: data.created_by_profile,
      participants: data.participants.map(p => ({
        ...p,
        user: p.profile,
      })),
    };
  }

  /**
   * Join a tournament
   * @param {String} tournamentId
   * @param {String} userId
   * @returns {Object} Participant record
   */
  async joinTournament(tournamentId, userId) {
    // First check if tournament exists and is accepting registrations
    const tournament = await this.getTournamentById(tournamentId);

    if (tournament.status !== 'registration') {
      throw new Error('Tournament is not accepting registrations');
    }

    if (tournament.participants.length >= tournament.max_players) {
      throw new Error('Tournament is full');
    }

    // Check if user is already in tournament
    const existing = tournament.participants.find(p => p.user_id === userId);
    if (existing) {
      throw new Error('You are already in this tournament');
    }

    const { data, error } = await supabase
      .from('tournament_participants')
      .insert({
        tournament_id: tournamentId,
        user_id: userId,
      })
      .select(`
        *,
        profile:profiles(id, username, avatar_url)
      `)
      .single();

    if (error) throw error;

    return {
      ...data,
      user: data.profile,
    };
  }

  /**
   * Leave a tournament
   * @param {String} tournamentId
   * @param {String} userId
   */
  async leaveTournament(tournamentId, userId) {
    // Check if tournament is still in registration
    const tournament = await this.getTournamentById(tournamentId);

    if (tournament.status !== 'registration') {
      throw new Error('Cannot leave tournament after it has started');
    }

    const { error } = await supabase
      .from('tournament_participants')
      .delete()
      .eq('tournament_id', tournamentId)
      .eq('user_id', userId);

    if (error) throw error;

    return { success: true };
  }

  /**
   * Get user's tournaments
   * @param {String} userId
   * @returns {Array} User's tournaments
   */
  async getUserTournaments(userId) {
    const { data, error } = await supabase.rpc('get_user_tournaments', {
      user_id_param: userId,
    });

    if (error) throw error;
    return data;
  }

  /**
   * Update tournament
   * @param {String} tournamentId
   * @param {String} userId - Must be creator
   * @param {Object} updates
   */
  async updateTournament(tournamentId, userId, updates) {
    // Verify user is creator
    const tournament = await this.getTournamentById(tournamentId);

    if (tournament.created_by !== userId) {
      throw new Error('Only tournament creator can update');
    }

    const { data, error } = await supabase
      .from('tournaments')
      .update(updates)
      .eq('id', tournamentId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Start tournament
   * @param {String} tournamentId
   * @param {String} userId - Must be creator
   */
  async startTournament(tournamentId, userId) {
    const tournament = await this.getTournamentById(tournamentId);

    if (tournament.created_by !== userId) {
      throw new Error('Only tournament creator can start the tournament');
    }

    if (tournament.status !== 'registration') {
      throw new Error('Tournament has already started');
    }

    const participantCount = tournament.participants.length;
    if (participantCount < 2) {
      throw new Error('Need at least 2 players to start tournament');
    }

    if (!Number.isInteger(Math.log2(participantCount))) {
      throw new Error('Tournament requires a power-of-two registered player count');
    }

    const { data, error } = await supabase
      .from('tournaments')
      .update({
        status: 'active',
        started_at: new Date().toISOString(),
      })
      .eq('id', tournamentId)
      .eq('status', 'registration')
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) throw new Error('Tournament has already started');
    
    // Generate bracket after tournament is active
    console.log('🏆 [BACKEND] Starting bracket generation for:', tournamentId);
    await this.generateInitialBracket(tournamentId);
    console.log('🏆 [BACKEND] Bracket generated successfully');
    
    return data;
  }

  /**
   * Cancel tournament
   * @param {String} tournamentId
   * @param {String} userId - Must be creator
   */
  async cancelTournament(tournamentId, userId) {
    const tournament = await this.getTournamentById(tournamentId);

    if (tournament.created_by !== userId) {
      throw new Error('Only tournament creator can cancel');
    }

    if (tournament.status === 'completed') {
      throw new Error('Cannot cancel completed tournament');
    }

    const { data, error } = await supabase
      .from('tournaments')
      .update({
        status: 'cancelled',
        ended_at: new Date().toISOString(),
      })
      .eq('id', tournamentId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get tournament standings
   * @param {String} tournamentId
   * @returns {Array} Standings
   */
  async getTournamentStandings(tournamentId) {
    const { data, error } = await supabase.rpc('get_tournament_standings', {
      tournament_id_param: tournamentId,
    });

    if (error) throw error;
    return data;
  }

  /**
   * Update participant seed (for bracket generation)
   * @param {String} participantId
   * @param {Number} seed
   */
  async updateParticipantSeed(participantId, seed) {
    const { data, error } = await supabase
      .from('tournament_participants')
      .update({ seed })
      .eq('id', participantId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Update participant status
   * @param {String} participantId
   * @param {Object} updates
   */
  async updateParticipant(participantId, updates) {
    const { data, error } = await supabase
      .from('tournament_participants')
      .update(updates)
      .eq('id', participantId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Complete tournament
   * @param {String} tournamentId
   * @param {String} winnerId
   */
  async completeTournament(tournamentId, winnerId) {
    const { data, error } = await supabase
      .from('tournaments')
      .update({
        status: 'completed',
        ended_at: new Date().toISOString(),
        winner_id: winnerId,
      })
      .eq('id', tournamentId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Generate initial tournament bracket with random pairings
   */
  async generateInitialBracket(tournamentId) {
    console.log('🏆 [BACKEND] Generating initial bracket for:', tournamentId);
    
    // Fetch all participants
    const { data: participants, error: participantsError } = await supabase
      .from('tournament_participants')
      .select('user_id')
      .eq('tournament_id', tournamentId)
      .order('joined_at', { ascending: true });

    if (participantsError) {
      console.error('🏆 [BACKEND] Error fetching participants:', participantsError);
      throw participantsError;
    }

    const playerCount = participants?.length || 0;
    console.log(`🏆 [BACKEND] Fetched ${playerCount} participants`);
    
    if (playerCount < 2 || !Number.isInteger(Math.log2(playerCount))) {
      throw new Error('Tournament requires a power-of-two registered player count');
    }

    // Calculate rounds needed
    const roundsNeeded = Math.ceil(Math.log2(playerCount));
    
    console.log(`🏆 [BACKEND] Generating bracket: ${playerCount} players, ${roundsNeeded} rounds`);

    // Shuffle players
    const shuffledPlayers = this.shuffleArray(participants.map(p => p.user_id));

    // Create first round matches
    const matches = [];
    let matchNumber = 1;

    for (let i = 0; i < shuffledPlayers.length; i += 2) {
      const player1_id = shuffledPlayers[i];
      const player2_id = shuffledPlayers[i + 1];

      matches.push({
        tournament_id: tournamentId,
        round: 1,
        match_number: matchNumber,
        bracket_position: `R1-M${matchNumber}`,
        player1_id: player1_id,
        player2_id,
        status: 'ready',
      });

      matchNumber++;
    }

    // Insert first round
    if (matches.length > 0) {
      const { error: insertError } = await supabase
        .from('tournament_matches')
        .insert(matches);

      if (insertError) {
        console.error('🏆 [BACKEND] Error inserting first round:', insertError);
        throw insertError;
      }

      console.log(`🏆 [BACKEND] Created ${matches.length} first round matches`);
    }

    // Generate subsequent rounds
    await this.generateSubsequentRounds(tournamentId, roundsNeeded);

    // Link each match to the next round so recordMatchResult can advance winners.
    const { data: bracketMatches, error: matchesError } = await supabase
      .from('tournament_matches')
      .select('id, round, match_number')
      .eq('tournament_id', tournamentId);
    if (matchesError) throw matchesError;
    const bySlot = new Map(bracketMatches.map((match) => [`${match.round}:${match.match_number}`, match.id]));
    for (const match of bracketMatches) {
      if (match.round >= roundsNeeded) continue;
      const nextMatchId = bySlot.get(`${match.round + 1}:${Math.ceil(match.match_number / 2)}`);
      if (!nextMatchId) throw new Error('Tournament bracket is incomplete');
      const { error: linkError } = await supabase
        .from('tournament_matches')
        .update({
          next_match_id: nextMatchId,
          winner_proceeds_to: match.match_number % 2 ? 'player1' : 'player2',
        })
        .eq('id', match.id);
      if (linkError) throw linkError;
    }
    
    console.log('🏆 [BACKEND] Bracket generation complete!');
  }

  /**
   * Generate subsequent tournament rounds
   */
  async generateSubsequentRounds(tournamentId, totalRounds) {
    if (totalRounds < 2) return;

    console.log(`🏆 [BACKEND] Generating ${totalRounds - 1} subsequent rounds`);

    for (let round = 2; round <= totalRounds; round++) {
      const matchesInRound = Math.pow(2, totalRounds - round);
      const matches = [];

      for (let matchNum = 1; matchNum <= matchesInRound; matchNum++) {
        matches.push({
          tournament_id: tournamentId,
          round: round,
          match_number: matchNum,
          bracket_position: `R${round}-M${matchNum}`,
          status: 'pending',
        });
      }

      if (matches.length > 0) {
        const { error: insertError } = await supabase
          .from('tournament_matches')
          .insert(matches);

        if (insertError) {
          console.error(`🏆 [BACKEND] Error inserting round ${round}:`, insertError);
          throw insertError;
        }

        console.log(`🏆 [BACKEND] Created ${matches.length} matches for round ${round}`);
      }
    }
  }

  /**
   * Shuffle array (Fisher-Yates)
   */
  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
}

export default new TournamentService();
