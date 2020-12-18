const logger = require("./logger");
const utils = require("./utils");

let lastTransferId = 0;
const allPendingTransfers = new Map();

// use this to ensure ids are not reused in between process restarts.
const transferIdPrefix = new Date().toISOString().replace(/[.:\-]/g, '');

function scheduleTransfer(req, res, backendId, targetUrl) {
    const clientIpAddress = utils.getClientIpAddress(req);
    const pendingTransfer = {
        req,
        res,
        id: transferIdPrefix + "-" + (++lastTransferId),
        targetUrl,
        timeout: null,
        bytesWritten: 0,
        startDate: new Date(),
        clientIpAddress,
        state: 0
    };
    let backendTransfers;
    if (allPendingTransfers.has(backendId)) {
        backendTransfers = allPendingTransfers.get(backendId);
    }
    else {
        backendTransfers = {
            id: backendId,
            queue: new Array(),
            remoteWorkers: new Array()
        };
        allPendingTransfers.set(backendId, backendTransfers);
    }
    backendTransfers.queue.push(pendingTransfer);
    pendingTransfer.timeout = setTimeout(() => {
        _endPendingTransfer(backendId, pendingTransfer, { timeout: true });
    }, utils.getRequestTimeoutMillis());
    
    logger.info(`[${pendingTransfer.clientIpAddress}] ${pendingTransfer.id}. ${req.method} "${targetUrl}" - scheduled`);

    // see if there's any remote worker to work on pendingTransfer immediately.
    if (backendTransfers.remoteWorkers.length) {
        _beginRemoteWorkOnPendingTransfer(backendId, pendingTransfer, backendTransfers.remoteWorkers[0]);
    }
}

function beginRequestTransfer(req, res, backendId) {
    let backendTransfers;
    if (allPendingTransfers.has(backendId)) {
        backendTransfers = allPendingTransfers.get(backendId);
    }
    else {
        backendTransfers = {
            id: backendId,
            queue: new Array(),
            remoteWorkers: new Array()
        };
        allPendingTransfers.set(backendId, backendTransfers);
    }
    const remoteWorker = {
        res,
        timeout: null,
        clientIpAddress: utils.getClientIpAddress(req)
    };
    backendTransfers.remoteWorkers.push(remoteWorker);

    // see if there is any pending transfer to pick up immediately.
    const pendingTransferWork = _identifyAnyPendingTransferWork(backendTransfers);
    if (pendingTransferWork) {
        _beginRemoteWorkOnPendingTransfer(backendId, pendingTransferWork, remoteWorker);
    }
    else {
        logger.debug(`[${remoteWorker.clientIpAddress}] remote worker waiting for pending transfer on ${backendId}`);

        // wait for some time.
        remoteWorker.timeout = setTimeout(() => {
            // send back response without an id to indicate
            // that no pending transfer was found.
            logger.debug(`[${remoteWorker.clientIpAddress}] remote worker exiting without any pending transfer on ${backendId}`);
            remoteWorker.res.json({});
            _endRemoteWork(backendId, remoteWorker);
        }, utils.getPollWaitTimeMillis());
    }
}

function endRequestTransfer(req, res, backendId, transferId) {
    if (!allPendingTransfers.has(backendId)) {
        _logAndIssueErrorResponse(req, res, `No pending transfer found from backend ${backendId}`);
        return;
    }
    const backendTransfers = allPendingTransfers.get(backendId);
    const pendingTransfer = backendTransfers.queue.find(x => x.id === transferId);
    if (!pendingTransfer) {
        _logAndIssueErrorResponse(req, res, `No pending transfer found with id ${transferId}`);
        return;
    }
    if (pendingTransfer.state !== 1) {
        _logAndIssueErrorResponse(req, res, 
            `Pending transfer with id ${transferId} is not expecting a request body transfer`);
        return;
    }

    clearTimeout(pendingTransfer.initialTimeout);

    const clientIpAddress = utils.getClientIpAddress(req);    
    logger.info(`[${clientIpAddress}] ${pendingTransfer.id}.`,
        `${pendingTransfer.req.method} "${pendingTransfer.targetUrl}" -`,
        `request body being transferred to remote worker`);

    // transfer request body to response
    res.header("content-type", "application/octet-stream");
    pendingTransfer.req.pipe(res);
    pendingTransfer.state++;
}

