function stamp() {
    return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(tag, ...args) {
    console.log(`${stamp()} [${tag}]`, ...args);
}

function warn(tag, ...args) {
    console.warn(`${stamp()} [${tag}]`, ...args);
}

function error(tag, ...args) {
    console.error(`${stamp()} [${tag}]`, ...args);
}

module.exports = { log, warn, error };
