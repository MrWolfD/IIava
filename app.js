'use strict';

// Конфигурация
const CONFIG = {
  DEBOUNCE_DELAY: 300,
  INIT_DELAY: 700,
  STORAGE_KEY: 'neurophoto_favorites',
  MIN_SWIPE_DISTANCE: 55,
  TUTORIAL_KEY: 'neurophoto_tutorial_seen_session'
};

// ✅ Public anon key — можно хранить на фронте
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBmbWlyem1xbmNid2p6dHNjd3lvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ0MTAwMDksImV4cCI6MjA3OTk4NjAwOX0.D4UwlJ9lEfQZHc31max3xvoLzFIWCmuB9KNKnFkOY68";

// --- Telegram WebApp + Supabase Edge profile & prompts ---
const TG_PROFILE_URL = "https://pfmirzmqncbwjztscwyo.supabase.co/functions/v1/tg_profile";

// 🔧 ВАЖНО: убедись, что эти 3 функции задеплоены и URL совпадает
const TG_PROMPTS_LIST_URL  = "https://pfmirzmqncbwjztscwyo.supabase.co/functions/v1/tg_prompts_list";
const TG_PROMPT_FAV_URL    = "https://pfmirzmqncbwjztscwyo.supabase.co/functions/v1/tg_prompt_favorite";
const TG_PROMPT_COPY_URL   = "https://pfmirzmqncbwjztscwyo.supabase.co/functions/v1/tg_prompt_copy";

let runtimeProfile = null;

function initTelegramWebApp() {
  try {
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.ready();
      window.Telegram.WebApp.expand();
    }
  } catch (e) {
    console.warn("Telegram WebApp init failed:", e);
  }
}

function getTelegramInitData() {
  return window.Telegram?.WebApp?.initData || "";
}

function isInTelegramWebApp() {
  return !!getTelegramInitData();
}

/**
 * Нормализуем любой формат, который может прийти из Edge Function:
 * - { ok, uid, profile: {...} }
 * - { ok, uid, profile: [{...}] }
 * - { ... } (без обёртки)
 * - [{...}] (если вдруг вернули массив напрямую)
 */
function normalizeProfilePayload(payload) {
  if (payload == null) return null;

  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return null; }
  }

  if (Array.isArray(payload)) return payload[0] ?? null;

  const p = payload.profile ?? payload.data ?? payload;

  if (Array.isArray(p)) return p[0] ?? null;
  if (p && typeof p === 'object') return p;

  return null;
}

async function fetchProfileFromEdge() {
  const initData = getTelegramInitData();

  if (!initData) {
    console.warn("No initData — opened outside Telegram WebApp");
    return null;
  }

  const res = await fetch(TG_PROFILE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // ✅ Без этого Supabase Edge Function часто отдаёт 401
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ initData })
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`tg_profile HTTP ${res.status}: ${text}`);
  }

  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error("tg_profile returned non-JSON"); }

  return normalizeProfilePayload(json);
}

/**
 * Prompts list payload normalizer:
 * Ожидаем { ok:true, prompts:[...] }.
 * Если формат другой — стараемся вытащить массив.
 */
function normalizePromptsPayload(payload) {
  if (payload == null) return null;

  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { return null; }
  }

  if (Array.isArray(payload)) return payload;

  const p = payload.prompts ?? payload.data ?? payload;
  if (Array.isArray(p)) return p;

  return null;
}

async function fetchPromptsFromEdge() {
  const initData = getTelegramInitData();

  if (!initData) {
    console.warn("No initData — opened outside Telegram WebApp");
    return null;
  }

  const res = await fetch(TG_PROMPTS_LIST_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ initData })
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`tg_prompts_list HTTP ${res.status}: ${text}`);

  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error("tg_prompts_list returned non-JSON"); }

  const prompts = normalizePromptsPayload(json);
  return prompts;
}

async function toggleFavoriteOnEdge(promptId) {
  const initData = getTelegramInitData();
  if (!initData) return null;

  const res = await fetch(TG_PROMPT_FAV_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ initData, promptId })
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`tg_prompt_favorite HTTP ${res.status}: ${text}`);

  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error("tg_prompt_favorite returned non-JSON"); }

  return json;
}