function beginReceiveResponse(req, res, backendId) {
    const responsePart = req.body;
    const transferId = responsePart.id;
    if (!allPendingTransfers.has(backendId)) {
        _logAndIssueErrorResponse(req, res, `No pending transfer found from backend ${backendId}`);
        return;
    }
    const backendTransfers = allPendingTransfers.get(backendId);
    const pendingTransfer = backendTransfers.queue.find(x => x.id === transferId);
    if (!pendingTransfer) {
        _logAndIssueErrorResponse(req, res, `No pending transfer found with id ${transferId}`);
        return;
    }
    if (pendingTransfer.state !== 2) {
        _logAndIssueErrorResponse(req, res, 
            `Pending transfer with id ${transferId} is not expecting to receive response headers`);
        return;
    }

    const clientIpAddress = utils.getClientIpAddress(req);
    logger.info(`[${clientIpAddress}] ${pendingTransfer.id}.`,
        `${pendingTransfer.req.method} "${pendingTransfer.targetUrl}" -`,
        `response headers being received from remote worker`);

    // transfer response headers from remote worker
    for (const k of Object.keys(responsePart.headers || {})) {
        // eliminate some headers entirely. content-encoding in particular
        // corrupts transferred response.
        if (/^(connection|content-encoding)$/i.test(k)) {
            logger.debug(`Skipping response header ${k} for pending transfer ${pendingTransfer.id}`);
            continue;
        }

        // nodejs doesn't allow some headers to be sent as array.
        if (/^(content-type)$/i.test(k)) {
            pendingTransfer.res.header(k, responsePart.headers[k][0])
        }
        else {
            pendingTransfer.res.header(k, responsePart.headers[k]);
        }
    }

    pendingTransfer.res.statusCode = responsePart.statusCode || 200;
    pendingTransfer.res.statusMessage = responsePart.statusMessage;
    pendingTransfer.state++;

    // end request made by remote worker.
    res.sendStatus(204);
}

function endReceiveResponse(req, res, backendId, transferId) {
    if (!allPendingTransfers.has(backendId)) {
        _logAndIssueErrorResponse(req, res, `No pending transfer found from backend ${backendId}`);
        return;
    }
    const backendTransfers = allPendingTransfers.get(backendId);
    const pendingTransfer = backendTransfers.queue.find(x => x.id === transferId);
    if (!pendingTransfer) {
        _logAndIssueErrorResponse(req, res, `No pending transfer found with id ${transferId}`);
        return;
    }
    if (pendingTransfer.state !== 3) {
        _logAndIssueErrorResponse(req, res, 
            `Pending transfer with id ${transferId} is not expecting to receive response body`);
        return;
    }

    const clientIpAddress = utils.getClientIpAddress(req);    
    logger.info(`[${clientIpAddress}] ${pendingTransfer.id}.`,
        `${pendingTransfer.req.method} "${pendingTransfer.targetUrl}" -`,
        `response body being received from remote worker`);

    // receive response body from remote worker
    req.pipe(pendingTransfer.res);
    pendingTransfer.state++;

    req.once("end", () => {
        res.sendStatus(204);
        _endPendingTransfer(backendId, pendingTransfer);
    });

    req.on("data", (chunk) => {
        pendingTransfer.bytesWritten += chunk.length;
    });

    req.once("error", (error) => {
        logger.error(`An error occurred while sending response body for ${pendingTransfer.id}`, error);
        res.sendStatus(204); // still send a success status to remote worker.
        _endPendingTransfer(backendId, pendingTransfer, { error });
    });

    // can clear timeout at this stage, so response body transfer doesn't interfere with
    // any timeout message.
    clearTimeout(pendingTransfer.timeout);
    pendingTransfer.timeout = null;
}

function _identifyAnyPendingTransferWork(backendTransfers) {
    for (pendingTransfer of backendTransfers.queue) {
        if (pendingTransfer.state === 0) {
            return pendingTransfer;
        }
    }
    return null;
}

