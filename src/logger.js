const npmlog = require("npmlog");

let _enableVerboseLogs;
let _omitLogTimestamps;

function setLoggerOptions(enableVerboseLogs, omitLogTimestamps) {
    _enableVerboseLogs = enableVerboseLogs;
    _omitLogTimestamps = omitLogTimestamps;
}

function debug(message, ...args) {
    if (_enableVerboseLogs) {
        _log('debug', message, args);
    }
}

function info(message, ...args) {
    _log('info', message, args);
}

function warn(message, ...args) {
    _log('warn', message, args);
}

function error(message, ...args) {
    _log('error', message, args);
}

function _log(level, message, args) {
  const prefix = _omitLogTimestamps ? "" : new Date().toISOString();
  npmlog.log(level, prefix, message, ...args);
};

module.exports = {
  debug, info, warn, error, setLoggerOptions
};