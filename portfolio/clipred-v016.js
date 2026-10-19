(function(scope){
"use strict";
if(scope.ClipRedV016Release){scope.ClipRedV016Release.start();return;}
(function (scope) {
  'use strict';

  const positive = (value) => Number.isFinite(value) && value > 0;
  const hasSize = (source) => positive(source.width) && positive(source.height);
  const ratioMatches = (a, b, tolerance = 0.01) => positive(a) && positive(b) && Math.abs(a / b - 1) <= tolerance;

  // Pure geometry: no DOM, network, randomness, thumbnail assumptions or cropping.
  function layout(items, width, settings = {}) {
    if (!positive(width)) throw new TypeError('A positive container width is required');
    const targets = settings.targets || [250];
    if (!targets.length || !targets.every(positive)) throw new TypeError('Invalid row targets');
    const gap = settings.gap ?? 8;
    const maxHeight = Math.min(settings.maxHeight ?? 360, 360);
    const maxWidth = settings.maxTileWidth ?? 720;
    const maxItems = settings.maxItems ?? 24;
    const final = settings.final !== false;
    if (!Number.isFinite(gap) || gap < 0 || !positive(maxHeight) || !positive(maxWidth)) throw new TypeError('Invalid limits');
    if (!Number.isInteger(maxItems) || maxItems < 1 || !Number.isInteger(settings.rowOffset ?? 0) || (settings.rowOffset ?? 0) < 0) throw new TypeError('Invalid row bounds');
    items.forEach((item) => {
      if (!positive(item.ratio)) throw new TypeError('An image must have measured dimensions');
      if (item.maxCssHeight !== undefined && !positive(item.maxCssHeight)) throw new TypeError('Invalid quality cap');
      if (item.maxCssWidth !== undefined && !positive(item.maxCssWidth)) throw new TypeError('Invalid width cap');
    });
    const rows = [];
    let start = 0;
    while (start < items.length) {
      const target = Math.min(maxHeight, targets[((settings.rowOffset || 0) + rows.length) % targets.length]);
      let sum = 0;
      let cap = maxHeight;
      let best = null;
      let closed = false;
      for (let end = start; end < Math.min(items.length, start + maxItems); end += 1) {
        const item = items[end];
        const count = end - start + 1;
        const available = width - gap * (count - 1);
        if (available <= 0) { closed = true; break; }
        sum += item.ratio;
        cap = Math.min(cap, maxWidth / item.ratio, item.maxCssHeight ?? Infinity,
          (item.maxCssWidth ?? Infinity) / item.ratio);
        const fit = available / sum;
        const last = final && end === items.length - 1;
        const height = Math.min(fit, cap, last ? target : Infinity);
        const used = sum * height + gap * (count - 1);
        const score = Math.abs(Math.log(height / target)) + 2 * Math.max(0, 1 - used / width);
        if (!best || score < best.score - 1e-10) best = { end, height, used, score };
        if (fit <= Math.min(target, cap) || count === maxItems) { closed = true; break; }
      }
      // Do not expose an unfinished row that would change when the next batch arrives.
      if (!final && !closed) break;
      const rowItems = items.slice(start, best.end + 1);
      let x = 0;
      const tiles = rowItems.map((item) => {
        const tile = { item, x, width: item.ratio * best.height, height: best.height };
        x += tile.width + gap;
        return tile;
      });
      rows.push({ height: best.height, width: best.used, target, tiles,
        justified: Math.abs(best.used - width) < 0.01,
        last: final && best.end === items.length - 1 });
      start = best.end + 1;
    }
    return { rows, tail: items.slice(start) };
  }

  function selectSource(sources, cssWidth, cssHeight, dpr = 1) {
    if (![cssWidth, cssHeight, dpr].every(positive)) throw new TypeError('Invalid image demand');
    const available = sources.filter((source) => !source.failed && hasSize(source))
      .slice().sort((a, b) => a.width * a.height - b.width * b.height || a.url.localeCompare(b.url));
    const requiredWidth = Math.ceil(cssWidth * dpr - 1e-7);
    const requiredHeight = Math.ceil(cssHeight * dpr - 1e-7);
    const adequate = available.find((source) => source.width >= requiredWidth && source.height >= requiredHeight);
    return { source: adequate || available[available.length - 1] || null,
      sufficient: Boolean(adequate), requiredWidth, requiredHeight };
  }

  function qualityCap(sources, ratio, dpr = 1) {
    if (!positive(ratio) || !positive(dpr)) throw new TypeError('Invalid quality demand');
    const heights = sources.filter((source) => !source.failed && hasSize(source) && ratioMatches(source.width / source.height, ratio))
      .map((source) => Math.min(source.height, source.width / ratio) / dpr);
    const height = Math.max(0, ...heights);
    return { maxCssHeight: height, maxCssWidth: height * ratio };
  }

  // A future player calls this after the owner's explicit request to load a video.
  // No src assignment, poster inference, video creation or media loading here.
  function observeVideoMetadata(video, callback) {
    const update = () => {
      if (positive(video.videoWidth) && positive(video.videoHeight)) {
        callback({ width: video.videoWidth, height: video.videoHeight,
          ratio: video.videoWidth / video.videoHeight });
      }
    };
    video.addEventListener('loadedmetadata', update);
    if (video.readyState >= 1) update();
    return () => video.removeEventListener('loadedmetadata', update);
  }

  const api = Object.freeze({ layout, selectSource, qualityCap, ratioMatches, hasSize, observeVideoMetadata });
  if (typeof module === 'object' && module.exports) module.exports = api;
  else scope.ClipRedMediaGrid = api;
})(globalThis);

(function (scope) {
  'use strict';
  const core = scope.ClipRedMediaGrid;
  const positive = (n) => Number.isFinite(n) && n > 0;

  // Rejection sampling avoids modulo bias for every Fisher–Yates step.
  function randomIndex(bound, crypto = scope.crypto, fallback = Math.random) {
    if (!Number.isInteger(bound) || bound < 1 || bound > 0x100000000) throw new RangeError('Invalid shuffle bound');
    if (!crypto?.getRandomValues) return Math.floor(fallback() * bound);
    const bucket = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / bound) * bound;
    do { crypto.getRandomValues(bucket); } while (bucket[0] >= limit);
    return bucket[0] % bound;
  }

  function shuffle(items, pick = randomIndex) {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = pick(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function aspect(value) {
    if (positive(value)) return value;
    const pair = Array.isArray(value) ? value : typeof value === 'string' ? value.split('/').map(Number) : [];
    return pair.length === 2 && pair.every(positive) ? pair[0] / pair[1] : null;
  }

  function videoRatio(clip) {
    if (core.hasSize(clip.metadata)) return clip.metadata.width / clip.metadata.height;
    return aspect(clip.aspectRatio);
  }

  function mediaURL(value, base = '') {
    if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value) || !base) return value;
    return new URL(value, base.endsWith('/') ? base : `${base}/`).href;
  }

  function sources(key, roles, metadata) {
    const dimensions = metadata.assets[key] || {};
    const values = roles.filter(([, url]) => url).map(([role, url]) => ({
      role, url, width: dimensions[role]?.width || 0, height: dimensions[role]?.height || 0
    }));
    (dimensions.sources || []).forEach((source) => values.push({ ...source, role: 'additional' }));
    return [...new Map(values.map((source) => [source.url, source])).values()];
  }

  function catalogs(data, photos, metadata, config = {}, pick) {
    const video = data.projects.flatMap((project) => {
      const key = `video:${project.id}`;
      const clips = project.videos.filter((clip) => clip.full).map((clip) => ({
        ...clip, full: mediaURL(clip.full, config.mediaBase?.video), preview: mediaURL(clip.preview, config.mediaBase?.video),
        poster: mediaURL(clip.poster, config.posterBase), ratio: videoRatio(clip), layoutRatio: aspect(clip.layoutAspectRatio)
      }));
      if (!clips.length) return [];
      return [{ key, kind: 'video', title: project.title || '', project, clips,
        videoRatio: clips[0].ratio, layoutRatio: clips[0].layoutRatio,
        sources: sources(key, [['poster', mediaURL(project.cover, config.posterBase)]], metadata) }];
    });
    const photo = photos.photos.map((item) => {
      const key = `photo:${item.id}`;
      if (item.width > 0 && item.height > 0) metadata = { ...metadata, assets: { ...metadata.assets, [key]: { ...metadata.assets[key], full: { width: item.width, height: item.height } } } };
      return { key, kind: 'photo', title: item.title || item.alt || '', full: mediaURL(item.full, config.mediaBase?.photo),
        sources: sources(key, [['preview', mediaURL(item.preview, config.mediaBase?.photo)], ['full', mediaURL(item.full, config.mediaBase?.photo)]], metadata) };
    });
    return { video: shuffle(video, pick), photo: shuffle(photo, pick) };
  }

  function nextIndex(index, delta, length) {
    return length ? ((index + delta) % length + length) % length : -1;
  }

  scope.ClipRedV09Data = Object.freeze({ randomIndex, shuffle, aspect, videoRatio, mediaURL, sources, catalogs, nextIndex });
})(globalThis);

(function (scope) {
  'use strict';
  const modes = ['video', 'gallery', 'campaign', 'object'];
  function readMode(href) { const value = new URL(href).searchParams.get('clipred'); return value === 'photo' ? 'gallery' : modes.includes(value) ? value : 'video'; }
  function modeURL(href, mode) { const url = new URL(href); url.searchParams.set('clipred', modes.includes(mode) ? mode : 'video'); return url.href; }
  scope.ClipRedV09Navigation = Object.freeze({ modes, readMode, modeURL });
})(globalThis);

(function (scope) {
  'use strict';
  const rankRect = (node, height = window.innerHeight) => {
    if (!node.isConnected || node.closest?.('[hidden]')) return 4;
    const rect = node.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < height) return 0;
    if (rect.top < height + 600 && rect.bottom > -200) return 1;
    return 2;
  };
  class PriorityQueue {
    constructor(limit = 3) { this.limit = limit; this.running = 0; this.jobs = []; this.serial = 0; this.subscribers = new Set(); }
    subscribe(listener) { this.subscribers.add(listener); return () => this.subscribers.delete(listener); }
    notify() { this.subscribers.forEach((listener) => listener()); }
    add(task, priority = () => 1, alive = () => true) {
      return new Promise((resolve, reject) => {
        this.jobs.push({ task, priority, alive, resolve, reject, serial: this.serial++ });
        this.wake(); this.notify();
      });
    }
    wake() {
      this.jobs.sort((a, b) => a.priority() - b.priority() || a.serial - b.serial);
      while (this.running < this.limit && this.jobs.length) {
        const job = this.jobs[0];
        if (!job.alive()) { this.jobs.shift(); job.resolve(null); continue; }
        if (job.priority() >= 4) break;
        this.jobs.shift(); this.running += 1;
        Promise.resolve().then(job.task).then(job.resolve, job.reject).finally(() => { this.running -= 1; this.wake(); this.notify(); });
      }
    }
  }
  function loadImage(img, url, decode = true, control) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true; clearTimeout(timer); img.onload = img.onerror = null;
        if (control) control.cancel = null;
        if (!ok) img.removeAttribute('src');
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), 15000);
      if (control) control.cancel = () => { control.cancelled = true; finish(false); };
      img.onload = async () => {
        try {
          if (decode && img.decode) await img.decode();
          finish(Boolean(img.naturalWidth && img.naturalHeight));
        } catch { finish(false); }
      };
      img.onerror = () => finish(false);
      img.decoding = 'async';
      img.src = url;
    });
  }
  class MeasurementCache {
    constructor(storage) {
      this.storage = storage; this.key = 'clipred:image-dimensions:1'; this.values = new Map();
      ['clipred:v04:image-dimensions:1', 'clipred:v05:image-dimensions:1', this.key].forEach((key) => {
        try {
          Object.entries(JSON.parse(storage?.getItem(key) || '{}')).forEach(([url, size]) => {
            if (scope.ClipRedMediaGrid.hasSize(size)) this.values.set(url, size);
          });
        } catch { /* One damaged legacy entry must not hide the current URL cache. */ }
      });
    }
    get(url) { return this.values.get(url); }
    set(url, size) {
      if (!scope.ClipRedMediaGrid.hasSize(size)) return;
      this.values.set(url, { width: size.width, height: size.height });
      try { this.storage?.setItem(this.key, JSON.stringify(Object.fromEntries(this.values))); } catch { /* In-memory cache remains available. */ }
    }
  }
  scope.ClipRedV09Loading = Object.freeze({ PriorityQueue, rankRect, loadImage, MeasurementCache });
})(globalThis);

(function (scope) {
  'use strict';
  const { rankRect } = scope.ClipRedV09Loading;
  class PhotoReveal {
    constructor(pick = scope.ClipRedV09Data.randomIndex) {
      this.pick = pick; this.pending = new Map(); this.revealed = new Set();
      this.phase = pick(2); this.last = null;
      this.motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    }
    add(key, frame, parity) {
      if (this.revealed.has(key)) { frame.classList.add('is-revealed'); return; }
      this.pending.set(key, { key, frame, parity, random: this.pick(1000000) });
      this.wake();
    }
    choose() {
      const items = [...this.pending.values()].filter((item) => item.frame.isConnected && rankRect(item.frame) <= 1);
      items.sort((a, b) => {
        const priority = rankRect(a.frame) - rankRect(b.frame);
        if (priority) return priority;
        const distance = (item) => {
          if (!this.last) return 0;
          const box = item.frame.getBoundingClientRect();
          const center = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
          return Math.hypot(center.x - this.last.x, center.y - this.last.y) < Math.max(box.width, box.height) * 1.15 ? 1 : 0;
        };
        return distance(a) - distance(b) || Number(a.parity !== this.phase) - Number(b.parity !== this.phase) || a.random - b.random;
      });
      return items[0];
    }
    wake() {
      if (this.timer || !this.choose()) return;
      this.timer = setTimeout(() => {
        this.timer = null;
        const item = this.choose();
        if (item) {
          this.pending.delete(item.key); this.revealed.add(item.key);
          const box = item.frame.getBoundingClientRect();
          this.last = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
          item.frame.classList.add(this.motion.matches ? 'is-revealed' : 'is-entering', 'is-revealed');
          item.frame.addEventListener('animationend', () => item.frame.classList.remove('is-entering'), { once: true });
        }
        this.wake();
      }, this.motion.matches ? 0 : 35 + this.pick(65));
    }
    destroy() { clearTimeout(this.timer); this.pending.clear(); }
  }
  scope.ClipRedV09Reveal = Object.freeze({ PhotoReveal });
})(globalThis);

