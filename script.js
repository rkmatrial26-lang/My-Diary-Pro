/**
 * MY DIARY (TAKEN) — Core Application Engine
 * ============================================
 * Premium single-page diary with Firebase Auth + Firestore sync,
 * local storage fallback, and a full-featured editor modal.
 */

'use strict';

/* ═══════════════════════════════════════════════════════════
   0. FIREBASE CONFIG — Replace with your project credentials
   ═══════════════════════════════════════════════════════════ */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCb5kjnrGPN31kmTUjFY49jTztsPNlmZLc",
  authDomain: "my-dairy-pro.firebaseapp.com",
  projectId: "my-dairy-pro",
  storageBucket: "my-dairy-pro.firebasestorage.app",
  messagingSenderId: "451916469142",
  appId: "1:451916469142:web:2328f173bf343d87fa43b7",
  measurementId: "G-T2N0BLW6XN"
};

/* ═══════════════════════════════════════════════════════════
   1. CONSTANTS & CONFIG
   ═══════════════════════════════════════════════════════════ */
const APP_CONFIG = {
  AUTOSAVE_DELAY:    600,      // ms before saving after input stops
  TOAST_DURATION:    3500,     // ms toast is visible
  LOCAL_STORAGE_KEY: 'taken_diary_notes',
  THEME_KEY:         'taken_theme',
  DEMO_MODE:         false,    // set true to skip Firebase, use local only
};

/* Filter IDs */
const FILTERS = { ALL: 'all', PINNED: 'pinned', FAVORITES: 'favorites', TRASH: 'trash', THIS_WEEK: 'this-week', THIS_MONTH: 'this-month', DATE: 'date' };

/* ═══════════════════════════════════════════════════════════
   2. UTILITY FUNCTIONS
   ═══════════════════════════════════════════════════════════ */
