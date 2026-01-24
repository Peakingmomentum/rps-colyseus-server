import { Room, Client } from "@colyseus/core";
import { Schema, MapSchema, type } from "@colyseus/schema";

class Player extends Schema {
  @type("string") odisId: string = "";
  @type("string") odisName: string = "";
  @type("string") odisChoice: string = "";
  @type("number") score: number = 0;
  @type("boolean") connected: boolean = true;
}

class RPSState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("string") phase: string = "waiting";
  @type("number") currentRound: number = 1;
  @type("number") countdown: number = 0;
  @type("number") choiceTimer: number = 10;
  @type("string") matchWinnerId: string = "";
  @type("string") matchId: string = "";
  @type("number") wagerAmount: number = 0;
}

export class RPSRoom extends Room<RPSState> {
  maxClients = 2;
  private choiceTimeout: NodeJS.Timeout | null = null;
  private countdownInterval: NodeJS.Timeout | null = null;
  private rounds: Array<{round: number, player1Choice: string, player2Choice: string, winnerId: string}> = [];

  onCreate(options: any) {
    this.setState(new RPSState());
    
    if (options.matchId) {
      this.state.matchId = options.matchId;
    }
    if (options.wagerAmount) {
      this.state.wagerAmount = options.wagerAmount;
    }

    this.onMessage("choice", (client, choice: string) => {
      this.handleChoice(client, choice);
    });

    this.onMessage("rematch", (client) => {
      this.handleRematch(client);
    });
  }

  onJoin(client: Client, options: any) {
    const player = new Player();
    player.odisId = options.odisId || client.sessionId;
    player.odisName = options.odisName || `Player ${this.state.players.size + 1}`;
    player.connected = true;

    this.state.players.set(client.sessionId, player);

    if (this.state.players.size === 2) {
      this.startCountdown();
    }
  }

  async onLeave(client: Client, consented: boolean) {
    const player = this.state.players.get(client.sessionId);
    if (player) {
      player.connected = false;
      try {
        if (consented) throw new Error("Left");
        await this.allowReconnection(client, 30);
        player.connected = true;
      } catch (e) {
        if (this.state.phase !== "matchEnd") {
          const remaining = Array.from(this.state.players.entries())
            .find(([id, _]) => id !== client.sessionId);
          if (remaining) {
            this.state.matchWinnerId = remaining[1].odisId;
            this.state.phase = "matchEnd";
            await this.sendMatchResult();
          }
        }
        this.state.players.delete(client.sessionId);
      }
    }
  }

  onDispose() {
    this.clearTimers();
  }

  private startCountdown() {
    this.state.phase = "countdown";
    this.state.countdown = 3;
    
    this.countdownInterval = setInterval(() => {
      this.state.countdown--;
      if (this.state.countdown <= 0) {
        this.clearTimers();
        this.startChoicePhase();
      }
    }, 1000);
  }

  private startChoicePhase() {
    this.state.phase = "choosing";
    this.state.choiceTimer = 10;
    
    this.state.players.forEach((player) => {
      player.odisChoice = "";
    });

    this.countdownInterval = setInterval(() => {
      this.state.choiceTimer--;
      if (this.state.choiceTimer <= 0) {
        this.clearTimers();
        this.resolveRound();
      }
    }, 1000);

    this.choiceTimeout = setTimeout(() => {
      this.resolveRound();
    }, 11000);
  }

  private handleChoice(client: Client, choice: string) {
    if (this.state.phase !== "choosing") return;
    
    const valid = ["rock", "paper", "scissors"];
    if (!valid.includes(choice)) return;

    const player = this.state.players.get(client.sessionId);
    if (player && !player.odisChoice) {
      player.odisChoice = choice;
      
      const allChosen = Array.from(this.state.players.values())
        .every(p => p.odisChoice !== "");
      
      if (allChosen) {
        this.clearTimers();
        this.resolveRound();
      }
    }
  }

  private resolveRound() {
    this.state.phase = "reveal";
    
    const players = Array.from(this.state.players.values());
    const p1 = players[0];
    const p2 = players[1];

    if (!p1 || !p2) return;

    if (!p1.odisChoice) p1.odisChoice = this.randomChoice();
    if (!p2.odisChoice) p2.odisChoice = this.randomChoice();

    const winner = this.getWinner(p1.odisChoice, p2.odisChoice);
    
    let roundWinnerId = "tie";
    if (winner === "p1") {
      p1.score++;
      roundWinnerId = p1.odisId;
    } else if (winner === "p2") {
      p2.score++;
      roundWinnerId = p2.odisId;
    }

    this.rounds.push({
      round: this.state.currentRound,
      player1Choice: p1.odisChoice,
      player2Choice: p2.odisChoice,
      winnerId: roundWinnerId
    });

    if (p1.score >= 2) {
      this.endMatch(p1.odisId);
    } else if (p2.score >= 2) {
      this.endMatch(p2.odisId);
    } else {
      setTimeout(() => {
        this.state.currentRound++;
        this.startCountdown();
      }, 3000);
    }
  }

  private getWinner(c1: string, c2: string): "p1" | "p2" | "tie" {
    if (c1 === c2) return "tie";
    const wins: Record<string, string> = {
      rock: "scissors",
      paper: "rock",
      scissors: "paper"
    };
    return wins[c1] === c2 ? "p1" : "p2";
  }

  private async endMatch(winnerId: string) {
    this.state.phase = "matchEnd";
    this.state.matchWinnerId = winnerId;
    await this.sendMatchResult();
  }

  private async sendMatchResult() {
    const players = Array.from(this.state.players.values());
    const winner = players.find(p => p.odisId === this.state.matchWinnerId);
    const loser = players.find(p => p.odisId !== this.state.matchWinnerId);

    if (!winner || !loser) return;

    const webhookUrl = process.env.SUPABASE_WEBHOOK_URL || 
      "https://mudprlsqzvvooyxauxwf.supabase.co/functions/v1/colyseus-match-complete";

    const payload = {
      matchId: this.state.matchId || this.roomId,
      matchType: "multiplayer",
      winnerId: winner.odisId,
      loserId: loser.odisId,
      winnerScore: winner.score,
      loserScore: loser.score,
      rounds: this.rounds,
      wagerAmount: this.state.wagerAmount || 0
    };

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-colyseus-secret": process.env.COLYSEUS_WEBHOOK_SECRET || ""
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        console.error("Webhook failed:", await response.text());
      } else {
        console.log("Match result sent successfully");
      }
    } catch (error) {
      console.error("Failed to send match result:", error);
    }
  }

  private handleRematch(client: Client) {
    const allWantRematch = Array.from(this.state.players.values()).length === 2;
    if (allWantRematch && this.state.phase === "matchEnd") {
      this.state.players.forEach((p) => {
        p.score = 0;
        p.odisChoice = "";
      });
      this.state.currentRound = 1;
      this.state.matchWinnerId = "";
      this.rounds = [];
      this.startCountdown();
    }
  }

  private randomChoice(): string {
    const choices = ["rock", "paper", "scissors"];
    return choices[Math.floor(Math.random() * choices.length)];
  }

  private clearTimers() {
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.choiceTimeout) {
      clearTimeout(this.choiceTimeout);
      this.choiceTimeout = null;
    }
  }
}
