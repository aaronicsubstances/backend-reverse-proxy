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
    if (lastTransferId === 1 << 30) {
        lastTransferId = 0;
    }
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
    
    logger.info(`[${pendingTransfer.clientIpAddress}] ${pendingTransfer.id}. ${req.method} ${backendId}${targetUrl} - scheduled`);

    // see if there's any remote worker to work on pendingTransfer immediately.
    if (backendTransfers.remoteWorkers.length) {
        _beginRemoteWorkOnPendingTransfer(backendId, pendingTransfer, backendTransfers.remoteWorkers[0]);
    }
}

function beginRequestTransfer(remoteWorkerAddress, backendId, resCb,
        requestErrCb) {
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
        resCb,
        requestErrCb,
        timeout: null,
        address: remoteWorkerAddress
    };
    backendTransfers.remoteWorkers.push(remoteWorker);

    // see if there is any pending transfer to pick up immediately.
    const pendingTransferWork = _identifyAnyPendingTransferWork(backendTransfers);
    if (pendingTransferWork) {
        _beginRemoteWorkOnPendingTransfer(backendId, pendingTransferWork, remoteWorker);
    }
    else {
        logger.debug(`[${remoteWorker.address}] remote worker waiting for pending transfer on ${backendId}`);

        // wait for some time.
        remoteWorker.timeout = setTimeout(() => {
            // send back response without an id to indicate
            // that no pending transfer was found.
            logger.debug(`[${remoteWorker.address}] remote worker exiting without any pending transfer on ${backendId}`);
            remoteWorker.resCb(null, {});
            _endRemoteWork(backendId, remoteWorker);
        }, utils.getPollWaitTimeMillis());
    }
}

function endRequestTransfer(remoteWorkerAddress, backendId, transferId, resCb) {
    if (!allPendingTransfers.has(backendId)) {
        _logAndIssueErrorResponse(remoteWorkerAddress, resCb, `No pending transfer found from backend ${backendId}`);
        return;
    }
    const backendTransfers = allPendingTransfers.get(backendId);
    const pendingTransfer = backendTransfers.queue.find(x => x.id === transferId);
    if (!pendingTransfer) {
        _logAndIssueErrorResponse(remoteWorkerAddress, resCb, `No pending transfer found with id ${transferId}`);
        return;
    }
    if (pendingTransfer.state !== 1) {
        _logAndIssueErrorResponse(remoteWorkerAddress, resCb, 
            `Pending transfer with id ${transferId} is not expecting a request body transfer`);
        return;
    }

    clearTimeout(pendingTransfer.initialTimeout);

    logger.debug(`[${remoteWorkerAddress}] ${pendingTransfer.id}.`,
        `${pendingTransfer.req.method} ${backendId}${pendingTransfer.targetUrl} -`,
        `request body being transferred to remote worker`);

    // transfer request body to response
    resCb(null, pendingTransfer.req);
    pendingTransfer.state++;
}

