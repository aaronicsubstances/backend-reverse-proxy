const dotenv = require('dotenv');
const express = require("express");

const logger = require("./logger");
const transfers = require("./transfers");
const utils = require("./utils");

dotenv.config();
const app = express();
const port = process.env.PORT || 5100;

app.use(express.static(__dirname + "/public"));

app.use(function(req, res, next) {
    // use req.originalUrl instead of req.path to include query string
    if (!req.originalUrl.startsWith("/main/")) {
        next();
        return;
    }
    const parsedUrl = utils.parseMainUrl(req.originalUrl);
    transfers.scheduleTransfer(req, res, parsedUrl[0], parsedUrl[1]);
});

app.get("/req-h/:backendId", function(req, res) {
    const backendId = utils.normalizeUuid(req.params.backendId);
    const remoteWorkerAddress = utils.getClientIpAddress(req);
    transfers.beginRequestTransfer(remoteWorkerAddress, backendId,
        (err, headers) => {
            if (headers) {
                res.json(headers);
            }
            else {
                res.status(500).send(err);
            }
        });
});

app.get("/req-b/:backendId/:transferId", function(req, res) {
    const backendId = utils.normalizeUuid(req.params.backendId);
    const remoteWorkerAddress = utils.getClientIpAddress(req);
    transfers.endRequestTransfer(remoteWorkerAddress, backendId, req.params.transferId,
        (err, body) => {
            if (body) {
                res.header("content-type", "application/octet-stream");
                body.pipe(res);
            }
            else {
                res.status(400).send(err);
            }
        });
});

// create application/json parser only for parsing reponse headers
// to avoid body parser tampering with request bodies to /main/*
const jsonParser = express.json();
app.post("/res-h/:backendId", jsonParser, function(req, res) {
    const backendId = utils.normalizeUuid(req.params.backendId);
    const remoteWorkerAddress = utils.getClientIpAddress(req);
    transfers.beginReceiveResponse(remoteWorkerAddress, backendId, req.body,
        (err) => {
            if (!err) {
                res.sendStatus(204);
            }
            else {
                res.status(400).send(err);
            }
        });
});

app.post("/res-b/:backendId/:transferId", function(req, res) {
    const backendId = utils.normalizeUuid(req.params.backendId);
    const remoteWorkerAddress = utils.getClientIpAddress(req);
    transfers.endReceiveResponse(remoteWorkerAddress, backendId, req.params.transferId, req,
        (err) => {
            if (!err) {
                res.sendStatus(204);
            }
            else {
                res.status(400).send(err);
            }
        });
});

app.post("/err/:backendId/:transferId", jsonParser, function(req, res) {
    const backendId = utils.normalizeUuid(req.params.backendId);
    const remoteWorkerAddress = utils.getClientIpAddress(req);
    const transferId = req.params.transferId;
    const transferError = req.body;

    // end response asap
    res.end();

    transfers.failTransfer(remoteWorkerAddress, backendId, transferId, transferError);
});
  
app.listen(port, () => {
    logger.info("http server listening on", port);
});