// src/rooms/schemas/RPSRoomState.ts
import { Schema, type, MapSchema } from "@colyseus/schema";

export class Player extends Schema {
  @type("string") odisId: string = "";
  @type("string") odisName: string = "";
  @type("string") odUserId: string = "";
  @type("string") choice: string = "";
  @type("boolean") locked: boolean = false;
  @type("number") score: number = 0;
  @type("boolean") connected: boolean = true;
}

export class RoundResult extends Schema {
  @type("number") round: number = 0;
  @type("string") player1Choice: string = "";
  @type("string") player2Choice: string = "";
  @type("string") winnerId: string = "";
}

export class RPSRoomState extends Schema {
  @type("string") phase: string = "waiting"; // waiting | countdown | choosing | reveal | matchEnd
  @type("number") currentRound: number = 1;
  @type("number") maxScore: number = 4;
  @type("number") countdownTimer: number = 3;
  @type("number") choiceTimer: number = 10;
  @type({ map: Player }) players = new MapSchema<Player>();
  @type(RoundResult) lastRoundResult: RoundResult | null = null;
  @type("string") winnerId: string = "";
}

