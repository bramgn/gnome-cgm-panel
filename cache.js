// cache.js
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// A simple class to handle reading and writing a JSON cache file to disk.
export class Cache {
    constructor() {
        this.cacheDir = GLib.get_user_cache_dir() + '/cgm-widget';
        this.cacheFile = this.cacheDir + '/cache.json';
        this._file = Gio.File.new_for_path(this.cacheFile);
        this._dir = Gio.File.new_for_path(this.cacheDir);
    }

    /**
     * Loads data from the cache file.
     * @returns {object | null} The parsed JSON object or null if not found/error.
     */
    load() {
        if (!this._file.query_exists(null)) {
            return null;
        }
        try {
            const [success, contents] = this._file.load_contents(null);
            if (success) {
                const decoder = new TextDecoder('utf-8');
                const cacheText = decoder.decode(contents);
                return JSON.parse(cacheText);
            }
        } catch (error) {
            console.error(`Error loading CGM cache: ${error.message}`);
        }
        return null;
    }

    /**
     * Saves a JavaScript object to the cache file as JSON.
     * @param {object} data The object to save.
     */
    save(data) {
        try {
            if (!this._dir.query_exists(null)) {
                this._dir.make_directory_with_parents(null);
            }
            const cacheJson = JSON.stringify(data, null, 2);
            this._file.replace_contents(
                cacheJson,
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch (error) {
            console.error(`Error saving CGM cache: ${error.message}`);
        }
    }
}
