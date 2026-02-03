import { Room, Client } from '@colyseus/core';
import { Schema, MapSchema, type } from '@colyseus/schema';

// Player schema - FIELD NAMES MUST MATCH CLIENT EXACTLY
class Player extends Schema {
  @type('string') odisId: string = '';           // Colyseus session ID (client expects 'odisId')
  @type('string') odisName: string = 'Player';   // Display name (client expects 'odisName')
  @type('string') odUserId: string = '';         // Supabase user ID
  @type('string') choice: string = '';           // 'rock', 'paper', 'scissors', or empty
  @type('boolean') locked: boolean = false;
  @type('number') score: number = 0;
  @type('boolean') connected: boolean = true;
}

// Round result schema
class RoundResult extends Schema {
  @type('number') round: number = 0;
  @type('string') player1Choice: string = '';
  @type('string') player2Choice: string = '';
  @type('string') winnerId: string = '';         // null represented as empty string for ties
}

// Room state - FIELD NAMES MUST MATCH CLIENT EXACTLY
class RPSRoomState extends Schema {
  @type('string') phase: string = 'waiting';     // Client expects 'phase' not 'status'
  @type('number') currentRound: number = 1;
  @type('number') maxScore: number = 4;          // First to 4 wins (can be overridden)
  @type('number') countdownTimer: number = 3;    // Pre-round countdown
  @type('number') choiceTimer: number = 10;      // Time to make choice
  @type({ map: Player }) players = new MapSchema<Player>();
  @type(RoundResult) lastRoundResult: RoundResult | null = null;
  @type('string') winnerId: string = '';         // Empty string until match ends
  @type('string') matchId: string = '';          // For tournament matching
}

export class RPSRoom extends Room<RPSRoomState> {
  private roundTimer: ReturnType<typeof setInterval> | null = null;
  private countdownTimerInterval: ReturnType<typeof setInterval> | null = null;

