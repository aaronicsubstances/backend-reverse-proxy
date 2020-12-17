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

function parsePositiveInt(str) {
    let num = _parseInt(str);
    if (num <= 0) {
        throw new Error(`invalid positive integer: ${str}`);
    }
    return num;
}

/*
 * Return 0 if invalid.
 */

function _parseInt(str) {
    let num = parseInt(str);
    if (Number.isNaN(num)) {
        return 0;
    }
    return num;
}

function parseMainUrl(url) {
    const mainSegEndIdx = "/main/".length;
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
    const configValue = _parseInt(process.env.REQUEST_TIMEOUT_MILLIS);
    if (configValue > 0) {
        return configValue;
    }
    return 5000;
}

function getPollWaitTimeMillis() {
    const configValue = _parseInt(process.env.POLL_WAIT_TIME_MILLIS);
    if (configValue > 0) {
        return configValue;
    }
    return 10000;
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
    parsePositiveInt,
    parseMainUrl,
    getRequestTimeoutMillis,
    getPollWaitTimeMillis,
    arrayRemove,
    getClientIpAddress
};