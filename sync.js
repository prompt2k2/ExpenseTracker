/* Google Drive sync. The phone copy stays the working copy; every change is also written to
   one file in the user's Drive, and the app merges with that file when it opens.
   mergeData() also loads in Node for tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpendSync = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // OAuth client ID from Google Cloud (not a secret). Empty hides the Drive option.
  var CLIENT_ID = '';
  var SCOPE = 'https://www.googleapis.com/auth/drive.file';
  var FILE_NAME = 'spend-log-data.json';
  var TOMBSTONE_DAYS = 365;

  function sortedItems(items) {
    return (items || []).slice().sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
  }
  function sortedObj(o) {
    var out = {};
    Object.keys(o || {}).sort().forEach(function (k) { out[k] = o[k]; });
    return out;
  }
  function canon(d) {
    return JSON.stringify({ items: sortedItems(d.items), deleted: sortedObj(d.deleted), config: d.config || null, configUpdated: d.configUpdated || 0 });
  }

  // Newest edit of each entry wins. A deletion beats any edit made before it.
  function mergeData(local, remote, now) {
    now = now || Date.now();
    if (!remote) {
      var only = { items: local.items || [], deleted: local.deleted || {}, config: local.config, configUpdated: local.configUpdated || 0 };
      return { data: only, changedLocal: false, changedRemote: true };
    }
    var deleted = {}, cutoff = now - TOMBSTONE_DAYS * 86400000;
    [local.deleted || {}, remote.deleted || {}].forEach(function (d) {
      Object.keys(d).forEach(function (id) { if (d[id] > cutoff) deleted[id] = Math.max(deleted[id] || 0, d[id]); });
    });
    var byId = {};
    (remote.items || []).forEach(function (x) { byId[x.id] = x; });
    (local.items || []).forEach(function (x) {
      var r = byId[x.id];
      if (!r || (x.updated || 0) >= (r.updated || 0)) byId[x.id] = x;
    });
    var items = Object.keys(byId).map(function (k) { return byId[k]; })
      .filter(function (x) { return !(deleted[x.id] && deleted[x.id] >= (x.updated || 0)); });
    var useLocalConfig = (local.configUpdated || 0) >= (remote.configUpdated || 0) || !remote.config;
    var data = {
      items: items,
      deleted: deleted,
      config: useLocalConfig ? local.config : remote.config,
      configUpdated: useLocalConfig ? (local.configUpdated || 0) : remote.configUpdated
    };
    var c = canon(data);
    return { data: data, changedLocal: c !== canon(local), changedRemote: c !== canon(remote) };
  }

  /* Browser side. opts: {clientId, getLocal(), applyLocal(data), onStatus(state, detail)}
     States: off, connecting, syncing, synced, reconnect, offline, error. */
  function createDrive(opts) {
    var K_ON = 'spendlog.drive.on', K_TOKEN = 'spendlog.drive.token', K_FILE = 'spendlog.drive.file', K_LAST = 'spendlog.drive.last';
    function get(k, f) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : f; } catch (e) { return f; } }
    function set(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

    var tokenClient = null, gisLoading = null;
    var busy = false, again = false, timer = null;
    var state = 'off';

    function status(s, detail) { state = s; opts.onStatus(s, detail); }
    function connected() { return !!get(K_ON, false); }
    function token() {
      var t = get(K_TOKEN, null);
      return t && t.exp > Date.now() ? t.access_token : null;
    }

    function loadGis() {
      if (tokenClient) return Promise.resolve();
      if (gisLoading) return gisLoading;
      gisLoading = new Promise(function (res, rej) {
        var s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = function () {
          tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: opts.clientId,
            scope: SCOPE,
            callback: onToken,
            error_callback: function (e) {
              status(connected() ? 'reconnect' : 'off', e && e.type === 'popup_closed' ? 'Sign-in was closed.' : 'Sign-in did not finish.');
            }
          });
          res();
        };
        s.onerror = function () { gisLoading = null; rej(new Error('Could not load Google sign-in')); };
        document.head.appendChild(s);
      });
      return gisLoading;
    }

    function onToken(resp) {
      if (!resp || resp.error || !resp.access_token) {
        status(connected() ? 'reconnect' : 'off', 'Google did not allow access.');
        return;
      }
      set(K_TOKEN, { access_token: resp.access_token, exp: Date.now() + (Math.max(60, +resp.expires_in || 3600) - 60) * 1000 });
      set(K_ON, true);
      sync();
    }

    // Must run straight from a tap, or the browser blocks the Google pop-up.
    function connect() {
      if (!tokenClient) {
        status('error', 'Google sign-in is still loading. Try again in a moment.');
        loadGis().catch(function () {});
        return;
      }
      status('connecting');
      tokenClient.requestAccessToken({ prompt: connected() ? '' : 'consent' });
    }

    function disconnect() {
      var t = get(K_TOKEN, null);
      if (t && window.google && google.accounts) { try { google.accounts.oauth2.revoke(t.access_token, function () {}); } catch (e) {} }
      set(K_TOKEN, null); set(K_ON, null); set(K_FILE, null); set(K_LAST, null);
      status('off');
    }

    function api(method, url, body, type) {
      var t = token();
      if (!t) return Promise.reject({ reconnect: true });
      var h = { Authorization: 'Bearer ' + t };
      if (type) h['Content-Type'] = type;
      return fetch(url, { method: method, headers: h, body: body }).then(function (r) {
        if (r.status === 401) { set(K_TOKEN, null); throw { reconnect: true }; }
        return r;
      });
    }
    function ok(r) {
      if (r.ok) return Promise.resolve(r);
      return r.text().then(function (t) {
        var m = 'error ' + r.status;
        try { m = JSON.parse(t).error.message || m; } catch (e) {}
        throw new Error(m);
      });
    }

    function findFile() {
      var q = encodeURIComponent("name='" + FILE_NAME + "' and trashed=false");
      return api('GET', 'https://www.googleapis.com/drive/v3/files?q=' + q + '&orderBy=modifiedTime%20desc&pageSize=1&fields=files(id)')
        .then(ok).then(function (r) { return r.json(); })
        .then(function (j) { return j.files && j.files[0] ? j.files[0].id : null; });
    }
    function readFile(id) {
      return api('GET', 'https://www.googleapis.com/drive/v3/files/' + id + '?alt=media').then(function (r) {
        if (r.status === 404) return undefined;
        return ok(r).then(function (r) { return r.json(); });
      });
    }
    function payload(d) {
      return JSON.stringify({ app: 'spendlog', version: 2, saved: new Date().toISOString(),
        config: d.config, configUpdated: d.configUpdated, items: d.items, deleted: d.deleted });
    }
    function createFile(d) {
      var b = 'spendlog' + Date.now();
      var body = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
        JSON.stringify({ name: FILE_NAME, mimeType: 'application/json' }) + '\r\n--' + b +
        '\r\nContent-Type: application/json\r\n\r\n' + payload(d) + '\r\n--' + b + '--';
      return api('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', body, 'multipart/related; boundary=' + b)
        .then(ok).then(function (r) { return r.json(); }).then(function (j) { return j.id; });
    }
    function updateFile(id, d) {
      return api('PATCH', 'https://www.googleapis.com/upload/drive/v3/files/' + id + '?uploadType=media', payload(d), 'application/json').then(ok);
    }

    function sync() {
      if (!connected()) return Promise.resolve();
      if (!navigator.onLine) { status('offline'); return Promise.resolve(); }
      if (!token()) { status('reconnect'); return Promise.resolve(); }
      if (busy) { again = true; return Promise.resolve(); }
      busy = true;
      status('syncing');
      var fileId = get(K_FILE, null);
      var remote = null;
      return (fileId ? Promise.resolve(fileId) : findFile()).then(function (id) {
        fileId = id;
        return id ? readFile(id) : null;
      }).then(function (r) {
        if (r === undefined) fileId = null; // file was deleted from Drive
        remote = r && r.app === 'spendlog' ? r : null;
        var m = mergeData(opts.getLocal(), remote);
        if (m.changedLocal) opts.applyLocal(m.data);
        if (!fileId) return createFile(m.data).then(function (id) { fileId = id; });
        if (m.changedRemote) return updateFile(fileId, m.data);
      }).then(function () {
        set(K_FILE, fileId);
        set(K_LAST, Date.now());
        status('synced', get(K_LAST, null));
      }).catch(function (e) {
        if (e && e.reconnect) status('reconnect');
        else if (!navigator.onLine) status('offline');
        else status('error', 'Could not reach Google Drive (' + (e && e.message ? e.message : e) + '). It will try again.');
      }).then(function () {
        busy = false;
        if (again) { again = false; return sync(); }
      });
    }

    // Called after every local change. Short delay so quick edits go up together.
    function changed() {
      if (!connected()) return;
      clearTimeout(timer);
      timer = setTimeout(sync, 1500);
    }

    function start() {
      if (!opts.clientId) return;
      if (navigator.onLine) loadGis().catch(function () {});
      window.addEventListener('online', function () { loadGis().catch(function () {}); sync(); });
      window.addEventListener('offline', function () { if (connected()) status('offline'); });
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') sync(); });
      if (connected()) sync(); else status('off');
    }

    return { start: start, connect: connect, disconnect: disconnect, sync: sync, changed: changed,
      isConnected: connected, lastSync: function () { return get(K_LAST, null); }, state: function () { return state; } };
  }

  return { CLIENT_ID: CLIENT_ID, FILE_NAME: FILE_NAME, mergeData: mergeData, createDrive: createDrive };
});