  onCreate(options: any) {
    this.setState(new RPSRoomState());
    
    // Store matchId in state for filtering
    this.state.matchId = options.matchId || '';
    
    // Set metadata so clients can find rooms by matchId
    this.setMetadata({ matchId: this.state.matchId });
    
    // Set maxScore based on wager or tournament round (can be customized)
    // Default: first to 4 for regular matches, can be overridden
    this.state.maxScore = options.maxScore || 4;
    
    this.maxClients = 2;
    
    console.log(`[RPSRoom] Room created. matchId: ${this.state.matchId}, roomId: ${this.roomId}`);
    
    // Handle player choice
    this.onMessage('choice', (client, message) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.phase !== 'choosing') return;
      
      if (!player.locked && ['rock', 'paper', 'scissors'].includes(message.choice)) {
        player.choice = message.choice;
        player.locked = true;
        
        // Broadcast that a player locked in (without revealing choice)
        this.broadcast('player_locked', { sessionId: client.sessionId });
        
        // Check if both players have locked in
        this.checkRoundComplete();
      }
    });
  }


  onJoin(client: Client, options: any) {
    // Check if this room's matchId matches the player's matchId
    // This ensures tournament matches pair correctly
    if (this.state.matchId && options.matchId && this.state.matchId !== options.matchId) {
      console.log(`[RPSRoom] Rejecting player - matchId mismatch: ${options.matchId} vs ${this.state.matchId}`);
      throw new Error('Match ID mismatch');
    }
    
    // Set matchId if not already set (first player sets it)
    if (!this.state.matchId && options.matchId) {
      this.state.matchId = options.matchId;
    }
    
    const player = new Player();
    player.odisId = client.sessionId;            // Use sessionId as odisId
    player.odUserId = options.odisId || '';      // Supabase user ID passed as odisId
    player.odisName = options.odisName || 'Player';
    player.connected = true;
    
    this.state.players.set(client.sessionId, player);
    
    console.log(`[RPSRoom] Player joined: ${player.odisName} (${client.sessionId}) to room ${this.roomId}, matchId: ${this.state.matchId}`);
    
    // Start game when 2 players join
    if (this.state.players.size === 2) {
      this.lock(); // Prevent more players from joining
      this.startCountdown();
    }
  }

  onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = false;
      
      console.log(`[RPSRoom] Player left: ${player.odisName} (consented: ${consented})`);
      
      // If game is in progress, opponent wins by forfeit
      if (this.state.phase === 'choosing' || this.state.phase === 'countdown') {
        const opponent = this.getOpponent(client.sessionId);
        if (opponent) {
          this.state.winnerId = opponent.odUserId;
          this.state.phase = 'matchEnd';
          this.broadcast('match_complete', { 
            winnerId: opponent.odUserId, 
            reason: 'forfeit' 
          });
        }
      }
    }
  }

  private getOpponent(sessionId: string): Player | null {
    let opponent: Player | null = null;
    this.state.players.forEach((player, sid) => {
      if (sid !== sessionId) opponent = player;
    });
    return opponent;
  }

  private clearTimers() {
    if (this.roundTimer) {
      clearInterval(this.roundTimer);
      this.roundTimer = null;
    }
    if (this.countdownTimerInterval) {
      clearInterval(this.countdownTimerInterval);
      this.countdownTimerInterval = null;
    }
  }

  private startCountdown() {
    this.clearTimers();
    this.state.phase = 'countdown';
    this.state.countdownTimer = 3;
    
    // Broadcast countdown updates
    this.broadcast('countdown', { timer: this.state.countdownTimer });
    
    this.countdownTimerInterval = setInterval(() => {
      this.state.countdownTimer--;
      this.broadcast('countdown', { timer: this.state.countdownTimer });
      
      if (this.state.countdownTimer <= 0) {
        this.clearTimers();
        this.startChoosing();
      }
    }, 1000);
  }

  private startChoosing() {
    this.clearTimers();
    this.state.phase = 'choosing';
    this.state.choiceTimer = 10;
    
    // Reset choices for new round
    this.state.players.forEach(player => {
      player.choice = '';
      player.locked = false;
    });
    
    // Broadcast timer updates
    this.roundTimer = setInterval(() => {
      this.state.choiceTimer--;
      this.broadcast('choice_timer', { timer: this.state.choiceTimer });
      
      if (this.state.choiceTimer <= 0) {
        this.clearTimers();
        this.autoSubmitChoices();
      }
    }, 1000);
  }

  private autoSubmitChoices() {
    const choices = ['rock', 'paper', 'scissors'];
    this.state.players.forEach(player => {
      if (!player.locked) {
        player.choice = choices[Math.floor(Math.random() * 3)];
        player.locked = true;
      }
    });
    this.resolveRound();
  }

  private checkRoundComplete() {
    let allLocked = true;
    this.state.players.forEach(player => {
      if (!player.locked) allLocked = false;
    });
    
    if (allLocked) {
      this.clearTimers();
      this.resolveRound();
    }
  }

  private resolveRound() {
    const players = Array.from(this.state.players.values());
    if (players.length !== 2) return;
    
    const [p1, p2] = players;
    
    // Update phase to reveal
    this.state.phase = 'reveal';
    
    // Create round result
    const result = new RoundResult();
    result.round = this.state.currentRound;
    result.player1Choice = p1.choice || 'rock';
    result.player2Choice = p2.choice || 'rock';
    
    // Determine winner
    const winner = this.determineWinner(result.player1Choice, result.player2Choice);
    if (winner === 1) {
      p1.score++;
      result.winnerId = p1.odUserId;
    } else if (winner === 2) {
      p2.score++;
      result.winnerId = p2.odUserId;
    } else {
      result.winnerId = ''; // tie - empty string
    }
    
    this.state.lastRoundResult = result;
    this.broadcast('round_result', {
      round: result.round,
      player1Choice: result.player1Choice,
      player2Choice: result.player2Choice,
      winnerId: result.winnerId || null
    });
    
    // Check for match winner (first to maxScore)
    if (p1.score >= this.state.maxScore) {
      this.state.winnerId = p1.odUserId;
      this.state.phase = 'matchEnd';
      this.broadcast('match_complete', { winnerId: p1.odUserId });
    } else if (p2.score >= this.state.maxScore) {
      this.state.winnerId = p2.odUserId;
      this.state.phase = 'matchEnd';
      this.broadcast('match_complete', { winnerId: p2.odUserId });
    } else {
      // Continue to next round after delay
      setTimeout(() => {
        this.state.currentRound++;
        this.startCountdown();
      }, 2500);
    }
  }

  private determineWinner(c1: string, c2: string): 0 | 1 | 2 {
    if (c1 === c2) return 0; // tie
    if (
      (c1 === 'rock' && c2 === 'scissors') ||
      (c1 === 'paper' && c2 === 'rock') ||
      (c1 === 'scissors' && c2 === 'paper')
    ) {
      return 1; // player 1 wins
    }
    return 2; // player 2 wins
  }

  onDispose() {
    this.clearTimers();
    console.log(`[RPSRoom] Room disposed: ${this.roomId}`);
  }
}