(function (scope) {
  'use strict';
  const core = scope.ClipRedMediaGrid;

  class ImageMeasurements {
    constructor(limit = 3, storage) {
      this.queue = new scope.ClipRedV09Loading.PriorityQueue(limit);
      this.persisted = new scope.ClipRedV09Loading.MeasurementCache(storage);
      this.cache = this.persisted.values; this.pending = new Map(); this.loaded = new Set();
    }
    hydrate(source) {
      if (!core.hasSize(source) && this.cache.has(source.url)) Object.assign(source, this.cache.get(source.url));
      return core.hasSize(source);
    }
    measure(source, alive, priority = () => 1) {
      if (source.failed) return Promise.resolve(null);
      if (this.hydrate(source)) return Promise.resolve(source);
      if (this.pending.has(source.url)) return this.pending.get(source.url).then((result) => {
        if (!result) return null;
        Object.assign(source, { width: result.width, height: result.height }); return source;
      });
      const job = this.queue.add(async () => {
        const img = new Image();
        if (await scope.ClipRedV09Loading.loadImage(img, source.url, false)) {
          const size = { width: img.naturalWidth, height: img.naturalHeight };
          Object.assign(source, size); this.persisted.set(source.url, size); this.loaded.add(source.url);
          return source;
        }
        source.failed = true; return null;
      }, priority, alive).finally(() => this.pending.delete(source.url));
      this.pending.set(source.url, job); return job;
    }
  }

  class JustifiedGallery {
    constructor(gallery, entries, settings, measurements, report) {
      Object.assign(this, { gallery, entries, settings, measurements, report });
      this.entries = entries.map((entry) => ({ ...entry, sources: entry.sources.map((source) => ({ ...source })) }));
      this.active = true;
      this.reveal = new scope.ClipRedV09Reveal.PhotoReveal();
      this.entries.forEach((entry) => entry.sources.forEach((source) => this.measurements.hydrate(source)));
      this.ready = [];
      this.tail = [];
      this.rows = [];
      this.cursor = 0;
      this.busy = false;
      this.width = Math.max(1, gallery.clientWidth);
      this.dpr = window.devicePixelRatio || 1;
      this.sentinel = document.createElement('div');
      this.sentinel.className = 'lab-sentinel';
      this.sentinel.setAttribute('aria-hidden', 'true');
      gallery.replaceChildren(this.sentinel);
      gallery.style.setProperty('--lab-gap', `${settings.gap}px`);
      this.onResize = () => this.scheduleResize();
      window.addEventListener('resize', this.onResize, { passive: true });
      if ('ResizeObserver' in window) {
        this.resizeObserver = new ResizeObserver(() => {
          if (Math.abs(gallery.clientWidth - this.width) > 1) this.scheduleResize();
        });
        this.resizeObserver.observe(gallery);
      }
      if ('IntersectionObserver' in window) {
        this.moreObserver = new IntersectionObserver(() => this.maybeMore(), { rootMargin: `${settings.preloadMargin}px` });
        this.moreObserver.observe(this.sentinel);
        this.tileObserver = new IntersectionObserver((records) => {
          if (records.some((record) => record.isIntersecting)) this.refresh();
        }, { rootMargin: '600px' });
      } else {
        this.onScroll = () => { this.maybeMore(); this.refresh(); };
        window.addEventListener('scroll', this.onScroll, { passive: true });
      }
      this.watchDpr();
      if (scope.ClipRedV013PhotoStartup) this.startup = new scope.ClipRedV013PhotoStartup(this);
      if (this.entries.length) this.more();
      else { gallery.setAttribute('aria-busy', 'false'); this.empty(); }
    }

    watchDpr() {
      this.dprQuery?.removeEventListener('change', this.onDpr);
      this.dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      this.onDpr = () => { this.watchDpr(); this.scheduleResize(); };
      this.dprQuery.addEventListener('change', this.onDpr);
    }

    compatible(entry) {
      return entry.sources.filter((source) => !source.failed && core.hasSize(source)
        && core.ratioMatches(source.width / source.height, entry.imageRatio || entry.ratio));
    }

    cap(entry) {
      if (!entry.sources.length) return;
      const imageRatio = entry.imageRatio || entry.ratio;
      const quality = core.qualityCap(this.compatible(entry), imageRatio, this.dpr);
      // Preserve the original photographic source-quality cap.
      const height = Math.max(quality.maxCssHeight, quality.maxCssWidth / entry.ratio);
      Object.assign(entry, { maxCssHeight: height, maxCssWidth: height * entry.ratio });
    }

    async base(entry) {
      for (const source of this.probeOrder(entry)) {
        if (!this.active) return null;
        const measured = await this.measurements.measure(source, () => this.active, () => this.startup?.measurePriority() ?? 1);
        if (!measured) { if (this.active) this.report(entry, 'image-unavailable', { url: source.url }); continue; }
        const ratio = measured.width / measured.height;
        entry.imageRatio = ratio;
        entry.ratio = ratio;
        this.cap(entry);
        return entry;
      }
      return null;
    }

    choose(entry, width, height) {
      const imageRatio = entry.imageRatio || entry.ratio;
      const containedWidth = Math.min(width, height * imageRatio);
      return core.selectSource(this.compatible(entry), containedWidth, containedWidth / imageRatio, this.dpr);
    }

    async quality(entry, width, height) {
      if (!entry.sources.length) return { source: null, sufficient: true };
      let choice = this.choose(entry, width, height);
      for (const source of this.probeOrder(entry)) {
        if (!this.active || choice.sufficient) break;
        if (source.failed || core.hasSize(source)) continue;
        const measured = await this.measurements.measure(source, () => this.active, () => this.startup?.measurePriority() ?? 1);
        if (!measured && this.active) this.report(entry, 'image-unavailable', { url: source.url });
        if (measured && !core.ratioMatches(measured.width / measured.height, entry.imageRatio || entry.ratio)) {
          this.report(entry, 'variant-format-mismatch', { url: source.url, width: source.width, height: source.height });
        }
        choice = this.choose(entry, width, height);
      }
      this.cap(entry);
      if (this.active && !choice.sufficient) this.report(entry, 'resolution-limited', {
        requiredWidth: choice.requiredWidth, requiredHeight: choice.requiredHeight, dpr: this.dpr,
        available: this.compatible(entry).map(({ url, width: w, height: h }) => ({ url, width: w, height: h }))
      });
      return choice;
    }

    probeOrder(entry) {
      const priority = (source) => source.role === 'full' ? 2 : source.role === 'additional' ? 1 : 0;
      return entry.sources.slice().sort((a, b) => priority(a) - priority(b));
    }

    idealLayout(entries, rowOffset = 0) {
      return core.layout(entries.map((entry) => ({ ...entry, maxCssWidth: undefined, maxCssHeight: undefined })),
        this.width, { ...this.geometrySettings(), final: true, rowOffset });
    }

    geometrySettings() {
      return this.settings;
    }

    more() {
      if (this.pending) return this.pending;
      this.pending = this.loadMore().finally(() => { this.pending = null; });
      return this.pending;
    }

    async loadMore() {
      if (!this.active || this.busy || this.cursor >= this.entries.length) return;
      this.busy = true;
      this.gallery.setAttribute('aria-busy', 'true');
      try {
        const start = this.cursor;
        const count = this.cursor === 0 ? (this.settings.initialBatchSize || 20) : this.settings.batchSize;
        const next = this.entries.slice(start, start + count);
        const tailAtStart = this.tail.slice(), rowOffsetAtStart = this.rows.length;
        const bases = new Map(), completed = new Map(), preparing = [];
        let planned = 0, consumed = 0;
        const commit = () => {
          if (!this.active) return;
          while (completed.has(consumed)) {
            const entry = completed.get(consumed++);
            if (entry) { this.ready.push(entry); this.tail.push(entry); }
          }
          this.cursor = start + consumed;
          this.appendReady();
        };
        const plan = () => {
          const previous = planned;
          while (bases.has(planned)) planned += 1;
          if (previous === planned) return;
          this.width = this.gallery.clientWidth || this.width;
          const known = [...tailAtStart, ...next.slice(0, planned).map((_, i) => bases.get(i)).filter(Boolean)];
          const desired = this.idealLayout(known, rowOffsetAtStart);
          const frames = new Map(desired.rows.flatMap((row) => row.tiles.map((tile) => [tile.item.key, tile])));
          for (let i = previous; i < planned; i += 1) {
            const entry = bases.get(i);
            if (!entry) { completed.set(i, null); continue; }
            const tile = frames.get(entry.key);
            // Each source prepares independently. No Promise.all quality barrier for a whole batch.
            const job = this.quality(entry, tile.width, tile.height).then(() => {
              completed.set(i, entry); commit();
            });
            preparing.push(job);
          }
          commit();
        };
        await Promise.all(next.map(async (entry, index) => {
          bases.set(index, await this.base(entry)); plan();
        }));
        await Promise.all(preparing); commit();
      } finally {
        this.busy = false;
        if (this.active) {
          this.gallery.setAttribute('aria-busy', 'false');
          requestAnimationFrame(() => this.maybeMore());
          this.startup?.wake();
        }
      }
    }

    appendReady() {
      const packed = core.layout(this.tail, this.width, { ...this.geometrySettings(),
        rowOffset: this.rows.length, final: this.cursor >= this.entries.length });
      this.tail = packed.tail;
      packed.rows.forEach((row) => this.mount(row));
      if (this.cursor >= this.entries.length && !this.ready.length) this.empty();
    }

    mount(row) {
      const node = document.createElement('div');
      node.className = 'lab-row';
      node.style.height = `${row.height}px`;
      row.tiles.forEach((tile, column) => {
        const entry = tile.item;
        const choice = this.choose(entry, tile.width, tile.height);
        if (!choice.source) return;
        const frame = document.createElement('button');
        frame.type = 'button'; frame.className = 'lab-tile';
        frame.setAttribute('aria-label', 'Открыть фотографию');
        frame.style.width = `${tile.width}px`; frame.style.height = `${tile.height}px`;
        frame.entry = entry;
        const img = document.createElement('img');
        img.className = 'lab-image'; img.alt = entry.title || 'Фотография CLIP.RED';
        img.width = choice.source.width; img.height = choice.source.height;
        img.draggable = false;
        frame.append(img); node.append(frame);
        this.startup?.track(frame);
        const parity = (this.rows.length + column) % 2;
        const loadWeight = scope.ClipRedV09Data.randomIndex(1000000) / 1000000;
        if (this.reveal.revealed.has(entry.key)) frame.classList.add('is-revealed');
        Promise.resolve().then(() => this.measurements.queue.add(() => {
          img.fetchPriority = scope.ClipRedV09Loading.rankRect(frame) === 0 ? 'high' : 'low';
          // Release the network slot on load, before this image's independent decode.
          return scope.ClipRedV09Loading.loadImage(img, choice.source.url, false);
        }, () => this.startup?.priority(frame, loadWeight) ?? scope.ClipRedV09Loading.rankRect(frame) + loadWeight * .2, () => this.active && frame.isConnected))
          .then(async (loaded) => {
            if (!this.active || !frame.isConnected || loaded === null) return;
            let ok = loaded;
            if (ok && img.decode) { try { await (this.startup && !this.startup.shown ? this.startup.decode(img) : img.decode()); } catch { ok = false; } }
            if (!this.active || !frame.isConnected) return;
            if (ok) {
              const size = { width: img.naturalWidth, height: img.naturalHeight };
              this.measurements.persisted.set(choice.source.url, size); this.measurements.loaded.add(choice.source.url);
              if (!core.ratioMatches(size.width / size.height, entry.ratio)) {
                this.report(entry, 'metadata-changed', { url: choice.source.url, ...size });
              }
              frame.classList.add('is-loaded');
              if (!this.startup?.reveal(entry.key, frame)) this.reveal.add(entry.key, frame, parity);
            } else {
              this.report(entry, 'image-unavailable', { url: choice.source.url });
              // Keep reserved geometry even on failure; full-photo navigation remains available.
              frame.classList.add('is-image-failed');
            }
            this.startup?.settled(frame);
          });
        this.tileObserver?.observe(frame);
      });
      this.gallery.insertBefore(node, this.sentinel); this.rows.push(node);
    }

    refresh() {
      this.measurements.queue.wake(); this.reveal.wake();
      this.startup?.wake();
    }

    empty() {
      if (this.gallery.querySelector('.lab-error')) return;
      const message = document.createElement('p');
      message.className = 'lab-error';
      message.setAttribute('role', 'alert');
      message.textContent = 'Изображения недоступны. Проверьте подключение и обновите страницу.';
      this.gallery.insertBefore(message, this.sentinel);
    }

    maybeMore() {
      if (!this.active || this.busy || this.gallery.hidden) return;
      if (this.startup && !this.startup.shown) { this.startup.wake(); return; }
      if (this.sentinel.getBoundingClientRect().top <= window.innerHeight + this.settings.preloadMargin) this.more();
    }

    scheduleResize() {
      if (this.resizeQueued || !this.active) return;
      this.resizeQueued = true;
      requestAnimationFrame(() => {
        this.resizeQueued = false;
        if (this.active && !this.gallery.hidden && this.gallery.clientWidth > 0) this.rebuild();
      });
    }

    rebuild() {
      if (this.gallery.hidden) return;
      this.width = Math.max(1, this.gallery.clientWidth);
      this.dpr = window.devicePixelRatio || 1;
      this.ready.forEach((entry) => this.cap(entry));
      this.tileObserver?.disconnect();
      this.rows.forEach((node) => node.remove());
      this.rows = [];
      this.tail = this.ready.slice();
      this.appendReady();

      this.refresh();
      this.maybeMore();
    }

    deactivate() { this.startup?.deactivate(); }

    destroy() {
      this.active = false;
      this.startup?.destroy();
      this.reveal.destroy();
      this.resizeObserver?.disconnect();
      this.moreObserver?.disconnect();
      this.tileObserver?.disconnect();
      this.dprQuery?.removeEventListener('change', this.onDpr);
      window.removeEventListener('resize', this.onResize);
      if (this.onScroll) window.removeEventListener('scroll', this.onScroll);
    }

    visibleEntries() {
      return [...this.gallery.querySelectorAll('.lab-tile')].map((tile) => tile.entry);
    }

  }

  scope.ClipRedV09Gallery = Object.freeze({ ImageMeasurements, JustifiedGallery });
})(globalThis);

(function (scope) {
  'use strict';
  class PhotoStartup {
    constructor(view) {
      this.view = view; this.gallery = view.gallery;
      this.shown = false; this.destroyed = false; this.showCount = 0;
      this.gallery.setAttribute('data-photo-startup', 'preparing');
      this.feedback = document.createElement('div'); this.feedback.className = 'lab-pdf-feedback';
      const ring = document.createElement('span'); ring.className = 'lab-spinner'; ring.setAttribute('aria-hidden', 'true');
      const text = document.createElement('p'); text.className = 'lab-pdf-status'; text.textContent = 'Загрузка...'; text.setAttribute('role', 'status');
      this.feedback.append(ring, text); this.gallery.append(this.feedback);
      this.wake();
    }
    targetHeight() {
      const height = window.innerHeight;
      return Math.max(height, height - this.gallery.getBoundingClientRect().top) + Math.min(400, height * .4);
    }
    requiredRows() {
      const rows = []; let height = 0;
      for (const row of this.view.rows) {
        rows.push(row); height += parseFloat(row.style.height) + this.view.settings.gap;
        if (height - this.view.settings.gap >= this.targetHeight()) break;
      }
      return { rows, height: Math.max(0, height - this.view.settings.gap) };
    }
    track(frame) {
      if (this.shown || this.destroyed) return;
      this.wake();
    }
    measurePriority() { return !this.shown && (this.gallery.hidden || this.gallery.clientWidth <= 0) ? 4 : 1; }
    priority(frame, random) {
      // Measurements keep their existing queue/priority. Tile requests wait until
      // all initial rows exist, then compete across rows in the original queue.
      if (!this.shown) return 4;
      return scope.ClipRedV09Loading.rankRect(frame) + random * .2;
    }
    async decode(img) {
      let timer;
      try {
        await Promise.race([img.decode(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('Initial photo decode timeout')), 15000);
        })]);
      } finally { clearTimeout(timer); }
    }
    reveal(key, frame) {
      // Use the unmodified V0.11 PhotoReveal for every individually ready tile.
      // Tile loading cannot start before geometry releases priority() above.
      return false;
    }
    settled(frame) {
      if (this.shown || this.destroyed) return;
      this.wake();
    }
    wake() {
      if (this.destroyed || this.scheduled) return;
      if (this.shown) { if (!this.view.busy) this.gallery.setAttribute('aria-busy', 'false'); return; }
      this.scheduled = true;
      requestAnimationFrame(() => { this.scheduled = false; this.check(); });
    }
    check() {
      if (this.shown || this.destroyed || !this.view.active || this.gallery.hidden || this.gallery.clientWidth <= 0) return;
      this.gallery.setAttribute('aria-busy', 'true');
      if (Math.abs(this.gallery.clientWidth - this.view.width) > 1) { this.view.scheduleResize(); return; }
      const required = this.requiredRows();
      const exhausted = this.failed || this.view.cursor >= this.view.entries.length;
      if (required.height < this.targetHeight() && !exhausted) {
        if (!this.view.busy && !this.filling) {
          this.filling = true;
          // more() reuses any pending batch; never run parallel loadMore passes.
          this.view.more().catch(() => { this.failed = true; this.view.empty(); }).finally(() => { this.filling = false; this.wake(); });
        }
        return;
      }
      this.shown = true; this.showCount++;
      this.gallery.setAttribute('data-photo-startup', 'ready'); this.gallery.setAttribute('aria-busy', 'false');
      this.feedback.remove();
      // Release the spinner on geometry alone: no onload/decode/animation barrier.
      this.view.measurements.queue.wake(); this.view.refresh(); this.view.maybeMore();
    }
    deactivate() { /* Hidden-tab queue/reveal parking remains in rankRect(). */ }
    destroy() { this.destroyed = true; this.feedback.remove(); }
  }
  scope.ClipRedV013PhotoStartup = PhotoStartup;
})(globalThis);

