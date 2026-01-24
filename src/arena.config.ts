import Arena from "@colyseus/arena";
import { monitor } from "@colyseus/monitor";
import { RPSRoom } from "./rooms/RPSRoom";

export default Arena({
  getId: () => "RPS Game Server",

  initializeGameServer: (gameServer) => {
    gameServer.define("rps_match", RPSRoom);
  },

  initializeExpress: (app) => {
    app.use("/colyseus", monitor());
    
    app.get("/health", (req, res) => {
      res.json({ status: "ok" });
    });
  },

  beforeListen: () => {
    console.log("RPS Game Server starting...");
  }
});
