// ════════════════════════════════════════════════════════
// STORAGE LAYER
// All data stored in localStorage under namespaced keys.
// ════════════════════════════════════════════════════════

const KEYS = {
  ANIME:    'adt_anime',    // { [slug]: AnimeRecord }
  SCHEDULE: 'adt_sched',   // { weekKey: [TimetableEntry] }
  SETTINGS: 'adt_settings' // { token, tz }
};

function loadData(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch(e) {
    return null;
  }
}

function saveData(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch(e) {
    showToast('Storage error: ' + e.message);
  }
}

// AnimeRecord shape:
// {
//   slug: string,            // animeschedule route slug
//   title: string,           // English title
//   titleRomaji: string,
//   totalEpisodes: number,
//   dubDay: string,          // day of week dub airs
//   dubTime: string,         // ISO string of next dub ep
//   savedAt: number,         // timestamp
//   cast: [                  // array from extension scrapes
//     {
//       character: string,
//       va: string,
//       tier: string         // 'Main'|'Secondary'|'Minor'|'Additional'
//     }
//   ]
// }

function getAnimeMap() {
  return loadData(KEYS.ANIME) || {};
}

function saveAnimeMap(map) {
  saveData(KEYS.ANIME, map);
}

function getSettings() {
  return loadData(KEYS.SETTINGS) || { token: '', tz: 'Australia/Sydney' };
}

function saveSettings_() {
  const token = document.getElementById('api-token-input').value.trim();
  const tz    = document.getElementById('tz-input').value.trim() || 'Europe/London';
  saveData(KEYS.SETTINGS, { token, tz });
  closeSettings();
  showToast('Settings saved');
}

// ════════════════════════════════════════════════════════
// TAB SWITCHING
// ════════════════════════════════════════════════════════

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'anime') renderAnime();
  if (name === 'vas')   renderVAs();
}

// ════════════════════════════════════════════════════════
// ANIMESCHEDULE API
// ════════════════════════════════════════════════════════

async function syncSchedule() {
  const settings = getSettings();
  if (!settings.token) {
    openSettings();
    showToast('Add your API token first');
    return;
  }

  const btn = document.getElementById('sync-btn');
  const statusEl = document.getElementById('sync-status');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  statusEl.textContent = '';

  try {
    // Call our Netlify proxy function which forwards to AnimeSchedule server-side
    // This avoids the browser CORS restriction on animeschedule.net
    const tz  = encodeURIComponent(settings.tz || 'Australia/Sydney');
    const url = `/.netlify/functions/timetable?airType=dub&tz=${tz}`;

    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${settings.token}` }
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`API error ${resp.status}: ${body}`);
    }

    const data = await resp.json();

    if (!Array.isArray(data)) {
      throw new Error('Unexpected API response format');
    }

    // Store the schedule keyed by current week
    const weekKey = getCurrentWeekKey();
    const schedMap = loadData(KEYS.SCHEDULE) || {};
    schedMap[weekKey] = data;
    // Keep only last 4 weeks to save space
    const allKeys = Object.keys(schedMap).sort();
    while (allKeys.length > 4) {
      delete schedMap[allKeys.shift()];
    }
    saveData(KEYS.SCHEDULE, schedMap);

    statusEl.textContent = `${data.length} entries`;
    renderCalendar(data);
    showToast(`Loaded ${data.length} dub episodes`);

  } catch(err) {
    showToast('Sync failed: ' + err.message);
    statusEl.textContent = 'Error';
    console.error('Sync error:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sync';
  }
}

function getCurrentWeekKey() {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ════════════════════════════════════════════════════════
// CALENDAR RENDER
// ════════════════════════════════════════════════════════

function renderCalendar(entries) {
  const container = document.getElementById('calendar-content');
  if (!entries || entries.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📅</div><h3>No dubs this week</h3><p>No dubbed episodes scheduled for this week.</p></div>`;
    return;
  }

  const animeMap = getAnimeMap();
  const todayStr = getDayString(new Date());

  // Group by day of week
  const days = {};
  const dayOrder = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  for (const entry of entries) {
    const epDate = new Date(entry.EpisodeDate || entry.episodeDate);
    if (isNaN(epDate.getTime())) continue;
    const dayName = dayOrder[epDate.getDay()];
    if (!days[dayName]) days[dayName] = [];
    days[dayName].push({ entry, epDate });
  }

  // Sort days starting from today
  const todayIdx = dayOrder.indexOf(todayStr);
  const sortedDays = [
    ...dayOrder.slice(todayIdx),
    ...dayOrder.slice(0, todayIdx)
  ].filter(d => days[d]);

  let html = '';
  for (const dayName of sortedDays) {
    const isToday = dayName === todayStr;
    html += `<div class="day-group">`;
    html += `<div class="day-label${isToday ? ' today' : ''}">${isToday ? 'TODAY — ' : ''}${dayName}</div>`;

    // Sort by time within day
    days[dayName].sort((a, b) => a.epDate - b.epDate);

    for (const { entry, epDate } of days[dayName]) {
      const slug  = entry.Route || entry.route || '';
      const title = entry.English || entry.english || entry.Title || entry.title || entry.Romaji || slug;
      const epNum = entry.EpisodeNumber || entry.episodeNumber || '?';
      const timeStr = epDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const isSaved = !!animeMap[slug];
      // Store data safely in a data attribute using base64 encoding to avoid any quote issues
      const dataObj = { slug, title, epNum, epDate: epDate.toISOString() };
      const dataB64 = btoa(unescape(encodeURIComponent(JSON.stringify(dataObj))));

      html += `
        <div class="cal-card${isSaved ? ' saved' : ''}" id="cal-${escHtml(slug)}">
          <div class="ep-time">${timeStr}</div>
          <div class="title-wrap">
            <div class="anime-title">${escHtml(title)}</div>
            <div class="ep-label">Ep ${epNum}</div>
          </div>
          <button class="save-btn" data-info="${dataB64}" onclick="toggleSaveAnime(event, this.dataset.info)">
            ${isSaved ? '✓ Saved' : '+ Save'}
          </button>
        </div>`;
    }
    html += `</div>`;
  }

  container.innerHTML = html;
}