const Utils = {
  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  },

  now() {
    return new Date().toISOString();
  },

  formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const now = new Date();
    const diff = now - d;
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);

    if (mins < 1)   return 'Just now';
    if (mins < 60)  return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7)   return `${days}d ago`;

    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
  },

  formatDateLong(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  },

  wordCount(text) {
    if (!text || !text.trim()) return 0;
    return text.trim().split(/\s+/).filter(w => w.length > 0).length;
  },

  stripHtml(html) {
    const t = document.createElement('div');
    t.innerHTML = html;
    return t.textContent || t.innerText || '';
  },

  escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  highlight(text, query) {
    if (!query || !query.trim()) return Utils.escapeHtml(text);
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escaped})`, 'gi');
    return Utils.escapeHtml(text).replace(regex, '<mark class="search-highlight">$1</mark>');
  },

  debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  },

  clamp(n, min, max) { return Math.min(Math.max(n, min), max); },

  clone(obj) { return JSON.parse(JSON.stringify(obj)); },

  calculateStreak(notes) {
    const activeNotes = notes.filter(n => !n.deletedAt);
    if (!activeNotes.length) return 0;

    const uniqueDates = new Set(activeNotes.map(n => new Date(n.createdAt).toLocaleDateString('en-CA')));
    let streak = 0;
    
    let d = new Date();
    let todayKey = d.toLocaleDateString('en-CA');
    d.setDate(d.getDate() - 1);
    let yesterdayKey = d.toLocaleDateString('en-CA');

    d = new Date();
    if (uniqueDates.has(todayKey)) {
      streak = 1;
      d.setDate(d.getDate() - 1);
    } else if (uniqueDates.has(yesterdayKey)) {
      streak = 1;
      d.setDate(d.getDate() - 2);
    } else {
      return 0; 
    }

    while (true) {
      let key = d.toLocaleDateString('en-CA');
      if (uniqueDates.has(key)) {
        streak++;
        d.setDate(d.getDate() - 1);
      } else {
        break;
      }
    }
    return streak;
  },
};

/* ═══════════════════════════════════════════════════════════
   3. LOCAL STORAGE SERVICE
   ═══════════════════════════════════════════════════════════ */
const StorageService = {
  load() {
    try {
      const raw = localStorage.getItem(APP_CONFIG.LOCAL_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.warn('[StorageService] Load error:', e);
      return [];
    }
  },

  save(notes) {
    try {
      localStorage.setItem(APP_CONFIG.LOCAL_STORAGE_KEY, JSON.stringify(notes));
    } catch (e) {
      console.warn('[StorageService] Save error:', e);
    }
  },

  merge(localNotes, remoteNotes) {
    const map = new Map();
    localNotes.forEach(n => map.set(n.id, n));
    remoteNotes.forEach(n => {
      const local = map.get(n.id);
      if (!local || new Date(n.updatedAt) > new Date(local.updatedAt)) {
        map.set(n.id, n);
      }
    });
    return Array.from(map.values());
  },

  loadTheme() {
    return localStorage.getItem(APP_CONFIG.THEME_KEY) || 'auto';
  },

  saveTheme(theme) {
    localStorage.setItem(APP_CONFIG.THEME_KEY, theme);
  },
};

/* ═══════════════════════════════════════════════════════════
   4. FIREBASE SERVICE
   ═══════════════════════════════════════════════════════════ */
const FirebaseService = {
  _auth: null,
  _db:   null,
  _initialized: false,
  _unsubscribeSnapshot: null,

  init() {
    if (this._initialized) return;
    try {
      firebase.initializeApp(FIREBASE_CONFIG);
      this._auth = firebase.auth();
      this._db   = firebase.firestore();
      this._initialized = true;
      console.log('[Firebase] Initialized.');
    } catch (e) {
      console.error('[Firebase] Init error:', e);
    }
  },

  onAuthStateChanged(callback) {
    if (!this._auth) return;
    this._auth.onAuthStateChanged(callback);
  },

  async signIn(email, password) {
    return this._auth.signInWithEmailAndPassword(email, password);
  },

  async signUp(email, password) {
    return this._auth.createUserWithEmailAndPassword(email, password);
  },

  async signOut() {
    if (this._unsubscribeSnapshot) this._unsubscribeSnapshot();
    return this._auth.signOut();
  },

  currentUser() {
    return this._auth ? this._auth.currentUser : null;
  },

  _notesRef(uid) {
    return this._db.collection('users').doc(uid).collection('notes');
  },

  async fetchNotes(uid) {
    const snap = await this._notesRef(uid).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  subscribeNotes(uid, callback) {
    if (this._unsubscribeSnapshot) this._unsubscribeSnapshot();
    this._unsubscribeSnapshot = this._notesRef(uid)
      .onSnapshot(snap => {
        const notes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(notes);
      }, err => {
        console.warn('[Firebase] Snapshot error:', err);
      });
  },

  unsubscribe() {
    if (this._unsubscribeSnapshot) {
      this._unsubscribeSnapshot();
      this._unsubscribeSnapshot = null;
    }
  },

  async saveNote(uid, note) {
    const { id, ...data } = note;
    await this._notesRef(uid).doc(id).set(data, { merge: true });
  },

  async deleteNote(uid, noteId) {
    await this._notesRef(uid).doc(noteId).delete();
  },

  async batchSave(uid, notes) {
    const batch = this._db.batch();
    const ref   = this._notesRef(uid);
    notes.forEach(note => {
      const { id, ...data } = note;
      batch.set(ref.doc(id), data, { merge: true });
    });
    await batch.commit();
  },
};

/* ═══════════════════════════════════════════════════════════
   5. NOTE ENGINE — Note Lifecycle & Transformations
   ═══════════════════════════════════════════════════════════ */
const NoteEngine = {
  create(overrides = {}) {
    const now = Utils.now();
    const dateTitle = new Date().toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
    });
    return {
      id:        Utils.uid(),
      title:     dateTitle,
      content:   '',
      emotion:   '😐',
      pinned:    false,
      favorite:  false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      ...overrides,
    };
  },

  update(note, changes) {
    return { ...note, ...changes, updatedAt: Utils.now() };
  },

  trash(note) {
    return NoteEngine.update(note, { deletedAt: Utils.now(), pinned: false, favorite: false });
  },

  restore(note) {
    return NoteEngine.update(note, { deletedAt: null });
  },

  filter(notes, filterKey, searchQuery = '', dateQuery = '') {
    let result = notes;

    switch (filterKey) {
      case FILTERS.PINNED:
        result = notes.filter(n => n.pinned && !n.deletedAt);
        break;
      case FILTERS.FAVORITES:
        result = notes.filter(n => n.favorite && !n.deletedAt);
        break;
      case FILTERS.TRASH:
        result = notes.filter(n => !!n.deletedAt);
        break;
      case FILTERS.THIS_WEEK:
        const oneWeekAgo = new Date();
        oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
        result = notes.filter(n => !n.deletedAt && new Date(n.createdAt) >= oneWeekAgo);
        break;
      case FILTERS.THIS_MONTH:
        const firstDayOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        result = notes.filter(n => !n.deletedAt && new Date(n.createdAt) >= firstDayOfMonth);
        break;
      default: // ALL and DATE fall here
        result = notes.filter(n => !n.deletedAt);
    }

    if (dateQuery) {
      result = result.filter(n => new Date(n.createdAt).toLocaleDateString('en-CA') === dateQuery);
    }

    if (searchQuery && searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(n => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q));
    }

    if (filterKey !== FILTERS.TRASH) {
      result = [...result].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return new Date(b.updatedAt) - new Date(a.updatedAt);
      });
    } else {
      result = [...result].sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));
    }

    return result;
  },

  counts(notes) {
    const active = notes.filter(n => !n.deletedAt);
    return {
      all:       active.length,
      pinned:    active.filter(n => n.pinned).length,
      favorites: active.filter(n => n.favorite).length,
      trash:     notes.filter(n => !!n.deletedAt).length,
    };
  },
};

/* ═══════════════════════════════════════════════════════════
   6. THEME CONTROLLER
   ═══════════════════════════════════════════════════════════ */
const ThemeController = {
  _current: 'auto',
  _mediaQuery: null,

  init() {
    this._mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this._current = StorageService.loadTheme();
    this._apply();

    this._mediaQuery.addEventListener('change', () => {
      if (this._current === 'auto') this._apply();
    });
  },

  toggle() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    this._current = isDark ? 'light' : 'dark';
    StorageService.saveTheme(this._current);
    this._apply();
    return !isDark;
  },

  _apply() {
    let dark;
    if (this._current === 'auto') {
      dark = this._mediaQuery.matches;
    } else {
      dark = this._current === 'dark';
    }
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    const btn = document.getElementById('theme-toggle');
    if (btn) {
      btn.querySelector('.theme-icon').textContent = dark ? '☀️' : '🌙';
      btn.querySelector('span:last-child').textContent = dark ? 'Light' : 'Dark';
    }
  },

  isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  },
};

/* ═══════════════════════════════════════════════════════════
   7. TOAST SERVICE
   ═══════════════════════════════════════════════════════════ */
const Toast = {
  _container: null,

  init() {
    this._container = document.getElementById('toast-container');
  },

  show(message, type = 'info', duration = APP_CONFIG.TOAST_DURATION) {
    if (!this._container) return;
    const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `
      <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
      <span class="toast-message">${Utils.escapeHtml(message)}</span>
    `;
    this._container.appendChild(el);

    const remove = () => {
      el.classList.add('toast-exit');
      el.addEventListener('animationend', () => el.remove(), { once: true });
    };

    const timer = setTimeout(remove, duration);
    el.addEventListener('click', () => { clearTimeout(timer); remove(); });
  },

  success(msg, dur) { this.show(msg, 'success', dur); },
  error(msg, dur)   { this.show(msg, 'error',   dur); },
  info(msg, dur)    { this.show(msg, 'info',     dur); },
  warning(msg, dur) { this.show(msg, 'warning',  dur); },
};

/* ═══════════════════════════════════════════════════════════
   8. CONFIRM DIALOG SERVICE
   ═══════════════════════════════════════════════════════════ */
const ConfirmDialog = {
  _dialog:  null,
  _resolve: null,

  init() {
    this._dialog = document.getElementById('confirm-dialog');
    document.getElementById('confirm-cancel').addEventListener('click', () => this._respond(false));
    document.getElementById('confirm-ok').addEventListener('click',     () => this._respond(true));
    this._dialog.querySelector('.confirm-backdrop').addEventListener('click', () => this._respond(false));
  },

  show({ title = 'Are you sure?', message = '', icon = '⚠️', okLabel = 'Confirm', cancelLabel = 'Cancel' }) {
    this._dialog.querySelector('.confirm-icon').textContent    = icon;
    this._dialog.querySelector('.confirm-title').textContent   = title;
    this._dialog.querySelector('.confirm-message').textContent = message;
    this._dialog.querySelector('#confirm-ok').textContent      = okLabel;
    this._dialog.querySelector('#confirm-cancel').textContent  = cancelLabel;
    this._dialog.classList.add('open');

    return new Promise(resolve => { this._resolve = resolve; });
  },

  _respond(value) {
    this._dialog.classList.remove('open');
    if (this._resolve) { this._resolve(value); this._resolve = null; }
  },
};

/* ═══════════════════════════════════════════════════════════
   9. EDITOR CONTROLLER — Full-screen Note Editor Modal
   ═══════════════════════════════════════════════════════════ */
const EditorController = {
  _modal:         null,
  _titleInput:    null,
  _contentEl:     null,
  _saveIndicator: null,
  _wordCounter:   null,
  _dateDisplay:   null,
  _btnPin:        null,
  _btnFav:        null,
  _btnTrash:      null,
  _emoBtns:       null,
  _currentNote:   null,
  _saveTimer:     null,
  _onSave:        null,
  _onTrash:       null,
  _isTrashView:   false,

  init(onSave, onTrash) {
    this._onSave  = onSave;
    this._onTrash = onTrash;

    this._modal         = document.getElementById('editor-modal');
    this._titleInput    = document.getElementById('editor-title');
    this._contentEl     = document.getElementById('editor-content');
    this._saveIndicator = document.getElementById('save-indicator');
    this._wordCounter   = document.getElementById('word-counter');
    this._dateDisplay   = document.getElementById('modal-date');
    this._btnPin        = document.getElementById('modal-btn-pin');
    this._btnFav        = document.getElementById('modal-btn-fav');
    this._btnTrash      = document.getElementById('modal-btn-trash');

    document.getElementById('btn-close-modal').addEventListener('click', () => this.close());
    this._modal.querySelector('.modal-backdrop').addEventListener('click', () => this.close());

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this._modal.classList.contains('open')) this.close();
    });

    this._titleInput.addEventListener('input', () => this._scheduleSave());
    this._contentEl.addEventListener('input', () => {
      this._updateWordCount();
      this._scheduleSave();
    });

    this._btnPin.addEventListener('click', () => {
      if (!this._currentNote || this._isTrashView) return;
      this._currentNote.pinned = !this._currentNote.pinned;
      this._currentNote.updatedAt = Utils.now();
      this._updatePinFavButtons();
      this._triggerSave();
    });

    this._btnFav.addEventListener('click', () => {
      if (!this._currentNote || this._isTrashView) return;
      this._currentNote.favorite = !this._currentNote.favorite;
      this._currentNote.updatedAt = Utils.now();
      this._updatePinFavButtons();
      this._triggerSave();
    });

    this._btnTrash.addEventListener('click', async () => {
      if (!this._currentNote) return;
      const confirmed = await ConfirmDialog.show({
        title:  'Move to Trash?',
        message: 'This note will be moved to the trash. You can restore it later.',
        icon:   '🗑️',
        okLabel: 'Move to Trash',
      });
      if (confirmed) {
        this.close();
        if (this._onTrash) this._onTrash(this._currentNote.id);
      }
    });

    this._emoBtns = document.querySelectorAll('.emo-btn');
    this._emoBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this._currentNote || this._isTrashView) return;
        this._emoBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._currentNote.emotion = btn.dataset.emo;
        this._triggerSave();
      });
    });
  },

  open(note, isTrashView = false) {
    this._currentNote = Utils.clone(note);
    this._isTrashView = isTrashView;

    this._titleInput.value = note.title || '';
    this._contentEl.innerHTML = note.content || '';
    this._dateDisplay.textContent = Utils.formatDateLong(note.createdAt);

    this._updateWordCount();
    this._updatePinFavButtons();
    this._setSaveState('idle');

    const editable = !isTrashView;
    this._titleInput.disabled       = !editable;
    this._contentEl.contentEditable = editable ? 'true' : 'false';
    this._btnPin.style.display      = isTrashView ? 'none' : '';
    this._btnFav.style.display      = isTrashView ? 'none' : '';
    this._btnTrash.style.display    = isTrashView ? 'none' : '';
    this._contentEl.dataset.placeholder = editable ? 'Write down your entry...' : '';

    const noteEmo = note.emotion || '😐';
    this._emoBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.emo === noteEmo);
      btn.style.pointerEvents = isTrashView ? 'none' : 'all';
    });

    this._modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    const fab = document.getElementById('fab-new-note');
    if (fab) fab.classList.add('hidden');

    if (editable) {
      setTimeout(() => {
        if (!note.content) {
          this._contentEl.focus();
        } else {
          this._titleInput.focus();
        }
      }, 300);
    }
  },

  close() {
    if (this._saveTimer) {
      clearTimeout(this._saveTimer);
      this._saveTimer = null;
      if (this._currentNote && !this._isTrashView) this._triggerSave(true);
    }

    this._modal.classList.remove('open');
    document.body.style.overflow = '';

    const fab = document.getElementById('fab-new-note');
    if (fab) fab.classList.remove('hidden');

    this._currentNote = null;
  },

  _scheduleSave() {
    this._setSaveState('saving');
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._triggerSave(), APP_CONFIG.AUTOSAVE_DELAY);
  },

  _triggerSave(silent = false) {
    if (!this._currentNote || this._isTrashView) return;

    const title   = this._titleInput.value.trim() ||
                    new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const content = this._contentEl.innerHTML;

    this._currentNote = NoteEngine.update(this._currentNote, { title, content });

    if (this._onSave) this._onSave(Utils.clone(this._currentNote));
    if (!silent) this._setSaveState('saved');

    clearTimeout(this._idleTimer);
    this._idleTimer = setTimeout(() => this._setSaveState('idle'), 2000);
  },

  _setSaveState(state) {
    const el = this._saveIndicator;
    el.classList.remove('saving', 'saved', 'idle');
    el.classList.add(state);

    if (state === 'saving') {
      el.innerHTML = `<span class="save-dot"></span> Saving...`;
    } else if (state === 'saved') {
      el.innerHTML = `<span class="save-dot"></span> Saved`;
    } else {
      el.innerHTML = '';
    }
  },

  _updateWordCount() {
    const text  = Utils.stripHtml(this._contentEl.innerHTML);
    const words = Utils.wordCount(text);
    const chars = text.length;
    this._wordCounter.textContent = `${words} word${words !== 1 ? 's' : ''} · ${chars} char${chars !== 1 ? 's' : ''}`;
  },

  _updatePinFavButtons() {
    if (!this._currentNote) return;
    this._btnPin.classList.toggle('pinned',    !!this._currentNote.pinned);
    this._btnFav.classList.toggle('favorited', !!this._currentNote.favorite);
    this._btnPin.title = this._currentNote.pinned    ? 'Unpin'       : 'Pin to top';
    this._btnFav.title = this._currentNote.favorite  ? 'Unfavorite'  : 'Add to favorites';
  },
};

/* ═══════════════════════════════════════════════════════════
   10. UI CONTROLLER — DOM Rendering
   ═══════════════════════════════════════════════════════════ */
const UIController = {
  _notesFeed:    null,
  _contextTitle: null,

  init() {
    this._notesFeed    = document.getElementById('notes-feed');
    this._contextTitle = document.getElementById('context-title');
  },

  renderNotes(notes, filterKey, searchQuery = '') {
    this._notesFeed.innerHTML = '';

    const titles = { all: 'All Notes', pinned: 'Pinned', favorites: 'Favorites', trash: 'Trash', 'this-week': 'This Week', 'this-month': 'This Month', date: 'Selected Date' };
    if (this._contextTitle) this._contextTitle.textContent = titles[filterKey] || 'All Notes';

    if (filterKey === FILTERS.TRASH) {
      const bar = document.createElement('div');
      bar.className = 'trash-controls';
      bar.innerHTML = `
        <span class="trash-info">${notes.length} item${notes.length !== 1 ? 's' : ''} in trash</span>
        <button id="btn-empty-trash" class="btn-empty-trash">
          <span>🗑️</span> Empty Trash
        </button>
      `;
      this._notesFeed.appendChild(bar);
    }

    if (notes.length === 0) {
      const emptyMsgs = {
        all:       { icon: '📔', title: 'Your diary is empty', sub: 'Tap the + button to write your first entry.' },
        pinned:    { icon: '📌', title: 'No pinned notes',     sub: 'Pin important notes to find them quickly.' },
        favorites: { icon: '❤️', title: 'No favorites yet',    sub: 'Mark notes as favorites to see them here.' },
        trash:     { icon: '🗑️', title: 'Trash is empty',      sub: 'Deleted notes will appear here.' },
        date:      { icon: '📅', title: 'No entries this day', sub: 'Try selecting a different date.' },
      };
      const msg = emptyMsgs[filterKey] || emptyMsgs.all;
      this._notesFeed.innerHTML += `
        <div class="empty-state">
          <div class="empty-state-icon">${msg.icon}</div>
          <h3>${msg.title}</h3>
          <p>${msg.sub}</p>
        </div>
      `;
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'notes-grid';

    notes.forEach((note, index) => {
      const card = this._buildNoteCard(note, filterKey, searchQuery, index);
      grid.appendChild(card);
    });

    this._notesFeed.appendChild(grid);
  },

  _buildNoteCard(note, filterKey, searchQuery, index) {
    const card = document.createElement('div');
    card.className = `note-card${note.deletedAt ? ' in-trash' : ''}`;
    card.dataset.noteId = note.id;
    card.style.animationDelay = `${Utils.clamp(index * 40, 0, 400)}ms`;

    const titleHtml   = Utils.highlight(note.title || 'Untitled', searchQuery);
    const previewText = Utils.stripHtml(note.content || '').slice(0, 200);
    const bodyHtml    = Utils.highlight(previewText, searchQuery);

    let badgesHtml = '';
    if (note.pinned)   badgesHtml += `<span class="card-badge badge-pin">📌 Pinned</span>`;
    if (note.favorite) badgesHtml += `<span class="card-badge badge-fav">❤️ Favorite</span>`;

    const words = Utils.wordCount(Utils.stripHtml(note.content || ''));

    const actionsHtml = !note.deletedAt ? `
      <div class="card-actions">
        <button class="card-action-btn pin-btn${note.pinned ? ' pinned' : ''}" title="${note.pinned ? 'Unpin' : 'Pin'}">📌</button>
        <button class="card-action-btn fav-btn${note.favorite ? ' favorited' : ''}" title="${note.favorite ? 'Unfavorite' : 'Favorite'}">❤️</button>
        <button class="card-action-btn trash-btn-card" title="Move to trash">🗑️</button>
      </div>
    ` : '';

    const trashActionsHtml = note.deletedAt ? `
      <div class="trash-card-actions">
        <button class="trash-btn restore" data-id="${note.id}">↩️ Restore</button>
        <button class="trash-btn purge"   data-id="${note.id}">🔥 Purge</button>
      </div>
    ` : '';

    card.innerHTML = `
      ${actionsHtml}
      ${badgesHtml ? `<div class="card-badge-row">${badgesHtml}</div>` : ''}
      <div class="card-title"><span style="margin-right: 6px;">${note.emotion || '😐'}</span>${titleHtml}</div>
      <div class="card-body">${bodyHtml || '<span style="color:var(--text-tertiary);font-style:italic">No content yet...</span>'}</div>
      <div class="card-footer">
        <span class="card-date">${Utils.formatDate(note.updatedAt)}</span>
        ${words > 0 ? `<span class="card-word-count">${words}w</span>` : ''}
      </div>
      ${trashActionsHtml}
    `;

    return card;
  },

  updateBadges(counts) {
    const setBadge = (id, count) => {
      const el = document.getElementById(id);
      if (el) {
        el.textContent = count;
        el.style.display = count === 0 ? 'none' : '';
      }
    };
    setBadge('badge-all',       counts.all);
    setBadge('badge-pinned',    counts.pinned);
    setBadge('badge-favorites', counts.favorites);
    setBadge('badge-trash',     counts.trash);
  },

  setActiveNav(filterKey) {
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.filter === filterKey);
    });
  },

  setLoading(visible) {
    const overlay = document.getElementById('loading-overlay');
    if (visible) {
      overlay.classList.remove('hidden');
    } else {
      setTimeout(() => overlay.classList.add('hidden'), 600);
    }
  },

  showAuth() {
    const gate = document.getElementById('auth-gate');
    gate.classList.remove('hidden');
  },

  hideAuth() {
    const gate = document.getElementById('auth-gate');
    gate.classList.add('hidden');
  },

  updateUserStrip(user) {
    const strip = document.getElementById('user-strip');
    if (!strip) return;
    if (user) {
      strip.style.display = 'flex';
      const email = user.email || 'Anonymous';
      document.getElementById('user-email-display').textContent = email;
      document.getElementById('user-avatar-char').textContent = email[0].toUpperCase();
    } else {
      strip.style.display = 'none';
    }
  },

  toggleMobileSidebar(open) {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobile-overlay');
    if (open === undefined) open = !sidebar.classList.contains('mobile-open');

    sidebar.classList.toggle('mobile-open', open);
    overlay.classList.toggle('visible', open);
  },
};

/* ═══════════════════════════════════════════════════════════
   11. DATA BACKUP SERVICE — Export & Import
   ═══════════════════════════════════════════════════════════ */
const BackupService = {
  export(notes) {
    const payload = {
      app:         'My Diary (TAKEN)',
      version:     '1.0.0',
      exportedAt:  Utils.now(),
      totalNotes:  notes.filter(n => !n.deletedAt).length,
      totalTrash:  notes.filter(n => !!n.deletedAt).length,
      notes:       notes,
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `my_diary_backup_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    Toast.success(`Exported ${notes.length} notes successfully.`);
  },

  import(file) {
    return new Promise((resolve, reject) => {
      if (!file || file.type !== 'application/json') {
        reject(new Error('Please select a valid JSON backup file.'));
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          const notes = Array.isArray(data) ? data : (data.notes || []);
          if (!Array.isArray(notes)) throw new Error('Invalid backup format.');

          const valid = notes.filter(n => n && typeof n === 'object' && n.id).map(n => ({
            id:        String(n.id),
            title:     String(n.title || 'Imported Note'),
            content:   String(n.content || ''),
            emotion:   String(n.emotion || '😐'),
            pinned:    Boolean(n.pinned),
            favorite:  Boolean(n.favorite),
            createdAt: n.createdAt || Utils.now(),
            updatedAt: n.updatedAt || Utils.now(),
            deletedAt: n.deletedAt || null,
          }));

          resolve(valid);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Failed to read file.'));
      reader.readAsText(file);
    });
  },
};

