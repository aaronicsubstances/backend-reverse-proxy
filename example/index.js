const dotenv = require('dotenv');
const express = require("express");
const http = require("http");
const { configureExpress, configureSocketIoStream, setupLogger, setupTransfers } = require("backend-reverse-proxy");

dotenv.config();
const app = express();
const server = http.createServer(app);
const io = require('socket.io')(server, { path: undefined });

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
    let remoteWorkerAddress = "";
    try {
        remoteWorkerAddress = client.request.connection.remoteAddress;
    }
    catch (ignore) {}
    console.log(`[${remoteWorkerAddress}]`, "connected");
    client.on("disconnect", (reason) => {
        console.log(`[${remoteWorkerAddress}]`, "disconnected due to", reason);
    });
    configureSocketIoStream(client, remoteWorkerAddress, reqHeadersPrefix,
        reqBodyPrefix, resHeadersPrefix, resBodyPrefix,
        transferErrorPrefix);
});

const requestTimeoutMillis = parseInt(process.env.REQUEST_TIMEOUT_MILLIS) || 20000;
const pollWaitTimeMillis = parseInt(process.env.POLL_WAIT_TIME_MILLIS) || 5000;
const pickUpConfirmationTimeoutMillis = parseInt(process.env.PICK_UP_CONFIRMATION_TIMEOUT) || 3000;

setupTransfers(requestTimeoutMillis, pollWaitTimeMillis, pickUpConfirmationTimeoutMillis);
setupLogger(process.env.DEBUG, process.env.OMIT_LOG_TIMESTAMP);

const port = process.env.PORT || 5100;
server.listen(port, () => {
    console.log("http server listening on", port);
});