function getDayString(date) {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][date.getDay()];
}

function toggleSaveAnime(event, dataB64) {
  event.stopPropagation();
  let info;
  try {
    info = JSON.parse(decodeURIComponent(escape(atob(dataB64))));
  } catch(e) {
    showToast('Error reading anime data');
    return;
  }
  const map  = getAnimeMap();

  if (map[info.slug]) {
    delete map[info.slug];
    showToast(`Removed "${info.title}"`);
  } else {
    map[info.slug] = {
      slug:          info.slug,
      title:         info.title,
      titleRomaji:   info.slug,
      totalEpisodes: null,
      dubTime:       info.epDate,
      savedAt:       Date.now(),
      cast:          []
    };
    showToast(`Saved "${info.title}"`);
  }

  saveAnimeMap(map);

  // Update the card in place without full re-render
  const card = document.getElementById('cal-' + info.slug);
  if (card) {
    const isSaved = !!map[info.slug];
    card.classList.toggle('saved', isSaved);
    card.querySelector('.save-btn').textContent = isSaved ? '✓ Saved' : '+ Save';
  }
}

// ════════════════════════════════════════════════════════
// ANIME TAB RENDER
// ════════════════════════════════════════════════════════

let animeFilter = '';

function filterAnime(val) {
  animeFilter = val.toLowerCase();
  renderAnime();
}