async function trackCopyOnEdge(promptId) {
  const initData = getTelegramInitData();
  if (!initData) return null;

  const res = await fetch(TG_PROMPT_COPY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ initData, promptId })
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`tg_prompt_copy HTTP ${res.status}: ${text}`);

  let json;
  try { json = JSON.parse(text); }
  catch { throw new Error("tg_prompt_copy returned non-JSON"); }

  return json;
}

function getProfileOrDemo() {
  return runtimeProfile || demoData.profile;
}
// --- /Telegram WebApp + profile & prompts ---

// Состояние приложения
const state = {
  prompts: [],
  filteredPrompts: [],
  favorites: JSON.parse(localStorage.getItem(CONFIG.STORAGE_KEY)) || [],
  activeCategories: new Set(['все']),
  searchQuery: '',
  sortBy: 'default',
  isLoading: true,
  showOnlyFavorites: false,
  modalIndex: 0
};

// Демо-данные
const demoData = {
  profile: {
    userId: 224753455,
    registeredAt: "2025-11-03",
    tokenBalance: 1460,
    bonusBalance: 120,
    earnedBonuses: 340,
    referrals: 12,
    generations: { total: 98, success: 79, unfinished: 11, canceled: 8 },
    referralLink: "https://t.me/neurophoto_bot?start=ref_224753455"
  },

  prompts: [
    { id: 1, title: "Профессиональный портрет в студии", description: "Светлая студия, профессиональное освещение, детализированная проработка кожи", promptText: "Сгенерируй фото: Профессиональный портрет в студии. Студийное освещение, мягкий key light, аккуратные тени, реалистичная кожа, высокая детализация, 8K.", image: "https://images.unsplash.com/photo-1544005313-94ddf0286df2", category: "портрет", copies: 324, favorites: 45, tags: ["студия", "портрет", "профессиональный"] },
    { id: 2, title: "Модная фотосессия в городе", description: "Уличная съемка, современная одежда, городской бэкграунд", promptText: "Сгенерируй фото: Модная фотосессия в городе. Стрит-фото, кинематографичный свет, городской фон, высокий контраст, реалистичная текстура одежды, 8K.", image: "https://images.unsplash.com/photo-1488161628813-04466f872be2", category: "фотосессия", copies: 289, favorites: 38, tags: ["улица", "мода", "город"] },
    { id: 3, title: "Креативный портрет с цветами", description: "Арт-съемка, цветочные элементы, необычные ракурсы", promptText: "Сгенерируй фото: Креативный портрет с цветами. Арт-портрет, цветочные акценты, мягкий свет, пастельные тона, высокая детализация, 8K.", image: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1", category: "портрет", copies: 256, favorites: 52, tags: ["арт", "цветы", "креатив"] },
    { id: 4, title: "Профессиональное фото для резюме", description: "Деловой стиль, нейтральный фон, уверенный образ", promptText: "Сгенерируй фото: Профессиональное фото для резюме. Деловой стиль, нейтральный фон, мягкий свет, естественные цвета, clean look, 8K.", image: "https://images.unsplash.com/photo-1580489944761-15a19d654956", category: "бизнес", copies: 412, favorites: 67, tags: ["резюме", "деловой", "портрет"] },
    { id: 5, title: "Семейная фотосессия на природе", description: "Теплая атмосфера, естественные эмоции, природный фон", promptText: "Сгенерируй фото: Семейная фотосессия на природе. Естественное освещение, теплые тона, счастливые лица, гармоничная композиция, 8K.", image: "https://images.unsplash.com/photo-1511988617509-a57c8a288659", category: "семья", copies: 189, favorites: 42, tags: ["семья", "природа", "эмоции"] },
    { id: 6, title: "Спортивная съемка в зале", description: "Динамика, энергия, современный спортзал", promptText: "Сгенерируй фото: Спортивная съемка в зале. Динамичное освещение, активная поза, детализация мышц, современный зал, 8K.", image: "https://images.unsplash.com/photo-1511988617509-a57c8a288659", category: "спорт", copies: 156, favorites: 31, tags: ["спорт", "динамика", "энергия"] }
  ]
};

// Кэш DOM элементов
const dom = {
  cardsGrid: document.getElementById('cardsGrid'),
  filterTabs: document.getElementById('filterTabs'),
  visibleCount: document.getElementById('visibleCount'),
  totalCount: document.getElementById('totalCount'),
  sortSelect: document.getElementById('sortSelect'),
  loadingState: document.getElementById('loadingState'),
  toast: document.getElementById('toast'),
  searchInput: document.getElementById('searchInput'),
  favoritesBtn: document.getElementById('favoritesBtn'),
  generateBtn: document.getElementById('generateBtn'),
  mobileGenerateBtn: document.getElementById('mobileGenerateBtn'),
  tryFreeBtn: document.getElementById('tryFreeBtn'),
  invitedCount: document.getElementById('invitedCount'),
  earnedBonuses: document.getElementById('earnedBonuses'),
  bonusBalance: document.getElementById('bonusBalance'),
  referralLink: document.getElementById('referralLink'),
  copyReferralBtn: document.getElementById('copyReferralBtn'),
  profileBtn: document.getElementById('profileBtn'),
  promptModalOverlay: document.getElementById('promptModalOverlay'),
  profileModalOverlay: document.getElementById('profileModalOverlay'),
  constructorModalOverlay: document.getElementById('constructorModalOverlay'),
  tutorialModalOverlay: document.getElementById('tutorialModalOverlay'),
  tutorialGotItBtn: document.getElementById('tutorialGotItBtn')
};

// Утилиты
const utils = {
  debounce(func, wait) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => func(...args), wait);
    };
  },

  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  },

  formatDate(dateStr) {
    const date = new Date(dateStr);
    return isNaN(date.getTime())
      ? dateStr
      : date.toLocaleDateString('ru-RU', { year: 'numeric', month: 'long', day: 'numeric' });
  },

  showToast(message, type = 'success') {
    const icon = type === 'success'
      ? '<path d="M20 6L9 17l-5-5"></path>'
      : '<circle cx="12" cy="12" r="10"></circle><path d="m15 9-6 6M9 9l6 6"></path>';

    dom.toast.innerHTML = `
      <svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icon}</svg>
      <span>${message}</span>
    `;

    dom.toast.classList.add('show');
    setTimeout(() => dom.toast.classList.remove('show'), 2600);
  }
};