(function (scope) {
  'use strict';
  // Idle-only preview warming, one image at a time, never full photos or video.
  class IdlePhotos {
    constructor(entries, measurements, canRun) {
      this.entries = entries.slice(0, 20); this.measurements = measurements; this.canRun = canRun;
      this.cursor = 0; this.finished = new Set(); this.paused = false; this.destroyed = false;
      this.unsubscribe = measurements.queue.subscribe(() => {
        if (!this.allowed()) this.cancelRequest();
        else this.wake();
      });
      this.visibility = () => { if (document.hidden) this.pause(); else this.resume(); };
      document.addEventListener('visibilitychange', this.visibility);
    }
    allowed() {
      const queue = this.measurements.queue;
      return !this.destroyed && !this.paused && !document.hidden && this.canRun() && queue.running === 0 &&
        !queue.jobs.some((job) => job.alive() && job.priority() < 4);
    }
    wake() {
      if (this.scheduled || this.request || this.cursor >= this.entries.length || !this.allowed()) return;
      const run = () => { this.scheduled = null; if (this.allowed()) this.step(); };
      if (scope.requestIdleCallback) this.scheduled = { idle: true, id: scope.requestIdleCallback(run, { timeout: 1500 }) };
      else this.scheduled = { idle: false, id: setTimeout(run, 250) };
    }
    async step() {
      const entry = this.entries[this.cursor];
      if (!entry || !this.allowed()) return;
      const source = entry.sources.find((item) => item.role === 'preview');
      if (!source || this.measurements.loaded.has(source.url)) {
        this.finished.add(entry.key); this.cursor += 1; this.wake(); return;
      }
      const control = { cancelled: false }; this.request = control;
      const image = new Image(); image.fetchPriority = 'low';
      const ok = await scope.ClipRedV09Loading.loadImage(image, source.url, false, control);
      if (ok) {
        this.measurements.persisted.set(source.url, { width: image.naturalWidth, height: image.naturalHeight });
        this.measurements.loaded.add(source.url);
      }
      this.request = null;
      // Cancellation is not a failed source and must be retried after foreground work.
      if (!control.cancelled) { this.finished.add(entry.key); this.cursor += 1; }
      this.wake();
    }
    cancelRequest() { this.request?.cancel?.(); }
    pause() {
      this.paused = true;
      if (this.scheduled?.idle) scope.cancelIdleCallback?.(this.scheduled.id);
      else if (this.scheduled) clearTimeout(this.scheduled.id);
      this.scheduled = null; this.cancelRequest();
    }
    resume() { this.paused = false; this.wake(); }
    destroy() { this.destroyed = true; this.pause(); this.unsubscribe(); document.removeEventListener('visibilitychange', this.visibility); }
  }
  scope.ClipRedV09Prefetch = Object.freeze({ IdlePhotos });
})(globalThis);

(function (scope) {
  'use strict';
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const button = (className, text, label) => {
    const node = element('button', className, text);
    node.type = 'button';
    node.setAttribute('aria-label', label);
    return node;
  };

  class Overlay {
    constructor(root) {
      this.root = root;
      this.node = element('div', 'v09-overlay');
      this.node.hidden = true;
      this.node.tabIndex = -1;
      this.node.setAttribute('role', 'dialog');
      this.node.setAttribute('aria-modal', 'true');
      this.closeButton = button('v09-close v09-control', '×', 'Закрыть просмотр');
      this.closeButton.addEventListener('click', () => this.close());
      this.node.append(this.closeButton);
      // Portal avoids transformed Tilda record ancestors constraining position:fixed.
      this.portal = element('div', 'cr-v09 cr-v09-portal');
      this.portal.append(this.node);
      document.body.append(this.portal);
      this.modality = 'pointer';
      const setInput = (value) => { this.modality = value; root.dataset.input = value; this.portal.dataset.input = value; };
      setInput('pointer');
      document.addEventListener('pointerdown', () => setInput('pointer'), { capture: true });
      document.addEventListener('keydown', (event) => {
        if (['Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) setInput('keyboard');
      }, { capture: true });
      this.node.addEventListener('click', (event) => {
        if (event.target === this.node) this.close();
      });
      this.onKey = (event) => {
        if (!this.opened) return;
        if (event.key === 'Escape') {
          if (this.blocksEscape?.()) return;
          event.preventDefault(); event.stopPropagation(); this.close(); return;
        }
        if (event.key === 'Tab') {
          const controls = [...this.node.querySelectorAll('button, video[controls], [tabindex="0"]')]
            .filter((node) => !node.hidden && !node.disabled && node.getClientRects().length);
          if (!controls.length) { event.preventDefault(); this.node.focus(); return; }
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || document.activeElement === this.node)) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
        this.keyHandler?.(event);
      };
    }

    open(kind, label, cleanup, keyHandler) {
      if (this.opened) this.close();
      this.returnFocus = document.activeElement;
      this.returnKey = this.returnFocus?.entry?.key;
      this.openedByKeyboard = this.modality === 'keyboard';
      this.scroll = { x: window.scrollX, y: window.scrollY };
      this.bodyStyle = document.body.getAttribute('style');
      const scrollbar = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
      const padding = parseFloat(window.getComputedStyle(document.body).paddingRight) || 0;
      Object.assign(document.body.style, { position: 'fixed', top: `-${this.scroll.y}px`,
        left: `-${this.scroll.x}px`, width: '100%', overflow: 'hidden', paddingRight: `${padding + scrollbar}px` });
      // Inert every branch outside the overlay, including surrounding Tilda records.
      this.inertNodes = [];
      let branch = this.node;
      while (branch.parentElement && branch !== document.body) {
        [...branch.parentElement.children].filter((sibling) => sibling !== branch).forEach((sibling) => {
          this.inertNodes.push([sibling, sibling.inert]); sibling.inert = true;
        });
        branch = branch.parentElement;
      }
      this.node.className = `v09-overlay v09-${kind}`;
      this.node.setAttribute('aria-label', label);
      this.node.hidden = false;
      this.node.scrollTop = 0;
      this.cleanup = cleanup;
      this.keyHandler = keyHandler;
      this.opened = true; this.onStateChange?.(true);
      document.addEventListener('keydown', this.onKey);
      this.closeButton.focus({ preventScroll: true });
    }

    close() {
      if (!this.opened) return;
      this.opened = false; this.onStateChange?.(false);
      this.cleanup?.();
      this.cleanup = this.keyHandler = null;
      this.blocksEscape = null;
      document.removeEventListener('keydown', this.onKey);
      this.node.hidden = true;
      this.node.replaceChildren(this.closeButton);
      this.inertNodes.forEach(([node, inert]) => { node.inert = inert; });
      if (this.bodyStyle === null) document.body.removeAttribute('style');
      else document.body.setAttribute('style', this.bodyStyle);
      // Override site-wide smooth scrolling only for restoration, then restore it.
      const html = document.documentElement;
      const previousScroll = html.style.getPropertyValue('scroll-behavior');
      const priority = html.style.getPropertyPriority('scroll-behavior');
      html.style.setProperty('scroll-behavior', 'auto', 'important');
      window.scrollTo(this.scroll.x, this.scroll.y);
      html.style.removeProperty('scroll-behavior');
      if (previousScroll) html.style.setProperty('scroll-behavior', previousScroll, priority);
      const target = this.returnFocus?.isConnected ? this.returnFocus :
        [...this.root.querySelectorAll('.lab-tile')].find((tile) => tile.entry?.key === this.returnKey);
      // Escape itself does not turn a mouse-opened tile into keyboard focus.
      if (!this.openedByKeyboard) this.root.dataset.input = 'pointer';
      target?.focus({ preventScroll: true });
    }
  }
  scope.ClipRedV09UI = Object.freeze({ element, button, Overlay });
})(globalThis);

(function (scope) {
  'use strict';
  const size = (value) => value && Number.isFinite(value.width) && value.width > 0 && Number.isFinite(value.height) && value.height > 0;
  class PreviewBatch {
    constructor(measurements, alive, visible, report) {
      Object.assign(this, { measurements, alive, visible, report }); this.records = new Map();
    }
    async prepare(entries, progress) {
      const pairs = entries.map((entry) => {
        const source = entry.sources.find((item) => /\.jpe?g(?:[?#].*)?$/i.test(item.url));
        if (!source) { entry.posterState = 'not-found'; this.report(entry, 'missing-poster'); return { entry }; }
        let record = this.records.get(source.url);
        if (!record) {
          record = { url: source.url, cached: this.measurements.persisted.get(source.url), state: 'loading' };
          this.records.set(source.url, record);
        }
        entry.posterState = 'loading'; return { entry, source, record };
      });
      let completed = 0; const total = this.records.size;
      const update = () => progress({ completed, total, percent: total ? Math.floor(completed / total * 100) : 100 });
      update();
      await Promise.all([...this.records.values()].map((record) => this.measurements.queue.add(async () => {
        const img = document.createElement('img'); record.img = img;
        img.className = 'lab-video-poster'; img.draggable = false; img.decoding = 'async'; img.fetchPriority = 'high';
        // loadImage has a bounded 15s load/decode timeout. This very IMG is mounted later.
        const ok = await scope.ClipRedV09Loading.loadImage(img, record.url);
        if (ok && size({ width: img.naturalWidth, height: img.naturalHeight })) {
          record.dimensions = { width: img.naturalWidth, height: img.naturalHeight }; record.state = 'loaded';
          this.measurements.persisted.set(record.url, record.dimensions); this.measurements.loaded.add(record.url);
        } else {
          record.state = 'failed'; if (size(record.cached)) record.dimensions = record.cached;
          scope.console?.warn?.('[CLIP.RED] Preview could not be loaded', { url: record.url });
        }
      }, () => this.visible() ? 0 : 4, this.alive).catch(() => {
        record.state = 'failed'; if (size(record.cached)) record.dimensions = record.cached;
        record.img?.removeAttribute('src');
      }).then(() => { completed++; update(); })));
      return pairs.map(({ entry, source, record }) => {
        if (!record) return { entry, state: 'not-found' };
        entry.posterState = record.state;
        if (record.state === 'failed') this.report(entry, 'poster-found-but-failed', { url: record.url });
        if (size(record.dimensions)) {
          Object.assign(source, record.dimensions); entry.videoRatio = record.dimensions.width / record.dimensions.height;
        } else entry.videoRatio = null;
        return { entry, record, state: record.state };
      });
    }
  }
  // Compatibility port used by unchanged app.js. It never measures/requests MP4 and
  // never stores player metadata as gallery dimensions. Card metadata stays in the player.
  class VideoDimensions {
    known() { return null; }
    remember() {}
    pause() {}
    resume() {}
    destroy() {}
  }
  scope.ClipRedV09Metadata = Object.freeze({ VideoDimensions });
  scope.ClipRedV11Previews = Object.freeze({ PreviewBatch, size });
})(globalThis);

(function (scope) {
  'use strict';
  const { element, button } = scope.ClipRedV09UI;
  const valid = (n) => Number.isFinite(n) && n > 0;
  const ratioOf = (entry) => {
    if (!valid(entry.videoRatio)) throw new TypeError('Video dimensions required before layout');
    return entry.videoRatio;
  };
  // Global partition of the shuffled sequence. No fixed item-count limit or special final row.
  function layout(entries, width, viewportHeight, gap = 6) {
    if (!(width > 0 && viewportHeight > 0 && gap >= 0)) throw new TypeError('Invalid video grid bounds');
    const target = Math.min(320, Math.max(150, viewportHeight * .265), width * .65);
    const best = Array(entries.length + 1).fill(null);
    best[entries.length] = { score: 0, rows: [] };
    for (let start = entries.length - 1; start >= 0; start -= 1) {
      let sum = 0;
      for (let end = start; end < entries.length; end += 1) {
        sum += ratioOf(entries[end]);
        const count = end - start + 1, available = width - gap * (count - 1);
        if (available <= 0) break;
        const height = available / sum;
        const tiles = entries.slice(start, end + 1).map((entry) => ({ entry, height, width: height * ratioOf(entry) }));
        const sizePenalty = Math.log(height / target) ** 2;
        const tiny = tiles.reduce((score, tile) => score + Math.max(0, Math.log(Math.min(80, width * .2) / tile.width)) ** 2, 0);
        const extreme = Math.max(0, Math.log(height / (target * 1.6))) ** 2 + Math.max(0, Math.log(target * .55 / height)) ** 2;
        const singleton = count === 1 && entries.length > 1 ? (sum < 1 ? 12 : sum < 2.4 ? 1.8 : 0) : 0;
        // Weight per element so extra rows cannot make a poor composition artificially cheaper.
        const score = count * (sizePenalty + 3 * extreme) + 2 * tiny + singleton + best[end + 1].score;
        if (!best[start] || score < best[start].score) best[start] = { score, rows: [{ height, tiles }, ...best[end + 1].rows] };
      }
    }
    return best[0]?.rows || [];
  }
  function choosePoster(sources, width, height, dpr = 1) {
    const core = scope.ClipRedMediaGrid;
    const first = sources.find((source) => !source.failed && core.hasSize(source));
    if (!first) return { source: null, sufficient: false };
    const ratio = first.width / first.height;
    const demandWidth = Math.max(width, height * ratio);
    return core.selectSource(sources.filter((source) => core.ratioMatches(source.width / source.height, ratio)), demandWidth, demandWidth / ratio, dpr);
  }
  class VideoGallery {
    constructor(gallery, entries, settings, measurements, report) {
      Object.assign(this, { gallery, entries, settings, measurements, report });
      this.active = true; this.cursor = entries.length; this.postersSettled = false;
      this.frames = new Map(); this.visible = []; this.mountCount = 0; this.fades = [];
      this.feedback = element('div', 'lab-pdf-feedback lab-video-feedback');
      const spinner = element('span', 'lab-spinner'); spinner.setAttribute('aria-hidden', 'true');
      this.status = element('p', 'lab-pdf-status', 'Загрузка 0%'); this.status.setAttribute('role', 'status');
      this.status.setAttribute('aria-live', 'polite'); this.feedback.append(spinner, this.status);
      gallery.replaceChildren(this.feedback); gallery.setAttribute('aria-busy', 'true');
      this.onResize = () => this.scheduleResize(); window.addEventListener('resize', this.onResize, { passive: true });
      if (scope.ResizeObserver) {
        this.observer = new scope.ResizeObserver(() => { if (this.gallery.clientWidth !== this.width) this.scheduleResize(); });
        this.observer.observe(gallery);
      }
      this.postersReady = this.prepare();
    }
    prepare() {
      if (this.pending) return this.pending;
      this.batch = new scope.ClipRedV11Previews.PreviewBatch(this.measurements, () => this.active,
        () => !this.gallery.hidden, this.report);
      this.pending = this.batch.prepare(this.entries, (progress) => {
        this.progress = progress;
        if (this.active) this.status.textContent = `Загрузка ${progress.percent}%`;
      }).then((results) => {
        if (!this.active) return;
        const used = new Set();
        this.preparedEntries = results.filter(({ entry, record }) => {
          const identity = entry.clips?.[0]?.path || entry.clips?.[0]?.full || entry.key;
          if (!valid(entry.videoRatio) || !record || used.has(identity)) return false;
          used.add(identity); return true;
        });
        this.visible = this.preparedEntries.map(({ entry }) => entry);
        this.prepared = true; this.postersSettled = true; this.render(); this.onPostersReady?.();
      });
      return this.pending;
    }
    sequence() { return this.visible.slice(); }
    render() {
      if (!this.active || !this.prepared || this.gallery.hidden) return;
      const width = Math.max(1, this.gallery.clientWidth), height = window.innerHeight;
      if (this.shown && width === this.width && height === this.layoutHeight) return;
      this.width = width; this.layoutHeight = height;
      if (!this.shown) {
        this.composition = element('div', 'lab-video-composition');
        Object.assign(this.composition.style, { position: 'relative', width: '100%', flex: 'none' });
        this.preparedEntries.forEach(({ entry, record }) => {
          const frame = button('lab-tile lab-video-tile', '', `Открыть ${entry.title || 'видеопроект'}`);
          frame.entry = entry; frame.dataset.posterState = record.state; frame.style.position = 'absolute';
          const play = element('span', 'lab-play', '▶'); play.setAttribute('aria-hidden', 'true'); frame.append(play);
          if (record.state === 'loaded') {
            // Reuse the measured image once; sharing its node would move it out
            // of the first card. A clone uses the same browser-cached JPG URL.
            const img = record.img.parentElement ? record.img.cloneNode(false) : record.img;
            img.alt = entry.title || 'Видеопроект CLIP.RED'; frame.append(img); frame.classList.add('is-loaded');
          }
          this.composition.append(frame); this.frames.set(entry.key, frame);
        });
      }
      // The original DP chooses rows; positioning updates styles, never replaces tile/IMG nodes.
      let top = 0;
      layout(this.sequence(), width, height, this.settings.gap).forEach((row) => {
        let left = 0;
        row.tiles.forEach((tile) => {
          Object.assign(this.frames.get(tile.entry.key).style,
            { left: `${left}px`, top: `${top}px`, width: `${tile.width}px`, height: `${tile.height}px` });
          left += tile.width + this.settings.gap;
        });
        top += row.height + this.settings.gap;
      });
      this.composition.style.height = `${Math.max(0, top - this.settings.gap)}px`;
      if (!this.shown) {
        if (!this.frames.size) this.composition.append(element('p', 'lab-status', 'Превью пока недоступны. Обновите страницу.'));
        this.gallery.replaceChildren(this.composition); this.shown = true; this.mountCount++;
        this.gallery.setAttribute('aria-busy', 'false');
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (!reduced) [...this.frames.values()].forEach((frame, index, frames) => {
          const delay = frames.length > 1 ? index / (frames.length - 1) * 100 : 0;
          if (frame.animate) this.fades.push(frame.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 320, delay, easing: 'ease-out', fill: 'backwards' }));
          else {
            frame.style.opacity = '0'; frame.style.transition = `opacity 320ms ease-out ${delay}ms`;
            requestAnimationFrame(() => { if (this.active) frame.style.opacity = '1'; });
          }
        });
      }
    }
    deactivate() {
      this.fades.forEach((animation) => { try { animation.finish?.(); } catch { /* Detached animation already ended. */ } });
      this.frames.forEach((frame) => { if (!frame.animate) { frame.style.transition = 'none'; frame.style.opacity = '1'; } });
    }
    visibleEntries() { return this.sequence(); }
    scheduleResize() {
      if (this.queued) return; this.queued = true;
      requestAnimationFrame(() => { this.queued = false; if (this.active) this.render(); });
    }
    refresh() { this.measurements.queue.wake(); this.render(); }
    // Player metadata remains operational, but cannot overwrite the JPG-authoritative gallery.
    updateRatio() {}
    destroy() { this.active = false; this.measurements.queue.wake(); this.observer?.disconnect(); window.removeEventListener('resize', this.onResize); }
  }
  scope.ClipRedV09VideoGrid = Object.freeze({ layout, ratioOf, choosePoster, VideoGallery });
})(globalThis);

(function (scope) {
  'use strict';
  const { element } = scope.ClipRedV09UI;
  const fields = [
    ['client', 'Заказчик'], ['year', 'Год'], ['description', 'Описание'],
    ['task', 'Задача'], ['creativeSolution', 'Творческое решение'],
    ['technicalImplementation', 'Техническая реализация'], ['studioWork', 'Выполненные работы'], ['participants', 'Участники']
  ];
  function content(value) {
    if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
    if (Array.isArray(value)) return value.map((item) => {
      if (typeof item === 'string') return item.trim();
      if (item && typeof item === 'object') return [item.name, item.role].filter(Boolean).join(' — ');
      return '';
    }).filter(Boolean).join('\n');
    return '';
  }
  const toolBadges = new Map([
    ['DaVinci Resolve', 'DR'], ['Adobe Premiere Pro', 'Pr'],
    ['Adobe After Effects', 'Ae'], ['Adobe Creative Cloud', 'CC'], ['ComfyUI', 'C']
  ]);
  function renderTools(value) {
    const names = Array.isArray(value) ? [...new Set(value.filter((name) => toolBadges.has(name)))] : [];
    if (!names.length) return null;
    const section = element('section', 'v09-info-section v12-tools');
    const list = element('ul', 'v12-tools-list'); list.setAttribute('role', 'list');
    names.forEach((name) => {
      const item = element('li', 'v12-tool');
      const badge = element('span', 'v12-tool-badge', toolBadges.get(name));
      badge.setAttribute('aria-hidden', 'true');
      item.append(badge, element('span', 'v12-tool-name', name)); list.append(item);
    });
    section.append(element('h3', 'v09-label', 'Инструменты'), list); return section;
  }
  function renderInfo(entry) {
    const panel = element('aside', 'v09-info');
    panel.setAttribute('aria-label', 'О проекте');
    const title = content(entry.title);
    if (title) panel.append(element('h2', 'v09-title', title));
    if (entry.demo) {
      panel.append(element('p', 'v09-label', entry.demo.notice));
      entry.demo.paragraphs.forEach((text) => {
        const section = element('section', 'v09-info-section');
        section.append(element('p', 'v09-text', text)); panel.append(section);
      });
    }
    fields.forEach(([key, label]) => {
      if (entry.demo && key === 'description') return;
      const text = content(entry.project[key]);
      if (!text) return;
      const section = element('section', 'v09-info-section');
      section.append(element('h3', 'v09-label', label), element('p', 'v09-text', text));
      panel.append(section);
    });
    const tools = renderTools(entry.project.tools);
    if (tools) panel.append(tools);
    if (panel.childElementCount) panel.tabIndex = 0;
    return panel;
  }
  scope.ClipRedV09Info = Object.freeze({ content, renderInfo });
})(globalThis);

(function (scope) {
  'use strict';
  const { element, button } = scope.ClipRedV09UI;
  class PhotoViewer {
    constructor(overlay, sequence, extend) {
      Object.assign(this, { overlay, sequence, extend });
      this.version = 0;
    }
    open(entry) {
      this.overlay.open('photo', 'Просмотр фотографий', () => {
        this.version += 1;
        this.image.removeAttribute('src');
        this.image.onload = this.image.onerror = null;
      }, (event) => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault(); this.move(event.key === 'ArrowRight' ? 1 : -1);
        }
      });
      this.image = element('img', 'v09-photo-image');
      this.image.decoding = 'async';
      this.image.addEventListener('click', () => this.move(1));
      this.previous = button('v09-previous v09-control', '‹', 'Предыдущая фотография');
      this.next = button('v09-next v09-control', '›', 'Следующая фотография');
      this.previous.addEventListener('click', () => this.move(-1));
      this.next.addEventListener('click', () => this.move(1));
      this.status = element('p', 'v09-photo-status');
      this.status.setAttribute('role', 'status');
      this.overlay.node.append(this.image, this.previous, this.next, this.status);
      this.show(entry);
    }
    show(entry) {
      this.current = entry;
      this.status.textContent = '';
      this.image.alt = entry.title || 'Фотография CLIP.RED';
      this.image.onerror = () => { this.status.textContent = 'Не удалось загрузить фотографию. Перейдите к следующей.'; };
      this.image.onload = () => { this.status.textContent = ''; };
      // Only full, never a preview substituted for the selected photograph.
      this.image.src = entry.full;
    }
    async move(delta) {
      if (this.moving) return;
      this.moving = true;
      const version = this.version;
      try {
        let items = this.sequence();
        let index = items.findIndex((item) => item.key === this.current.key);
        if ((delta > 0 && index === items.length - 1) || (delta < 0 && index === 0)) {
          await this.extend(delta);
          if (version !== this.version || !this.overlay.opened) return;
          items = this.sequence();
          index = items.findIndex((item) => item.key === this.current.key);
        }
        const next = scope.ClipRedV09Data.nextIndex(index, delta, items.length);
        if (next >= 0) this.show(items[next]);
      } finally { this.moving = false; }
    }
  }
  scope.ClipRedV09Photos = Object.freeze({ PhotoViewer });
})(globalThis);

