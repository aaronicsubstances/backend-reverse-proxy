const dotenv = require('dotenv');
const express = require("express");
const http = require("http");
const { configureExpress, configureSocketIoStream } = require("backend-reverse-proxy");

dotenv.config();
const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server);

app.use(express.static(__dirname + "/public"));

const generalPrefix = "/main-";
const reqHeadersPrefix = "/req-h";
const reqBodyPrefix = "/req-b";
const resHeadersPrefix = "/res-h";
const resBodyPrefix = "/res-b";
const transferErrorPrefix = "/transfer-err";

const jsonParser = express.json();
configureExpress(app, jsonParser, generalPrefix, reqHeadersPrefix,
    reqBodyPrefix, resHeadersPrefix, resBodyPrefix,
    transferErrorPrefix);

io.on('connection', (client) => {
    const remoteWorkerAddress = client.request.connection.remoteAddress;
    console.log(`[${remoteWorkerAddress}]`, "connected");
    client.on("disconnect", (reason) => {
        console.log(`[${remoteWorkerAddress}]`, "disconnected due to", reason);
    });
    configureSocketIoStream(client, remoteWorkerAddress, reqHeadersPrefix,
        reqBodyPrefix, resHeadersPrefix, resBodyPrefix,
        transferErrorPrefix);
});

const port = process.env.PORT || 5100;
server.listen(port, () => {
    console.log("http server listening on", port);
});