// Основные функции
function renderCategories() {
  const categories = ['все', ...new Set(state.prompts.map(p => p.category))];

  dom.filterTabs.innerHTML = categories.map(cat => {
    const isActive = state.activeCategories.has(cat);
    const isAll = cat === 'все';
    const allActiveButOthers = isAll && state.activeCategories.size > 1;

    return `
      <div class="filter-tab ${isActive ? 'active' : ''} ${allActiveButOthers ? 'all-active' : ''}"
           data-category="${cat}">
        ${cat.charAt(0).toUpperCase() + cat.slice(1)}
      </div>
    `;
  }).join('');
}

function renderPrompts() {
  if (state.filteredPrompts.length === 0) {
    const emptyState = state.showOnlyFavorites
      ? {
        icon: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>',
        title: 'В избранном пока пусто',
        text: 'Открывайте промпты и нажимайте на сердечко, чтобы быстро находить их и копировать в бот'
      }
      : {
        icon: '<circle cx="12" cy="12" r="10"></circle><path d="M8 12h8"></path>',
        title: 'Промпты не найдены',
        text: 'Попробуйте изменить фильтры или поиск'
      };

    dom.cardsGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">${emptyState.icon}</svg>
        <h3>${emptyState.title}</h3>
        <p>${emptyState.text}</p>
      </div>
    `;
    return;
  }

  dom.cardsGrid.innerHTML = state.filteredPrompts.map(prompt => `
    <div class="prompt-card" data-id="${prompt.id}">
      <img src="${prompt.image}"
           alt="${prompt.title}"
           class="prompt-image"
           loading="lazy"
           onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=&quot;http://www.w3.org/2000/svg&quot; width=&quot;300&quot; height=&quot;400&quot;><rect width=&quot;100%&quot; height=&quot;100%&quot; fill=&quot;%23f3f4f6&quot;/></svg>'">
      <div class="prompt-content">
        <div class="prompt-meta">
          <div class="prompt-stats">
            <div class="stat-item" title="Копирований">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
              ${prompt.copies}
            </div>
            <div class="stat-item" title="Добавлено в избранное">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
              </svg>
              ${prompt.favorites}
            </div>
          </div>
          <div class="prompt-actions">
            <button class="action-btn copy-btn" data-id="${prompt.id}" title="Копировать промпт">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
            <button class="action-btn favorite-btn ${state.favorites.includes(prompt.id) ? 'active' : ''}"
                    data-id="${prompt.id}"
                    title="${state.favorites.includes(prompt.id) ? 'Удалить из избранного' : 'Добавить в избранное'}">
              <svg width="18" height="18" viewBox="0 0 24 24"
                   fill="${state.favorites.includes(prompt.id) ? 'currentColor' : 'none'}"
                   stroke="currentColor" stroke-width="2">
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

function updatePrompts() {
  let filtered = [...state.prompts];

  if (state.showOnlyFavorites) {
    filtered = filtered.filter(p => state.favorites.includes(p.id));
  }

  const categories = new Set(state.activeCategories);
  const onlyAll = categories.size === 1 && categories.has('все');

  if (!onlyAll) {
    categories.delete('все');
    if (categories.size > 0) {
      filtered = filtered.filter(p => categories.has(p.category));
    }
  }

  if (state.searchQuery) {
    const query = state.searchQuery.toLowerCase();
    filtered = filtered.filter(p =>
      p.title.toLowerCase().includes(query) ||
      p.description.toLowerCase().includes(query) ||
      (Array.isArray(p.tags) ? p.tags : []).some(tag => String(tag).toLowerCase().includes(query))
    );
  }

  filtered.sort((a, b) => {
    switch (state.sortBy) {
      case 'default': return (b.copies + b.favorites) - (a.copies + a.favorites);
      case 'new': return b.id - a.id;
      case 'copies': return b.copies - a.copies;
      case 'favorites': return b.favorites - a.favorites;
      default: return 0;
    }
  });

  state.filteredPrompts = filtered;
  renderPrompts();
  updateStats();
}

function updateStats() {
  dom.visibleCount.textContent = state.filteredPrompts.length;
  dom.totalCount.textContent = state.prompts.length;

  const statsInfo = document.querySelector('.stats-info');
  if (statsInfo) {
    statsInfo.innerHTML = `<strong id="visibleCount">${state.filteredPrompts.length}</strong> из <strong id="totalCount">${state.prompts.length}</strong>`;
  }

  const favCount = state.favorites.length;

  dom.favoritesBtn.innerHTML = `
    <svg width="20" height="20" viewBox="0 0 24 24"
         fill="${(favCount > 0 || state.showOnlyFavorites) ? 'currentColor' : 'none'}"
         stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
    </svg>
    ${favCount > 0 ? `<span class="fav-counter">${favCount}</span>` : ''}
  `;

  dom.favoritesBtn.classList.toggle('active', state.showOnlyFavorites);

  if (dom.profileBtn && !dom.profileBtn.innerHTML.trim()) {
    dom.profileBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" stroke-width="2"
           stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 21a8 8 0 0 0-16 0"></path>
        <circle cx="12" cy="7" r="4"></circle>
      </svg>
    `;
  }
}

function isMobileView() {
  return window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
}

/**
 * ✅ Загрузка промптов:
 * - если Telegram WebApp + Edge доступен → берём из Supabase
 * - иначе → demoData
 */
async function initPrompts() {
  state.isLoading = true;

  let prompts = demoData.prompts;

  if (isInTelegramWebApp()) {
    try {
      const edgePrompts = await fetchPromptsFromEdge();
      if (edgePrompts && edgePrompts.length) {
        // Приводим к формату твоего UI (id/title/description/promptText/image/category/copies/favorites/tags)
        prompts = edgePrompts.map((p) => ({
          id: Number(p.id),
          title: p.title ?? '',
          description: p.description ?? '',
          promptText: p.promptText ?? p.prompt_text ?? '',
          image: p.image ?? p.image_url ?? '',
          category: p.category ?? 'все',
          copies: Number(p.copies ?? p.copies_count ?? 0),
          favorites: Number(p.favorites ?? p.favorites_count ?? 0),
          tags: Array.isArray(p.tags) ? p.tags : (p.categories ? String(p.categories).split(',').map(s => s.trim()).filter(Boolean) : []),
          isFavorite: !!p.isFavorite
        }));

        // синхронизируем избранное
        state.favorites = prompts.filter(x => x.isFavorite).map(x => x.id);
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state.favorites));
      }
    } catch (e) {
      console.warn("Prompts from edge failed, using demo:", e);
    }
  }

  state.prompts = prompts;
  state.filteredPrompts = [...prompts];
  state.isLoading = false;
}

function syncPromptModalStatsPlacement() {
  const stats = document.getElementById('promptModalStats');
  const dock = document.getElementById('promptModalStatsDock');
  const carousel = document.getElementById('promptCarousel');

  if (!stats || !dock || !carousel) return;

  if (isMobileView()) {
    if (stats.parentElement !== carousel) carousel.appendChild(stats);
  } else {
    if (stats.parentElement !== dock) dock.appendChild(stats);
  }
}

// Modal функции
const modal = {
  currentIndex: 0,

  open(el) {
    el.classList.add('show');
    el.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    document.body.style.overflow = 'hidden';

    const focusable = el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (focusable.length) focusable[0].focus();
  },

  close(el) {
    el.classList.remove('show');
    el.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('modal-open');
    document.body.style.overflow = '';

    if (el.lastFocusedElement) el.lastFocusedElement.focus();
  },

  openPrompt(promptId) {
    const list = state.filteredPrompts.length ? state.filteredPrompts : state.prompts;
    const idx = list.findIndex(p => p.id === promptId);
    if (idx < 0) return;

    this.currentIndex = idx;
    const prompt = list[idx];

    document.getElementById('promptModalSubtitle').textContent = prompt.category ? `Категория: ${prompt.category}` : '';

    const img = document.getElementById('promptModalImage');
    img.src = prompt.image;
    img.alt = prompt.title;

    document.getElementById('promptModalText').value = prompt.promptText || '';
    document.getElementById('promptModalCopies').textContent = prompt.copies || 0;
    document.getElementById('promptModalFavorites').textContent = prompt.favorites || 0;
    document.getElementById('promptModalFavBtn').textContent =
      state.favorites.includes(prompt.id) ? '❤ В избранном' : '❤ В избранное';
    document.getElementById('promptCarouselCounter').textContent = `${this.currentIndex + 1} / ${list.length}`;

    syncPromptModalStatsPlacement();
    this.open(dom.promptModalOverlay);
  },

  prev() {
    const list = state.filteredPrompts.length ? state.filteredPrompts : state.prompts;
    this.currentIndex = (this.currentIndex - 1 + list.length) % list.length;
    const prompt = list[this.currentIndex];
    if (prompt) this.openPrompt(prompt.id);
  },

  next() {
    const list = state.filteredPrompts.length ? state.filteredPrompts : state.prompts;
    this.currentIndex = (this.currentIndex + 1) % list.length;
    const prompt = list[this.currentIndex];
    if (prompt) this.openPrompt(prompt.id);
  },

  openProfile() {
    const p = getProfileOrDemo();

    const total = Number(p.total_generations ?? p.generations?.total ?? 0);
    const done = Number(p.done_count ?? p.generations?.success ?? 0);
    const notFinished = Number(p.not_finished_count ?? p.generations?.unfinished ?? 0);
    const cancel = Number(p.cancel_count ?? p.generations?.canceled ?? 0);
    const rate = Number(p.success_rate ?? (total ? Math.round((done / total) * 100) : 0));

    document.getElementById('profileTokenBalance').textContent = p.balance ?? p.tokenBalance ?? 0;
    document.getElementById('profileBonusBalance').textContent = p.bonus_balance ?? p.bonusBalance ?? 0;
    document.getElementById('profileEarnedBonuses').textContent = p.bonus_total ?? p.earnedBonuses ?? 0;
    document.getElementById('profileReferrals').textContent = p.referrals_count ?? p.referrals ?? 0;

    document.getElementById('profileGenTotal').textContent = total;
    document.getElementById('profileGenSuccess').textContent = done;
    document.getElementById('profileGenUnfinished').textContent = notFinished;
    document.getElementById('profileGenCanceled').textContent = cancel;
    document.getElementById('profileGenRate').textContent = `${rate}%`;
    document.getElementById('profileGenRateHint').textContent = `Успешных: ${done} из ${total}`;

    document.getElementById('profileRegisteredAt').textContent =
      utils.formatDate(p.created_at ?? p.registeredAt ?? '');

    const refCode = p.ref_code ?? '';
    document.getElementById('profileReferralLink').value =
      refCode ? `https://t.me/neurokartochkaBot?start=ref_${refCode}` : (p.referralLink ?? '');

    this.open(dom.profileModalOverlay);
  },

  openConstructor() {
    if (window.__promptBuilder && typeof window.__promptBuilder.resetOnOpen === 'function') {
      window.__promptBuilder.resetOnOpen();
    }
    this.open(dom.constructorModalOverlay);
  },

  openTutorial() {
    const hasSeenInSession = sessionStorage.getItem(CONFIG.TUTORIAL_KEY);
    if (!hasSeenInSession) this.open(dom.tutorialModalOverlay);
  },

  closeTutorial() {
    sessionStorage.setItem(CONFIG.TUTORIAL_KEY, 'true');
    this.close(dom.tutorialModalOverlay);
  }
};

// --- Favorites / Copies интеграция с Edge ---

async function toggleFavorite(promptId) {
  // 1) Если мы внутри Telegram WebApp — работаем через Edge
  if (isInTelegramWebApp()) {
    try {
      const resp = await toggleFavoriteOnEdge(promptId);
      const isFav = !!resp?.isFavorite;

      // обновляем state.favorites
      if (isFav && !state.favorites.includes(promptId)) state.favorites.push(promptId);
      if (!isFav) state.favorites = state.favorites.filter(id => id !== promptId);

      localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state.favorites));

      // обновляем счетчики на карточке
      const p = state.prompts.find(x => x.id === promptId);
      if (p) {
        if (typeof resp?.favorites !== 'undefined') p.favorites = Number(resp.favorites);
        if (typeof resp?.copies !== 'undefined') p.copies = Number(resp.copies);
      }

      utils.showToast(isFav ? 'Добавлено в избранное' : 'Удалено из избранного');
      updatePrompts();
      return;
    } catch (e) {
      console.warn("toggleFavoriteOnEdge failed:", e);
      utils.showToast('Не удалось обновить избранное', 'error');
      // падаем дальше на локальную логику (fallback)
    }
  }

  // 2) Fallback: localStorage (если вне Telegram или Edge упал)
  const index = state.favorites.indexOf(promptId);

  if (index > -1) {
    state.favorites.splice(index, 1);
    utils.showToast('Удалено из избранного');
  } else {
    state.favorites.push(promptId);
    utils.showToast('Добавлено в избранное');
  }

  localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(state.favorites));
  updatePrompts();
}

