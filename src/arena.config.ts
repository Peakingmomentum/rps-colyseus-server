import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import express from "express";
import { RPSRoom } from "./rooms/RPSRoom";

const app = express();
const port = Number(process.env.PORT) || 2567;

const server = new Server({
  transport: new WebSocketTransport({
    server: app.listen(port)
  })
});

server.define("rps_match", RPSRoom);

app.use("/colyseus", monitor());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

console.log(`RPS Game Server running on port ${port}`);import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { monitor } from "@colyseus/monitor";
import express from "express";
import { RPSRoom } from "./rooms/RPSRoom";

const app = express();
const port = Number(process.env.PORT) || 2567;

const server = new Server({
  transport: new WebSocketTransport({
    server: app.listen(port)
  })
});

server.define("rps_match", RPSRoom);

app.use("/colyseus", monitor());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

console.log(`RPS Game Server running on port ${port}`);