function beginReceiveResponse(remoteWorkerAddress, backendId, responsePart, resCb) {
    const transferId = responsePart.id;
    if (!allPendingTransfers.has(backendId)) {
        _logAndIssueErrorResponse(remoteWorkerAddress, resCb,
            `No pending transfer found from backend ${backendId}`);
        return;
    }
    const backendTransfers = allPendingTransfers.get(backendId);
    const pendingTransfer = backendTransfers.queue.find(x => x.id === transferId);
    if (!pendingTransfer) {
        _logAndIssueErrorResponse(remoteWorkerAddress, resCb,
            `No pending transfer found with id ${transferId}`);
        return;
    }
    if (pendingTransfer.state !== 2) {
        _logAndIssueErrorResponse(remoteWorkerAddress, resCb, 
            `Pending transfer with id ${transferId} is not expecting to receive response headers`);
        return;
    }

    logger.debug(`[${remoteWorkerAddress}] ${pendingTransfer.id}.`,
        `${pendingTransfer.req.method} ${backendId}${pendingTransfer.targetUrl} -`,
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
    resCb();
}

function endReceiveResponse(remoteWorkerAddress, backendId, transferId, finalResponsePart, resCb) {
    if (!allPendingTransfers.has(backendId)) {
        _logAndIssueErrorResponse(remoteWorkerAddress, resCb,
            `No pending transfer found from backend ${backendId}`);
        return;
    }
    const backendTransfers = allPendingTransfers.get(backendId);
    const pendingTransfer = backendTransfers.queue.find(x => x.id === transferId);
    if (!pendingTransfer) {
        _logAndIssueErrorResponse(remoteWorkerAddress, resCb,
            `No pending transfer found with id ${transferId}`);
        return;
    }
    if (pendingTransfer.state !== 3) {
        _logAndIssueErrorResponse(remoteWorkerAddress, resCb, 
            `Pending transfer with id ${transferId} is not expecting to receive response body`);
        return;
    }

    logger.debug(`[${remoteWorkerAddress}] ${pendingTransfer.id}.`,
        `${pendingTransfer.req.method} ${backendId}${pendingTransfer.targetUrl} -`,
        `response body being received from remote worker`);

    // receive response body from remote worker
    finalResponsePart.pipe(pendingTransfer.res);
    pendingTransfer.state++;

    finalResponsePart.once("end", () => {
        resCb();
        _endPendingTransfer(backendId, pendingTransfer);
    });

    finalResponsePart.on("data", (chunk) => {
        pendingTransfer.bytesWritten += chunk.length;
    });

    finalResponsePart.once("error", (error) => {
        logger.error(`An error occurred while sending response body for ${pendingTransfer.id}`, error);
        resCb(); // still send a success status to remote worker.
        _endPendingTransfer(backendId, pendingTransfer, { error });
    });

    // can clear timeout at this stage, so response body transfer doesn't interfere with
    // any timeout message.
    clearTimeout(pendingTransfer.timeout);
    pendingTransfer.timeout = null;
}

function failTransfer(remoteWorkerAddress, backendId, transferId, errorResponsePart) {
    if (!allPendingTransfers.has(backendId)) {
        return;
    }
    const backendTransfers = allPendingTransfers.get(backendId);
    const pendingTransfer = backendTransfers.queue.find(x => x.id === transferId);
    if (!pendingTransfer) {
        return;
    }

    logger.warn(`[${remoteWorkerAddress}] ${pendingTransfer.id}.`,
        `${pendingTransfer.req.method} ${backendId}${pendingTransfer.targetUrl} -`,
        `transfer failure notification - `, errorResponsePart.error || '');
    _endPendingTransfer(backendId, pendingTransfer, errorResponsePart);
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
    pendingTransfer.requestErrCb = remoteWorker.requestErrCb;
    
    logger.info(`[${remoteWorker.address}] ${pendingTransfer.id}.`,
        `${pendingTransfer.req.method} ${backendId}${pendingTransfer.targetUrl} -`,
        `request headers being transferred to remote worker`);

    const requestMetadata = {
        id: pendingTransfer.id,
        method: pendingTransfer.req.method,
        path: pendingTransfer.targetUrl,
        protocolVersion: pendingTransfer.req.httpVersion,
        headers: pendingTransfer.req.rawHeaders,
        clientIpAddress: pendingTransfer.clientIpAddress
    };
    remoteWorker.resCb(null, requestMetadata);
    pendingTransfer.state++;

    // just in case remote worker is disconnected without us knowing, add a timeout and revert
    // state of pendingTransfer to make it eligible for pick up.
    pendingTransfer.initialTimeout = setTimeout(() => {
        const waitTime = new Date().getTime() - pendingTransfer.startDate.getTime();
        logger.warn(`transfer of request headers for ${pendingTransfer.id} not confirmed`,
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

function _logAndIssueErrorResponse(remoteWorkerAddress, resCb, msg) {
    logger.warn(`[${remoteWorkerAddress}]`, msg);
    resCb(msg);
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
        if (failureReason.timeout || failureReason.remoteTimeout) {
            errorStatus = 504;
        }
        if (!failureReason.error) {
            if (failureReason.timeout) {
                failureReason.error = "No remote worker showed up to process request";
            }
            else if (failureReason.remoteTimeout) {
                failureReason.error = "Request timed out at local forward proxy during processing";
            }
            else {
                failureReason.error = "Unspecified error";
            }
        }
        if (pendingTransfer.res.headersSent) {
            pendingTransfer.res.end(failureReason.error.toString());
        }
        else {
            pendingTransfer.res.status(errorStatus);
            pendingTransfer.res.send(failureReason.error.toString());
        }
        if (pendingTransfer.requestErrCb) {
            pendingTransfer.requestErrCb(pendingTransfer.backendId, 
                pendingTransfer.id, failureReason.error);
        }
    }

    // present summary of what happened with transfer.
    let summary = `[${pendingTransfer.clientIpAddress}] ${pendingTransfer.id}. `;
    summary += `${pendingTransfer.req.method} ${backendId}${pendingTransfer.targetUrl} - completed; `;
    if (failureReason) {
        if (failureReason.timeout) {
            summary += `timed out after`;
        }
        else if (failureReason.remoteTimeout) {
            summary += `timed out at local forward proxy after`;
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
    endReceiveResponse,
    failTransfer
};