function renderAnime() {
  const container = document.getElementById('anime-content');
  const map = getAnimeMap();
  let entries = Object.values(map);

  if (animeFilter) {
    entries = entries.filter(a => {
      if (a.title.toLowerCase().includes(animeFilter)) return true;
      return (a.cast || []).some(c =>
        (c.character || '').toLowerCase().includes(animeFilter) ||
        (c.va || '').toLowerCase().includes(animeFilter)
      );
    });
  }

  entries.sort((a, b) => b.savedAt - a.savedAt);

  if (entries.length === 0) {
    if (animeFilter) {
      container.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><h3>No results</h3><p>No saved anime match "${escHtml(animeFilter)}".</p></div>`;
    } else {
      container.innerHTML = `<div class="empty-state"><div class="icon">📺</div><h3>No anime saved yet</h3><p>Save anime from the Calendar tab or install the Quetta extension to import cast data automatically.</p></div>`;
    }
    return;
  }

  const html = entries.map(anime => buildAnimeCard(anime)).join('');
  container.innerHTML = html;
}

function buildAnimeCard(anime) {
  const cast = anime.cast || [];
  const castCount = cast.length;
  const hasData = castCount > 0;

  // Group cast by tier
  const tiers = { Main: [], Secondary: [], Minor: [], Additional: [] };
  for (const c of cast) {
    const t = c.tier || 'Additional';
    if (tiers[t]) tiers[t].push(c);
    else tiers['Additional'].push(c);
  }

  let castHtml = '';
  if (!hasData) {
    castHtml = `<div class="no-cast">No cast data yet. Visit this anime's page on Anime Voice Over in Quetta Browser to import the cast automatically.</div>`;
  } else {
    for (const tier of ['Main','Secondary','Minor','Additional']) {
      if (tiers[tier].length === 0) continue;
      castHtml += `<div class="cast-section-label">${tier}</div>`;
      for (const c of tiers[tier]) {
        const vaHtml = escHtml(c.va || 'Unknown');
        const vaB64  = btoa(unescape(encodeURIComponent(c.va || '')));
        castHtml += `
          <div class="cast-row">
            <span class="char-name">${escHtml(c.character)}</span>
            <span class="va-name" data-va="${vaB64}" onclick="jumpToVA(this.dataset.va)" title="Go to ${vaHtml}">${vaHtml}</span>
          </div>`;
      }
    }
  }

  const slug = anime.slug || '';
  const castLabel = hasData ? `${castCount} cast` : 'No cast';
  const slugB64 = btoa(unescape(encodeURIComponent(slug)));

  return `
    <div class="anime-entry" id="ae-${escHtml(slug)}">
      <div class="anime-entry-header" data-slug="${slugB64}" onclick="toggleAnimeCard(this.dataset.slug)">
        <div class="title-wrap" style="flex:1;min-width:0">
          <div class="entry-title">${escHtml(anime.title)}</div>
          <div class="entry-meta">${castLabel}</div>
        </div>
        <button style="background:none;border:none;color:var(--accent);font-size:12px;cursor:pointer;flex-shrink:0;padding:4px 8px"
                data-slug="${slugB64}" onclick="event.stopPropagation(); removeAnime(this.dataset.slug)">Remove</button>
        <span class="chevron" id="chev-${escHtml(slug)}">›</span>
      </div>
      <div class="cast-list" id="cast-${escHtml(slug)}">
        ${castHtml}
      </div>
    </div>`;
}

function toggleAnimeCard(slugB64) {
  let slug;
  try { slug = decodeURIComponent(escape(atob(slugB64))); } catch(e) { slug = slugB64; }
  const castEl = document.getElementById('cast-' + slug);
  const chevEl = document.getElementById('chev-' + slug);
  if (!castEl) return;
  const isOpen = castEl.classList.toggle('open');
  if (chevEl) chevEl.classList.toggle('open', isOpen);
}

function removeAnime(slugB64) {
  let slug;
  try { slug = decodeURIComponent(escape(atob(slugB64))); } catch(e) { slug = slugB64; }
  const map = getAnimeMap();
  const title = map[slug] ? map[slug].title : slug;
  delete map[slug];
  saveAnimeMap(map);
  showToast(`Removed "${title}"`);
  renderAnime();
}

function jumpToVA(vaB64) {
  let vaName;
  try {
    vaName = decodeURIComponent(escape(atob(vaB64)));
  } catch(e) {
    vaName = vaB64; // fallback if not base64
  }
  // Switch to VA tab and filter to that VA
  switchTab('vas');
  document.getElementById('va-search').value = vaName;
  filterVAs(vaName);
}

// ════════════════════════════════════════════════════════
// VOICE ACTORS TAB RENDER
// ════════════════════════════════════════════════════════

let vaFilter = '';

function filterVAs(val) {
  vaFilter = val.toLowerCase();
  renderVAs();
}

// Normalise a VA name for grouping purposes.
// Removes middle initials, punctuation, and extra spaces so that
// "Joshua A. Waters", "Joshua Waters", and "Josh Waters" are
// treated as potentially the same person.
// The normalisation is: lowercase, strip middle initials (single letter + dot),
// remove punctuation, collapse spaces.
function normaliseVAName(name) {
  return name
    .toLowerCase()
    .replace(/\b[a-z]\.\s*/g, '')   // remove middle initials like "A."
    .replace(/[^a-z0-9\s]/g, '')    // remove remaining punctuation
    .replace(/\s+/g, ' ')           // collapse multiple spaces
    .trim();
}

function renderVAs() {
  const container = document.getElementById('vas-content');
  const map = getAnimeMap();
  const allAnime = Object.values(map);

  // Build VA → [{anime, character, tier}] map
  // Uses normalised name as key to group slight variations together
  // e.g. "Joshua A. Waters" and "Joshua Waters" → same person
  const vaMap = {};

  for (const anime of allAnime) {
    for (const c of (anime.cast || [])) {
      if (!c.va) continue;
      const key = normaliseVAName(c.va);
      if (!vaMap[key]) {
        // Use the longest/most complete version of the name as display name
        vaMap[key] = { displayName: c.va, roles: [] };
      } else {
        // Keep whichever name is longer (more complete)
        if (c.va.length > vaMap[key].displayName.length) {
          vaMap[key].displayName = c.va;
        }
      }
      vaMap[key].roles.push({
        animeTitle: anime.title,
        character:  c.character,
        tier:       c.tier || 'Additional'
      });
    }
  }

  let vas = Object.values(vaMap);

  if (vaFilter) {
    // Search both VA name and character names
    vas = vas.filter(v => {
      if (v.displayName.toLowerCase().includes(vaFilter)) return true;
      return v.roles.some(r => r.character.toLowerCase().includes(vaFilter));
    });
  }

  // Sort by number of roles desc, then alpha
  vas.sort((a, b) => b.roles.length - a.roles.length || a.displayName.localeCompare(b.displayName));

  if (vas.length === 0) {
    if (vaFilter) {
      container.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><h3>No results</h3><p>No voice actors match "${escHtml(vaFilter)}".</p></div>`;
    } else {
      container.innerHTML = `<div class="empty-state"><div class="icon">🎙️</div><h3>No voice actors yet</h3><p>Import cast data by visiting Anime Voice Over pages in Quetta Browser with the extension installed.</p></div>`;
    }
    return;
  }

  const html = vas.map(va => buildVACard(va)).join('');
  container.innerHTML = html;
}

function buildVACard(va) {
  const id = 'va-' + slugify(va.displayName);
  const roleCount = va.roles.length;

  // Sort roles: Main first, then Secondary, then Minor, then Additional; then alpha by anime
  const tierOrder = { Main: 0, Secondary: 1, Minor: 2, Additional: 3 };
  const sorted = [...va.roles].sort((a, b) => {
    const td = (tierOrder[a.tier] || 3) - (tierOrder[b.tier] || 3);
    if (td !== 0) return td;
    return a.animeTitle.localeCompare(b.animeTitle);
  });

  const rolesHtml = sorted.map(r => `
    <div class="va-role-row">
      <span class="va-role-anime">${escHtml(r.animeTitle)}</span>
      <span class="va-role-char">${escHtml(r.character)}</span>
      <span class="va-role-tier">${r.tier}</span>
    </div>`).join('');

  return `
    <div class="va-card" id="${id}">
      <div class="va-card-header" onclick="toggleVACard('${id}')">
        <span class="va-name-main">${escHtml(va.displayName)}</span>
        <span class="va-role-count">${roleCount} role${roleCount !== 1 ? 's' : ''}</span>
        <span class="chevron" id="chev-${id}">›</span>
      </div>
      <div class="va-roles-list" id="roles-${id}">
        ${rolesHtml}
      </div>
    </div>`;
}

function toggleVACard(id) {
  const rolesEl = document.getElementById('roles-' + id);
  const chevEl  = document.getElementById('chev-' + id);
  if (!rolesEl) return;
  const isOpen = rolesEl.classList.toggle('open');
  chevEl.classList.toggle('open', isOpen);
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ════════════════════════════════════════════════════════
// EXTENSION MESSAGE LISTENER
// The Quetta extension's pwa-bridge.js injects data into this
// page via window.postMessage. We listen for those messages here.
// ════════════════════════════════════════════════════════

window.addEventListener('message', function(event) {
  if (!event.data || event.data.source !== 'anime-dub-tracker-ext') return;
  handleExtensionMessage(event.data);
});

function handleExtensionMessage(msg) {
  if (!msg || !msg.type) return;

  if (msg.type === 'CAST_DATA') {
    // msg.slug: animeschedule route slug (or title-normalised key)
    // msg.title: anime title string
    // msg.cast: [{ character, va, tier }]
    importCastData(msg.slug, msg.title, msg.cast);
  } else if (msg.type === 'SCHEDULE_ENTRY') {
    // Single anime entry to add/update
    importScheduleEntry(msg.entry);
  }
}

function importCastData(slug, title, cast) {
  if (!slug || !Array.isArray(cast)) return;

  const map = getAnimeMap();

  if (!map[slug]) {
    // Auto-create entry if not yet saved
    map[slug] = {
      slug,
      title:         title || slug,
      titleRomaji:   slug,
      totalEpisodes: null,
      dubTime:       null,
      savedAt:       Date.now(),
      cast:          []
    };
  }

  // Merge cast: add entries not already present (match on character+va)
  const existing = map[slug].cast || [];
  const existingKeys = new Set(existing.map(c => (c.character + '|||' + c.va).toLowerCase()));
  let added = 0;

  for (const entry of cast) {
    if (!entry.character && !entry.va) continue;
    const key = ((entry.character || '') + '|||' + (entry.va || '')).toLowerCase();
    if (!existingKeys.has(key)) {
      existing.push({
        character: (entry.character || '').trim(),
        va:        (entry.va || '').trim(),
        tier:      entry.tier || 'Additional'
      });
      existingKeys.add(key);
      added++;
    }
  }

  map[slug].cast = existing;
  if (title && !map[slug].title) map[slug].title = title;

  saveAnimeMap(map);

  const msg = added > 0
    ? `Imported ${added} cast entries for "${map[slug].title}"`
    : `Cast data for "${map[slug].title}" already up to date`;

  showToast(msg);

  // Re-render if anime tab is active
  if (document.getElementById('tab-anime').classList.contains('active')) {
    renderAnime();
  }
  if (document.getElementById('tab-vas').classList.contains('active')) {
    renderVAs();
  }
}

function importScheduleEntry(entry) {
  if (!entry || !entry.slug) return;
  const map = getAnimeMap();
  if (!map[entry.slug]) {
    map[entry.slug] = {
      slug:          entry.slug,
      title:         entry.title || entry.slug,
      titleRomaji:   entry.titleRomaji || entry.slug,
      totalEpisodes: entry.totalEpisodes || null,
      dubTime:       entry.dubTime |//   savedAt: number,         // timestamp
//   cast: [                  // array from extension scrapes
//     {
//       character: string,
//       va: string,
//       tier: string         // 'Main'|'Secondary'|'Minor'|'Additional'
//     }
//   ]
// }

function getAnimeMap() {
  return loadData(KEYS.ANIME) || {};
}

function saveAnimeMap(map) {
  saveData(KEYS.ANIME, map);
}

function getSettings() {
  return loadData(KEYS.SETTINGS) || { token: '', tz: 'Australia/Sydney' };
}

function saveSettings_() {
  const token = document.getElementById('api-token-input').value.trim();
  const tz    = document.getElementById('tz-input').value.trim() || 'Europe/London';
  saveData(KEYS.SETTINGS, { token, tz });
  closeSettings();
  showToast('Settings saved');
}

// ════════════════════════════════════════════════════════
// TAB SWITCHING
// ════════════════════════════════════════════════════════

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'anime') renderAnime();
  if (name === 'vas')   renderVAs();
}

// ════════════════════════════════════════════════════════
// ANIMESCHEDULE API
// ════════════════════════════════════════════════════════

async function syncSchedule() {
  const settings = getSettings();
  if (!settings.token) {
    openSettings();
    showToast('Add your API token first');
    return;
  }

  const btn = document.getElementById('sync-btn');
  const statusEl = document.getElementById('sync-status');
  btn.disabled = true;
  btn.textContent = 'Syncing…';
  statusEl.textContent = '';

  try {
    // Call our Netlify proxy function which forwards to AnimeSchedule server-side
    // This avoids the browser CORS restriction on animeschedule.net
    const tz  = encodeURIComponent(settings.tz || 'Australia/Sydney');
    const url = `/.netlify/functions/timetable?airType=dub&tz=${tz}`;

    const resp = await fetch(url, {
      headers: { 'Authorization': `Bearer ${settings.token}` }
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`API error ${resp.status}: ${body}`);
    }

    const data = await resp.json();

    if (!Array.isArray(data)) {
      throw new Error('Unexpected API response format');
    }

    // Store the schedule keyed by current week
    const weekKey = getCurrentWeekKey();
    const schedMap = loadData(KEYS.SCHEDULE) || {};
    schedMap[weekKey] = data;
    // Keep only last 4 weeks to save space
    const allKeys = Object.keys(schedMap).sort();
    while (allKeys.length > 4) {
      delete schedMap[allKeys.shift()];
    }
    saveData(KEYS.SCHEDULE, schedMap);

    statusEl.textContent = `${data.length} entries`;
    renderCalendar(data);
    showToast(`Loaded ${data.length} dub episodes`);

  } catch(err) {
    showToast('Sync failed: ' + err.message);
    statusEl.textContent = 'Error';
    console.error('Sync error:', err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sync';
  }
}

function getCurrentWeekKey() {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  const week = Math.ceil(((now - jan1) / 86400000 + jan1.getDay() + 1) / 7);
  return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ════════════════════════════════════════════════════════
// CALENDAR RENDER
// ════════════════════════════════════════════════════════

function renderCalendar(entries) {
  const container = document.getElementById('calendar-content');
  if (!entries || entries.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="icon">📅</div><h3>No dubs this week</h3><p>No dubbed episodes scheduled for this week.</p></div>`;
    return;
  }

  const animeMap = getAnimeMap();
  const todayStr = getDayString(new Date());

  // Group by day of week
  const days = {};
  const dayOrder = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

  for (const entry of entries) {
    const epDate = new Date(entry.EpisodeDate || entry.episodeDate);
    if (isNaN(epDate.getTime())) continue;
    const dayName = dayOrder[epDate.getDay()];
    if (!days[dayName]) days[dayName] = [];
    days[dayName].push({ entry, epDate });
  }

  // Sort days starting from today
  const todayIdx = dayOrder.indexOf(todayStr);
  const sortedDays = [
    ...dayOrder.slice(todayIdx),
    ...dayOrder.slice(0, todayIdx)
  ].filter(d => days[d]);

  let html = '';
  for (const dayName of sortedDays) {
    const isToday = dayName === todayStr;
    html += `<div class="day-group">`;
    html += `<div class="day-label${isToday ? ' today' : ''}">${isToday ? 'TODAY — ' : ''}${dayName}</div>`;

    // Sort by time within day
    days[dayName].sort((a, b) => a.epDate - b.epDate);

    for (const { entry, epDate } of days[dayName]) {
      const slug  = entry.Route || entry.route || '';
      const title = entry.English || entry.english || entry.Title || entry.title || entry.Romaji || slug;
      const epNum = entry.EpisodeNumber || entry.episodeNumber || '?';
      const timeStr = epDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const isSaved = !!animeMap[slug];
      // Store data safely in a data attribute using base64 encoding to avoid any quote issues
      const dataObj = { slug, title, epNum, epDate: epDate.toISOString() };
      const dataB64 = btoa(unescape(encodeURIComponent(JSON.stringify(dataObj))));

      html += `
        <div class="cal-card${isSaved ? ' saved' : ''}" id="cal-${escHtml(slug)}">
          <div class="ep-time">${timeStr}</div>
          <div class="title-wrap">
            <div class="anime-title">${escHtml(title)}</div>
            <div class="ep-label">Ep ${epNum}</div>
          </div>
          <button class="save-btn" data-info="${dataB64}" onclick="toggleSaveAnime(event, this.dataset.info)">
            ${isSaved ? '✓ Saved' : '+ Save'}
          </button>
        </div>`;
    }
    html += `</div>`;
  }

  container.innerHTML = html;
}

function getDayString(date) {
  return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][date.getDay()];
}

function toggleSaveAnime(event, dataB64) {
  event.stopPropagation();
  let info;
  try {
    info = JSON.parse(decodeURIComponent(escape(atob(dataB64))));
  } catch(e) {
    showToast('Error reading anime data');
    return;
  }
  const map  = getAnimeMap();

  if (map[info.slug]) {
    delete map[info.slug];
    showToast(`Removed "${info.title}"`);
  } else {
    map[info.slug] = {
      slug:          info.slug,
      title:         info.title,
      titleRomaji:   info.slug,
      totalEpisodes: null,
      dubTime:       info.epDate,
      savedAt:       Date.now(),
      cast:          []
    };
    showToast(`Saved "${info.title}"`);
  }

  saveAnimeMap(map);

  // Update the card in place without full re-render
  const card = document.getElementById('cal-' + info.slug);
  if (card) {
    const isSaved = !!map[info.slug];
    card.classList.toggle('saved', isSaved);
    card.querySelector('.save-btn').textContent = isSaved ? '✓ Saved' : '+ Save';
  }
}

// ════════════════════════════════════════════════════════
// ANIME TAB RENDER
// ════════════════════════════════════════════════════════

let animeFilter = '';

function filterAnime(val) {
  animeFilter = val.toLowerCase();
  renderAnime();
}

function renderAnime() {
  const container = document.getElementById('anime-content');
  const map = getAnimeMap();
  let entries = Object.values(map);

  if (animeFilter) {
    entries = entries.filter(a => a.title.toLowerCase().includes(animeFilter));
  }

  entries.sort((a, b) => b.savedAt - a.savedAt);

  if (entries.length === 0) {
    if (animeFilter) {
      container.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><h3>No results</h3><p>No saved anime match "${escHtml(animeFilter)}".</p></div>`;
    } else {
      container.innerHTML = `<div class="empty-state"><div class="icon">📺</div><h3>No anime saved yet</h3><p>Save anime from the Calendar tab or install the Kiwi extension to import cast data automatically.</p></div>`;
    }
    return;
  }

  const html = entries.map(anime => buildAnimeCard(anime)).join('');
  container.innerHTML = html;
}

function buildAnimeCard(anime) {
  const cast = anime.cast || [];
  const castCount = cast.length;
  const hasData = castCount > 0;

  // Group cast by tier
  const tiers = { Main: [], Secondary: [], Minor: [], Additional: [] };
  for (const c of cast) {
    const t = c.tier || 'Additional';
    if (tiers[t]) tiers[t].push(c);
    else tiers['Additional'].push(c);
  }

  let castHtml = '';
  if (!hasData) {
    castHtml = `<div class="no-cast">No cast data yet. Visit this anime's page on Anime Voice Over in Kiwi Browser to import the cast automatically.</div>`;
  } else {
    for (const tier of ['Main','Secondary','Minor','Additional']) {
      if (tiers[tier].length === 0) continue;
      castHtml += `<div class="cast-section-label">${tier}</div>`;
      for (const c of tiers[tier]) {
        const vaHtml = escHtml(c.va || 'Unknown');
        const vaB64  = btoa(unescape(encodeURIComponent(c.va || '')));
        castHtml += `
          <div class="cast-row">
            <span class="char-name">${escHtml(c.character)}</span>
            <span class="va-name" data-va="${vaB64}" onclick="jumpToVA(this.dataset.va)" title="Go to ${vaHtml}">${vaHtml}</span>
          </div>`;
      }
    }
  }

  const slug = anime.slug || '';
  const castLabel = hasData ? `${castCount} cast` : 'No cast';
  const slugB64 = btoa(unescape(encodeURIComponent(slug)));

  return `
    <div class="anime-entry" id="ae-${escHtml(slug)}">
      <div class="anime-entry-header" data-slug="${slugB64}" onclick="toggleAnimeCard(this.dataset.slug)">
        <div class="title-wrap" style="flex:1;min-width:0">
          <div class="entry-title">${escHtml(anime.title)}</div>
          <div class="entry-meta">${castLabel}</div>
        </div>
        <button style="background:none;border:none;color:var(--accent);font-size:12px;cursor:pointer;flex-shrink:0;padding:4px 8px"
                data-slug="${slugB64}" onclick="event.stopPropagation(); removeAnime(this.dataset.slug)">Remove</button>
        <span class="chevron" id="chev-${escHtml(slug)}">›</span>
      </div>
      <div class="cast-list" id="cast-${escHtml(slug)}">
        ${castHtml}
      </div>
    </div>`;
}

function toggleAnimeCard(slugB64) {
  let slug;
  try { slug = decodeURIComponent(escape(atob(slugB64))); } catch(e) { slug = slugB64; }
  const castEl = document.getElementById('cast-' + slug);
  const chevEl = document.getElementById('chev-' + slug);
  if (!castEl) return;
  const isOpen = castEl.classList.toggle('open');
  if (chevEl) chevEl.classList.toggle('open', isOpen);
}

function removeAnime(slugB64) {
  let slug;
  try { slug = decodeURIComponent(escape(atob(slugB64))); } catch(e) { slug = slugB64; }
  const map = getAnimeMap();
  const title = map[slug] ? map[slug].title : slug;
  delete map[slug];
  saveAnimeMap(map);
  showToast(`Removed "${title}"`);
  renderAnime();
}

function jumpToVA(vaB64) {
  let vaName;
  try {
    vaName = decodeURIComponent(escape(atob(vaB64)));
  } catch(e) {
    vaName = vaB64; // fallback if not base64
  }
  // Switch to VA tab and filter to that VA
  switchTab('vas');
  document.getElementById('va-search').value = vaName;
  filterVAs(vaName);
}

// ════════════════════════════════════════════════════════
// VOICE ACTORS TAB RENDER
// ════════════════════════════════════════════════════════

let vaFilter = '';

function filterVAs(val) {
  vaFilter = val.toLowerCase();
  renderVAs();
}

function renderVAs() {
  const container = document.getElementById('vas-content');
  const map = getAnimeMap();
  const allAnime = Object.values(map);

  // Build VA → [{anime, character, tier}] map
  const vaMap = {}; // vaName (normalised) → { displayName, roles: [{animeTitle, character, tier}] }

  for (const anime of allAnime) {
    for (const c of (anime.cast || [])) {
      if (!c.va) continue;
      const key = c.va.toLowerCase().trim();
      if (!vaMap[key]) {
        vaMap[key] = { displayName: c.va, roles: [] };
      }
      vaMap[key].roles.push({
        animeTitle: anime.title,
        character:  c.character,
        tier:       c.tier || 'Additional'
      });
    }
  }

  let vas = Object.values(vaMap);

  if (vaFilter) {
    vas = vas.filter(v => v.displayName.toLowerCase().includes(vaFilter));
  }

  // Sort by number of roles desc, then alpha
  vas.sort((a, b) => b.roles.length - a.roles.length || a.displayName.localeCompare(b.displayName));

  if (vas.length === 0) {
    if (vaFilter) {
      container.innerHTML = `<div class="empty-state"><div class="icon">🔍</div><h3>No results</h3><p>No voice actors match "${escHtml(vaFilter)}".</p></div>`;
    } else {
      container.innerHTML = `<div class="empty-state"><div class="icon">🎙️</div><h3>No voice actors yet</h3><p>Import cast data by visiting Anime Voice Over pages in Kiwi Browser with the extension installed.</p></div>`;
    }
    return;
  }

  const html = vas.map(va => buildVACard(va)).join('');
  container.innerHTML = html;
}

function buildVACard(va) {
  const id = 'va-' + slugify(va.displayName);
  const roleCount = va.roles.length;

  // Sort roles: Main first, then Secondary, then Minor, then Additional; then alpha by anime
  const tierOrder = { Main: 0, Secondary: 1, Minor: 2, Additional: 3 };
  const sorted = [...va.roles].sort((a, b) => {
    const td = (tierOrder[a.tier] || 3) - (tierOrder[b.tier] || 3);
    if (td !== 0) return td;
    return a.animeTitle.localeCompare(b.animeTitle);
  });

  const rolesHtml = sorted.map(r => `
    <div class="va-role-row">
      <span class="va-role-anime">${escHtml(r.animeTitle)}</span>
      <span class="va-role-char">${escHtml(r.character)}</span>
      <span class="va-role-tier">${r.tier}</span>
    </div>`).join('');

  return `
    <div class="va-card" id="${id}">
      <div class="va-card-header" onclick="toggleVACard('${id}')">
        <span class="va-name-main">${escHtml(va.displayName)}</span>
        <span class="va-role-count">${roleCount} role${roleCount !== 1 ? 's' : ''}</span>
        <span class="chevron" id="chev-${id}">›</span>
      </div>
      <div class="va-roles-list" id="roles-${id}">
        ${rolesHtml}
      </div>
    </div>`;
}

function toggleVACard(id) {
  const rolesEl = document.getElementById('roles-' + id);
  const chevEl  = document.getElementById('chev-' + id);
  if (!rolesEl) return;
  const isOpen = rolesEl.classList.toggle('open');
  chevEl.classList.toggle('open', isOpen);
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ════════════════════════════════════════════════════════
// EXTENSION MESSAGE LISTENER
// The Kiwi extension's pwa-bridge.js injects data into this
// page via window.postMessage. We listen for those messages here.
// ════════════════════════════════════════════════════════

window.addEventListener('message', function(event) {
  if (!event.data || event.data.source !== 'anime-dub-tracker-ext') return;
  handleExtensionMessage(event.data);
});

function handleExtensionMessage(msg) {
  if (!msg || !msg.type) return;

  if (msg.type === 'CAST_DATA') {
    // msg.slug: animeschedule route slug (or title-normalised key)
    // msg.title: anime title string
    // msg.cast: [{ character, va, tier }]
    importCastData(msg.slug, msg.title, msg.cast);
  } else if (msg.type === 'SCHEDULE_ENTRY') {
    // Single anime entry to add/update
    importScheduleEntry(msg.entry);
  }
}

function importCastData(slug, title, cast) {
  if (!slug || !Array.isArray(cast)) return;

  const map = getAnimeMap();

  if (!map[slug]) {
    // Auto-create entry if not yet saved
    map[slug] = {
      slug,
      title:         title || slug,
      titleRomaji:   slug,
      totalEpisodes: null,
      dubTime:       null,
      savedAt:       Date.now(),
      cast:          []
    };
  }

  // Merge cast: add entries not already present (match on character+va)
  const existing = map[slug].cast || [];
  const existingKeys = new Set(existing.map(c => (c.character + '|||' + c.va).toLowerCase()));
  let added = 0;

  for (const entry of cast) {
    if (!entry.character && !entry.va) continue;
    const key = ((entry.character || '') + '|||' + (entry.va || '')).toLowerCase();
    if (!existingKeys.has(key)) {
      existing.push({
        character: (entry.character || '').trim(),
        va:        (entry.va || '').trim(),
        tier:      entry.tier || 'Additional'
      });
      existingKeys.add(key);
      added++;
    }
  }

  map[slug].cast = existing;
  if (title && !map[slug].title) map[slug].title = title;

  saveAnimeMap(map);

  const msg = added > 0
    ? `Imported ${added} cast entries for "${map[slug].title}"`
    : `Cast data for "${map[slug].title}" already up to date`;

  showToast(msg);

  // Re-render if anime tab is active
  if (document.getElementById('tab-anime').classList.contains('active')) {
    renderAnime();
  }
  if (document.getElementById('tab-vas').classList.contains('active')) {
    renderVAs();
  }
}

function importScheduleEntry(entry) {
  if (!entry || !entry.slug) return;
  const map = getAnimeMap();
  if (!map[entry.slug]) {
    map[entry.slug] = {
      slug:          entry.slug,
      title:         entry.title || entry.slug,
      titleRomaji:   entry.titleRomaji || entry.slug,
      totalEpisodes: entry.totalEpisodes || null,
      dubTime:       entry.dubTime || null,
      savedAt:       Date.now(),
      cast:          []
    };
    saveAnimeMap(map);
    showToast(`Added "${map[entry.slug].title}" to your list`);
  }
}

// ════════════════════════════════════════════════════════
// SETTINGS MODAL
// ════════════════════════════════════════════════════════

function openSettings() {
  const s = getSettings();
  document.getElementById('api-token-input').value = s.token || '';
  document.getElementById('tz-input').value = s.tz || 'Europe/London';
  document.getElementById('modal-overlay').classList.add('open');
}

function closeSettings() {
  document.getElementById('modal-overlay').classList.remove('open');
}

function saveSettings() {
  saveSettings_();
}

// ════════════════════════════════════════════════════════
// TOAST
// ════════════════════════════════════════════════════════

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ════════════════════════════════════════════════════════
// HTML ESCAPING
// ════════════════════════════════════════════════════════

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escAttr(str) {
  return String(str || '')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"');
}

// ════════════════════════════════════════════════════════
// SERVICE WORKER REGISTRATION
// ════════════════════════════════════════════════════════

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(reg => console.log('SW registered:', reg.scope))
      .catch(err => console.warn('SW registration failed:', err));
  });
}

