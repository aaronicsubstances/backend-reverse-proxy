const bodyParser = require('body-parser')
const dotenv = require('dotenv');
const express = require("express");

const logger = require("./logger");
const transfers = require("./transfers");
const utils = require("./utils");

dotenv.config();
const app = express();
const port = process.env.PORT || 5100;

app.use(express.static(__dirname + "/public"));

app.use(bodyParser.json());

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
    transfers.beginRequestTransfer(req, res, backendId);
});

app.get("/req-b/:backendId/:transferId", function(req, res) {
    const backendId = utils.normalizeUuid(req.params.backendId);
    transfers.endRequestTransfer(req, res, backendId, req.params.transferId);
});

app.post("/res-h/:backendId", function(req, res) {
    const backendId = utils.normalizeUuid(req.params.backendId);
    transfers.beginReceiveResponse(req, res, backendId);
});

app.post("/res-b/:backendId/:transferId", function(req, res) {
    const backendId = utils.normalizeUuid(req.params.backendId);
    transfers.endReceiveResponse(req, res, backendId, req.params.transferId);
});
  
app.listen(port, () => {
    logger.info("http server listening on", port);
});