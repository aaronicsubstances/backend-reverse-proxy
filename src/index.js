const ss = require("socket.io-stream");

const transfers = require("./transfers");
const utils = require("./utils");

function configureExpress(app, jsonParser, generalPrefix, reqHeadersPrefix,
        reqBodyPrefix, resHeadersPrefix, resBodyPrefix,
        transferErrorPrefix) {
    if (generalPrefix) {
        app.use(function(req, res, next) {
            // use req.originalUrl instead of req.path to include query string
            if (!req.originalUrl.startsWith(generalPrefix)) {
                next();
                return;
            }
            const parsedUrl = utils.parseMainUrl(generalPrefix, req.originalUrl);
            transfers.scheduleTransfer(req, res, parsedUrl[0], parsedUrl[1]);
        });
    }

    // use application/json parser only for parsing reponse headers
    // to avoid body parser tampering with request bodies to general url.
    app.get(`${reqHeadersPrefix}/:backendId`, jsonParser, function(req, res) {
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

    app.post(reqBodyPrefix, jsonParser, function(req, res) {
        const backendId = utils.normalizeUuid(req.body.backendId);
        const remoteWorkerAddress = utils.getClientIpAddress(req);
        transfers.endRequestTransfer(remoteWorkerAddress, backendId, req.body.id,
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

    app.post(resHeadersPrefix, jsonParser, function(req, res) {
        const backendId = utils.normalizeUuid(req.body.backendId);
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

    app.post(`${resBodyPrefix}/:backendId/:transferId`, jsonParser, function(req, res) {
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

    app.post(transferErrorPrefix, jsonParser, function(req, res) {
        const backendId = utils.normalizeUuid(req.body.backendId);
        const remoteWorkerAddress = utils.getClientIpAddress(req);
        const transferId = req.body.id;
        const transferError = req.body;

        // end response asap
        res.end();

        transfers.failTransfer(remoteWorkerAddress, backendId, transferId, transferError);
    });
}

function configureSocketIoStream(client, remoteWorkerAddress, reqHeadersPrefix,
        reqBodyPrefix, resHeadersPrefix, resBodyPrefix,
        transferErrorPrefix) {
    client.on(reqHeadersPrefix, req => {
        const backendId = utils.normalizeUuid(req.backendId);
        transfers.beginRequestTransfer(remoteWorkerAddress, backendId,
            (errToBeIgnored, headers) => {
                client.emit(reqHeadersPrefix, headers);
            },
            (backendId, id, error) => {
                client.emit(transferErrorPrefix, { backendId, id, error });
            });
    });
    client.on(reqBodyPrefix, (req) => {
        const backendId = utils.normalizeUuid(req.backendId);
        transfers.endRequestTransfer(remoteWorkerAddress, backendId, req.id,
            (err, body) => {
                const stream = ss.createStream();
                ss(client).emit(reqBodyPrefix, stream, { id: req.id, error: err });
                if (body) {
                    body.pipe(stream);
                }
            });
    });
    client.on(resHeadersPrefix, req => {
        const backendId = utils.normalizeUuid(req.backendId);
        transfers.beginReceiveResponse(remoteWorkerAddress, backendId, req,
            (err) => {
                client.emit(resHeadersPrefix, { id: req.id, error: err });
            });
    });
    ss(client).on(resBodyPrefix, function(stream, req) {
        const backendId = utils.normalizeUuid(req.backendId);
        transfers.endReceiveResponse(remoteWorkerAddress, backendId, req.id, stream,
            (err) => {
                client.emit(resBodyPrefix, { id: req.id, error: err });
            });
    });
    client.on(transferErrorPrefix, req => {
        const backendId = utils.normalizeUuid(req.backendId);

        transfers.failTransfer(remoteWorkerAddress, backendId, req.id, req);
    });
}

module.exports = {
    configureExpress,
    configureSocketIoStream
};