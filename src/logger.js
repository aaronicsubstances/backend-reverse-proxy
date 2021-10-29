const npmlog = require("npmlog");
const { LogLevels } = require("npmlog");

function debug(message, ...args) {
    if (process.env.DEBUG) {
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
  const prefix = process.env.OMIT_LOG_TIMESTAMP ? "" : new Date().toISOString();
  npmlog.log(level, prefix, message, ...args);
};

module.exports = {
  debug, info, warn, error
};