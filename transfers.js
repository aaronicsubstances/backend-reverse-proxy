const logger = require("./logger");
const utils = require("./utils");

let lastTransferId = 0;
const allPendingTransfers = new Map();

function scheduleTransfer(req, res, backendId, targetUrl) {
    const clientIpAddress = utils.getClientIpAddress(req);
    const pendingTransfer = {
        req,
        res,
        id: ++lastTransferId,
        targetUrl,
        timeout: null,
        statusCode: 0,
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
    
    logger.info(`[${pendingTransfer.clientIpAddress}] ${pendingTransfer.id}. ${req.method} "${targetUrl}" scheduled`);

    // see if there's any remote worker to work on pendingTransfer immediately.
    if (backendTransfers.remoteWorkers.length) {
        _beginRemoteWorkOnPendingTransfer(backendId, pendingTransfer, backendTransfers.remoteWorkers[0]);
    }
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
    summary += `${pendingTransfer.req.method} "${pendingTransfer.targetUrl}" completed; `;
    if (failureReason) {
        if (failureReason.timeout) {
            summary += `timed out after`;
        }
        else {
            summary += `encountered error after`;
        }
    }
    else {
        summary += `returned status ${pendingTransfer.statusCode}; `;
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
        // wait for some time.
        remoteWorker.timeout = setTimeout(() => {
            // send back response without an id to indicate
            // that no pending transfer was found.
            remoteWorker.res.json({});
            _endRemoteWork(backendId, remoteWorker);
        }, utils.getPollWaitTimeMillis());
    }
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
    
    logger.info(`[${remoteWorker.clientIpAddress}] ${pendingTransfer.id}.`,
        `${pendingTransfer.req.method} "${pendingTransfer.targetUrl}" picked up by remote worker`);

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

function endRequestTransfer(res, backendId, transferId) {
    res.send(backendId + " - " + transferId);
}

function beginReceiveResponse(req, res, backendId, transferId) {
    res.send(backendId + " - " + transferId);
}

function endReceiveResponse(req, res, backendId, transferId) {
    res.send(backendId + " - " + transferId);
}

module.exports = {
    scheduleTransfer,
    beginRequestTransfer,
    endRequestTransfer,
    beginReceiveResponse,
    endReceiveResponse
};