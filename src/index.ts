import Arena from "@colyseus/arena";
import arenaConfig from "./arena.config";

Arena.listen(arenaConfig, 2567);