(function (scope) {
  'use strict';
  const { element, button } = scope.ClipRedV09UI;
  function fitMedia(ratio, width, height) {
    if (!(Number.isFinite(ratio) && ratio > 0 && width > 0 && height > 0)) return null;
    const w = Math.min(width, height * ratio); return { width: w, height: w / ratio };
  }
  class VideoViewer {
    constructor(overlay, onMetadata, sequence) {
      Object.assign(this, { overlay, onMetadata, sequence }); this.version = 0;
    }
    isFullscreen() {
      return Boolean(document.fullscreenElement || document.webkitFullscreenElement || this.video?.webkitDisplayingFullscreen || this.nativeFullscreen);
    }
    open(entry) {
      this.overlay.open('video', entry.title || 'Видеопроект', () => this.release(), (event) => {
        if (this.isFullscreen() || ['VIDEO', 'video'].includes(event.target?.tagName)) return;
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
          event.preventDefault(); this.move(event.key === 'ArrowRight' ? 1 : -1);
        }
      });
      this.overlay.blocksEscape = () => this.isFullscreen() || Date.now() < (this.fullscreenExitedAt || 0) + 300;
      this.previous = button('v09-project-previous v09-control', '‹', 'Предыдущий проект');
      this.next = button('v09-project-next v09-control', '›', 'Следующий проект');
      this.previous.addEventListener('click', () => this.move(-1));
      this.next.addEventListener('click', () => this.move(1));
      this.layout = element('div', 'v09-video-layout');
      this.media = element('div', 'v09-media'); this.stage = element('div', 'v09-stage');
      this.switcher = element('nav', 'v09-clips'); this.switcher.setAttribute('aria-label', 'Ролики проекта');
      this.media.append(this.stage, this.switcher); this.layout.append(this.media);
      this.overlay.node.append(this.previous, this.next, this.layout);
      this.show(entry);
    }
    show(entry) {
      this.release(); this.entry = entry;
      this.overlay.node.setAttribute('aria-label', entry.title || 'Видеопроект'); this.overlay.node.scrollTop = 0;
      this.info?.remove(); this.info = scope.ClipRedV09Info.renderInfo(entry); this.layout.append(this.info); this.info.scrollTop = 0;
      this.switcher.replaceChildren(); this.switcher.hidden = entry.clips.length < 2;
      entry.clips.forEach((clip, index) => {
        const control = button('v09-clip', `Ролик ${index + 1}`, `Ролик ${index + 1} из ${entry.clips.length}`);
        control.addEventListener('click', () => this.select(index)); this.switcher.append(control);
      });
      this.select(0);
    }
    move(delta) {
      if (this.isFullscreen()) return;
      const items = this.sequence(), index = items.findIndex((entry) => entry.key === this.entry.key);
      const next = scope.ClipRedV09Data.nextIndex(index, delta, items.length);
      if (next >= 0) this.show(items[next]);
    }
    fit() {
      if (!this.stage || this.isFullscreen()) return;
      const rect = this.stage.getBoundingClientRect();
      const width = this.stage.clientWidth || rect.width, height = this.stage.clientHeight || rect.height;
      const clip = this.entry.clips[this.index];
      const box = fitMedia(clip.ratio || clip.layoutRatio || 16 / 9, width, height);
      if (box && this.video) Object.assign(this.video.style, { width: `${box.width}px`, height: `${box.height}px` });
      if (this.poster) {
        const ratio = this.poster.naturalWidth && this.poster.naturalHeight ? this.poster.naturalWidth / this.poster.naturalHeight :
          scope.ClipRedV09Data.aspect(clip.posterMetadata?.aspectRatio) || (clip.posterMetadata?.width && clip.posterMetadata?.height ? clip.posterMetadata.width / clip.posterMetadata.height : null);
        const posterBox = fitMedia(ratio, width, height);
        if (posterBox) Object.assign(this.poster.style, { width: `${posterBox.width}px`, height: `${posterBox.height}px` });
      }
    }
    select(index) {
      this.release(); this.index = index; this.started = false; this.revealed = false; this.playing = false; this.poster = null;
      this.stage.classList.remove('is-frame-ready'); this.stage.classList.add('is-preparing');
      const token = this.version, clip = this.entry.clips[index];
      [...this.switcher.children].forEach((control, i) => control.setAttribute('aria-pressed', String(i === index)));
      this.stage.style.setProperty('--v09-ratio', clip.ratio || clip.layoutRatio || 16 / 9);
      this.stage.style.setProperty('--v09-stage-ratio', clip.ratio || clip.layoutRatio || 16 / 9); this.stage.replaceChildren();
      this.cover = element('div', 'v09-poster-cover');
      const posterURL = clip.poster || (index === 0 ? this.entry.sources.find((source) => !source.failed)?.url : '');
      if (posterURL) {
        const poster = element('img', 'v09-project-poster'); poster.alt = this.entry.title || 'Видеопроект';
        poster.draggable = false; this.poster = poster;
        poster.addEventListener('load', () => { if (token === this.version) this.fit(); }, { once: true });
        poster.src = posterURL; this.cover.append(poster);
        poster.addEventListener('error', () => poster.remove(), { once: true });
      }
      this.playButton = button('v09-play-button', '▶', 'Воспроизвести со звуком');
      this.playButton.addEventListener('click', () => this.start());
      this.message = element('p', 'v09-video-message'); this.message.setAttribute('role', 'status');
      this.buffering = element('span', 'v09-buffering lab-spinner'); this.buffering.hidden = true; this.buffering.setAttribute('aria-hidden', 'true');
      this.cover.append(this.playButton, this.buffering); this.stage.append(this.cover, this.message);
      const video = element('video', 'v09-video-element');
      video.controls = true; video.playsInline = true; video.preload = 'auto'; video.muted = false; video.volume = 1;
      video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', '');
      video.setAttribute('aria-label', this.entry.title || 'Видео CLIP.RED'); this.video = video;
      this.stopObserving = scope.ClipRedMediaGrid.observeVideoMetadata(video, (dimensions) => {
        if (token !== this.version) return;
        clip.ratio = dimensions.ratio; this.stage.style.setProperty('--v09-ratio', dimensions.ratio);
        if (!this.started) this.stage.style.setProperty('--v09-stage-ratio', dimensions.ratio);
        this.fit(); this.revealFrame(token); this.onMetadata(this.entry, clip, this.index, dimensions);
      });
      const listen = (node, event, handler) => {
        node.addEventListener(event, handler); this.listeners.push(() => node.removeEventListener(event, handler));
      };
      this.listeners = [];
      listen(video, 'playing', () => {
        if (token !== this.version) return;
        this.playing = true; this.revealFrame(token);
      });
      listen(video, 'waiting', () => {
        if (token !== this.version || !this.started) return;
        this.buffering.hidden = this.revealed; this.message.textContent = 'Загрузка…';
      });
      listen(video, 'loadeddata', () => this.revealFrame(token));
      listen(video, 'canplay', () => {
        if (token !== this.version) return;
        if (this.revealed) this.message.textContent = '';
        this.revealFrame(token);
      });
      listen(video, 'pause', () => { if (token === this.version && this.revealed) this.message.textContent = ''; });
      listen(video, 'error', () => {
        if (token !== this.version) return;
        this.restoreCover('Видео недоступно. Нажмите Play, чтобы повторить.');
      });
      // Fullscreen is an explicit separate gesture, never a side effect of Play.
      listen(video, 'dblclick', (event) => { event.preventDefault(); this.fullscreen(video, token); });
      listen(video, 'webkitbeginfullscreen', () => { if (token === this.version) this.nativeFullscreen = true; });
      listen(video, 'webkitendfullscreen', () => {
        if (token === this.version) { this.nativeFullscreen = false; this.fullscreenExitedAt = Date.now(); this.fit(); }
      });
      const onFullscreen = () => {
        if (token !== this.version) return;
        const current = document.fullscreenElement || document.webkitFullscreenElement;
        if (current === video) this.nativeFullscreen = true;
        else if (this.nativeFullscreen) { this.nativeFullscreen = false; this.fullscreenExitedAt = Date.now(); this.fit(); }
      };
      listen(window, 'resize', () => this.fit());
      if (scope.ResizeObserver) { this.sizeObserver = new scope.ResizeObserver(() => this.fit()); this.sizeObserver.observe(this.stage); }
      listen(document, 'fullscreenchange', onFullscreen); listen(document, 'webkitfullscreenchange', onFullscreen);
      this.stage.prepend(video);
      video.src = clip.full; video.load(); this.fit();
      // Only this selected source is attached. No play, next-source preload, or autoplay.
    }
    restoreCover(message) {
      this.revealed = false; this.playing = false; this.started = false;
      this.cover.hidden = false; this.playButton.hidden = false; this.buffering.hidden = true;
      this.stage.classList.remove('is-frame-ready'); this.stage.classList.add('is-preparing');
      this.message.textContent = message;
      if (this.frameRequest != null) this.video?.cancelVideoFrameCallback?.(this.frameRequest);
      this.frameRequest = null;
    }
    revealFrame(token, presented = false) {
      const video = this.video;
      if (token !== this.version || !video || !this.started || this.revealed || !this.playing ||
          !(video.videoWidth > 0 && video.videoHeight > 0 && video.readyState >= 2)) return;
      // Prefer a frame delivered to the compositor. Older browsers use playing + HAVE_CURRENT_DATA.
      if (!presented && video.requestVideoFrameCallback) {
        if (this.frameRequest == null) this.frameRequest = video.requestVideoFrameCallback(() => {
          if (token !== this.version || this.video !== video) return;
          this.frameRequest = null; this.revealFrame(token, true);
        });
        return;
      }
      this.fit(); this.revealed = true; this.buffering.hidden = true; this.message.textContent = '';
      this.stage.classList.remove('is-preparing'); this.stage.classList.add('is-frame-ready');
    }
    start() {
      if (!this.video) return;
      const token = this.version;
      this.started = true; this.playButton.hidden = true; this.buffering.hidden = false;
      this.video.muted = false; this.video.volume = 1;
      if (this.video.error) this.video.load();
      this.message.textContent = 'Загрузка…';
      const blocked = () => {
        if (token !== this.version) return;
        this.restoreCover('Нажмите Play, чтобы повторить воспроизведение.');
      };
      // Synchronous in the click handler, with no intervening await, animation or fullscreen call.
      try { this.video.play()?.catch(blocked); } catch { blocked(); }
    }
    fullscreen(video, token) {
      if (token !== this.version || this.video !== video) return;
      try {
        if (video.requestFullscreen) video.requestFullscreen()?.catch?.(() => {});
        else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen()?.catch?.(() => {});
        else if (video.webkitEnterFullscreen) {
          video.webkitEnterFullscreen();
        }
      } catch {
        // Older iOS may need metadata first. Inline playback remains available;
        // the native fullscreen control supplies a fresh user gesture after load.
      }
    }
    release() {
      const wasFullscreen = this.isFullscreen();
      this.version += 1; this.stopObserving?.(); this.stopObserving = null;
      this.listeners?.forEach((remove) => remove()); this.listeners = []; this.sizeObserver?.disconnect(); this.sizeObserver = null;
      const video = this.video;
      if (this.frameRequest != null) video?.cancelVideoFrameCallback?.(this.frameRequest);
      this.frameRequest = null; this.video = null;
      if (!video) return;
      if (wasFullscreen) {
        try {
          const result = document.exitFullscreen?.() || document.webkitExitFullscreen?.(); result?.catch?.(() => {});
          video.webkitExitFullscreen?.();
        } catch { /* The UA may have exited already. */ }
      }
      this.nativeFullscreen = false;
      video.pause(); video.removeAttribute('src'); video.load(); video.remove();
    }
  }
  scope.ClipRedV09Video = Object.freeze({ fitMedia, VideoViewer });
})(globalThis);