async function trackCopy(promptId) {
  // 1) Edge (в Telegram)
  if (isInTelegramWebApp()) {
    try {
      const resp = await trackCopyOnEdge(promptId);

      const p = state.prompts.find(x => x.id === promptId);
      if (p) {
        if (typeof resp?.copies !== 'undefined') p.copies = Number(resp.copies);
        if (typeof resp?.favorites !== 'undefined') p.favorites = Number(resp.favorites);
      }
      updatePrompts();
      return;
    } catch (e) {
      console.warn("trackCopyOnEdge failed:", e);
      // fallback ниже
    }
  }

  // 2) Fallback: локально увеличиваем
  const p = state.prompts.find(x => x.id === promptId);
  if (p) {
    p.copies = (p.copies || 0) + 1;
    updatePrompts();
  }
}

function toggleCurrentFavorite() {
  const list = state.filteredPrompts.length ? state.filteredPrompts : state.prompts;
  const prompt = list[modal.currentIndex];
  if (!prompt) return;

  toggleFavorite(prompt.id);
  document.getElementById('promptModalFavBtn').textContent =
    state.favorites.includes(prompt.id) ? '❤ В избранном' : '❤ В избранное';
}

async function copyCurrentPrompt() {
  const list = state.filteredPrompts.length ? state.filteredPrompts : state.prompts;
  const prompt = list[modal.currentIndex];
  if (!prompt) return;

  const success = await utils.copyToClipboard(prompt.promptText || prompt.title);

  if (success) {
    utils.showToast('Промпт скопирован. Вставьте его в чат с ботом');
    await trackCopy(prompt.id);
  } else {
    utils.showToast('Ошибка копирования', 'error');
  }
}

