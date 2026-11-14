// cache.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');
Gio._promisify(Gio.File.prototype, 'replace_contents_async', 'replace_contents_finish');

// A simple class to handle reading and writing a JSON cache file to disk.
export class Cache {
    constructor() {
        this.cacheDir = GLib.get_user_cache_dir() + '/cgm-widget';
        this.cacheFile = this.cacheDir + '/cache.json';
        this._file = Gio.File.new_for_path(this.cacheFile);
        this._dir = Gio.File.new_for_path(this.cacheDir);
        this._data = null;
    }

    /**
     * Reads the cache file from disk asynchronously into memory.
     * Call once (and await it) before using load()/save().
     */
    async init() {
        try {
            const [contents] = await this._file.load_contents_async(null);
            this._data = JSON.parse(new TextDecoder('utf-8').decode(contents));
        } catch (error) {
            if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                console.error(`Error loading CGM cache: ${error.message}`);
            this._data = null;
        }
    }

    /**
     * Returns the in-memory cache contents (a copy), or null if empty.
     * @returns {object | null}
     */
    load() {
        return this._data ? {...this._data} : null;
    }

    /**
     * Updates the in-memory cache and writes it to disk asynchronously.
     * @param {object} data The object to save.
     */
    save(data) {
        this._data = data;
        this._write(JSON.stringify(data, null, 2)).catch(error => {
            console.error(`Error saving CGM cache: ${error.message}`);
        });
    }

    async _write(json) {
        if (!this._dir.query_exists(null))
            this._dir.make_directory_with_parents(null);
        await this._file.replace_contents_async(
            new TextEncoder().encode(json),
            null,
            false,
            Gio.FileCreateFlags.REPLACE_DESTINATION,
            null
        );
    }
}
