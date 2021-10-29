const { parse: uuidparse, stringify: uuidStringify } = require("uuid");

function normalizeUuid(str) {
    // NB: uuidparse requires hyphens.
    // Therefore insert hyphens for a string lacking hyphens
    // but looking like a valid uuid.
    if (str.indexOf('-') === -1) {        
        if (/[0-9a-f]{32}/i.test(str)) {
            // convert to sth like: ccebe604-9e4e-4185-9a93-eddd247001b0
            str = str.substring(0, 8) + '-' + str.substring(8, 12) +
                '-' + str.substring(12, 16) + '-' + str.substring(16, 20) +
                '-' + str.substring(20);
        }
    }
    const uuidInst = uuidparse(str);
    const id = uuidStringify(uuidInst).toLowerCase();
    return id;
}

function parseMainUrl(prefix, url) {
    if (!url.startsWith(prefix)) {
        throw new Error(`url doesn't start with '${prefix}'`);
    }
    const mainSegEndIdx = prefix.length;
    let thirdSlashIdx = url.indexOf('/', mainSegEndIdx);
    if (thirdSlashIdx === -1) {
        thirdSlashIdx = url.indexOf('?', mainSegEndIdx);
        if (thirdSlashIdx === -1) {
            thirdSlashIdx = url.indexOf('#', mainSegEndIdx);
        }
    }
    const idSegment = thirdSlashIdx === -1 ? url.substring(mainSegEndIdx)
        : url.substring(mainSegEndIdx, thirdSlashIdx);
    const remainingUrl = thirdSlashIdx === -1 ? ''
        : url.substring(thirdSlashIdx);
    const id = normalizeUuid(idSegment);
    return [ id, remainingUrl ];
}

function getRequestTimeoutMillis() {
    return parseInt(process.env.REQUEST_TIMEOUT_MILLIS) || 20000;
}

function getPollWaitTimeMillis() {
    return parseInt(process.env.POLL_WAIT_TIME_MILLIS) || 5000;
}

function getPickUpConfirmationTimeoutMillis() {
    return parseInt(process.env.PICK_UP_CONFIRMATION_TIMEOUT) || 3000;
}

function arrayRemove(arr, value) {
    for (let i = 0; i < arr.length; i++) {
        if ( arr[i] === value) {
            arr.splice(i, 1);
            i--;
        }
    }
}

function getClientIpAddress(req) {
    try {
        const forwardedForIp = req.headers['x-forwarded-for'].split(/\s*,\s*/)[0];
        return forwardedForIp;
    }
    catch (ignore) {}
    const ip = req.socket.remoteAddress;
    return ip;
}

module.exports = {
    normalizeUuid,
    parseMainUrl,
    getRequestTimeoutMillis,
    getPollWaitTimeMillis,
    getPickUpConfirmationTimeoutMillis,
    arrayRemove,
    getClientIpAddress
};