iimport { Room, Client } from '@colyseus/core';
import { Schema, MapSchema, type } from '@colyseus/schema';

class Player extends Schema {
  @type('string') odisId: string = '';
  @type('string') odisName: string = 'Player';
  @type('string') odUserId: string = '';
  @type('string') choice: string = '';
  @type('boolean') locked: boolean = false;
  @type('number') score: number = 0;
  @type('boolean') connected: boolean = true;
}

class RoundResult extends Schema {
  @type('number') round: number = 0;
  @type('string') player1Choice: string = '';
  @type('string') player2Choice: string = '';
  @type('string') winnerId: string = '';
}

class RPSRoomState extends Schema {
  @type('string') phase: string = 'waiting';
  @type('number') currentRound: number = 1;
  @type('number') maxScore: number = 4;
  @type('number') countdownTimer: number = 3;
  @type('number') choiceTimer: number = 10;
  @type({ map: Player }) players = new MapSchema<Player>();
  @type(RoundResult) lastRoundResult: RoundResult | null = null;
  @type('string') winnerId: string = '';
  @type('string') matchId: string = '';
}

export class RPSRoom extends Room<RPSRoomState> {
  private roundTimer: ReturnType<typeof setInterval> | null = null;
  private countdownTimerInterval: ReturnType<typeof setInterval> | null = null;

  onCreate(options: any) {
    this.setState(new RPSRoomState());
    this.state.matchId = options.matchId || '';
    this.setMetadata({ matchId: this.state.matchId });
    this.state.maxScore = options.maxScore || 4;
    this.maxClients = 2;
    console.log(`[RPSRoom] Room created. matchId: ${this.state.matchId}, roomId: ${this.roomId}`);
    
    this.onMessage('choice', (client, message) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.phase !== 'choosing') return;
      if (!player.locked && ['rock', 'paper', 'scissors'].includes(message.choice)) {
        player.choice = message.choice;
        player.locked = true;
        this.broadcast('player_locked', { sessionId: client.sessionId });
        this.checkRoundComplete();
      }
    });
  }

  onJoin(client: Client, options: any) {
    if (this.state.matchId && options.matchId && this.state.matchId !== options.matchId) {
      throw new Error('Match ID mismatch');
    }
    if (!this.state.matchId && options.matchId) {
      this.state.matchId = options.matchId;
    }
    const player = new Player();
    player.odisId = client.sessionId;
    player.odUserId = options.odisId || '';
    player.odisName = options.odisName || 'Player';
    player.connected = true;
    this.state.players.set(client.sessionId, player);
    console.log(`[RPSRoom] Player joined: ${player.odisName} (${client.sessionId})`);
    if (this.state.players.size === 2) {
      this.lock();
      this.startCountdown();
    }
  }

  onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = false;
      if (this.state.phase === 'choosing' || this.state.phase === 'countdown') {
        const opponent = this.getOpponent(client.sessionId);
        if (opponent) {
          this.state.winnerId = opponent.odUserId;
          this.state.phase = 'matchEnd';
          this.broadcast('match_complete', { winnerId: opponent.odUserId, reason: 'forfeit' });
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
    if (this.roundTimer) { clearInterval(this.roundTimer); this.roundTimer = null; }
    if (this.countdownTimerInterval) { clearInterval(this.countdownTimerInterval); this.countdownTimerInterval = null; }
  }

  private startCountdown() {
    this.clearTimers();
    this.state.phase = 'countdown';
    this.state.countdownTimer = 3;
    this.broadcast('countdown', { timer: this.state.countdownTimer });
    this.countdownTimerInterval = setInterval(() => {
      this.state.countdownTimer--;
      this.broadcast('countdown', { timer: this.state.countdownTimer });
      if (this.state.countdownTimer <= 0) { this.clearTimers(); this.startChoosing(); }
    }, 1000);
  }

  private startChoosing() {
    this.clearTimers();
    this.state.phase = 'choosing';
    this.state.choiceTimer = 10;
    this.state.players.forEach(player => { player.choice = ''; player.locked = false; });
    this.roundTimer = setInterval(() => {
      this.state.choiceTimer--;
      this.broadcast('choice_timer', { timer: this.state.choiceTimer });
      if (this.state.choiceTimer <= 0) { this.clearTimers(); this.autoSubmitChoices(); }
    }, 1000);
  }

  private autoSubmitChoices() {
    const choices = ['rock', 'paper', 'scissors'];
    this.state.players.forEach(player => {
      if (!player.locked) { player.choice = choices[Math.floor(Math.random() * 3)]; player.locked = true; }
    });
    this.resolveRound();
  }

  private checkRoundComplete() {
    let allLocked = true;
    this.state.players.forEach(player => { if (!player.locked) allLocked = false; });
    if (allLocked) { this.clearTimers(); this.resolveRound(); }
  }

  private resolveRound() {
    const players = Array.from(this.state.players.values());
    if (players.length !== 2) return;
    const [p1, p2] = players;
    this.state.phase = 'reveal';
    const result = new RoundResult();
    result.round = this.state.currentRound;
    result.player1Choice = p1.choice || 'rock';
    result.player2Choice = p2.choice || 'rock';
    const winner = this.determineWinner(result.player1Choice, result.player2Choice);
    if (winner === 1) { p1.score++; result.winnerId = p1.odUserId; }
    else if (winner === 2) { p2.score++; result.winnerId = p2.odUserId; }
    else { result.winnerId = ''; }
    this.state.lastRoundResult = result;
    this.broadcast('round_result', { round: result.round, player1Choice: result.player1Choice, player2Choice: result.player2Choice, winnerId: result.winnerId || null });
    if (p1.score >= this.state.maxScore) { this.state.winnerId = p1.odUserId; this.state.phase = 'matchEnd'; this.broadcast('match_complete', { winnerId: p1.odUserId }); }
    else if (p2.score >= this.state.maxScore) { this.state.winnerId = p2.odUserId; this.state.phase = 'matchEnd'; this.broadcast('match_complete', { winnerId: p2.odUserId }); }
    else { setTimeout(() => { this.state.currentRound++; this.startCountdown(); }, 2500); }
  }

  private determineWinner(c1: string, c2: string): 0 | 1 | 2 {
    if (c1 === c2) return 0;
    if ((c1 === 'rock' && c2 === 'scissors') || (c1 === 'paper' && c2 === 'rock') || (c1 === 'scissors' && c2 === 'paper')) return 1;
    return 2;
  }

  onDispose() { this.clearTimers(); console.log(`[RPSRoom] Room disposed: ${this.roomId}`); }
}
}