/* ═══════════════════════════════════════════════════════════
   12. APP CONTROLLER — Main Orchestrator
   ═══════════════════════════════════════════════════════════ */
const AppController = {
  _notes:       [],
  _currentUser: null,
  _activeFilter: FILTERS.ALL,
  _searchQuery:  '',
  _dateQuery:    '',
  _demoMode:     APP_CONFIG.DEMO_MODE,

  async init() {
    console.log('[App] Initializing My Diary (TAKEN)...');

    ThemeController.init();
    Toast.init();
    ConfirmDialog.init();
    UIController.init();

    EditorController.init(
      (updatedNote) => this._handleNoteSave(updatedNote),
      (noteId)      => this._handleNoteTrash(noteId)
    );

    this._notes = StorageService.load();
    this._renderCurrentView();
    UIController.setLoading(false);

    if (this._demoMode) {
      UIController.hideAuth();
      this._bindUIEvents();
      return;
    }

    try {
      FirebaseService.init();
    } catch (e) {
      console.warn('[App] Firebase init failed, running in offline mode.', e);
      this._demoMode = true;
      UIController.hideAuth();
      this._bindUIEvents();
      return;
    }

    FirebaseService.onAuthStateChanged(user => {
      if (user) {
        this._onUserSignedIn(user);
      } else {
        this._onUserSignedOut();
      }
    });

    this._bindUIEvents();
  },

  async _onUserSignedIn(user) {
    console.log('[App] User signed in:', user.email);
    this._currentUser = user;
    UIController.hideAuth();
    UIController.updateUserStrip(user);

    FirebaseService.subscribeNotes(user.uid, (remoteNotes) => {
      console.log('[App] Firestore sync: received', remoteNotes.length, 'notes');
      this._notes = StorageService.merge(this._notes, remoteNotes);
      StorageService.save(this._notes);
      this._renderCurrentView();
    });
  },

  _onUserSignedOut() {
    console.log('[App] User signed out.');
    this._currentUser = null;
    FirebaseService.unsubscribe();
    UIController.updateUserStrip(null);
    UIController.showAuth();
  },

  async _handleNoteSave(updatedNote) {
    const index = this._notes.findIndex(n => n.id === updatedNote.id);
    if (index >= 0) {
      this._notes[index] = updatedNote;
    } else {
      this._notes.unshift(updatedNote);
    }

    StorageService.save(this._notes);
    this._renderCurrentView();

    if (this._currentUser) {
      try {
        await FirebaseService.saveNote(this._currentUser.uid, updatedNote);
      } catch (e) {
        console.warn('[App] Firestore save failed:', e);
        Toast.warning('Saved locally. Cloud sync pending.');
      }
    }
  },

  async _handleNoteTrash(noteId) {
    const index = this._notes.findIndex(n => n.id === noteId);
    if (index < 0) return;

    this._notes[index] = NoteEngine.trash(this._notes[index]);
    StorageService.save(this._notes);
    this._renderCurrentView();
    Toast.info('Note moved to trash.');

    if (this._currentUser) {
      try {
        await FirebaseService.saveNote(this._currentUser.uid, this._notes[index]);
      } catch (e) {
        console.warn('[App] Firestore trash sync failed:', e);
      }
    }
  },

  _createNote() {
    const note = NoteEngine.create();
    this._notes.unshift(note);
    StorageService.save(this._notes);
    this._renderCurrentView();
    EditorController.open(note, false);

    if (this._currentUser) {
      FirebaseService.saveNote(this._currentUser.uid, note).catch(console.warn);
    }
  },

  _openNote(noteId) {
    const note = this._notes.find(n => n.id === noteId);
    if (!note) return;
    const isTrash = !!note.deletedAt;
    EditorController.open(note, isTrash);
  },

  async _togglePin(noteId) {
    const index = this._notes.findIndex(n => n.id === noteId);
    if (index < 0) return;
    this._notes[index] = NoteEngine.update(this._notes[index], {
      pinned: !this._notes[index].pinned
    });
    StorageService.save(this._notes);
    this._renderCurrentView();

    if (this._currentUser) {
      FirebaseService.saveNote(this._currentUser.uid, this._notes[index]).catch(console.warn);
    }
  },

  async _toggleFavorite(noteId) {
    const index = this._notes.findIndex(n => n.id === noteId);
    if (index < 0) return;
    this._notes[index] = NoteEngine.update(this._notes[index], {
      favorite: !this._notes[index].favorite
    });
    StorageService.save(this._notes);
    this._renderCurrentView();

    if (this._currentUser) {
      FirebaseService.saveNote(this._currentUser.uid, this._notes[index]).catch(console.warn);
    }
  },

  async _restoreNote(noteId) {
    const index = this._notes.findIndex(n => n.id === noteId);
    if (index < 0) return;
    this._notes[index] = NoteEngine.restore(this._notes[index]);
    StorageService.save(this._notes);
    this._renderCurrentView();
    Toast.success('Note restored.');

    if (this._currentUser) {
      FirebaseService.saveNote(this._currentUser.uid, this._notes[index]).catch(console.warn);
    }
  },

  async _purgeNote(noteId) {
    const confirmed = await ConfirmDialog.show({
      title:   'Permanently Delete?',
      message: 'This note will be deleted forever. This action cannot be undone.',
      icon:    '🔥',
      okLabel: 'Delete Forever',
    });
    if (!confirmed) return;

    this._notes = this._notes.filter(n => n.id !== noteId);
    StorageService.save(this._notes);
    this._renderCurrentView();
    Toast.info('Note permanently deleted.');

    if (this._currentUser) {
      FirebaseService.deleteNote(this._currentUser.uid, noteId).catch(console.warn);
    }
  },

  async _emptyTrash() {
    const trashNotes = this._notes.filter(n => !!n.deletedAt);
    if (trashNotes.length === 0) return;

    const confirmed = await ConfirmDialog.show({
      title:   'Empty Trash?',
      message: `This will permanently delete ${trashNotes.length} note${trashNotes.length !== 1 ? 's' : ''}. This cannot be undone.`,
      icon:    '🗑️',
      okLabel: 'Empty Trash',
    });
    if (!confirmed) return;

    const deletedIds = trashNotes.map(n => n.id);
    this._notes = this._notes.filter(n => !n.deletedAt);
    StorageService.save(this._notes);
    this._renderCurrentView();
    Toast.success('Trash emptied.');

    if (this._currentUser) {
      deletedIds.forEach(id => {
        FirebaseService.deleteNote(this._currentUser.uid, id).catch(console.warn);
      });
    }
  },

  _setFilter(filterKey) {
    this._activeFilter = filterKey;
    this._searchQuery  = '';
    document.getElementById('search-input').value = '';
    document.getElementById('btn-search-clear').classList.remove('visible');
    UIController.setActiveNav(filterKey);
    this._renderCurrentView();

    if (window.innerWidth <= 768) UIController.toggleMobileSidebar(false);
  },

  _renderCurrentView() {
    const filtered = NoteEngine.filter(this._notes, this._activeFilter, this._searchQuery, this._dateQuery);
    const counts   = NoteEngine.counts(this._notes);
    UIController.renderNotes(filtered, this._activeFilter, this._searchQuery);
    UIController.updateBadges(counts);
    UIController.setActiveNav(this._activeFilter);

    // Update Dashboard Cards
    const dashTotal = document.getElementById('dash-total-notes');
    const dashStreak = document.getElementById('dash-streak');
    if (dashTotal) dashTotal.textContent = counts.all;
    if (dashStreak) dashStreak.textContent = Utils.calculateStreak(this._notes);

    // Sync Quick Filter UI Active States
    document.querySelectorAll('.qf-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === this._activeFilter);
    });

    this._bindTrashCardButtons();
    this._bindEmptyTrashButton();
  },

  _bindTrashCardButtons() {
    document.querySelectorAll('.trash-btn.restore').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._restoreNote(btn.dataset.id);
      });
    });
    document.querySelectorAll('.trash-btn.purge').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._purgeNote(btn.dataset.id);
      });
    });
  },

  _bindEmptyTrashButton() {
    const btn = document.getElementById('btn-empty-trash');
    if (btn) btn.addEventListener('click', () => this._emptyTrash());
  },

  _bindUIEvents() {
    document.querySelectorAll('.nav-item[data-filter]').forEach(item => {
      item.addEventListener('click', () => this._setFilter(item.dataset.filter));
    });

    document.getElementById('btn-new-note').addEventListener('click', () => this._createNote());
    document.getElementById('fab-new-note').addEventListener('click', () => this._createNote());

    document.getElementById('notes-feed').addEventListener('click', (e) => {
      const card = e.target.closest('.note-card');
      if (!card) return;

      if (e.target.closest('.pin-btn')) {
        e.stopPropagation();
        this._togglePin(card.dataset.noteId);
        return;
      }
      if (e.target.closest('.fav-btn')) {
        e.stopPropagation();
        this._toggleFavorite(card.dataset.noteId);
        return;
      }
      if (e.target.closest('.trash-btn-card')) {
        e.stopPropagation();
        this._handleNoteTrash(card.dataset.noteId);
        return;
      }
      if (e.target.closest('.trash-card-actions')) return;

      const note = this._notes.find(n => n.id === card.dataset.noteId);
      if (note && !note.deletedAt) this._openNote(card.dataset.noteId);
    });

    const searchInput  = document.getElementById('search-input');
    const searchClear  = document.getElementById('btn-search-clear');

    searchInput.addEventListener('input', Utils.debounce(() => {
      this._searchQuery = searchInput.value;
      const hasQuery    = !!this._searchQuery.trim();
      searchClear.classList.toggle('visible', hasQuery);
      this._renderCurrentView();
    }, 200));

    searchClear.addEventListener('click', () => {
      searchInput.value  = '';
      this._searchQuery  = '';
      searchClear.classList.remove('visible');
      searchInput.focus();
      this._renderCurrentView();
    });

    /* ── Dashboard Quick Filters ── */
    document.querySelectorAll('.qf-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const cal = document.getElementById('calendar-filter');
        if (btn.dataset.filter !== FILTERS.DATE && cal) {
          cal.value = '';
          this._dateQuery = '';
        }
        this._setFilter(btn.dataset.filter);
      });
    });

    /* ── Calendar Date Picker ── */
    const calendarInput = document.getElementById('calendar-filter');
    if (calendarInput) {
      calendarInput.addEventListener('change', (e) => {
        if (e.target.value) {
          this._dateQuery = e.target.value; 
          this._setFilter(FILTERS.DATE);
        } else {
          this._dateQuery = '';
          this._setFilter(FILTERS.ALL);
        }
      });
    }

    document.getElementById('theme-toggle').addEventListener('click', () => {
      ThemeController.toggle();
    });

    document.getElementById('btn-hamburger').addEventListener('click', () => {
      UIController.toggleMobileSidebar();
    });

    document.getElementById('mobile-overlay').addEventListener('click', () => {
      UIController.toggleMobileSidebar(false);
    });

    document.getElementById('btn-logout').addEventListener('click', async () => {
      const confirmed = await ConfirmDialog.show({
        title:   'Sign Out?',
        message: 'You will need to sign in again to sync your notes.',
        icon:    '👋',
        okLabel: 'Sign Out',
      });
      if (!confirmed) return;
      if (!this._demoMode) await FirebaseService.signOut();
      this._currentUser = null;
      Toast.info('You have been signed out.');
      UIController.showAuth();
    });

    document.getElementById('btn-export').addEventListener('click', () => {
      BackupService.export(this._notes);
    });

    document.getElementById('btn-import').addEventListener('click', () => {
      document.getElementById('import-file-input').click();
    });

    document.getElementById('import-file-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const imported = await BackupService.import(file);
        this._notes = StorageService.merge(this._notes, imported);
        StorageService.save(this._notes);
        this._renderCurrentView();
        Toast.success(`Imported ${imported.length} notes.`);

        if (this._currentUser) {
          FirebaseService.batchSave(this._currentUser.uid, imported).catch(console.warn);
        }
      } catch (err) {
        Toast.error(err.message || 'Import failed.');
      }

      e.target.value = '';
    });

    this._bindAuthForm();
  },

  _bindAuthForm() {
    const form       = document.getElementById('auth-form');
    const emailInput = document.getElementById('auth-email');
    const passInput  = document.getElementById('auth-password');
    const submitBtn  = document.getElementById('btn-auth-submit');
    const errorEl    = document.getElementById('auth-error');
    const toggleBtn  = document.getElementById('auth-mode-toggle');
    const titleEl    = document.getElementById('auth-title');
    const subtitleEl = document.getElementById('auth-subtitle');
    let isSignUp     = false;

    const setError = (msg) => {
      errorEl.textContent = msg;
      errorEl.classList.toggle('visible', !!msg);
    };

    const setLoading = (loading) => {
      submitBtn.classList.toggle('loading', loading);
      emailInput.disabled = loading;
      passInput.disabled  = loading;
    };

    toggleBtn.addEventListener('click', () => {
      isSignUp = !isSignUp;
      titleEl.textContent    = isSignUp ? 'Create Account' : 'Welcome Back';
      subtitleEl.textContent = isSignUp ? 'Start your private diary today.' : 'Sign in to access your diary.';
      submitBtn.querySelector('.btn-label').textContent = isSignUp ? 'Create Account' : 'Sign In';
      toggleBtn.previousElementSibling.textContent     = isSignUp ? 'Already have an account?' : "Don't have an account?";
      toggleBtn.textContent = isSignUp ? 'Sign In' : 'Sign Up';
      setError('');
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email    = emailInput.value.trim();
      const password = passInput.value;

      setError('');

      if (!email)    { setError('Please enter your email address.'); return; }
      if (!password) { setError('Please enter your password.'); return; }
      if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }

      setLoading(true);

      try {
        if (this._demoMode) {
          setTimeout(() => {
            setLoading(false);
            UIController.hideAuth();
            Toast.success('Welcome back! (Demo Mode)');
          }, 800);
          return;
        }

        if (isSignUp) {
          await FirebaseService.signUp(email, password);
        } else {
          await FirebaseService.signIn(email, password);
        }

        Toast.success(isSignUp ? '🎉 Account created! Welcome to My Diary.' : '👋 Welcome back!');
      } catch (err) {
        setLoading(false);
        const msg = this._parseAuthError(err.code || err.message);
        setError(msg);
      }
    });
  },

  _parseAuthError(code) {
    const messages = {
      'auth/invalid-email':            'Please enter a valid email address.',
      'auth/user-not-found':           'No account found with this email.',
      'auth/wrong-password':           'Incorrect password. Please try again.',
      'auth/email-already-in-use':     'This email is already registered. Try signing in.',
      'auth/weak-password':            'Password should be at least 6 characters.',
      'auth/too-many-requests':        'Too many failed attempts. Please try again later.',
      'auth/network-request-failed':   'Network error. Check your connection.',
      'auth/invalid-credential':       'Invalid credentials. Please check your email and password.',
      'auth/operation-not-allowed':    'Sign-in method not enabled. Contact support.',
      'auth/user-disabled':            'This account has been disabled.',
      'auth/configuration-not-found':  'Firebase not configured. Running in demo mode.',
    };
    return messages[code] || `Authentication error: ${code}`;
  },
};

/* ═══════════════════════════════════════════════════════════
   13. ENTRY POINT
   ═══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  AppController.init();
});