function _beginRemoteWorkOnPendingTransfer(backendId, pendingTransfer, remoteWorker) {
    clearTimeout(remoteWorker.timeout);
    remoteWorker.timeout = null;
    
    logger.info(`[${remoteWorker.clientIpAddress}] ${pendingTransfer.id}.`,
        `${pendingTransfer.req.method} "${pendingTransfer.targetUrl}" -`,
        `request headers being transferred to remote worker`);

    const requestMetadata = {
        id: pendingTransfer.id,
        method: pendingTransfer.req.method,
        path: pendingTransfer.targetUrl,
        protocolVersion: pendingTransfer.req.httpVersion,
        headers: pendingTransfer.req.rawHeaders,
        clientIpAddress: pendingTransfer.clientIpAddress
    };
    remoteWorker.res.json(requestMetadata);
    pendingTransfer.state++;

    // just in case remote worker is disconnected without us knowing, add a timeout and revert
    // state of pendingTransfer to make it eligible for pick up.
    pendingTransfer.initialTimeout = setTimeout(() => {
        const waitTime = new Date().getTime() - pendingTransfer.startDate.getTime();
        logger.warn(`transfer of request headers for ${pendingTransfer.id} have not been confirmed`,
            `after ${waitTime} ms. Reverting to scheduled state.`);
        pendingTransfer.state = 0;
    }, utils.getPickUpConfirmationTimeoutMillis());

    _endRemoteWork(backendId, remoteWorker);
}

function _endRemoteWork(backendId, remoteWorker) {
    if (!allPendingTransfers.has(backendId)) {
        return;
    }
    const backendTransfers = allPendingTransfers.get(backendId);
    if (!backendTransfers.remoteWorkers.find(x => x === remoteWorker)) {
        return;
    }
    clearTimeout(remoteWorker.timeout);
    utils.arrayRemove(backendTransfers.remoteWorkers, remoteWorker);
    _trimAllPendingTransfers(backendId);
}

function _logAndIssueErrorResponse(req, res, msg) {
    const clientIpAddress = utils.getClientIpAddress(req);
    logger.warn(`[${clientIpAddress}]`, msg);
    res.status(400).send(msg);
}

function _endPendingTransfer(backendId, pendingTransfer, failureReason) {
    if (!allPendingTransfers.has(backendId)) {
        return;
    }
    const backendTransfers = allPendingTransfers.get(backendId);
    if (!backendTransfers.queue.find(x => x === pendingTransfer)) {
        return;
    }

    const executionTimeMillis = new Date().getTime() - pendingTransfer.startDate.getTime();

    clearTimeout(pendingTransfer.timeout);

    // remove pending transfer and trim down map of all pending transfers
    // if possible.
    utils.arrayRemove(backendTransfers.queue, pendingTransfer);
    _trimAllPendingTransfers(backendId);

    // send back an error response for failures.
    if (failureReason) {
        let errorStatus = 500;
        let errorMessage;
        if (failureReason.error) {
            errorMessage = failureReason.error.toString();
        }
        else {
            errorStatus = 504;
            errorMessage = "No remote worker showed up to process request";
        }
        if (pendingTransfer.res.headersSent) {
            pendingTransfer.res.end(errorMessage);
        }
        else {
            pendingTransfer.res.status(errorStatus);
            pendingTransfer.res.send(errorMessage);
        }
    }

    // present summary of what happened with transfer.
    let summary = `[${pendingTransfer.clientIpAddress}] ${pendingTransfer.id}. `;
    summary += `${pendingTransfer.req.method} "${pendingTransfer.targetUrl}" - completed; `;
    if (failureReason) {
        if (failureReason.timeout) {
            summary += `timed out after`;
        }
        else {
            summary += `encountered error after`;
        }
    }
    else {
        summary += `returned status ${pendingTransfer.res.statusCode}; `;
        summary += `transferred ${pendingTransfer.bytesWritten} bytes in`;
    }
    summary += ` ${executionTimeMillis} ms`;

    logger.info(summary);
}

function _trimAllPendingTransfers(backendId) {
    if (!allPendingTransfers.has(backendId)) {
        return;
    }
    const backendTransfers = allPendingTransfers.get(backendId);
    if (backendTransfers.remoteWorkers.length || backendTransfers.queue.length) {
        // continue.
    }
    else {
        // remove
        allPendingTransfers.delete(backendId);
    }
}

module.exports = {
    scheduleTransfer,
    beginRequestTransfer,
    endRequestTransfer,
    beginReceiveResponse,
    endReceiveResponse
};