// ════════════════════════════════════════════════════════
// INIT — load cached schedule on startup
// ════════════════════════════════════════════════════════

window.addEventListener('DOMContentLoaded', () => {
  attachStaticListeners();
  const schedMap = loadData(KEYS.SCHEDULE) || {};
  const weekKey  = getCurrentWeekKey();
  const cached   = schedMap[weekKey];
  if (cached && cached.length > 0) {
    renderCalendar(cached);
    document.getElementById('sync-status').textContent = `${cached.length} entries (cached)`;
  }
});

// ════════════════════════════════════════════════════════
// STATIC ELEMENT EVENT LISTENERS
// Replaces all inline onclick/oninput handlers in the HTML.
// Must run after DOMContentLoaded (already wrapped below).
// ════════════════════════════════════════════════════════

function attachStaticListeners() {
  // Header buttons
  document.getElementById('sync-btn').addEventListener('click', syncSchedule);
  document.getElementById('settings-btn').addEventListener('click', openSettings);

  // Tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', function() {
      switchTab(this.dataset.tab);
    });
  });

  // Search inputs
  document.getElementById('anime-search').addEventListener('input', function() {
    filterAnime(this.value);
  });
  document.getElementById('va-search').addEventListener('input', function() {
    filterVAs(this.value);
  });

  // Modal overlay — close when tapping outside the modal box
  document.getElementById('modal-overlay').addEventListener('click', function(event) {
    if (event.target === this) closeSettings();
  });

  // Modal buttons
  document.getElementById('modal-cancel').addEventListener('click', closeSettings);
  document.getElementById('modal-save').addEventListener('click', saveSettings);
}