(function (scope) {
  'use strict';
  const registry = scope.ClipRedV09CatalogRequests || new Map();
  scope.ClipRedV09CatalogRequests = registry;
  const safePath = (value) => typeof value === 'string' && value.length > 0 && !value.startsWith('/') &&
    !value.includes('\\') && !/[\u0000-\u001f]/.test(value) && value.split('/').every((part) => part && part !== '..' && !part.startsWith('.'));
  function fileURL(base, path) {
    if (!safePath(path)) throw new TypeError('Invalid media path');
    return base.replace(/\/?$/, '/') + path.split('/').map(encodeURIComponent).join('/');
  }
  function validateManifest(value, config) {
    if (!value || value.schemaVersion !== 1 || value.repository !== `${config.repository.owner}/${config.repository.name}` ||
        value.branch !== config.repository.branch || !Array.isArray(value.files)) throw new Error('Invalid manifest');
    const seen = new Set();
    const files = value.files.filter((item) => item && safePath(item.path) && !seen.has(item.path) && seen.add(item.path)).map((item) => {
      const record = { path: item.path };
      if (typeof item.sha === 'string' && /^[a-f0-9]{40,64}$/i.test(item.sha)) record.sha = item.sha;
      for (const key of ['width', 'height']) if (Number.isFinite(item[key]) && item[key] > 0) record[key] = item[key];
      if (safePath(item.previewPath) && item.previewPath.startsWith(config.directories.photo + '/')) record.previewPath = item.previewPath;
      if (item.videoMetadata && Number.isFinite(item.videoMetadata.width) && item.videoMetadata.width > 0 && Number.isFinite(item.videoMetadata.height) && item.videoMetadata.height > 0) record.videoMetadata = { width: item.videoMetadata.width, height: item.videoMetadata.height };
      return record;
    });
    return { schemaVersion: 1, repository: value.repository, branch: value.branch, complete: value.complete !== false, files };
  }
  function treeManifest(tree, config) {
    if (!tree || !Array.isArray(tree.tree) || tree.truncated) throw new Error('Incomplete GitHub tree');
    return validateManifest({ schemaVersion: 1, repository: `${config.repository.owner}/${config.repository.name}`, branch: config.repository.branch,
      files: tree.tree.filter((item) => item.type === 'blob' && item.mode !== '120000').map((item) => ({ path: item.path, sha: item.sha })) }, config);
  }
  const readable = (name) => name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() || name;
  function discover(manifest, editorial, config) {
    const issues = [], posterAudit = [], files = manifest.files;
    const direct = (item, directory) => item.path.startsWith(directory + '/') && item.path.split('/').length === 2;
    const videos = files.filter((item) => direct(item, config.directories.video) && /\.mp4$/i.test(item.path));
    const posters = files.filter((item) => direct(item, config.directories.video) && /_preview\.jpe?g$/i.test(item.path));
    const stem = (path) => path.split('/').pop().replace(/\.mp4$/i, '').normalize('NFC');
    const counts = new Map(), fold = new Map();
    videos.forEach((item) => { const key = stem(item.path); counts.set(key, (counts.get(key) || 0) + 1); const lower = key.toLowerCase(); fold.set(lower, (fold.get(lower) || 0) + 1); });
    const aliases = new Map();
    editorial.projects.forEach((project) => project.files.forEach((file) => {
      const key = file.normalize('NFC'); const list = aliases.get(key) || []; list.push(project); aliases.set(key, list);
    }));
    const projects = videos.map((item) => {
      const name = item.path.split('/').pop(), key = stem(item.path);
      const matches = aliases.get(name.normalize('NFC')) || [];
      // Case-insensitive editorial matching only when both aliases and files are unambiguous.
      const possible = matches.length ? matches : editorial.projects.filter((project) => project.files.some((file) => file.normalize('NFC').toLowerCase() === name.normalize('NFC').toLowerCase()));
      const known = possible.length === 1 && fold.get(key.toLowerCase()) === 1 ? possible[0] : null;
      if (possible.length > 1) issues.push({ code: 'editorial-conflict', path: item.path });
      if (fold.get(key.toLowerCase()) > 1) issues.push({ code: 'case-name-conflict', path: item.path });
      const candidates = posters.filter((poster) => poster.path.split('/').pop().replace(/_preview\.jpe?g$/i, '').normalize('NFC') === key);
      let cover = '', posterPath = '', posterSource = 'api-or-manifest';
      if (candidates.length === 1 && counts.get(key) === 1) { posterPath = candidates[0].path; cover = fileURL(config.rawBase, posterPath); }
      else if (candidates.length > 1 || counts.get(key) > 1) issues.push({ code: 'poster-conflict', path: item.path });
      else if (posters.some((poster) => poster.path.split('/').pop().replace(/_preview\.jpe?g$/i, '').normalize('NFC').toLowerCase() === key.toLowerCase())) issues.push({ code: 'poster-case-mismatch', path: item.path });
      const confirmed = config.confirmedPosters?.[item.path];
      // Explicit owner mapping wins even when the regular same-stem JPG exists.
      // Membership in posters also enforces a direct, catalogued JPG/JPEG path.
      if (counts.get(key) === 1 && safePath(confirmed) && posters.some((poster) => poster.path === confirmed)) {
        posterPath = confirmed; cover = fileURL(config.rawBase, confirmed); posterSource = 'owner-confirmed';
      }
      if (!cover) issues.push({ code: 'missing-poster', path: item.path });
      posterAudit.push({ videoPath: item.path, videoURL: fileURL(config.rawBase, item.path),
        posterPath, posterURL: cover, source: cover ? posterSource : '', candidates: candidates.map((poster) => poster.path),
        mapping: cover ? 'matched' : candidates.length > 1 || counts.get(key) > 1 ? 'conflict' :
          issues.some((issue) => issue.path === item.path && issue.code === 'poster-case-mismatch') ? 'case-mismatch' : 'not-found',
        loadState: cover ? 'not-requested' : 'not-found' });
      const id = `file:${item.path}`;
      return { ...(known || {}), id, editorialId: known?.id || '', title: known?.title || readable(name), cover,
        videos: [{ id: `${id}:v1`, full: fileURL(config.rawBase, item.path), poster: cover,
          path: item.path, sha: item.sha || '', aspectRatio: null, layoutAspectRatio: null,
          metadata: item.videoMetadata || (Number.isFinite(item.width) && item.width > 0 && Number.isFinite(item.height) && item.height > 0 ? { width: item.width, height: item.height } : {}) }] };
    });
    Object.keys(config.confirmedPosters || {}).forEach((path) => {
      if (!safePath(path) || !path.startsWith(config.directories.video + '/') || !/\.mp4$/i.test(path) || videos.some((item) => item.path === path)) return;
      issues.push({ code: 'confirmed-video-not-found', path });
      posterAudit.push({ videoPath: path, videoURL: '', posterPath: '', posterURL: '', source: 'owner-confirmed',
        candidates: [], mapping: 'video-not-found', loadState: 'video-not-found' });
    });
    const photos = files.filter((item) => direct(item, config.directories.photo) && /\.webp$/i.test(item.path)).map((item) => ({
      id: `file:${item.path}`, title: '', full: fileURL(config.rawBase, item.path),
      preview: item.previewPath ? fileURL(config.rawBase, item.previewPath) : '',
      width: item.width || 0, height: item.height || 0
    }));
    return { projects: { projects }, photos: { photos }, issues, posterAudit };
  }
  class CatalogClient {
    constructor(config, fallback, options = {}) {
      Object.assign(this, { config, fallback }); this.fetch = options.fetch || scope.fetch.bind(scope); this.storage = options.storage;
      this.now = options.now || Date.now; this.inflight = null; this.nextRetry = 0;
      this.key = `clipred:catalog:2:${config.repository.owner}/${config.repository.name}:${config.repository.branch}`;
    }
    cached() {
      try { const value = JSON.parse(this.storage?.getItem(this.key) || 'null');
        if (!value || !Number.isFinite(value.time)) return null;
        return { time: value.time, manifest: validateManifest(value.manifest, this.config),
          revision: typeof value.revision === 'string' ? value.revision : '',
          refreshRevision: typeof value.refreshRevision === 'string' ? value.refreshRevision : '',
          refreshUntil: Number.isFinite(value.refreshUntil) ? value.refreshUntil : 0 };
      } catch { return null; }
    }
    async json(url) {
      const controller = scope.AbortController ? new scope.AbortController() : null;
      let timer;
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { controller?.abort(); reject(new Error('Request timeout')); }, this.config.requestTimeout); });
      try {
        const response = await Promise.race([this.fetch(url, { signal: controller?.signal, headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit', referrerPolicy: 'no-referrer' }), timeout]);
        if (!response.ok) {
          const error = new Error(response.status === 403 || response.status === 429 ? 'GitHub rate limit' : 'Catalog request failed');
          if (response.status === 403 || response.status === 429) {
            const reset = Number(response.headers?.get('x-ratelimit-reset')) * 1000;
            const retry = Number(response.headers?.get('retry-after')) * 1000;
            this.nextRetry = Math.max(this.now() + 60000, Number.isFinite(reset) ? reset : 0, this.now() + (Number.isFinite(retry) ? retry : 0));
          }
          throw error;
        }
        return await Promise.race([response.json(), timeout]);
      } finally { clearTimeout(timer); }
    }
    load(force = false) {
      if (this.inflight) return this.inflight;
      const cached = this.cached();
      const revision = this.config.catalogRevision || '';
      const current = !revision || cached?.revision === revision;
      // Refresh a pre-V0.16 cache once; never mark stale data as newly validated.
      if (!force && cached) {
        if (current && this.now() - cached.time < this.config.cacheTTL) return Promise.resolve({ ...cached, source: 'cache', degraded: false });
        if (!current && cached.refreshRevision === revision && this.now() < cached.refreshUntil)
          return Promise.resolve({ ...cached, source: 'stale-cache', degraded: true, retryAt: cached.refreshUntil });
      }
      if (this.now() < this.nextRetry) return Promise.resolve({ manifest: cached?.manifest || validateManifest(this.fallback, this.config), source: cached ? 'stale-cache' : 'embedded-manifest', degraded: true, retryAt: this.nextRetry });
      const registryKey = this.config.apiURL;
      let job = registry.get(registryKey);
      if (!job) {
        job = this.json(this.config.apiURL).then((value) => treeManifest(value, this.config));
        registry.set(registryKey, job); job.finally(() => { if (registry.get(registryKey) === job) registry.delete(registryKey); }).catch(() => {});
      }
      this.inflight = (async () => {
        try {
          const manifest = await job, time = this.now();
          try { this.storage?.setItem(this.key, JSON.stringify({ time, manifest, revision })); } catch { /* Optional cache. */ }
          return { manifest, time, source: 'github', degraded: false };
        } catch {
          if (cached) {
            const refreshUntil = Math.max(this.now() + 60000, this.nextRetry);
            if (!current) {
              try { this.storage?.setItem(this.key, JSON.stringify({ ...cached, refreshRevision: revision, refreshUntil })); } catch { /* In-memory fallback still works. */ }
            }
            return { ...cached, source: 'stale-cache', degraded: true, retryAt: !current ? refreshUntil : this.nextRetry };
          }
          try { return { manifest: validateManifest(await this.json(this.config.manifestURL), this.config), source: 'remote-manifest', degraded: true, retryAt: this.nextRetry }; }
          catch { return { manifest: validateManifest(this.fallback, this.config), source: 'embedded-manifest', degraded: true, retryAt: this.nextRetry }; }
        }
      })().finally(() => { this.inflight = null; });
      return this.inflight;
    }
  }
  scope.ClipRedV09Catalog = Object.freeze({ safePath, fileURL, validateManifest, treeManifest, discover, readable, CatalogClient });
})(globalThis);

(function (scope) {
  'use strict';
  const { element, button } = scope.ClipRedV09UI;
  let library;
  async function loadLibrary(config) {
    if (!library) {
      library = (async () => {
        // PDF.js 4.x expects this standard Promise helper in older Safari.
        if (!Promise.withResolvers) Promise.withResolvers = function () { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
        const api = await import(config.module);
        if (api.version !== config.version) throw new Error('PDF library version mismatch');
        api.GlobalWorkerOptions.workerSrc = config.worker; return api;
      })().catch((error) => { library = null; throw error; });
    }
    return library;
  }
  function renderSize(width, pageWidth, pageHeight, dpr = 1, maxPixels = 8000000) {
    const cssWidth = Math.max(1, width), cssHeight = cssWidth * pageHeight / pageWidth;
    const density = Math.min(2, Math.max(1, dpr), Math.sqrt(maxPixels / (cssWidth * cssHeight)));
    return { cssWidth, cssHeight, scale: cssWidth / pageWidth * density, width: Math.max(1, Math.floor(cssWidth * density)), height: Math.max(1, Math.floor(cssHeight * density)) };
  }
  class PDFViewer {
    constructor(container, url, title, config, options = {}) {
      Object.assign(this, { container, url, title, config }); this.getLibrary = options.getLibrary || loadLibrary;
      this.pages = []; this.running = 0; this.generation = 0; this.active = false; this.nextPage = 1;
      this.feedback = element('div', 'lab-pdf-feedback');
      this.spinner = element('span', 'lab-spinner'); this.spinner.setAttribute('aria-hidden', 'true');
      this.status = element('p', 'lab-pdf-status', 'Загрузка...'); this.status.setAttribute('role', 'status'); this.status.setAttribute('aria-live', 'polite');
      this.retry = button('lab-retry', 'Повторить', 'Повторить'); this.retry.hidden = true; this.retry.addEventListener('click', () => this.open());
      this.feedback.append(this.spinner, this.status, this.retry);
      this.list = element('div', 'lab-pdf-pages'); this.list.setAttribute('aria-label', title);
      this.list.style.visibility = 'hidden'; container.replaceChildren(this.feedback, this.list);
      this.onScroll = () => this.refresh(); this.onResize = () => this.resize();
      window.addEventListener('scroll', this.onScroll, { passive: true }); window.addEventListener('resize', this.onResize, { passive: true });
      if (scope.ResizeObserver) { this.resizeObserver = new scope.ResizeObserver(this.onResize); this.resizeObserver.observe(container); }
      if (scope.IntersectionObserver) {
        this.observer = new scope.IntersectionObserver(() => this.refresh(), { rootMargin: '800px' });
      }
    }
    showLoading() {
      this.feedback.hidden = !this.active || this.firstPaint === true;
      this.spinner.hidden = false; this.retry.hidden = true; this.status.textContent = 'Загрузка...';
      this.container.setAttribute('aria-busy', String(!this.firstPaint));
    }
    fail(message = 'Не удалось загрузить документ.') {
      if (this.destroyed) return;
      this.failed = true; this.feedback.hidden = !this.active;
      this.spinner.hidden = true; this.status.textContent = message; this.retry.hidden = false;
      this.container.setAttribute('aria-busy', 'false');
    }
    progress({ loaded, total }) {
      if (this.firstPaint || this.failed || this.destroyed) return;
      this.status.textContent = Number.isFinite(total) && total > 0 && Number.isFinite(loaded) && loaded >= 0
        ? `Загрузка ${Math.min(100, Math.floor(loaded / total * 100))}%` : 'Загрузка...';
    }
    open() {
      this.active = true; this.failed = false; if (!this.width) this.width = this.container.clientWidth;
      this.showLoading();
      if (this.doc) { this.pages.forEach((record) => { if (!record.canvas) record.attempts = 0; }); this.prepare(); this.resize(); this.refresh(); return Promise.resolve(); }
      if (this.loading) return this.loading;
      this.loading = (async () => {
        try {
          const api = await this.getLibrary(this.config);
          if (this.destroyed) return;
          const task = this.loadingTask = api.getDocument({ url: this.url, disableAutoFetch: true, disableStream: true, rangeChunkSize: 262144, isEvalSupported: false });
          task.onProgress = (event) => { if (this.loadingTask === task) this.progress(event); };
          this.doc = await task.promise;
          if (this.destroyed) return;
          if (!(this.doc.numPages > 0)) throw new Error('Empty PDF');
          if (!this.firstPaint) this.status.textContent = 'Загрузка...';
          await this.prepare(); this.refresh();
        } catch {
          this.fail(); this.doc = null;
          try { await this.loadingTask?.destroy?.(); } catch { /* Failed task already released. */ }
        } finally { this.loading = null; }
      })();
      return this.loading;
    }
    async prepare() {
      if (this.preparing || !this.doc) return this.preparing;
      this.preparationFailed = false;
      this.preparing = (async () => {
        // Geometry only, in document order. Canvas is created solely near the viewport.
        while (this.active && this.nextPage <= this.doc.numPages) {
          const number = this.nextPage, page = await this.doc.getPage(number), viewport = page.getViewport({ scale: 1 });
          const node = element('div', 'lab-pdf-page'); node.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
          node.setAttribute('role', 'img'); node.setAttribute('aria-label', `${this.title}, страница ${number}`);
          const record = { number, width: viewport.width, height: viewport.height, node, page, attempts: 0 };
          this.pages.push(record); this.list.append(node); this.nextPage += 1; this.observer?.observe(node);
          this.refresh();
        }
      })().catch(() => {
        this.preparationFailed = true; this.fail('Не удалось показать документ.');
      }).finally(() => { this.preparing = null; });
      return this.preparing;
    }
    near(record) { const rect = record.node.getBoundingClientRect(); return rect.bottom >= -800 && rect.top <= window.innerHeight + 800; }
    refresh() {
      if (!this.active || this.container.hidden) return;
      const wanted = this.pages.filter((record) => (!this.firstPaint && record.number === 1) || this.near(record)).sort((a, b) => {
        const distance = (record) => { const rect = record.node.getBoundingClientRect(); return rect.top <= window.innerHeight && rect.bottom >= 0 ? 0 : Math.min(Math.abs(rect.top), Math.abs(rect.bottom - window.innerHeight)); };
        return (!this.firstPaint ? (a.number === 1 ? -1 : b.number === 1 ? 1 : 0) : 0) || distance(a) - distance(b) || a.number - b.number;
      }).slice(0, 8);
      const keep = new Set(wanted);
      this.pages.filter((record) => !keep.has(record)).forEach((record) => {
        if (record.task) { record.discard = true; record.task.cancel(); }
        else if (record.canvas) { this.releaseCanvas(record); record.attempts = 0; }
      });
      const candidates = wanted.filter((record) => !record.canvas && !record.task && record.attempts < 2);
      while (this.running < 2 && candidates.length && this.pages.filter((record) => record.canvas).length < 8) this.render(candidates.shift());
    }
    async render(record) {
      this.running += 1; const generation = this.generation; record.attempts += 1;
      const canvas = element('canvas', 'lab-pdf-canvas'); const size = renderSize(this.container.clientWidth || 1, record.width, record.height, window.devicePixelRatio || 1);
      canvas.width = size.width; canvas.height = size.height; canvas.setAttribute('aria-hidden', 'true');
      record.canvas = canvas; record.node.replaceChildren(canvas);
      try {
        const viewport = record.page.getViewport({ scale: size.scale });
        record.task = record.page.render({ canvasContext: canvas.getContext('2d'), viewport });
        await record.task.promise;
        record.failed = false; this.failed = Boolean(this.preparationFailed || this.pages.some((page) => page.failed));
        if (generation === this.generation && this.active && !record.discard && record.number === 1) {
          this.firstPaint = true; this.list.style.visibility = 'visible';
          if (!this.failed) this.feedback.hidden = true;
          this.container.setAttribute('aria-busy', 'false');
        }
        if (this.active && this.firstPaint && !this.failed) this.feedback.hidden = true;
      } catch (error) {
        if (error?.name !== 'RenderingCancelledException' && generation === this.generation && this.active) {
          record.failed = true; this.fail('Не удалось показать документ.');
        }
        if (record.canvas === canvas) { canvas.remove(); record.canvas = null; }
      } finally {
        record.task = null; this.running -= 1;
        if ((generation !== this.generation || record.discard) && record.canvas === canvas) this.releaseCanvas(record);
        if (record.discard) { record.discard = false; record.attempts = 0; }
        this.refresh();
      }
    }
    releaseCanvas(record) { record.canvas?.remove(); record.canvas = null; record.page.cleanup?.(); }
    resize() {
      if (!this.active || this.container.hidden) return;
      const width = this.container.clientWidth;
      if (!width || Math.abs(width - (this.width || 0)) < 1) return;
      this.width = width; this.generation += 1;
      this.pages.forEach((record) => { record.task?.cancel(); if (!record.task) this.releaseCanvas(record); record.attempts = 0; }); this.refresh();
    }
    deactivate() {
      this.active = false; this.feedback.hidden = true; this.generation += 1;
      this.pages.forEach((record) => { if (record.task) record.task.cancel(); else this.releaseCanvas(record); record.attempts = 0; });
    }
    destroy() { this.destroyed = true; this.deactivate(); this.observer?.disconnect(); this.resizeObserver?.disconnect(); window.removeEventListener('scroll', this.onScroll); window.removeEventListener('resize', this.onResize); this.doc?.destroy?.(); }
  }
  scope.ClipRedV09PDF = Object.freeze({ renderSize, loadLibrary, PDFViewer });
})(globalThis);

(function (scope) {
  'use strict';
  const { element, button, Overlay } = scope.ClipRedV09UI;
  const nav = scope.ClipRedV09Navigation, data = scope.ClipRedV09Data;
  function init(root, payload, dependencies = {}) {
    if (root.dataset.initialized === 'true') return root.portfolioInstance;
    root.dataset.initialized = 'true';
    const options = payload.config, production = options.production === true;
    const panels = Object.fromEntries([...root.querySelectorAll('[data-gallery]')].map((node) => [node.dataset.gallery, node]));
    const tabs = [...root.querySelectorAll('[data-mode]')], notice = root.querySelector('[data-catalog-notice]');
    const views = {}, positions = {}, issues = new Map(); let posterAudit = []; let mode = nav.readMode(window.location.href), session, sessionLoading, prefetch;
    let storage; try { storage = window.localStorage; } catch { /* Optional. */ }
    const client = dependencies.client || new scope.ClipRedV09Catalog.CatalogClient(options, payload.manifest, { storage });
    const settings = { ...payload.grid.common, ...payload.grid.presets.b, initialBatchSize: 20 };
    const measurements = new scope.ClipRedV09Gallery.ImageMeasurements(settings.concurrency, storage);
    const videoDimensions = dependencies.videoDimensions || new scope.ClipRedV09Metadata.VideoDimensions({ storage, rawBase: options.rawBase, manifest: payload.videoDimensions, ...options.videoMetadata });
    const overlay = new Overlay(root);
    const report = (entry, code, details = {}) => { if (!production) issues.set(`${entry.key}:${code}`, { key: entry.key, code, ...details }); };
    const photos = new scope.ClipRedV09Photos.PhotoViewer(overlay, () => views.gallery?.visibleEntries() || [], async (delta) => {
      const view = views.gallery, count = view.visibleEntries().length;
      while (view.active && view.cursor < view.entries.length) { await view.more(); if (delta > 0 && view.visibleEntries().length > count) break; }
    });
    const videos = new scope.ClipRedV09Video.VideoViewer(overlay, (entry, clip, index, dimensions) => {
      videoDimensions.remember(clip, dimensions);
      if (index === 0) views.video?.updateRatio(entry.key, dimensions.ratio); report(entry, 'video-metadata', dimensions);
    }, () => views.video?.visibleEntries() || []);
    overlay.onStateChange = (opened) => {
      if (opened) { prefetch?.pause(); videoDimensions.pause(); }
      else if (mode === 'video') { videoDimensions.resume(); prefetch?.resume(); }
    };
    function catalogNotice(result) {
      if (!notice) return;
      notice.replaceChildren(); notice.hidden = !result.degraded || !['video', 'gallery'].includes(mode);
      if (!result.degraded) return;
      const text = session && session.video.length + session.photo.length ? 'Показана сохранённая подборка. Каталог сейчас недоступен.' : 'Не удалось получить каталог. Проверьте соединение и повторите загрузку.';
      notice.append(element('p', 'lab-status', text));
      const retry = button('lab-retry', 'Повторить загрузку', 'Повторить загрузку каталога');
      retry.addEventListener('click', async () => {
        retry.disabled = true;
        if (result.retryAt > Date.now()) { notice.append(element('p', 'lab-status', 'Доступ временно ограничен. Попробуйте позже.')); retry.disabled = false; return; }
        const updated = await client.load(true);
        // Once rendered, media order remains fixed for this page instance.
        if (session?.video.length + session?.photo.length) catalogNotice(updated);
        else { session = null; sessionLoading = null; await ensureCatalog(updated); await changeMode(mode, false, false); }
        retry.disabled = false;
      }); notice.append(retry);
    }
    function ensureCatalog(result) {
      if (session) return Promise.resolve(session);
      if (sessionLoading) return sessionLoading;
      sessionLoading = (async () => {
        const loaded = result || await client.load();
        const found = scope.ClipRedV09Catalog.discover(loaded.manifest, payload.editorial, options);
        posterAudit = found.posterAudit;
        session = data.catalogs(found.projects, found.photos, { assets: {} });
        const local = ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname);
        if (!production && local && options.demo?.enabled && root.dataset.embedded !== 'true') {
          const attachDemo = () => {
            session.video.forEach((entry) => { entry.demo = payload.demo?.projects[entry.project.editorialId]; });
            if (overlay.opened && videos.entry?.demo) { videos.info?.remove(); videos.info = scope.ClipRedV09Info.renderInfo(videos.entry); videos.layout.append(videos.info); }
          };
          attachDemo(); payload.demoReady?.then(attachDemo);
        }
        prefetch?.destroy();
        prefetch = new scope.ClipRedV09Prefetch.IdlePhotos(session.photo, measurements,
          () => options.photoPrefetch?.enabled !== false && mode === 'video' && !overlay.opened && Boolean(views.video?.postersSettled));
        catalogNotice(loaded); return session;
      })().finally(() => { sessionLoading = null; }); return sessionLoading;
    }
    async function changeMode(next, updateURL = true, restore = true) {
      if (overlay.opened) overlay.close();
      positions[mode] = window.scrollY;
      if (updateURL) { const href = nav.modeURL(window.location.href, next); if (href !== window.location.href) window.history.pushState(window.history.state, '', href); }
      views[mode]?.deactivate?.(); prefetch?.pause(); videoDimensions.pause(); mode = next;
      if (mode === 'video') videoDimensions.resume();
      tabs.forEach((tab) => { const selected = tab.dataset.mode === next; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; });
      Object.entries(panels).forEach(([key, panel]) => { panel.hidden = key !== next; });
      if (notice) notice.hidden = !['video', 'gallery'].includes(next) || !notice.childElementCount;
      try {
        if (next === 'campaign' || next === 'object') {
          if (!views[next]) {
            const pdf = options.pdf[next];
            views[next] = new scope.ClipRedV09PDF.PDFViewer(panels[next], scope.ClipRedV09Catalog.fileURL(options.rawBase, pdf.path), pdf.title, options.pdfjs, dependencies.pdf || {});
          }
          views[next].open();
        } else {
          panels[next].setAttribute('aria-busy', 'true');
          if (!session && !views[next]) panels[next].replaceChildren(element('p', 'lab-status', 'Загрузка…'));
          const entries = await ensureCatalog(); if (mode !== next) return;
          const items = next === 'video' ? entries.video : entries.photo;
          if (!items.length) {
            panels[next].replaceChildren(element('p', 'lab-status', next === 'video' ? 'Видеопроекты пока недоступны.' : 'Фотографии пока недоступны.'));
            panels[next].setAttribute('aria-busy', 'false');
          } else if (!views[next]) {
            const Gallery = next === 'video' ? scope.ClipRedV09VideoGrid.VideoGallery : scope.ClipRedV09Gallery.JustifiedGallery;
            views[next] = new Gallery(panels[next], items, settings, measurements, report, videoDimensions);
          } else {
            const view = views[next];
            if (Math.abs((view.width || 0) - panels[next].clientWidth) > 1 || (next === 'gallery' && view.dpr !== (window.devicePixelRatio || 1)) || (next === 'video' && view.layoutHeight !== window.innerHeight)) view.scheduleResize();
            view.refresh(); view.maybeMore?.();
          }
          if (next === 'video' && views.video) { views.video.onPostersReady = () => { if (mode === 'video') prefetch.resume(); }; prefetch.resume(); }
        }
        if (restore && mode === next) requestAnimationFrame(() => { if (mode === next) window.scrollTo(0, positions[next] ?? Math.max(0, root.getBoundingClientRect().top + window.scrollY)); });
      } catch {
        panels[next].setAttribute('aria-busy', 'false'); panels[next].replaceChildren(element('p', 'lab-error', 'Не удалось открыть раздел. Обновите страницу.'));
      }
    }
    const prefix = root.id || `clipred-${Math.random().toString(36).slice(2)}`;
    tabs.forEach((tab, index) => {
      tab.id = `${prefix}-tab-${tab.dataset.mode}`; const panel = panels[tab.dataset.mode]; panel.id = `${prefix}-panel-${tab.dataset.mode}`;
      tab.setAttribute('aria-controls', panel.id); panel.setAttribute('aria-labelledby', tab.id);
      tab.addEventListener('click', () => changeMode(tab.dataset.mode));
      tab.addEventListener('keydown', (event) => {
        if (!['Home', 'End', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return; event.preventDefault();
        const target = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[target].focus(); changeMode(tabs[target].dataset.mode);
      });
    });
    window.addEventListener('popstate', () => changeMode(nav.readMode(window.location.href), false));
    root.addEventListener('click', (event) => { const tile = event.target.closest('.lab-tile'); if (!tile?.entry) return; tile.focus({ preventScroll: true }); if (tile.entry.kind === 'video') videos.open(tile.entry); else photos.open(tile.entry); });
    if (options.logo?.src && root.dataset.embedded !== 'true') {
      const brand = root.querySelector('.lab-brand'), logo = element('img', 'lab-brand-image'); logo.alt = options.logo.alt || 'CLIP.RED';
      logo.addEventListener('error', () => { brand.textContent = 'CLIP.RED'; }, { once: true }); logo.src = options.logo.src; brand.replaceChildren(logo);
    }
    const instance = { changeMode, getPosterAudit: () => posterAudit.map((record) => {
      const entry = session?.video.find((item) => item.clips[0].path === record.videoPath);
      return { ...record, loadState: entry?.posterState || record.loadState };
    }), retryVideoDimensions: () => views.video?.prepare(true) }; root.portfolioInstance = instance;
    if (!production) { root.getSessionOrder = () => ({ video: session?.video.map((item) => item.key) || [], gallery: session?.photo.map((item) => item.key) || [] }); root.getMediaQualityReport = () => [...issues.values()]; }
    changeMode(mode, false, false); return instance;
  }
  scope.ClipRedV09App = Object.freeze({ init });
})(globalThis);

const payload={
  "config": {
    "version": "0.16",
    "production": true,
    "repository": {
      "owner": "Hommun",
      "name": "site-assets",
      "branch": "main"
    },
    "rawBase": "https://raw.githubusercontent.com/Hommun/site-assets/main/",
    "apiURL": "https://api.github.com/repos/Hommun/site-assets/git/trees/main?recursive=1",
    "manifestURL": "https://raw.githubusercontent.com/Hommun/site-assets/main/manifest.json",
    "directories": {
      "video": "video",
      "photo": "photo"
    },
    "pdf": {
      "campaign": {
        "path": "Portfolio_AD.pdf",
        "title": "Кампейн"
      },
      "object": {
        "path": "Portfolio_OBJ.pdf",
        "title": "Предметка"
      }
    },
    "pdfjs": {
      "version": "4.10.38",
      "module": "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs",
      "worker": "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs"
    },
    "cacheTTL": 21600000,
    "requestTimeout": 12000,
    "demo": {
      "enabled": false
    },
    "photoPrefetch": {
      "enabled": true
    },
    "logo": {
      "src": "",
      "alt": "CLIP.RED"
    },
    "confirmedPosters": {
      "video/CHGB.mp4": "video/CHGB_preview.jpg",
      "video/CHRB.mp4": "video/CHGB_preview.jpg"
    },
    "catalogRevision": "v016"
  },
  "editorial": {
    "schemaVersion": 1,
    "projects": [
      {
        "id": "p01",
        "title": "Grusha Diamonds — Архангельское",
        "titleStatus": "owner-approved-v013",
        "client": "",
        "year": "",
        "description": "Рекламная fashion-кампания ювелирного бренда Grusha Diamonds, снятая в Архангельском.\n\nПроизводство включало несколько локаций, массовые сцены и работу съёмочной команды численностью около 20 человек. Съёмка проходила в течение одного дня в сложных погодных условиях.\n\nПосле завершения съёмочного этапа была подготовлена дополнительная монтажная версия проекта, а также около 30 адаптаций для различных рекламных форматов, включая медийные размещения и экраны торговых центров.",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "studioWork": [
          "Организация производства",
          "Видеосъёмка",
          "Координация команды",
          "Монтаж",
          "Цветокоррекция",
          "Адаптация рекламных материалов"
        ],
        "participants": [],
        "files": [
          "GrushaD.mp4"
        ],
        "aspectRatio": null,
        "metadata": {
          "width": null,
          "height": null,
          "status": "unverified-legacy-layout-hint",
          "ratioSource": null
        },
        "layoutAspectRatio": "1278 / 468",
        "tools": [
          "DaVinci Resolve",
          "Adobe Creative Cloud"
        ]
      },
      {
        "id": "p02",
        "title": "Cartier — предметное видео",
        "titleStatus": "owner-approved-v012",
        "client": "",
        "year": "",
        "description": "На первый взгляд изображение может напоминать 3D-рендер или генеративную графику. Однако ролик полностью построен на предметной видеосъёмке.\n\nВесь процесс — от съёмки до монтажа — занял примерно один час. Точная работа с предметом и камерой позволила получить выразительную картинку без сложного производственного цикла.",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "studioWork": [
          "Предметная видеосъёмка",
          "Монтаж"
        ],
        "participants": [],
        "files": [
          "Cartier.M.mp4",
          "Cartier.mp4"
        ],
        "aspectRatio": "9 / 16",
        "metadata": {
          "width": null,
          "height": null,
          "status": "owner-confirmed-ratio",
          "ratioSource": "owner"
        },
        "layoutAspectRatio": "16 / 9",
        "tools": []
      },
      {
        "id": "p03",
        "title": "Grusha Diamonds — реставрация украшений",
        "titleStatus": "owner-approved-v013",
        "client": "",
        "year": "",
        "description": "Предметный рекламный ролик для кампании, посвящённой восстановлению ювелирных изделий.\n\nВ основе визуальной концепции — преображение украшения: от следов длительного использования до восстановленной поверхности и первоначального блеска. Проект демонстрирует возможности ювелирного сервиса по реставрации украшений.\n\nСъёмка и монтаж были выполнены в короткие сроки — по одному рабочему дню на каждый этап.",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "studioWork": [
          "Предметная видеосъёмка",
          "Монтаж",
          "Рекламный постпродакшн"
        ],
        "participants": [],
        "files": [
          "GrushaS.M.mp4",
          "GrushaS.mp4"
        ],
        "aspectRatio": "9 / 16",
        "metadata": {
          "width": null,
          "height": null,
          "status": "owner-confirmed-ratio",
          "ratioSource": "owner-v05"
        },
        "layoutAspectRatio": "16 / 9",
        "tools": []
      },
      {
        "id": "p04",
        "title": "Box — рекламное видео",
        "titleStatus": "owner-approved-v012",
        "client": "",
        "year": "",
        "description": "Этот рекламный ролик появился в последние минуты запланированной фотосъёмки. Задача на видеопроизводство возникла непосредственно на площадке, когда тренер по боксу уже собирался приступить к следующему занятию.\n\nНа съёмку удалось выделить всего 90 секунд. Без специального видеосвета, используя доступное естественное освещение, мы сняли несколько кадров, из которых впоследствии был собран рекламный ролик.\n\nГотовый материал использовался на различных рекламных носителях, включая медиафасады, экраны торговых центров и внутренние размещения.",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "studioWork": [
          "Видеосъёмка",
          "Монтаж",
          "Цветокоррекция",
          "Рекламная графика",
          "Адаптация форматов"
        ],
        "participants": [],
        "files": [
          "BOX.mp4"
        ],
        "aspectRatio": null,
        "metadata": {
          "width": null,
          "height": null,
          "status": "unverified-legacy-layout-hint",
          "ratioSource": null
        },
        "layoutAspectRatio": "16 / 9",
        "tools": [
          "DaVinci Resolve",
          "Adobe Creative Cloud"
        ]
      },
      {
        "id": "p05",
        "title": "Backstage",
        "titleStatus": "owner-approved-v012",
        "client": "",
        "year": "",
        "description": "Бэкстейдж-видео с визуальной стилизацией в духе Уэса Андерсона.\n\nОсновное внимание уделено композиции, ритму и характеру монтажных переходов. Материал объединён в короткую самостоятельную видеоисторию, сохраняющую атмосферу съёмочного процесса.",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "studioWork": [
          "Бэкстейдж-съёмка",
          "Монтаж"
        ],
        "participants": [],
        "files": [
          "WA.mp4"
        ],
        "aspectRatio": null,
        "metadata": {
          "width": null,
          "height": null,
          "status": "unverified-legacy-layout-hint",
          "ratioSource": null
        },
        "layoutAspectRatio": "16 / 9",
        "tools": [
          "DaVinci Resolve"
        ]
      },
      {
        "id": "p06",
        "title": "Prada — рекламное видео",
        "titleStatus": "owner-approved-v013",
        "client": "",
        "year": "",
        "description": "Рекламный видеоролик, созданный в рамках однодневного съёмочного и монтажного цикла.\n\nПредставленная работа — мастер-версия, на основе которой впоследствии было подготовлено множество рекламных адаптаций.\n\nВ их числе короткие форматы продолжительностью 5, 10 и 15 секунд с дополнительной графикой для различных рекламных носителей.",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "studioWork": [
          "Видеосъёмка",
          "Монтаж",
          "Цветокоррекция",
          "Адаптация форматов",
          "Рекламная графика"
        ],
        "participants": [],
        "files": [
          "PR.mp4",
          "Prada.mp4",
          "Prado.mp4"
        ],
        "aspectRatio": null,
        "metadata": {
          "width": null,
          "height": null,
          "status": "unverified-legacy-layout-hint",
          "ratioSource": null
        },
        "layoutAspectRatio": "16 / 9",
        "tools": [
          "DaVinci Resolve",
          "Adobe Creative Cloud"
        ]
      },
      {
        "id": "uniize-1",
        "title": "Elegant",
        "titleStatus": "owner-approved-v012",
        "client": "",
        "year": "",
        "description": "Один из четырёх коротких fashion-роликов, созданных для презентации коллекции Uniize.\n\nВся серия была снята примерно за четыре часа, после чего за два дня выполнены монтаж, цветокоррекция, согласование и подготовка финальных материалов.",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "studioWork": [
          "Видеосъёмка",
          "Монтаж",
          "Цветокоррекция",
          "Финальная подготовка"
        ],
        "participants": [],
        "files": [
          "Unize_1.MP4",
          "Uniize_1.mp4",
          "Unize1.mp4",
          "Uniize1.mp4"
        ],
        "aspectRatio": "9 / 16",
        "metadata": {
          "width": null,
          "height": null,
          "status": "owner-confirmed-ratio",
          "ratioSource": "owner"
        },
        "layoutAspectRatio": "9 / 16",
        "tools": [
          "Adobe Creative Cloud"
        ]
      },
      {
        "id": "uniize-2",
        "title": "Green & White",
        "titleStatus": "owner-approved-v012",
        "client": "",
        "year": "",
        "description": "Короткая видеопрезентация новой коллекции Uniize, созданная в рамках серии из четырёх роликов.\n\nСъёмка всей серии заняла около четырёх часов. Монтаж, цветокоррекция, согласование и сдача материалов были выполнены за два дня.",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "studioWork": [
          "Видеосъёмка",
          "Монтаж",
          "Цветокоррекция"
        ],
        "participants": [],
        "files": [
          "Unize_2.MP4",
          "Uniize_2.mp4",
          "Unize2.mp4",
          "Uniize2.mp4"
        ],
        "aspectRatio": "9 / 16",
        "metadata": {
          "width": null,
          "height": null,
          "status": "owner-confirmed-ratio",
          "ratioSource": "owner"
        },
        "layoutAspectRatio": "9 / 16",
        "tools": [
          "Adobe Creative Cloud"
        ]
      },
      {
        "id": "uniize-3",
        "title": "The Pair",
        "titleStatus": "owner-approved-v012",
        "client": "",
        "year": "",
        "description": "Один из роликов серии Uniize, посвящённой новой коллекции бренда.\n\nВ основе — лёгкая визуальная история с участием пары. Съёмка проводилась в рамках единой производственной смены из четырёх роликов, а монтаж и постпродакшн завершены в течение нескольких дней.",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "studioWork": [
          "Видеосъёмка",
          "Монтаж",
          "Цветокоррекция"
        ],
        "participants": [],
        "files": [
          "Unize_3.MP4",
          "Uniize_3.mp4",
          "Unize3.mp4",
          "Uniize3.mp4"
        ],
        "aspectRatio": "9 / 16",
        "metadata": {
          "width": null,
          "height": null,
          "status": "owner-confirmed-ratio",
          "ratioSource": "owner"
        },
        "layoutAspectRatio": "9 / 16",
        "tools": [
          "Adobe Creative Cloud"
        ]
      },
      {
        "id": "uniize-4",
        "title": "Casual",
        "titleStatus": "owner-approved-v012",
        "client": "",
        "year": "",
        "description": "Короткий fashion-ролик из серии четырёх видео для Uniize.\n\nПроект создавался в рамках компактного производственного цикла: несколько разных визуальных историй за одну съёмочную смену с последующим монтажом, цветокоррекцией и согласованием материалов.",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "studioWork": [
          "Видеосъёмка",
          "Монтаж",
          "Цветокоррекция"
        ],
        "participants": [],
        "files": [
          "Unize 4.MP4",
          "Uniize_4.mp4",
          "Unize4.mp4",
          "Uniize4.mp4"
        ],
        "aspectRatio": "9 / 16",
        "metadata": {
          "width": null,
          "height": null,
          "status": "owner-confirmed-ratio",
          "ratioSource": "owner"
        },
        "layoutAspectRatio": "9 / 16",
        "tools": [
          "Adobe Creative Cloud"
        ]
      },
      {
        "id": "p08",
        "title": "",
        "titleStatus": "unknown-internal-only",
        "client": "",
        "year": "",
        "description": "",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "studioWork": [],
        "participants": [],
        "files": [
          "HEAD.mp4"
        ],
        "aspectRatio": null,
        "metadata": {
          "width": null,
          "height": null,
          "status": "unverified-legacy-layout-hint",
          "ratioSource": null
        },
        "layoutAspectRatio": "1278 / 468"
      },
      {
        "id": "p09",
        "title": "Чемпионат России по греко-римской борьбе — рекламный фильм, 2025",
        "titleStatus": "owner-approved-v013",
        "client": "",
        "year": "",
        "description": "Рекламный фильм чемпионата России по греко-римской борьбе 2025 года — один из наиболее сложных проектов по организации производства и логистике.\n\nПосле подтверждения финансирования на подготовку выездной съёмки оставалось всего несколько дней. Компактная команда из трёх человек была оперативно отправлена в Омск с большим комплектом оборудования.\n\nПроизводство включало постановочные сцены в спортивном зале, сложную работу со светом, затемнение больших оконных проёмов, техническую подготовку площадки и последующую серию интервью в Омске и Москве.\n\nПараллельно с продолжавшимися съёмками шёл монтаж рекламного фильма и материалов для открытия чемпионата. Все основные версии были подготовлены к установленным датам мероприятия.",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "AI-инструменты для анализа материалов интервью и отдельных задач по звуку.",
        "studioWork": [
          "Разработка производственного решения",
          "Продюсирование",
          "Организация логистики",
          "Координация съёмочной группы",
          "Постановочная видеосъёмка",
          "Интервью",
          "Монтаж",
          "Цветокоррекция",
          "Работа со звуком",
          "Постпродакшн"
        ],
        "participants": [],
        "files": [
          "CHRB.mp4"
        ],
        "aspectRatio": null,
        "metadata": {
          "width": null,
          "height": null,
          "status": "unverified-legacy-layout-hint",
          "ratioSource": null
        },
        "layoutAspectRatio": "16 / 9",
        "tools": [
          "DaVinci Resolve",
          "Adobe Creative Cloud"
        ]
      },
      {
        "id": "book",
        "files": [
          "Book.mp4"
        ],
        "client": "Российский центр неврологии и нейронаук",
        "year": "",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "participants": [],
        "title": "Руководство по неврологии",
        "titleStatus": "owner-approved-v012",
        "description": "Презентационный видеоролик, посвящённый выходу восьмитомного «Руководства по неврологии», подготовленного к 80-летию Российского центра неврологии и нейронаук.\n\nЗадача заключалась в создании лаконичной визуальной презентации издания для профессиональной аудитории. Предметная съёмка заняла несколько часов, монтаж и подготовка основной версии были выполнены в течение одного дня.\n\nДополнительно подготовлены адаптации для различных презентационных форматов.",
        "studioWork": [
          "Предметная видеосъёмка",
          "Монтаж",
          "Постпродакшн",
          "Адаптация форматов"
        ],
        "tools": [
          "DaVinci Resolve",
          "Adobe After Effects"
        ]
      },
      {
        "id": "ny",
        "files": [
          "NY.mp4"
        ],
        "client": "",
        "year": "",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "participants": [],
        "title": "New Year — Бронницкий ювелир",
        "titleStatus": "owner-approved-v012",
        "description": "Новогодняя рекламная кампания для компании «Бронницкий ювелир».\n\nПроект объединил фото- и видеосъёмку, работу с моделью и организацию постановочного пространства.\n\nПроизводство проходило в условиях ограниченного бюджета и плотного графика.\n\nДополнительным вызовом стал форс-мажор на съёмочной площадке: из-за отсутствия одного из участников производственный план и отдельные решения по сет-дизайну пришлось оперативно пересматривать непосредственно во время съёмки.\n\nНесмотря на изменения, удалось сохранить основную визуальную концепцию и завершить съёмочный этап.\n\nПосле съёмки на весь постпродакшн и адаптацию материалов оставалось менее трёх суток.\n\nЗа это время был выполнен монтаж и подготовлено более 30 форматов для рекламных размещений, включая торговые центры, магазины, шоурумы, аэропорт и цифровые площадки.",
        "studioWork": [
          "Организация производства",
          "Фото- и видеосъёмка",
          "Работа с моделью",
          "Координация площадки",
          "Монтаж",
          "Цветокоррекция",
          "Рекламные адаптации"
        ],
        "tools": [
          "DaVinci Resolve",
          "Adobe Creative Cloud"
        ]
      },
      {
        "id": "she",
        "files": [
          "SHE.mp4"
        ],
        "client": "",
        "year": "",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "participants": [],
        "title": "SHE — ювелирная миниатюра",
        "titleStatus": "owner-approved-v012",
        "description": "Короткая видеопрезентация ювелирного кольца с акцентом на детали изделия и его визуальный характер.\n\nСъёмка и основной монтаж были выполнены за один день.\n\nНесмотря на компактный формат, проект включал значительный объём подготовки рекламных версий.\n\nНа основе основного ролика были созданы горизонтальные и вертикальные адаптации для различных рекламных экранов, цифровых площадок и других носителей.\n\nДополнительно подготовлены варианты с разными рекламными сообщениями, текстовыми подписями и графикой.",
        "studioWork": [
          "Предметная видеосъёмка",
          "Монтаж",
          "Адаптация рекламных форматов",
          "Рекламная графика"
        ],
        "tools": [
          "Adobe Premiere Pro"
        ]
      },
      {
        "id": "min",
        "files": [
          "MIN.mp4"
        ],
        "client": "",
        "year": "",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "participants": [],
        "title": "MIN — музыкальный фильм",
        "titleStatus": "owner-approved-v012",
        "description": "Музыкальный видеопроект, связанный с пространством музея Скрябина и идеей сохранения культурного наследия. Работа велась во взаимодействии с приглашённым режиссёром.\n\nВ рамках проекта были организованы и проведены видеосъёмка и комплексный постпродакшн. После завершения первоначальной версии концепция получила дальнейшее развитие: по пожеланиям заказчика были переработаны отдельные сцены, ритм повествования и визуальная атмосфера.\n\nДополнительно в фильм интегрированы AI-сцены на основе фотографий интерьеров и референсных материалов. Это позволило объединить отснятый и созданный на постпродакшне материал в единую визуальную историю.",
        "studioWork": [
          "Организация видеосъёмки",
          "Операторская работа",
          "Монтаж",
          "Цветокоррекция",
          "AI-постпродакшн",
          "Доработка визуальной концепции"
        ],
        "tools": [
          "DaVinci Resolve",
          "Adobe Creative Cloud",
          "ComfyUI"
        ]
      },
      {
        "id": "anniversary-97",
        "files": [
          "97.mp4"
        ],
        "client": "",
        "year": "",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "participants": [],
        "title": "97 лет Бронницкому ювелиру",
        "titleStatus": "owner-approved-v012",
        "description": "Юбилейный видеоролик, посвящённый 97-летию компании «Бронницкий ювелир».\n\nВ основе фильма — кадры реального ювелирного производства, позволяющие показать технологические процессы и атмосферу предприятия.\n\nПроект объединяет производственную документальную съёмку и лаконичный презентационный монтаж.",
        "studioWork": [
          "Производственная видеосъёмка",
          "Монтаж",
          "Постпродакшн"
        ],
        "tools": [
          "Adobe Creative Cloud"
        ]
      },
      {
        "id": "proriv",
        "files": [
          "Proriv.mp4"
        ],
        "client": "",
        "year": "",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "participants": [],
        "title": "Прорыв — световые эффекты",
        "titleStatus": "owner-approved-v012",
        "description": "Видеоархив световых решений, созданных для специализированного фестивального мероприятия.\n\nЗадача заключалась в фиксации световых эффектов и сценических решений без дополнительной рекламной драматургии. Из отснятого материала была подготовлена короткая монтажная подборка для презентации и внутреннего архива заказчика.",
        "studioWork": [
          "Видеосъёмка световых эффектов",
          "Монтаж",
          "Подготовка архивной версии"
        ],
        "tools": [
          "Adobe Creative Cloud"
        ]
      },
      {
        "id": "champ2025",
        "files": [
          "Champ2025.mp4"
        ],
        "client": "",
        "year": "",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "participants": [],
        "title": "Чемпионат России по греко-римской борьбе — отчётный фильм, 2025",
        "titleStatus": "owner-approved-v012",
        "description": "Итоговый фильм чемпионата России по греко-римской борьбе 2025 года. Проект стал заключительным этапом большого производственного цикла, включавшего рекламный фильм, материалы для открытия чемпионата и съёмку самого спортивного события.\n\nСоревнования снимались с 3 по 7 июня. После завершения чемпионата команда оперативно подготовила итоговый монтаж. Фильм был согласован и передан заказчику в течение следующей недели.",
        "studioWork": [
          "Организация съёмки мероприятия",
          "Операторская работа",
          "Монтаж",
          "Цветокоррекция",
          "Постпродакшн"
        ],
        "tools": [
          "DaVinci Resolve",
          "Adobe Creative Cloud"
        ]
      },
      {
        "id": "artmasters-teaser",
        "files": [
          "Тизер.mp4"
        ],
        "client": "",
        "year": "",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "participants": [],
        "title": "ArtMasters — тизер",
        "titleStatus": "owner-approved-v012",
        "description": "Небольшой экспериментальный ролик, созданный как самостоятельная творческая работа для ArtMasters.\n\nСъёмка, монтаж и работа со звуком были выполнены за один день — от первоначального решения до готового видео.",
        "studioWork": [
          "Видеосъёмка",
          "Монтаж",
          "Звуковое оформление"
        ],
        "tools": [
          "Adobe Creative Cloud"
        ]
      },
      {
        "id": "ne",
        "files": [
          "NE.mp4"
        ],
        "client": "",
        "year": "",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "participants": [],
        "title": "NE — волонтёрский проект",
        "titleStatus": "owner-approved-v012",
        "description": "Короткий видеоролик, созданный для сопровождения волонтёрского проекта в социальных сетях.\n\nПомимо видеоматериалов, организаторы проводили отдельную офлайн-акцию с элементами шествия.\n\nСъёмка была выполнена в течение одного дня, монтаж — также в течение одного дня.\n\nУчастие в видеопроизводстве было оказано по просьбе организаторов в качестве поддержки их инициативы.",
        "studioWork": [
          "Видеосъёмка",
          "Монтаж"
        ],
        "tools": [
          "Adobe Creative Cloud"
        ]
      },
      {
        "id": "atelier-bj",
        "files": [
          "Atelier_BJ.mp4"
        ],
        "client": "",
        "year": "",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "participants": [],
        "title": "Atelier BJ — ювелирное ателье",
        "titleStatus": "owner-approved-v012",
        "description": "Короткое предметное видео для ювелирного ателье, созданное в рамках регулярного производства контента для ювелирного бренда.\n\nОсновная задача — лаконично представить изделие в формате, подходящем для социальных сетей.\n\nСъёмка и монтаж выполнены в течение одного дня.",
        "studioWork": [
          "Предметная видеосъёмка",
          "Монтаж",
          "Подготовка для социальных сетей"
        ],
        "tools": [
          "Adobe Creative Cloud"
        ]
      },
      {
        "id": "sbj-1924",
        "files": [
          "S_BJ_1924.mp4"
        ],
        "client": "",
        "year": "",
        "task": "",
        "creativeSolution": "",
        "technicalImplementation": "",
        "participants": [],
        "title": "1924 — ювелирная коллекция",
        "titleStatus": "owner-approved-v013",
        "description": "Выездная рекламная съёмка ювелирной коллекции 1924, реализованная в парковой локации.\n\nПроект создавался практически без предварительной подготовки, с небольшой съёмочной командой и использованием естественной атмосферы локации.\n\nОсобенностью проекта стала съёмка с участием животного. Впоследствии этот опыт получил продолжение в других рекламных проектах.\n\nСъёмка выполнена за один день, монтаж — в течение следующего дня.",
        "studioWork": [
          "Видеосъёмка",
          "Монтаж",
          "Цветокоррекция",
          "Адаптация рекламных форматов"
        ],
        "tools": [
          "DaVinci Resolve",
          "Adobe Creative Cloud"
        ]
      },
      {
        "id": "grusha-custom",
        "files": [
          "Груша.mp4"
        ],
        "title": "Grusha Diamonds — индивидуальный заказ",
        "titleStatus": "owner-approved-v014",
        "description": "Короткая предметная видеопрезентация перстня ручной работы, изготовленного по индивидуальному заказу в Grusha Diamonds.\n\nВ центре внимания — само украшение: крупные планы позволяют рассмотреть особенности формы, фактуру металла и детали ювелирного исполнения.\n\nПростая композиция и лаконичный монтаж подчёркивают характер изделия, не отвлекая зрителя от деталей ручной работы.\n\nПродолжительность ролика — около 40 секунд.\n\nСъёмка и монтаж заняли по одному рабочему дню.",
        "studioWork": [
          "Предметная макросъёмка",
          "Монтаж",
          "Цветокоррекция"
        ],
        "tools": [
          "DaVinci Resolve"
        ]
      }
    ]
  },
  "grid": {
    "schemaVersion": 2,
    "common": {
      "maxHeight": 360,
      "maxTileWidth": 720,
      "maxItems": 24,
      "batchSize": 12,
      "concurrency": 3,
      "preloadMargin": 600
    },
    "presets": {
      "a": {
        "targets": [
          250,
          260,
          250
        ],
        "gap": 8
      },
      "b": {
        "targets": [
          220,
          290,
          240,
          300
        ],
        "gap": 6
      }
    }
  },
  "manifest": {
    "schemaVersion": 1,
    "repository": "Hommun/site-assets",
    "branch": "main",
    "complete": false,
    "provenance": "Owner confirmed PDF paths. Video/photo directory listing is unavailable offline; never fabricate it.",
    "files": [
      {
        "path": "Portfolio_AD.pdf"
      },
      {
        "path": "Portfolio_OBJ.pdf"
      }
    ]
  }
};
// Executed after the unmodified V0.9 modules and embedded production payload.
(function (scope, payload) {
  'use strict';
  const document = scope.document;
  const selector = '[data-portfolio][data-release="0.16"]';
  const attempted = new WeakSet();
  let observer, fallback, started = false, queued = false;
  const ready = (root) => ['video', 'gallery', 'campaign', 'object'].every((mode) =>
    root.querySelector(`[data-mode="${mode}"]`) && root.querySelector(`[data-gallery="${mode}"]`)) &&
    root.querySelector('[data-catalog-notice]');
  function scan() {
    const css = scope.ClipRedV016Assets?.css || document.querySelector('link[data-clipred-css="0.16"]')?.sheet;
    if (!css) return;
    document.querySelectorAll(selector).forEach((root) => {
      if (attempted.has(root) || root.dataset.initialized === 'true' || !ready(root)) return;
      attempted.add(root);
      const status = root.querySelector('[data-clipred-load-status]');
      try {
        scope.ClipRedV09App.init(root, payload);
        if (status) status.hidden = true;
      } catch {
        if (status) { status.hidden = false; status.textContent = 'Не удалось запустить портфолио. Обновите страницу.'; }
      } finally {
        if (fallback) { scope.clearInterval(fallback); fallback = null; }
      }
    });
  }
  function schedule() {
    if (queued) return; queued = true;
    Promise.resolve().then(() => { queued = false; scan(); });
  }
  function start() {
    schedule();
    if (started) return; started = true;
    if (scope.MutationObserver) {
      observer = new scope.MutationObserver(schedule);
      observer.observe(document.documentElement || document, { childList: true, subtree: true,
        attributes: true, attributeFilter: ['data-release', 'data-portfolio', 'data-mode', 'data-gallery'] });
    } else fallback = scope.setInterval(schedule, 500);
    document.addEventListener('DOMContentLoaded', schedule, { once: true });
    scope.addEventListener('load', schedule, { once: true });
  }
  scope.ClipRedV016Release = Object.freeze({ version: '0.16', start, scan: schedule });
  start();
})(globalThis, payload);

})(globalThis);
