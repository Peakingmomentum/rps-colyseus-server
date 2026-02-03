import Arena from "@colyseus/tools";
import { monitor } from "@colyseus/monitor";
import { RPSRoom } from "./src/rooms/RPSRoom";

export default Arena({
    getId: () => "RPS Colyseus Server",

    initializeGameServer: (gameServer) => {
        gameServer.define('rps_match', RPSRoom);
    },

    initializeExpress: (app) => {
        app.use("/colyseus", monitor());
    },

    beforeListen: () => {
        // Called before listen
    }
});