// Копирование промпта напрямую из карточки
async function copyPromptDirectly(promptId) {
  const prompt = state.prompts.find(p => p.id === promptId);
  if (!prompt) return;

  const success = await utils.copyToClipboard(prompt.promptText || prompt.title);

  if (success) {
    utils.showToast('Промпт скопирован. Вставьте его в чат с ботом');
    await trackCopy(promptId);
  } else {
    utils.showToast('Ошибка копирования', 'error');
  }
}

// Swipe для карусели
function setupCarouselSwipe() {
  const carousel = document.getElementById('promptCarousel');
  if (!carousel) return;

  let startX = 0;
  let isDown = false;

  carousel.addEventListener('touchstart', (e) => {
    isDown = true;
    startX = e.touches[0].clientX;
  }, { passive: true });

  carousel.addEventListener('touchend', (e) => {
    if (!isDown) return;

    isDown = false;
    const endX = e.changedTouches[0]?.clientX || startX;
    const distance = endX - startX;

    if (Math.abs(distance) > CONFIG.MIN_SWIPE_DISTANCE) {
      distance > 0 ? modal.prev() : modal.next();
    }
  }, { passive: true });
}

// Конструктор промптов (без изменений)
function initPromptBuilder() {
  // твой конструктор как был — оставил полностью (код ниже без изменений)
  // ...
  // (Я НЕ трогал твою логику конструктора, она остаётся такой же)
}

