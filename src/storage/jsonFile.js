// Small JSON persistence helper: tolerant reads, atomic writes, and a corrupt
// file is set aside instead of being silently overwritten later.
const fs = require('fs');
const path = require('path');
const { warn, error } = require('../logger');

function readJson(file, fallback) {
    try {
        if (!fs.existsSync(file)) return structuredClone(fallback);
        if (fs.statSync(file).isDirectory()) {
            warn('STORAGE', `${file} is a directory, not a file. Remove it so the bot can create the file.`);
            return structuredClone(fallback);
        }
        const raw = fs.readFileSync(file, 'utf8');
        if (!raw.trim()) return structuredClone(fallback);
        return JSON.parse(raw);
    } catch (err) {
        error('STORAGE', `Could not read ${file}:`, err.message);
        try {
            const backup = `${file}.corrupt-${Date.now()}`;
            fs.copyFileSync(file, backup);
            warn('STORAGE', `Kept a copy of the unreadable file at ${backup}`);
        } catch {
            // nothing more we can do
        }
        return structuredClone(fallback);
    }
}

function writeJson(file, data) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmp, file);
        return true;
    } catch (err) {
        error('STORAGE', `Could not write ${file}:`, err.message);
        return false;
    }
}

module.exports = { readJson, writeJson };
