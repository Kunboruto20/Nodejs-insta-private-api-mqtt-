'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const DEFAULT_FLUSH_INTERVAL = 30000;

class PersistentLogger {
    constructor(options = {}) {
        this.logDir = options.logDir || './logs';
        this.prefix = options.prefix || 'instagram-mqtt';
        this.maxFileSize = options.maxFileSize || DEFAULT_MAX_FILE_SIZE;
        this.maxFiles = options.maxFiles || DEFAULT_MAX_FILES;
        this.flushIntervalMs = options.flushIntervalMs || DEFAULT_FLUSH_INTERVAL;
        this.logToConsole = options.logToConsole !== false;
        this.logLevel = options.logLevel || 'info';

        this._buffer = [];
        this._currentFile = null;
        this._currentFileSize = 0;
        this._flushTimer = null;
        this._started = false;
        this._totalLines = 0;

        this._levels = { debug: 0, info: 1, warn: 2, error: 3 };
    }

    start() {
        if (this._started) return;
        this._started = true;

        try {
            if (!fs.existsSync(this.logDir)) {
                fs.mkdirSync(this.logDir, { recursive: true });
            }
        } catch (e) {
            console.error('[LOGGER] Failed to create log directory:', e?.message || e);
        }

        this._rotateIfNeeded();

        this._flushTimer = setInterval(() => {
            this._flush();
        }, this.flushIntervalMs);

        this.info('PersistentLogger started', { logDir: this.logDir, maxFileSize: this.maxFileSize, maxFiles: this.maxFiles });
    }

    stop() {
        this._started = false;
        if (this._flushTimer) {
            clearInterval(this._flushTimer);
            this._flushTimer = null;
        }
        this._flush();
    }

    debug(...args) { this._write('debug', args); }
    info(...args) { this._write('info', args); }
    warn(...args) { this._write('warn', args); }
    error(...args) { this._write('error', args); }

    _write(level, args) {
        if (this._levels[level] < this._levels[this.logLevel]) return;

        const timestamp = new Date().toISOString();
        const message = args.map(a => {
            if (typeof a === 'object') {
                try { return JSON.stringify(a); } catch (e) { return String(a); }
            }
            return String(a);
        }).join(' ');

        const line = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

        if (this.logToConsole) {
            const consoleFn = level === 'error' ? console.error : (level === 'warn' ? console.warn : console.log);
            consoleFn(line);
        }

        this._buffer.push(line);
        this._totalLines++;

        if (this._buffer.length >= 50) {
            this._flush();
        }
    }

    _flush() {
        if (this._buffer.length === 0) return;
        if (!this._currentFile) this._rotateIfNeeded();

        try {
            const content = this._buffer.join('\n') + '\n';
            fs.appendFileSync(this._currentFile, content);
            this._currentFileSize += Buffer.byteLength(content);
            this._buffer = [];

            if (this._currentFileSize >= this.maxFileSize) {
                this._rotateIfNeeded();
            }
        } catch (e) {
            if (this.logToConsole) {
                console.error('[LOGGER] Failed to flush:', e?.message || e);
            }
        }
    }

    _rotateIfNeeded() {
        try {
            if (this._currentFile && fs.existsSync(this._currentFile)) {
                try {
                    const stat = fs.statSync(this._currentFile);
                    this._currentFileSize = stat.size;
                    if (this._currentFileSize < this.maxFileSize) return;
                } catch (e) {}
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
            this._currentFile = path.join(this.logDir, `${this.prefix}_${timestamp}.log`);
            this._currentFileSize = 0;

            this._cleanOldFiles();
        } catch (e) {
            if (this.logToConsole) {
                console.error('[LOGGER] Rotation error:', e?.message || e);
            }
        }
    }

    _cleanOldFiles() {
        try {
            const files = fs.readdirSync(this.logDir)
                .filter(f => f.startsWith(this.prefix) && f.endsWith('.log'))
                .sort();

            while (files.length > this.maxFiles) {
                const oldest = files.shift();
                try {
                    fs.unlinkSync(path.join(this.logDir, oldest));
                } catch (e) {}
            }
        } catch (e) {}
    }

    getLogFiles() {
        try {
            return fs.readdirSync(this.logDir)
                .filter(f => f.startsWith(this.prefix) && f.endsWith('.log'))
                .sort()
                .map(f => path.join(this.logDir, f));
        } catch (e) {
            return [];
        }
    }

    getRecentLines(count = 100) {
        this._flush();
        try {
            const files = this.getLogFiles();
            if (files.length === 0) return [];

            const lastFile = files[files.length - 1];
            const content = fs.readFileSync(lastFile, 'utf8');
            const lines = content.trim().split('\n');
            return lines.slice(-count);
        } catch (e) {
            return [];
        }
    }

    getStats() {
        return {
            started: this._started,
            totalLines: this._totalLines,
            bufferSize: this._buffer.length,
            currentFile: this._currentFile,
            currentFileSize: this._currentFileSize,
            logFiles: this.getLogFiles(),
        };
    }
}

module.exports = { PersistentLogger };