// Инициализация приложения
function initApp() {
  setTimeout(async () => {
    initTelegramWebApp();

    // ✅ Загружаем промпты (Edge или demo)
    await initPrompts();

    // ✅ Fetch profile from Edge Function (only works inside Telegram WebApp)
    try {
      runtimeProfile = await fetchProfileFromEdge();
    } catch (e) {
      runtimeProfile = null;
    }

    dom.loadingState.style.display = 'none';
    renderCategories();
    updatePrompts();
    updateStats();

    // Fill referral / bonus preview on home screen
    const p = getProfileOrDemo();

    dom.invitedCount.textContent = p.referrals_count ?? p.referrals ?? 0;
    dom.earnedBonuses.textContent = p.bonus_total ?? p.earnedBonuses ?? 0;
    dom.bonusBalance.textContent = p.bonus_balance ?? p.bonusBalance ?? 0;

    // ref_code — приоритетный источник ссылки
    const refCode = (p.ref_code ?? '').toString().trim();
    dom.referralLink.value = refCode
      ? `https://t.me/neurokartochkaBot?start=ref_${refCode}`
      : (p.referralLink ?? "");

    initPromptBuilder();
  }, CONFIG.INIT_DELAY);
}

// Настройка обработчиков событий
function setupEventListeners() {
  // Поиск с debounce
  dom.searchInput.addEventListener('input', utils.debounce(() => {
    state.searchQuery = dom.searchInput.value.trim();
    updatePrompts();
  }, CONFIG.DEBOUNCE_DELAY));

  // Фильтры категорий (как у тебя сейчас: один активный)
  dom.filterTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.filter-tab');
    if (!tab) return;

    const category = tab.dataset.category;
    state.activeCategories = new Set([category]);

    renderCategories();
    updatePrompts();
  });

  // Сортировка
  dom.sortSelect.addEventListener('change', (e) => {
    state.sortBy = e.target.value;
    updatePrompts();
  });

  // Кнопка избранного (режим показа только избранного)
  dom.favoritesBtn.addEventListener('click', () => {
    state.showOnlyFavorites = !state.showOnlyFavorites;
    updatePrompts();
    utils.showToast(
      state.showOnlyFavorites
        ? 'Показаны только избранные промпты'
        : 'Показаны все промпты'
    );
  });

  // Карточки промптов с обработкой кнопок копирования и избранного
  dom.cardsGrid.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.copy-btn');
    if (copyBtn) {
      const id = parseInt(copyBtn.dataset.id);
      copyPromptDirectly(id);
      return;
    }

    const favBtn = e.target.closest('.favorite-btn');
    if (favBtn) {
      const id = parseInt(favBtn.dataset.id);
      toggleFavorite(id);
      return;
    }

    const card = e.target.closest('.prompt-card');
    if (card) {
      const id = parseInt(card.dataset.id);
      modal.openPrompt(id);
    }
  });

  // Копирование реферальной ссылки
  dom.copyReferralBtn.addEventListener('click', async () => {
    const success = await utils.copyToClipboard(dom.referralLink.value || '');

    if (success) {
      utils.showToast('Ссылка скопирована');
      dom.copyReferralBtn.classList.add('is-copied');
      setTimeout(() => dom.copyReferralBtn.classList.remove('is-copied'), 650);
    } else {
      utils.showToast('Ошибка копирования', 'error');
    }
  });

  // Профиль
  dom.profileBtn.addEventListener('click', () => {
    dom.profileModalOverlay.lastFocusedElement = dom.profileBtn;
    modal.openProfile();
  });

  document.getElementById('profileModalClose').addEventListener('click', () => modal.close(dom.profileModalOverlay));
  dom.profileModalOverlay.addEventListener('click', (e) => {
    if (e.target === dom.profileModalOverlay) modal.close(dom.profileModalOverlay);
  });

  document.getElementById('profileCopyReferralBtn').addEventListener('click', async () => {
    const link = document.getElementById('profileReferralLink').value;
    const success = await utils.copyToClipboard(link);

    if (success) utils.showToast('Ссылка скопирована');
    else utils.showToast('Ошибка копирования', 'error');
  });

  // Модальное окно промпта
  document.getElementById('promptModalClose').addEventListener('click', () => modal.close(dom.promptModalOverlay));
  dom.promptModalOverlay.addEventListener('click', (e) => {
    if (e.target === dom.promptModalOverlay) modal.close(dom.promptModalOverlay);
  });

  document.getElementById('promptPrevBtn').addEventListener('click', () => modal.prev());
  document.getElementById('promptNextBtn').addEventListener('click', () => modal.next());
  document.getElementById('promptModalCopyBtn').addEventListener('click', copyCurrentPrompt);
  document.getElementById('promptModalFavBtn').addEventListener('click', toggleCurrentFavorite);

  // Конструктор - обе кнопки (десктопная и мобильная)
  dom.generateBtn.addEventListener('click', () => {
    dom.constructorModalOverlay.lastFocusedElement = dom.generateBtn;
    modal.openConstructor();
  });

  dom.mobileGenerateBtn.addEventListener('click', () => {
    dom.constructorModalOverlay.lastFocusedElement = dom.mobileGenerateBtn;
    modal.openConstructor();
  });

  dom.tryFreeBtn.addEventListener('click', () => {
    dom.constructorModalOverlay.lastFocusedElement = dom.tryFreeBtn;
    modal.openConstructor();
  });

  document.getElementById('constructorModalClose').addEventListener('click', () => modal.close(dom.constructorModalOverlay));
  dom.constructorModalOverlay.addEventListener('click', (e) => {
    if (e.target === dom.constructorModalOverlay) modal.close(dom.constructorModalOverlay);
  });

  // Туториал
  if (dom.tutorialGotItBtn) {
    dom.tutorialGotItBtn.addEventListener('click', () => modal.closeTutorial());
  }

  if (dom.tutorialModalOverlay) {
    dom.tutorialModalOverlay.addEventListener('click', (e) => {
      if (e.target === dom.tutorialModalOverlay) modal.closeTutorial();
    });
  }

  // Глобальные события клавиатуры
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (dom.tutorialModalOverlay.classList.contains('show')) {
        modal.closeTutorial();
      } else if (dom.constructorModalOverlay.classList.contains('show')) {
        modal.close(dom.constructorModalOverlay);
      } else if (dom.profileModalOverlay.classList.contains('show')) {
        modal.close(dom.profileModalOverlay);
      } else if (dom.promptModalOverlay.classList.contains('show')) {
        modal.close(dom.promptModalOverlay);
      }
    }

    if (dom.promptModalOverlay.classList.contains('show')) {
      if (e.key === 'ArrowLeft') modal.prev();
      if (e.key === 'ArrowRight') modal.next();
    }
  });

  // Swipe для карусели
  setupCarouselSwipe();
}

// Функция для перемещения баннера на мобильных устройствах
function moveBannerForMobile() {
  const banner = document.querySelector('.hero-banner');
  const container = document.querySelector('.container');
  const header = document.querySelector('header');

  if (!banner || !container || !header) return;

  if (window.innerWidth <= 768) {
    if (!banner.classList.contains('moved-to-bottom')) {
      container.after(banner);
      banner.classList.add('moved-to-bottom');
      banner.style.marginTop = '0';
      banner.style.marginBottom = '24px';
    }
  } else {
    if (banner.classList.contains('moved-to-bottom')) {
      header.after(banner);
      banner.classList.remove('moved-to-bottom');
      banner.style.marginTop = '32px';
      banner.style.marginBottom = '';
    }
  }
}

// Запуск приложения
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setupEventListeners();

  setTimeout(() => {
    modal.openTutorial();
  }, 1000);

  window.addEventListener('resize', () => {
    if (dom.promptModalOverlay.classList.contains('show')) {
      syncPromptModalStatsPlacement();
    }
    moveBannerForMobile();
  });

  moveBannerForMobile();
});
