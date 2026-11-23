/* My Salary Tracker - local profile (name + photo). Stored ONLY in this browser's localStorage under 'mst-profile'.
   Never sent anywhere. Not stored in IndexedDB, so salary records are never touched. */
(function (root) {
  'use strict';
  var KEY = 'mst-profile', MAX_NAME = 60, SIDE = 256, MAX_PHOTO_CHARS = 120000, MAX_INPUT_BYTES = 25 * 1024 * 1024;
  var PHOTO_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;

  function cleanName(s) { return String(s == null ? '' : s).replace(/[<>]/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME); }
  function validPhoto(s) { return typeof s === 'string' && s.length > 40 && s.length <= MAX_PHOTO_CHARS * 2 && PHOTO_RE.test(s); }
  function clean(raw) {
    var r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return { name: cleanName(r.name), photo: validPhoto(r.photo) ? r.photo : '', updatedAt: typeof r.updatedAt === 'string' ? r.updatedAt.slice(0, 40) : '' };
  }
  function empty() { return { name: '', photo: '', updatedAt: '' }; }
  function load(storage) { try { var s = storage.getItem(KEY); return s ? clean(JSON.parse(s)) : empty(); } catch (e) { return empty(); } }
  // Returns {ok:true} or {ok:false, reason:'quota'|'denied'|'other', error}. On failure the previously saved profile is left as it was.
  function save(storage, p) {
    var c = clean(p); c.updatedAt = new Date().toISOString();
    try { storage.setItem(KEY, JSON.stringify(c)); return { ok: true, profile: c }; }
    catch (e) {
      var n = e && e.name, m = String(e && e.message || '');
      var reason = (n === 'QuotaExceededError' || /quota/i.test(m)) ? 'quota' : (n === 'SecurityError' || /denied/i.test(m)) ? 'denied' : 'other';
      return { ok: false, reason: reason, error: e };
    }
  }
  function isEmpty(p) { return !p || (!p.name && !p.photo); }
  function initials(name) {
    var parts = cleanName(name).split(' ').filter(Boolean); if (!parts.length) return '';
    var a = Array.from(parts[0])[0] || '', b = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] || '') : '';
    return (a + b).toUpperCase();
  }
  // Largest centred square that fits, scaled so the side is at most `max`.
  function fitSquare(w, h, max) { var s = Math.min(w, h); return { sx: Math.floor((w - s) / 2), sy: Math.floor((h - s) / 2), side: s, out: Math.max(1, Math.min(max, s)) }; }
  // env: { decode(file) -> Promise<{width,height,source}>, canvas(side) -> {ctx, toDataURL(type,q)} }  (the app supplies real browser implementations)
  async function compress(file, env) {
    if (!file || !/^image\//.test(file.type || '')) { var e1 = new Error('Please choose an image file.'); e1.code = 'type'; throw e1; }
    if (file.size > MAX_INPUT_BYTES) { var e2 = new Error('That photo is too large (max 25 MB).'); e2.code = 'size'; throw e2; }
    var img; try { img = await env.decode(file); } catch (e) { var e3 = new Error('This photo could not be read. Try a JPEG or PNG.'); e3.code = 'decode'; throw e3; }
    var f = fitSquare(img.width, img.height, SIDE), sides = [f.out, Math.min(f.out, 192), Math.min(f.out, 128)], qs = [0.82, 0.7, 0.55];
    for (var i = 0; i < sides.length; i++) {
      var c = env.canvas(sides[i]); c.ctx.fillStyle = '#ffffff'; c.ctx.fillRect(0, 0, sides[i], sides[i]);
      c.ctx.drawImage(img.source, f.sx, f.sy, f.side, f.side, 0, 0, sides[i], sides[i]);
      var url = c.toDataURL('image/jpeg', qs[i]);
      if (validPhoto(url) && url.length <= MAX_PHOTO_CHARS) return url;
    }
    var e4 = new Error('Could not shrink this photo enough. Choose another photo.'); e4.code = 'big'; throw e4;
  }
  function browserEnv(win) {
    return {
      decode: function (file) {
        return new Promise(function (res, rej) {
          var fr = new win.FileReader();
          fr.onerror = function () { rej(fr.error || new Error('read failed')); };
          fr.onload = function () { var im = new win.Image(); im.onload = function () { res({ width: im.naturalWidth, height: im.naturalHeight, source: im }); }; im.onerror = function () { rej(new Error('decode failed')); }; im.src = fr.result; };
          fr.readAsDataURL(file);
        });
      },
      canvas: function (side) { var cv = win.document.createElement('canvas'); cv.width = cv.height = side; return { ctx: cv.getContext('2d'), toDataURL: function (t, q) { return cv.toDataURL(t, q); } }; }
    };
  }
  function forBackup(p) { var c = clean(p); return isEmpty(c) ? null : { name: c.name, photo: c.photo, updatedAt: c.updatedAt }; }
  // Merge keeps what the phone already has and only fills blanks; Replace takes the backup's profile.
  function fromBackup(raw, current, replace) {
    var b = clean(raw); if (isEmpty(b)) return null;
    if (replace) return b;
    var cur = clean(current); return { name: cur.name || b.name, photo: cur.photo || b.photo, updatedAt: cur.updatedAt || b.updatedAt };
  }
  var api = { empty: empty, KEY: KEY, cleanName: cleanName, validPhoto: validPhoto, clean: clean, load: load, save: save, isEmpty: isEmpty, initials: initials, fitSquare: fitSquare, compress: compress, browserEnv: browserEnv, forBackup: forBackup, fromBackup: fromBackup, MAX_NAME: MAX_NAME, MAX_PHOTO_CHARS: MAX_PHOTO_CHARS };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.MSTProfile = api;
})(typeof self !== 'undefined' ? self : this);
