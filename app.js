/* ===== データ管理 ===== */
const STORAGE_KEY = 'fitnessAppData';
let storageAvailable = true;

const PRESET_ACCENTS = [
  '#d4a373', '#e63946', '#ff7b00', '#f4a261',
  '#2a9d8f', '#06d6a0', '#48cae4', '#1d3557',
  '#7209b7', '#f72585', '#b5179e', '#8d99ae'
];

const PRESET_BACKGROUNDS = [
  '#121212', '#000000', '#181a1b', '#1a1d20',
  '#141e24', '#1b1924', '#241b1b', '#1e231e'
];

function defaultState() {
  return {
    exercises: [
      { id: 'ex1', name: 'ベンチプレス', trackWeight: true, trackReps: true, trackTime: false, met: 6.0 },
      { id: 'ex2', name: 'プランク', trackWeight: false, trackReps: false, trackTime: true, met: 3.5 }
    ],
    workoutLogs: [],
    meals: [],
    goals: { dailySetTarget: 4, dailyCalorieTarget: 2000, dailyProteinTarget: 100 },
    settings: {
      geminiApiKey: '',
      groqApiKey: '',
      userName: '',
      honorific: 'さん',
      bodyHeightCm: null,
      bodyWeightKg: null,
      goalWeightKg: null,
      mascotEnabled: true,
      activeMascotSetId: 'set_default',
      mascotSets: [{ id: 'set_default', name: 'デフォルト', images: {} }],
      themeAccent: '#d4a373',
      themeBg: '#121212',
      mascotPosition: null
    },
    favoriteMeals: [],
    haveToList: { date: todayKey(), items: [] },
    dailyAdvices: [],
    weightLogs: []
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.settings.mascotSets) {
        parsed.settings.mascotSets = [{ id: 'set_default', name: 'デフォルト', images: parsed.settings.mascotImages || {} }];
        parsed.settings.activeMascotSetId = 'set_default';
      }
      if (parsed.settings.mascotEnabled === undefined) parsed.settings.mascotEnabled = true;
      if (parsed.settings.honorific === undefined) parsed.settings.honorific = 'さん';
      if (!parsed.settings.themeAccent) parsed.settings.themeAccent = '#d4a373';
      if (!parsed.settings.themeBg) parsed.settings.themeBg = '#121212';
      if (parsed.settings.bodyHeightCm === undefined) parsed.settings.bodyHeightCm = null;
      if (parsed.settings.goalWeightKg === undefined) parsed.settings.goalWeightKg = null;
      if (parsed.settings.mascotPosition === undefined) parsed.settings.mascotPosition = null;
      if (parsed.settings.groqApiKey === undefined) parsed.settings.groqApiKey = '';
      if (!parsed.haveToList || parsed.haveToList.date !== todayKey()) {
        parsed.haveToList = { date: todayKey(), items: [] };
      }
      if (!parsed.dailyAdvices) parsed.dailyAdvices = [];
      if (!parsed.weightLogs) parsed.weightLogs = [];
      if (parsed.goals && parsed.goals.dailyProteinTarget === undefined) parsed.goals.dailyProteinTarget = 100;
      return parsed;
    }
  } catch (e) {
    storageAvailable = false;
  }
  return defaultState();
}

let state = loadState();
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    storageAvailable = false;
  }
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let activeLogDate = todayKey();
let favListOpen = false;
let photoSectionOpen = false;
let exerciseListOpen = false;
let themeAccentOpen = false;
let themeBgOpen = false;
let currentTab = 'home';
let weeklyViewMode = 'total';

/* ===== 運動タイマー ===== */
const TIMER_STORAGE_KEY = 'fitnessActiveTimer';

function loadActiveTimer() {
  try {
    const raw = localStorage.getItem(TIMER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function saveActiveTimer(timer) {
  try {
    if (timer) localStorage.setItem(TIMER_STORAGE_KEY, JSON.stringify(timer));
    else localStorage.removeItem(TIMER_STORAGE_KEY);
  } catch (e) {}
}

let activeTimer = loadActiveTimer();
let timerTickInterval = null;

function currentTimerSeconds() {
  if (!activeTimer) return 0;
  return Math.floor((Date.now() - activeTimer.startedAt) / 1000);
}

function startTimer(exerciseId) {
  activeTimer = { exerciseId, startedAt: Date.now() };
  saveActiveTimer(activeTimer);
  render();
}

function stopTimerAndFillInput() {
  if (!activeTimer) return;
  const seconds = currentTimerSeconds();
  activeTimer = null;
  saveActiveTimer(null);
  render();
  const timeInput = document.getElementById('input-time');
  const unitSelect = document.getElementById('input-time-unit');
  if (timeInput) timeInput.value = seconds;
  if (unitSelect) unitSelect.value = '1';
}

function startTimerTickDisplay() {
  if (timerTickInterval) clearInterval(timerTickInterval);
  timerTickInterval = setInterval(() => {
    const el = document.getElementById('timer-live-display');
    if (el && activeTimer) {
      el.textContent = formatDuration(currentTimerSeconds());
    }
  }, 1000);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && activeTimer) {
    const el = document.getElementById('timer-live-display');
    if (el) el.textContent = formatDuration(currentTimerSeconds());
  }
});

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/* ===== マスコット画像 (IndexedDB) ===== */
const IDB_DB_NAME = 'fitnessAppMascotDB';
const IDB_STORE_NAME = 'mascotImages';
let idbInstance = null;
let mascotImageCache = {};

function mascotImageKey(setId, expression) {
  return `${setId}::${expression}`;
}

function openMascotImageDB() {
  if (idbInstance) return Promise.resolve(idbInstance);
  if (!('indexedDB' in window)) return Promise.reject(new Error('indexedDB unsupported'));
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };
    req.onsuccess = () => { idbInstance = req.result; resolve(idbInstance); };
    req.onerror = () => reject(req.error);
  });
}

async function idbSetImage(key, dataUrl) {
  const db = await openMascotImageDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    tx.objectStore(IDB_STORE_NAME).put(dataUrl, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDeleteImage(key) {
  const db = await openMascotImageDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
    tx.objectStore(IDB_STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetAllImages() {
  const db = await openMascotImageDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE_NAME, 'readonly');
    const store = tx.objectStore(IDB_STORE_NAME);
    const keysReq = store.getAllKeys();
    const valuesReq = store.getAll();
    tx.oncomplete = () => {
      const result = {};
      keysReq.result.forEach((k, i) => { result[k] = valuesReq.result[i]; });
      resolve(result);
    };
    tx.onerror = () => reject(tx.error);
  });
}

async function migrateMascotImagesToIDB() {
  try {
    const sets = state.settings.mascotSets || [];
    let migratedAny = false;
    for (const set of sets) {
      if (!set.images) continue;
      for (const exp of Object.keys(set.images)) {
        const val = set.images[exp];
        if (typeof val === 'string' && val.startsWith('data:')) {
          await idbSetImage(mascotImageKey(set.id, exp), val);
          mascotImageCache[mascotImageKey(set.id, exp)] = val;
          delete set.images[exp];
          migratedAny = true;
        }
      }
    }
    if (migratedAny) saveState();
  } catch (e) {
    console.warn('移行失敗:', e);
  }
}

async function loadMascotImageCache() {
  try {
    await migrateMascotImagesToIDB();
    const all = await idbGetAllImages();
    mascotImageCache = { ...mascotImageCache, ...all };
    render();
    renderMascot();
  } catch (e) {
    console.warn('画像読込失敗:', e);
  }
}

const TRASH_ICON_SVG = `<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12M9 7V4a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" /></svg>`;

function applyThemeColors() {
  const root = document.documentElement;
  root.style.setProperty('--gold', state.settings.themeAccent);
  root.style.setProperty('--bg', state.settings.themeBg);
}

function triggerScreenGlow(type) {
  let overlay = document.getElementById('screen-glow-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'screen-glow-overlay';
    overlay.className = 'screen-glow-overlay';
    document.body.appendChild(overlay);
  }
  overlay.className = 'screen-glow-overlay';
  void overlay.offsetWidth;
  overlay.classList.add(type === 'workout' ? 'glow-workout' : 'glow-meal');
}

function getActiveSet() {
  const sets = state.settings.mascotSets;
  return sets.find(s => s.id === state.settings.activeMascotSetId) || sets[0];
}

/* ===== 集計ロジック ===== */
function todaysWorkoutLogs() { return state.workoutLogs.filter(l => l.date === todayKey()); }
function todaysMeals() { return state.meals.filter(m => m.date === todayKey()); }
function todaysCalorieTotal() { return todaysMeals().reduce((sum, m) => sum + (Number(m.calories) || 0), 0); }
function currentLogWorkouts() { return state.workoutLogs.filter(l => l.date === activeLogDate); }
function currentLogMeals() { return state.meals.filter(m => m.date === activeLogDate); }
function currentCalorieTotal() { return currentLogMeals().reduce((sum, m) => sum + (Number(m.calories) || 0), 0); }

function computeStreak() {
  const days = new Set(state.workoutLogs.map(l => l.date));
  let streak = 0;
  let cur = new Date();
  while (true) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    if (days.has(`${y}-${m}-${d}`)) { streak++; cur.setDate(cur.getDate() - 1); } 
    else break;
  }
  return streak;
}

function computeAchievementRateForDate(dateKey) {
  const setCount = state.workoutLogs.filter(l => l.date === dateKey).length;
  const setRate = state.goals.dailySetTarget > 0 ? Math.min(setCount / state.goals.dailySetTarget, 1) : 0;
  const calTotal = state.meals.filter(m => m.date === dateKey).reduce((s, m) => s + (Number(m.calories) || 0), 0);
  const calRate = state.goals.dailyCalorieTarget > 0 ? Math.min(calTotal / state.goals.dailyCalorieTarget, 1) : 0;
  return Math.round((setRate * 0.6 + calRate * 0.4) * 100);
}

function computeAchievementRate() { return computeAchievementRateForDate(todayKey()); }

function previousBestWeight(exerciseId) {
  const weights = state.workoutLogs.filter(l => l.exerciseId === exerciseId && typeof l.weight === 'number').map(l => l.weight);
  return weights.length === 0 ? null : Math.max(...weights);
}

function computeWeeklyRates() {
  const dates = [];
  const cur = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(cur);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    dates.push({ key: `${y}-${m}-${day}`, label: `${d.getMonth() + 1}/${d.getDate()}`, isToday: i === 0 });
  }
  return dates.map(d => {
    const setCount = state.workoutLogs.filter(l => l.date === d.key).length;
    const wRate = state.goals.dailySetTarget > 0 ? Math.min(setCount / state.goals.dailySetTarget, 1) * 100 : 0;
    const calTotal = state.meals.filter(m => m.date === d.key).reduce((s, m) => s + (Number(m.calories) || 0), 0);
    const mRate = state.goals.dailyCalorieTarget > 0 ? Math.min(calTotal / state.goals.dailyCalorieTarget, 1) * 100 : 0;
    const tRate = (wRate * 0.6) + (mRate * 0.4);
    const rate = weeklyViewMode === 'workout' ? wRate : (weeklyViewMode === 'meal' ? mRate : tRate);
    return { ...d, rate: Math.round(rate) };
  });
}

function calculateBMI(heightCm, weightKg) {
  if (!heightCm || !weightKg || heightCm <= 0 || weightKg <= 0) return null;
  const hM = heightCm / 100;
  const bmi = weightKg / (hM * hM);
  const standardWeight = (22 * hM * hM).toFixed(1);
  const diffStandard = (weightKg - standardWeight).toFixed(1);

  let category = ''; let advice = '';
  if (bmi < 18.5) {
    category = '低体重 (痩せ型)';
    const normalMin = (18.5 * hM * hM).toFixed(1);
    const toGain = (normalMin - weightKg).toFixed(1);
    advice = `適正体重は <strong>${standardWeight}kg</strong> です。普通体重の基準まであと <strong>+${toGain}kg</strong> です。しっかり栄養を摂って筋肉量を増やしていきましょう！`;
  } else if (bmi < 25) {
    category = '普通体重 (標準)';
    if (Math.abs(diffStandard) <= 1.5) {
      advice = `適正体重（<strong>${standardWeight}kg</strong>）に非常に近いです！理想的なバランスをキープできています。今のペースを続けましょう！`;
    } else if (diffStandard > 0) {
      advice = `適正体重（BMI 22）の <strong>${standardWeight}kg</strong> まであと <strong>-${diffStandard}kg</strong> です。健康的な標準体型を維持できています！`;
    } else {
      advice = `適正体重（BMI 22）の <strong>${standardWeight}kg</strong> まであと <strong>+${Math.abs(diffStandard)}kg</strong> です。健康的な標準体型です！`;
    }
  } else if (bmi < 30) {
    category = '肥満 (1度)';
    const normalMax = (24.9 * hM * hM).toFixed(1);
    const toLose = (weightKg - normalMax).toFixed(1);
    advice = `普通体重の上限（${normalMax}kg）まであと <strong>-${toLose}kg</strong> の減量が必要です。適正体重（BMI 22）は <strong>${standardWeight}kg</strong> です。少しずつ摂取カロリーを見直していきましょう！`;
  } else {
    category = '肥満 (2度以上)';
    const normalMax = (24.9 * hM * hM).toFixed(1);
    const toLose = (weightKg - normalMax).toFixed(1);
    advice = `普通体重の上限まであと <strong>-${toLose}kg</strong>、適正体重までは <strong>-${diffStandard}kg</strong> です。焦らず筋トレと食事改善をコツコツ進めていきましょう！`;
  }
  return { val: bmi.toFixed(1), category, advice, standardWeight };
}

/* ===== マスコット管理 ===== */
const MASCOT_EXPRESSIONS = ['neutral', 'smile', 'dismay', 'angry', 'sad'];
const MASCOT_EXPRESSION_LABELS = { neutral: '通常', smile: '笑顔', dismay: '困り', angry: '怒り', sad: '悲しい' };
const MASCOT_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="#2a2a26"/><circle cx="35" cy="42" r="6" fill="#6b675e"/><circle cx="65" cy="42" r="6" fill="#6b675e"/><path d="M35 65 Q50 75 65 65" stroke="#6b675e" stroke-width="4" fill="none" stroke-linecap="round"/></svg>`);

function getMascotImage(exp) {
  const active = getActiveSet();
  const cached = mascotImageCache[mascotImageKey(active.id, exp)];
  if (cached) return cached;
  return (active.images && active.images[exp]) || MASCOT_PLACEHOLDER;
}

function resizeImageFile(file, maxSize = 320, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxSize) { height = Math.round(height * (maxSize / width)); width = maxSize; }
        else if (height > maxSize) { width = Math.round(width * (maxSize / height)); height = maxSize; }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const MASCOT_LINES = {
  open: ['今日もがんばろ!', 'おかえり!調子はどう?', 'よし、記録つけていこ!'],
  workoutAdd: ['頑張っててえらいぞ!', 'ナイスセット!その調子!'],
  mealSnackAdd: ['もう、食べすぎたらダメだぞ!', '間食はほどほどにね…'],
  mealNormalAdd: ['ちゃんと記録できてえらい!', 'いいね、その調子!'],
  workoutPR: ['自己ベスト更新、すごいじゃん!'],
  mealOverAngry: ['ちょっと!カロリー上限オーバーしてるじゃん!もう今日はこれ以上食べちゃダメだぞ!']
};

function greetingPrefix() {
  const name = (state.settings.userName || '').trim();
  const h = state.settings.honorific === 'none' ? '' : state.settings.honorific;
  return name ? `${name}${h}、` : '';
}

function pickLine(key) {
  const arr = MASCOT_LINES[key];
  return `${greetingPrefix()}${arr[Math.floor(Math.random() * arr.length)]}`;
}

let mascotExpression = 'neutral';
let mascotMessage = '';
let mascotBubbleVisible = false;
let mascotHideTimer = null;

function addDailyAdvice(source, text) {
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  state.dailyAdvices.unshift({ id: uid(), date: todayKey(), time: timeStr, source: source, text: text });
  if (state.dailyAdvices.length > 20) state.dailyAdvices = state.dailyAdvices.slice(0, 20);
  saveState();
}

function showMascot(expression, message, autoHide = true, saveSource = null) {
  if (!state.settings.mascotEnabled) return;
  mascotExpression = expression;
  mascotMessage = message;
  mascotBubbleVisible = true;
  renderMascot();
  
  if (saveSource && message) {
    addDailyAdvice(saveSource, message);
    if (currentTab === 'home') render();
  }
  
  if (mascotHideTimer) clearTimeout(mascotHideTimer);
  if (autoHide) {
    mascotHideTimer = setTimeout(() => {
      mascotBubbleVisible = false;
      renderMascot();
    }, 5000);
  }
}

let mascotDragState = null;

function applyMascotPosition(wrap) {
  const pos = state.settings.mascotPosition;
  if (pos) {
    wrap.style.left = `${pos.xPercent}%`; wrap.style.top = `${pos.yPercent}%`; wrap.style.right = 'auto'; wrap.style.bottom = 'auto';
  } else {
    wrap.style.left = 'auto'; wrap.style.right = '14px'; wrap.style.top = 'max(76px, calc(env(safe-area-inset-top, 0px) + 66px))'; wrap.style.bottom = 'auto';
  }
}

function attachMascotDrag(btn, wrap) {
  const onPointerDown = (e) => {
    const rect = wrap.getBoundingClientRect();
    mascotDragState = { startX: e.clientX, startY: e.clientY, originLeft: rect.left, originTop: rect.top, moved: false };
    btn.classList.add('dragging');
    try { btn.setPointerCapture(e.pointerId); } catch (err) {}
  };
  const onPointerMove = (e) => {
    if (!mascotDragState) return;
    const dx = e.clientX - mascotDragState.startX; const dy = e.clientY - mascotDragState.startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) mascotDragState.moved = true;
    if (!mascotDragState.moved) return;
    const maxLeft = Math.max(0, window.innerWidth - wrap.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - wrap.offsetHeight);
    const newLeft = Math.min(Math.max(0, mascotDragState.originLeft + dx), maxLeft);
    const newTop = Math.min(Math.max(0, mascotDragState.originTop + dy), maxTop);
    wrap.style.left = `${newLeft}px`; wrap.style.top = `${newTop}px`; wrap.style.right = 'auto'; wrap.style.bottom = 'auto';
  };
  const onPointerUp = (e) => {
    if (!mascotDragState) return;
    btn.classList.remove('dragging');
    if (mascotDragState.moved) {
      const rect = wrap.getBoundingClientRect();
      state.settings.mascotPosition = { xPercent: (rect.left / window.innerWidth) * 100, yPercent: (rect.top / window.innerHeight) * 100 };
      saveState();
    } else {
      mascotBubbleVisible = !mascotBubbleVisible; renderMascot();
    }
    mascotDragState = null;
  };
  btn.addEventListener('pointerdown', onPointerDown); btn.addEventListener('pointermove', onPointerMove);
  btn.addEventListener('pointerup', onPointerUp); btn.addEventListener('pointercancel', onPointerUp);
}

function renderMascot() {
  const wrap = document.getElementById('mascot-wrap');
  if (!wrap) return;
  if (!state.settings.mascotEnabled) { wrap.innerHTML = ''; return; }
  if (typeof lastAdvice !== 'undefined' && lastAdvice && lastAdvice.tab === currentTab) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `
    <div class="mascot-bubble ${mascotBubbleVisible ? 'show' : ''}">${formatAdviceText(mascotMessage)}</div>
    <button class="mascot-avatar-btn" id="mascot-avatar-btn"><img src="${getMascotImage(mascotExpression)}" alt="キャラ"></button>
  `;
  applyMascotPosition(wrap);
  const btn = document.getElementById('mascot-avatar-btn');
  if (btn) attachMascotDrag(btn, wrap);
}

/* ===== AI通信: テキストはGroq、画像認識はGemini ===== */
async function fetchGroqComment(prompt, opts = {}) {
  const apiKey = state.settings.groqApiKey;
  if (!apiKey) {
    alert('設定画面でGroq APIキーを保存してください');
    return null;
  }
  const system = opts.jsonOnly
    ? 'あなたはJSON生成マシンです。指定されたJSON形式のみを返し、前置き・解説・コードフェンスは付けないでください。'
    : personaInstruction() + '回答では、渡された記録データの具体的な数字に必ず触れてください。データに無い栄養素や数値を断定せず、推定が必要な場合は「推定」と明記し幅を持たせてください。一般論の繰り返しではなく、その人の今日の記録に合わせた具体的な次の一手を示してください。Markdown記法(**や#)は絶対に使わず、プレーンな文章で書いてください。';
  const models = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'];
  let lastError = '';
  for (const model of models) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: opts.maxTokens || (opts.jsonOnly ? 200 : 900)
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        lastError = `${res.status}: ${err.error?.message || '不明なエラー'}`;
        if (res.status === 404 || res.status === 400) continue;
        alert(`【Groqエラー】\nコード: ${res.status}\n内容: ${err.error?.message || '不明なエラー'}`);
        return null;
      }
      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content?.trim();
      if (text) return text;
      lastError = 'empty response';
    } catch (e) {
      lastError = e.message;
    }
  }
  alert(`【Groqエラー】\n利用できるモデルがありませんでした。\n内容: ${lastError}`);
  return null;
}

async function fetchGeminiFoodRecognition(file) {
  const apiKey = state.settings.geminiApiKey;
  if (!apiKey) return { error: 'no_key' };
  try {
    let base64Data;
    let mimeType = 'image/jpeg';
    try {
      const dataUrl = await resizeImageFile(file, 1024, 0.82);
      base64Data = dataUrl.slice(dataUrl.indexOf(',') + 1);
    } catch (convErr) {
      base64Data = await fileToBase64Raw(file);
      mimeType = file.type || 'image/jpeg';
    }
    const prompt = '写真の食事全体を見て、料理名(複数ある場合は「○○と△△」のようにまとめる)、推定カロリー(kcal、整数)、推定たんぱく質量(g、整数)、推定脂質量(g、整数)、推定炭水化物量(g、整数)、短い根拠メモを判定し、{\"name\": \"料理名\", \"calories\": 数値, \"protein_g\": 数値, \"fat_g\": 数値, \"carbs_g\": 数値, \"note\": \"根拠を30字以内\"} のJSON形式のみ返してください。量が写真から判断できない部分は一般的な1人前として推定し、前置きや解説はJSON以外に一切付けないでください。';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: base64Data } }, { text: prompt }] }],
        generationConfig: { temperature: 0.2, response_mime_type: 'application/json' }
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { error: 'failed', detail: `${res.status}: ${err.error?.message || '不明なエラー'}` };
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
    if (!text) return { error: 'no_text', detail: 'AIから本文が返りませんでした' };
    const cleaned = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      name: parsed.name,
      calories: Math.round(parsed.calories),
      protein: (parsed.protein_g !== undefined && parsed.protein_g !== null) ? Math.round(parsed.protein_g) : null,
      fat: (parsed.fat_g !== undefined && parsed.fat_g !== null) ? Math.round(parsed.fat_g) : null,
      carbs: (parsed.carbs_g !== undefined && parsed.carbs_g !== null) ? Math.round(parsed.carbs_g) : null,
      note: parsed.note || ''
    };
  } catch (e) {
    return { error: 'exception', detail: e.message };
  }
}


async function fetchGeminiLabelRecognition(file) {
  const apiKey = state.settings.geminiApiKey;
  if (!apiKey) return { error: 'no_key' };
  try {
    let base64Data;
    let mimeType = 'image/jpeg';
    try {
      const dataUrl = await resizeImageFile(file, 1400, 0.85);
      base64Data = dataUrl.slice(dataUrl.indexOf(',') + 1);
    } catch (convErr) {
      base64Data = await fileToBase64Raw(file);
      mimeType = file.type || 'image/jpeg';
    }
    const prompt = '栄養成分表示のラベルを読み取り、商品名(写っていれば)、エネルギー(kcal)、たんぱく質(g)、脂質(g)、炭水化物(g)を抽出してください。値が「1個・1食・1包装あたり」で書かれている場合はその値を、「100gあたり」しか無い場合は100gあたりの値を返し、basis に \"per_item\" か \"per_100g\" を入れてください。{\"name\": \"商品名または空文字\", \"calories\": 数値またはnull, \"protein_g\": 数値またはnull, \"fat_g\": 数値またはnull, \"carbs_g\": 数値またはnull, \"basis\": \"per_item\", \"note\": \"読み取り根拠を30字以内\"} のJSON形式のみ返してください。前置きや解説はJSON以外に一切付けないでください。';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mimeType, data: base64Data } }, { text: prompt }] }],
        generationConfig: { temperature: 0.1, response_mime_type: 'application/json' }
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return { error: 'failed', detail: `${res.status}: ${err.error?.message || '不明なエラー'}` };
    }
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('');
    if (!text) return { error: 'no_text', detail: 'AIから本文が返りませんでした' };
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
    const num = v => (v === null || v === undefined || isNaN(Number(v))) ? null : Math.round(Number(v) * 10) / 10;
    return {
      name: parsed.name || '',
      calories: num(parsed.calories) !== null ? Math.round(Number(parsed.calories)) : null,
      protein: num(parsed.protein_g),
      fat: num(parsed.fat_g),
      carbs: num(parsed.carbs_g),
      basis: parsed.basis || 'per_item',
      note: parsed.note || ''
    };
  } catch (e) {
    return { error: 'exception', detail: e.message };
  }
}

function personaInstruction() {
  const name = (state.settings.userName || '').trim();
  const h = state.settings.honorific === 'none' ? '' : state.settings.honorific;
  const nameNote = name ? `ユーザーの名前は「${name}」です。「${name}${h}」と呼んでください。` : '';
  return `あなたは筋トレ・食事管理アプリの応援キャラです。口調はタメ口寄りのフランクで元気なノリにしてください(「〜だよ」ではなく「〜だぞ!」「〜じゃん!」)。${nameNote}`;
}

/* ===== v28: AIへ渡す文脈と、長文アドバイス表示 ===== */
let lastAdvice = null;

function buildAIContext() {
  const s = state.settings;
  const bmi = calculateBMI(s.bodyHeightCm, s.bodyWeightKg);
  const lines = [];
  lines.push(`プロフィール: 身長${s.bodyHeightCm ?? '未設定'}cm / 体重${s.bodyWeightKg ?? '未設定'}kg${bmi ? ` / BMI ${bmi.val}` : ''}${s.goalWeightKg ? ` / 目標体重 ${s.goalWeightKg}kg` : ''}`);
  lines.push(`目標: 1日 ${state.goals.dailySetTarget}セット / ${state.goals.dailyCalorieTarget}kcalまで / たんぱく質 ${state.goals.dailyProteinTarget || 100}g`);
  const wtInfo = weightTrendInfo();
  if (wtInfo) lines.push(`体重: 最新 ${wtInfo.latest.weight}kg (${wtInfo.latest.date}) / 7日平均 ${wtInfo.avg7 ? wtInfo.avg7.toFixed(1) : '-'}kg${wtInfo.goal ? ` / 目標まで ${Math.max(0, ((wtInfo.avg7 || Number(wtInfo.latest.weight)) - wtInfo.goal)).toFixed(1)}kg` : ''}${wtInfo.weeklyRate !== null ? ` / 直近の変化 約${wtInfo.weeklyRate.toFixed(2)}kg/週` : ''}`);
  const wToday = currentLogWorkouts().map(l => {
    const e2 = state.exercises.find(e => e.id === l.exerciseId);
    const parts = [];
    if (l.weight !== undefined) parts.push(`${l.weight}kg`);
    if (l.reps !== undefined) parts.push(`${l.reps}回`);
    if (l.time !== undefined) parts.push(formatDuration(l.time));
    return `${e2 ? e2.name : '種目'} ${parts.join('×')}`;
  });
  lines.push(`対象日の筋トレ(${currentLogWorkouts().length}セット): ${wToday.length ? wToday.join('、') : 'なし'}`);
  const mToday = currentLogMeals();
  lines.push(`対象日の食事(合計${currentCalorieTotal()}kcal / P${mToday.reduce((sum, m) => sum + (Number(m.protein) || 0), 0)}g / F${mToday.reduce((sum, m) => sum + (Number(m.fat) || 0), 0)}g / C${mToday.reduce((sum, m) => sum + (Number(m.carbs) || 0), 0)}g): ${mToday.length ? mToday.map(m => `${m.category}:${m.name}(${m.calories}kcal${m.protein ? `/P${m.protein}g` : ''}${m.fat ? `/F${m.fat}g` : ''}${m.carbs ? `/C${m.carbs}g` : ''})`).join('、') : 'なし'}`);
  const daily = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const sets = state.workoutLogs.filter(l => l.date === key).length;
    const kcal = state.meals.filter(m => m.date === key).reduce((sum, m) => sum + (Number(m.calories) || 0), 0);
    daily.push(`${key}: ${sets}セット/${kcal}kcal`);
  }
  lines.push(`直近7日: ${daily.join(' / ')}`);
  return lines.join('\n');
}

function formatAdviceText(text) {
  let html = escapeHtml(String(text || ''));
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*/g, '');
  html = html.replace(/^#+\s*/gm, '');
  html = html.replace(/^\s*[-•]\s*/gm, '・');
  return html;
}

function presentAdvice(source, text, expression = 'smile') {
  lastAdvice = { source, text, tab: currentTab };
  addDailyAdvice(source, text);
  showMascot(expression, '詳しいアドバイスを画面の上に表示したぞ! ホームの履歴にも残してあるぞ', true);
  render();
}

function renderLastAdvice() {
  if (!lastAdvice) return '';
  return `
    <div class="advice-card" style="flex-direction:column; gap:8px; align-items:stretch;">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
        <strong>✨ AIアドバイス（${escapeHtml(lastAdvice.source)}）</strong>
        <button type="button" class="secondary" id="close-advice-btn" style="width:auto; padding:4px 10px; font-size:12px;">閉じる</button>
      </div>
      <div style="white-space:pre-wrap;">${formatAdviceText(lastAdvice.text)}</div>
    </div>
  `;
}


/* ===== v32: 体重推移・今日の残り・夕方アラート ===== */
function sortedWeightLogs() {
  return [...(state.weightLogs || [])].sort((a, b) => (a.date < b.date ? -1 : 1));
}
function dateKeyOf(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function weightAvgUpTo(endKey, days) {
  const logs = sortedWeightLogs();
  if (!logs.length) return null;
  const end = new Date(endKey + 'T00:00:00');
  const start = new Date(end); start.setDate(start.getDate() - (days - 1));
  const inRange = logs.filter(l => { const d = new Date(l.date + 'T00:00:00'); return d >= start && d <= end; });
  if (!inRange.length) return null;
  return inRange.reduce((s, l) => s + Number(l.weight), 0) / inRange.length;
}
function weightTrendInfo() {
  const logs = sortedWeightLogs();
  if (!logs.length) return null;
  const latest = logs[logs.length - 1];
  const avg7 = weightAvgUpTo(latest.date, 7);
  const prevEnd = new Date(latest.date + 'T00:00:00'); prevEnd.setDate(prevEnd.getDate() - 7);
  const avgPrev7 = weightAvgUpTo(dateKeyOf(prevEnd), 7);
  const weeklyRate = (avg7 !== null && avgPrev7 !== null) ? (avg7 - avgPrev7) : null;
  const goal = state.settings.goalWeightKg;
  let etaText = '';
  if (goal) {
    const baseVal = avg7 !== null ? avg7 : Number(latest.weight);
    const remain = baseVal - goal;
    if (remain <= 0) etaText = '目標体重に到達しています。この調子でキープしましょう。';
    else if (weeklyRate !== null && weeklyRate < -0.05) {
      const eta = new Date(); eta.setDate(eta.getDate() + Math.round((remain / Math.abs(weeklyRate)) * 7));
      etaText = `今のペース (週 ${weeklyRate.toFixed(2)}kg) なら、到達目安は ${eta.getMonth() + 1}月${eta.getDate()}日頃です`;
    } else {
      etaText = 'ペース予測には、2週間分くらいの記録が貯まるか、減少ペースが出てくる必要があります';
    }
  }
  return { latest, avg7, weeklyRate, goal, etaText };
}
function renderWeightCard() {
  const logs = sortedWeightLogs();
  const info = weightTrendInfo();
  const todayLog = logs.find(l => l.date === todayKey());
  const inputVal = todayLog ? todayLog.weight : (info ? info.latest.weight : (state.settings.bodyWeightKg ?? ''));
  let chartHtml = '';
  if (logs.length >= 2) {
    const pts = logs.slice(-30);
    const vals = pts.map(p => Number(p.weight));
    const avgs = pts.map(p => weightAvgUpTo(p.date, 7));
    let min = Math.min(...vals); let max = Math.max(...vals);
    if (info && info.goal) { min = Math.min(min, info.goal); max = Math.max(max, info.goal); }
    const padV = Math.max(0.5, (max - min) * 0.2); min -= padV; max += padV;
    const W = 320, H = 110, PX = 8, PY = 12;
    const x = i => PX + (W - PX * 2) * (i / (pts.length - 1));
    const y = v => PY + (H - PY * 2) * (1 - (v - min) / (max - min));
    const rawLine = pts.map((p, i) => `${x(i).toFixed(1)},${y(Number(p.weight)).toFixed(1)}`).join(' ');
    const avgLine = pts.map((p, i) => avgs[i] ? `${x(i).toFixed(1)},${y(avgs[i]).toFixed(1)}` : null).filter(Boolean).join(' ');
    const goalLine = (info && info.goal) ? `<line x1="${PX}" y1="${y(info.goal).toFixed(1)}" x2="${W - PX}" y2="${y(info.goal).toFixed(1)}" stroke="#06d6a0" stroke-width="1" stroke-dasharray="4 3"/><text x="${W - PX}" y="${(y(info.goal) - 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#06d6a0">目標 ${info.goal}kg</text>` : '';
    chartHtml = `<svg viewBox="0 0 ${W} ${H}" style="width:100%; height:auto; display:block; margin-top:8px;">${goalLine}<polyline points="${rawLine}" fill="none" stroke="var(--text-muted)" stroke-width="1.5"/>${avgLine ? `<polyline points="${avgLine}" fill="none" stroke="var(--gold)" stroke-width="2.5"/>` : ''}${pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(Number(p.weight)).toFixed(1)}" r="2.5" fill="var(--text-secondary)"/>`).join('')}</svg><div style="display:flex; gap:14px; font-size:11px; color:var(--text-secondary); margin-top:2px;"><span>― 毎日の体重</span><span style="color:var(--gold);">― 7日平均</span></div>`;
  }
  const recent = [...logs].reverse().slice(0, 5).map(l => `
    <div class="list-row" style="padding:8px 0;">
      <span class="sub">${l.date}</span><span class="val">${l.weight} kg</span>
      <button type="button" class="delete-btn" data-delete-weight="${l.id}">${TRASH_ICON_SVG}</button>
    </div>`).join('');
  const summary = info ? `
    <div style="font-size:13px; line-height:1.7;">
      最新: <strong>${info.latest.weight}kg</strong> <span class="sub">(${info.latest.date})</span>${info.avg7 ? ` / 7日平均: <strong>${info.avg7.toFixed(1)}kg</strong>` : ''}<br>
      ${info.goal ? `目標 ${info.goal}kg まで あと <strong>${Math.max(0, ((info.avg7 || Number(info.latest.weight)) - info.goal)).toFixed(1)}kg</strong><br>` : '<span class="sub">設定で目標体重を入れると、残りと到達予測が出ます</span><br>'}
      ${info.etaText ? `<span class="sub">${escapeHtml(info.etaText)}</span>` : ''}
    </div>` : `<div class="empty-hint">まだ体重記録がありません。朝の体重を入れてみてください</div>`;
  return `
    <p class="section-title">体重の推移</p>
    <div class="list-card" style="padding:14px 16px; margin-bottom:12px;">
      ${summary}
      ${chartHtml}
      <div class="row-2" style="margin-top:12px;">
        <input type="number" id="input-weight-today" inputmode="decimal" placeholder="今日の体重 (kg)" value="${inputVal}">
        <button type="button" class="secondary" id="add-weight-btn">${todayLog ? '今日の体重を更新' : '体重を記録'}</button>
      </div>
      ${recent ? `<div style="margin-top:8px;">${recent}</div>` : ''}
    </div>
  `;
}
function todaysPFC() {
  const meals = todaysMeals();
  return {
    kcal: meals.reduce((s, m) => s + (Number(m.calories) || 0), 0),
    protein: meals.reduce((s, m) => s + (Number(m.protein) || 0), 0),
    fat: meals.reduce((s, m) => s + (Number(m.fat) || 0), 0),
    carbs: meals.reduce((s, m) => s + (Number(m.carbs) || 0), 0)
  };
}
function renderRemainingCard() {
  const t = todaysPFC();
  const calTarget = state.goals.dailyCalorieTarget;
  const pTarget = state.goals.dailyProteinTarget || 100;
  const calRemain = calTarget - t.kcal;
  const pRemain = pTarget - t.protein;
  return `
    <p class="section-title">今日の残り</p>
    <div class="stat-grid">
      <div class="stat-card">
        <p class="label"><i class="ti ti-flame"></i>カロリー</p>
        <p class="value gold">${calRemain >= 0 ? `あと ${calRemain.toLocaleString()}` : `${Math.abs(calRemain).toLocaleString()} 超過`} <span class="unit">kcal</span></p>
        <p class="sub" style="margin:4px 0 0;">現在 ${t.kcal.toLocaleString()} / ${calTarget.toLocaleString()} kcal</p>
      </div>
      <div class="stat-card">
        <p class="label"><i class="ti ti-egg"></i>たんぱく質</p>
        <p class="value gold">${pRemain > 0 ? `あと ${pRemain}` : '目標達成'} <span class="unit">g</span></p>
        <p class="sub" style="margin:4px 0 0;">現在 ${t.protein} / ${pTarget} g (F${t.fat}g / C${t.carbs}g)</p>
      </div>
    </div>
  `;
}
function renderRemainingStrip() {
  const t = todaysPFC();
  const calRemain = state.goals.dailyCalorieTarget - t.kcal;
  const pRemain = (state.goals.dailyProteinTarget || 100) - t.protein;
  return `<div class="list-card" style="padding:10px 14px; margin-bottom:12px; font-size:13px;">今日の残り: <strong style="color:var(--gold);">${calRemain >= 0 ? `あと ${calRemain.toLocaleString()}kcal` : `${Math.abs(calRemain).toLocaleString()}kcal超過`}</strong> / たんぱく質 <strong style="color:var(--gold);">${pRemain > 0 ? `あと ${pRemain}g` : '目標達成'}</strong></div>`;
}
function eveningShortfall() {
  if (new Date().getHours() < 17) return null;
  const meals = todaysMeals();
  if (!meals.length) return null;
  const pTotal = meals.reduce((s, m) => s + (Number(m.protein) || 0), 0);
  const pTarget = state.goals.dailyProteinTarget || 100;
  const remain = pTarget - pTotal;
  if (remain < 20) return null;
  return { pTotal, pTarget, remain };
}
function eveningSuggestions(remain) {
  const foods = [
    { name: 'サラダチキン', p: 26 },
    { name: 'ザバス プロテイン', p: 20 },
    { name: 'ツナ缶', p: 12 },
    { name: 'ギリシャヨーグルト', p: 10 },
    { name: 'ゆで卵', p: 6 }
  ];
  const picked = [];
  let rest = remain;
  for (const f of foods) {
    if (rest <= 0 || picked.length >= 3) break;
    picked.push(`${f.name}(${f.p}g)`);
    rest -= f.p;
  }
  return picked.join(' と ');
}
function renderEveningCard() {
  const s = eveningShortfall();
  if (!s) return '';
  return `
    <div class="advice-card" style="margin-bottom:12px;">
      <i class="ti ti-moon"></i>
      <div>
        <div style="font-weight:600; margin-bottom:2px;">夕方チェック: たんぱく質があと ${s.remain}g</div>
        <div>記録では今日 ${s.pTotal}g / 目標 ${s.pTarget}g です。${escapeHtml(eveningSuggestions(s.remain))} で埋められます。</div>
      </div>
    </div>
  `;
}
let eveningAlertShown = false;
function checkEveningAlert() {
  if (eveningAlertShown) return;
  let last = null;
  try { last = localStorage.getItem('fitnessEveningAlertDate'); } catch (e) {}
  if (last === todayKey()) { eveningAlertShown = true; return; }
  const s = eveningShortfall();
  if (!s) return;
  eveningAlertShown = true;
  try { localStorage.setItem('fitnessEveningAlertDate', todayKey()); } catch (e) {}
  showMascot('dismay', `夕方チェックだぞ。今日のたんぱく質は記録では${s.pTotal}gで、目標${s.pTarget}gまであと${s.remain}g足りないぞ。${eveningSuggestions(s.remain)}で埋められるぞ!`, true, '夕方チェック');
}

/* ===== 描画処理 ===== */
function setTab(tab) {
  currentTab = tab;
  render();
  if (tab === 'home') checkEveningAlert();
}

function renderHome() {
  const rate = computeAchievementRate();
  const circumference = 2 * Math.PI * 68;
  const offset = circumference * (1 - rate / 100);
  const setCount = todaysWorkoutLogs().length;
  const calTotal = todaysCalorieTotal();
  const streak = computeStreak();

  const havetoItems = state.haveToList.items.map(item => `
    <div class="haveto-item ${item.done ? 'done' : ''}">
      <input type="checkbox" class="haveto-checkbox" data-haveto-toggle="${item.id}" ${item.done ? 'checked' : ''}>
      <span style="flex:1; font-size:14px;">${escapeHtml(item.text)}</span>
      <button type="button" class="delete-btn" data-haveto-delete="${item.id}">${TRASH_ICON_SVG}</button>
    </div>
  `).join('');

  const weekly = computeWeeklyRates();
  const weeklyAvg = Math.round(weekly.reduce((s, d) => s + d.rate, 0) / weekly.length);

  const todaysAdvices = state.dailyAdvices.filter(a => a.date === todayKey());
  const adviceHtml = todaysAdvices.length > 0 
    ? todaysAdvices.map(a => `
        <div class="advice-card" style="margin-bottom:8px;">
          <i class="ti ti-message-circle"></i>
          <div>
            <div style="font-size:11px; color:var(--text-secondary); margin-bottom:2px;">[${a.time} ${escapeHtml(a.source)}]</div>
            <div style="white-space:pre-wrap;">${formatAdviceText(a.text)}</div>
          </div>
        </div>
      `).join('')
    : `<div class="empty-hint">記録やリクエストをすると、AIがアドバイスをくれるよ。</div>`;

  return `
    <div class="gauge-wrap">
      <svg width="180" height="180" viewBox="0 0 180 180">
        <circle cx="90" cy="90" r="68" fill="none" stroke="var(--border-strong)" stroke-width="14"/>
        <circle cx="90" cy="90" r="68" fill="none" stroke="var(--gold)" stroke-width="14"
          stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"
          transform="rotate(-90 90 90)"/>
        <text x="90" y="86" text-anchor="middle" font-size="34" font-weight="500" fill="var(--text-primary)">${rate}%</text>
        <text x="90" y="108" text-anchor="middle" font-size="13" fill="var(--text-secondary)">本日の達成率</text>
      </svg>
    </div>
    <div class="stat-grid">
      <div class="stat-card">
        <p class="label"><i class="ti ti-flame"></i>本日のカロリー</p>
        <p class="value gold">${calTotal.toLocaleString()} <span class="unit">/ ${state.goals.dailyCalorieTarget.toLocaleString()} kcal</span></p>
      </div>
      <div class="stat-card">
        <p class="label"><i class="ti ti-barbell"></i>本日の筋トレ</p>
        <p class="value">${setCount} <span class="unit">/ ${state.goals.dailySetTarget} セット</span></p>
      </div>
    </div>
    <div class="streak-row">
      <span class="label" style="display:flex;align-items:center;gap:6px;margin:0;"><i class="ti ti-flame-filled" style="color:var(--gold);"></i>連続記録</span>
      <span class="value gold" style="font-size:20px;">${streak}日</span>
    </div>
    ${renderRemainingCard()}
    ${renderEveningCard()}
    ${renderWeightCard()}

    <div class="haveto-wrap">
      <p class="section-title">今日の Have To リスト</p>
      <div class="field" style="margin-bottom:8px;">
        <div class="row-2">
          <input type="text" id="new-haveto-input" placeholder="例: プロテイン飲む">
          <button type="button" class="secondary" id="add-haveto-btn">追加</button>
        </div>
      </div>
      <div class="list-card" style="padding:4px 16px;">
        ${havetoItems || `<div class="empty-hint">今日のタスクはありません</div>`}
      </div>
    </div>

    <p class="section-title">今日のアドバイス履歴</p>
    <div class="list-card" style="padding:12px; max-height:280px; overflow-y:auto; margin-bottom:12px;">
      ${adviceHtml}
    </div>

    <p class="section-title">週間の達成率 (直近7日間)</p>
    <div class="list-card" style="padding:14px 16px; margin-bottom:12px;">
      <div class="row-3" style="margin-bottom:12px;">
        <button type="button" class="secondary weekly-toggle-btn" data-mode="total" style="${weeklyViewMode === 'total' ? 'border-color:var(--gold); color:var(--gold);' : ''}">総合</button>
        <button type="button" class="secondary weekly-toggle-btn" data-mode="workout" style="${weeklyViewMode === 'workout' ? 'border-color:var(--gold); color:var(--gold);' : ''}">筋トレ</button>
        <button type="button" class="secondary weekly-toggle-btn" data-mode="meal" style="${weeklyViewMode === 'meal' ? 'border-color:var(--gold); color:var(--gold);' : ''}">食事</button>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
        <span class="sub">${weeklyViewMode === 'workout' ? '筋トレ' : (weeklyViewMode === 'meal' ? '食事' : '総合')}平均</span>
        <span class="val gold" style="font-size:18px; font-weight:500;">${weeklyAvg}%</span>
      </div>
      <div class="weekly-bar-row">
        ${weekly.map(d => `
          <div class="weekly-bar-col">
            <div class="weekly-bar ${d.isToday ? 'today' : ''}" style="height:${Math.max(3, d.rate)}%;"></div>
            <span class="weekly-bar-label">${d.label}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

let selectedExerciseId = null;
let selectedMetValue = null;

function formatDuration(seconds) {
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}時間${Math.round((seconds % 3600) / 60)}分`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}分${Math.round(seconds % 60)}秒`;
  return `${seconds}秒`;
}

function computeCaloriesBurned(ex, log) {
  const weight = state.settings.bodyWeightKg;
  if (!weight) return null;
  let durationHours = log.time !== undefined ? log.time / 3600 : (log.reps !== undefined ? (log.reps * 3) / 3600 : null);
  if (durationHours === null) return null;
  const met = log.met || (ex && ex.met) || 5.0;
  return Math.round(met * weight * durationHours);
}

function renderWorkout() {
  if (state.exercises.length === 0) return `<div class="empty-hint">まずは種目を追加してください</div>`;
  if (!selectedExerciseId || !state.exercises.find(e => e.id === selectedExerciseId)) {
    selectedExerciseId = state.exercises[0].id;
  }
  const ex = state.exercises.find(e => e.id === selectedExerciseId);
  const exLogsAll = state.workoutLogs.filter(l => l.exerciseId === ex.id);
  const lastLog = exLogsAll.length ? exLogsAll[exLogsAll.length - 1] : null;

  const inputs = [];
  if (ex.trackWeight) inputs.push(`<div class="field"><label>重量 (kg)${lastLog && lastLog.weight !== undefined ? ` <span class="sub">前回: ${lastLog.weight}kg</span>` : ''}</label><input type="number" id="input-weight" inputmode="decimal" placeholder="60" value="${lastLog && lastLog.weight !== undefined ? lastLog.weight : '' }"></div>`);
  if (ex.trackReps) inputs.push(`<div class="field"><label>回数${lastLog && lastLog.reps !== undefined ? ` <span class="sub">前回: ${lastLog.reps}回</span>` : ''}</label><input type="number" id="input-reps" inputmode="numeric" placeholder="10" value="${lastLog && lastLog.reps !== undefined ? lastLog.reps : '' }"></div>`);
  if (ex.trackTime) {
    const isRunningThis = activeTimer && activeTimer.exerciseId === ex.id;
    inputs.push(`
      <div class="field">
        <label>時間 (計測 または 手入力)</label>
        <div class="row-2" style="margin-bottom:8px;">
          <span id="timer-live-display" style="font-size:22px; font-weight:600; display:flex; align-items:center;">${formatDuration(isRunningThis ? currentTimerSeconds() : 0)}</span>
          <button type="button" class="secondary" id="timer-toggle-btn" data-exercise-id="${ex.id}">${isRunningThis ? '⏹ 停止して反映' : '▶ 計測開始'}</button>
        </div>
        <div class="row-2"><input type="number" id="input-time" inputmode="numeric" placeholder="30"><select id="input-time-unit"><option value="1">秒</option><option value="60">分</option><option value="3600">時間</option></select></div>
      </div>`);
  }

  const logs = currentLogWorkouts().filter(l => l.exerciseId === ex.id);
  let totalBurned = 0;
  const logRows = logs.map((l, i) => {
    const parts = [];
    if (l.weight !== undefined) parts.push(`${l.weight}kg`);
    if (l.reps !== undefined) parts.push(`${l.reps}回`);
    if (l.time !== undefined) parts.push(formatDuration(l.time));
    const kcal = computeCaloriesBurned(ex, l);
    if (kcal !== null) totalBurned += kcal;
    return `
      <div class="list-row">
        <div><span class="sub" style="margin-right:8px;">セット${i + 1}</span><span class="val">${parts.join(' × ')}${kcal !== null ? ` <span class="sub">・約${kcal}kcal</span>` : ''}</span></div>
        <button type="button" class="delete-btn" data-delete-workout-log="${l.id}">${TRASH_ICON_SVG}</button>
      </div>`;
  }).join('');

  const exerciseRows = state.exercises.map(e => `
    <div class="list-row" style="padding: 8px 0;">
      <span class="val" style="font-size:13px;">${escapeHtml(e.name)}</span>
      <button type="button" class="delete-btn" data-delete-exercise="${e.id}">${TRASH_ICON_SVG}</button>
    </div>`).join('');
    
  const exerciseSettingsHtml = `
    <button type="button" class="accordion-toggle" id="workout-exercise-toggle-btn" style="margin-top:16px;">
      <span><i class="ti ti-list"></i> ➕ 種目の管理・追加 (${state.exercises.length})</span>
      <i class="ti ${exerciseListOpen ? 'ti-chevron-up' : 'ti-chevron-down'}"></i>
    </button>
    ${exerciseListOpen ? `
      <div class="list-card" style="padding:12px 16px; margin-bottom:16px;">
        <div class="field"><label>新しい種目を追加</label><input type="text" id="new-exercise-name" placeholder="例: ベンチプレス"></div>
        <div class="field">
          <label>記録項目 (複数選択可)</label>
          <div style="display:flex; gap:16px; align-items:center; padding:6px 0;">
            <label style="display:flex; align-items:center; gap:6px; font-size:14px; cursor:pointer;"><input type="checkbox" id="track-weight-chk" checked> 重量</label>
            <label style="display:flex; align-items:center; gap:6px; font-size:14px; cursor:pointer;"><input type="checkbox" id="track-reps-chk" checked> 回数</label>
            <label style="display:flex; align-items:center; gap:6px; font-size:14px; cursor:pointer;"><input type="checkbox" id="track-time-chk"> 時間</label>
          </div>
        </div>
        <button class="primary" id="save-exercise-btn" style="margin-bottom:16px;">種目を追加して選択</button>
        <p class="section-title" style="margin-top:0;">登録済み種目リスト</p>
        ${exerciseRows || `<div class="empty-hint">まだ種目がありません</div>`}
      </div>
    ` : ''}
  `;

  return `
    ${renderLastAdvice()}
    <div class="field">
      <label>記録する日付</label>
      <input type="date" id="active-log-date-workout" value="${activeLogDate}">
    </div>
    <div class="field"><label>種目</label><select id="exercise-select">${state.exercises.map(e => `<option value="${e.id}" ${e.id === ex.id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`).join('')}</select></div>
    <p class="sub" style="margin:0 0 16px;">消費カロリーは種目ごとの強度（MET ${ex.met || 5.0}）からの推定値です。体重・実際のきつさで変わるので目安として見てください。</p>
    ${inputs.join('')}
    <button class="primary" id="add-set-btn">記録を追加</button>
    
    ${exerciseSettingsHtml}
    
    <button type="button" class="secondary" id="req-workout-advice-btn" style="margin-top:16px; width:100%;">✨ 現状からAIに筋トレのアドバイスをもらう</button>

    <p class="section-title">${activeLogDate === todayKey() ? '今日' : activeLogDate} の記録</p>
    <div class="list-card">${logRows || `<div class="empty-hint">まだ記録がありません</div>`}</div>
    ${state.settings.bodyWeightKg ? `<div class="list-card" style="margin-top:12px;"><div class="total-row"><span class="label">消費カロリー(この種目)</span><span class="value">約${totalBurned.toLocaleString()} kcal</span></div></div>` : ''}
  `;
}

let selectedMealCategory = '朝食';
const MEAL_CATEGORIES = ['朝食', '昼食', '間食', '夜ご飯'];

function fileToBase64Raw(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(reader.error);
    reader.onload = () => { const result = reader.result; resolve(result.slice(result.indexOf(',') + 1)); };
    reader.readAsDataURL(file);
  });
}

async function addMealRecord(name, calNum, category, proteinG = null, fatG = null, carbsG = null) {
  const target = state.goals.dailyCalorieTarget;
  const beforeTotal = currentCalorieTotal();
  const afterTotal = beforeTotal + calNum;

  state.meals.push({ id: uid(), category, name, calories: calNum, date: activeLogDate, ...((proteinG !== null && proteinG !== '' && !isNaN(Number(proteinG))) ? { protein: Number(proteinG) } : {}), ...((fatG !== null && fatG !== '' && !isNaN(Number(fatG))) ? { fat: Number(fatG) } : {}), ...((carbsG !== null && carbsG !== '' && !isNaN(Number(carbsG))) ? { carbs: Number(carbsG) } : {}) });
  saveState(); render(); triggerScreenGlow('meal');

  const todaysMealList = currentLogMeals().map(m => `${m.category}:${m.name}(${m.calories}kcal)`).join('、');
  const apiKey = state.settings.groqApiKey;

  if (target > 0 && afterTotal > target) {
    showMascot('angry', 'カロリーオーバー確認中…', false);
    const aiText = await fetchGroqComment(`${personaInstruction()}ユーザーが「${name}」(${calNum}kcal)を食べたことで、本日の摂取カロリーが${afterTotal}kcalとなり、目標の${target}kcalを超えてしまいました。愛情を持って叱るセリフを2文以内で返してください。前置きは不要です。`);
    showMascot('angry', aiText || pickLine('mealOverAngry'), true, `警告`);
  } else if (apiKey) {
    showMascot(category === '間食' ? 'angry' : 'smile', '栄養バランス確認中…', false);
    const expr = category === '間食' ? 'angry' : 'smile';
    const prompt = `ユーザーが「${name}」(${calNum}kcal)を${category}として記録しました。\n${buildAIContext()}\n記録にある数字を根拠に、足りていないものを具体的な食材名と量の目安で2〜3文提案してください。記録に無い栄養素の量は断定しないでください。`;
    let aiText = await fetchGroqComment(prompt);
    if (aiText) aiText = `【${category}：${name} に対して】\n` + aiText;
    showMascot(expr, aiText || pickLine(category === '間食' ? 'mealSnackAdd' : 'mealNormalAdd'), true, `食事記録`);
  } else if (category === '間食') {
    showMascot('angry', pickLine('mealSnackAdd'), true, `食事記録`);
  } else {
    showMascot('smile', pickLine('mealNormalAdd'), true, `食事記録`);
  }
}

function renderMeal() {
  const meals = currentLogMeals();
  const total = currentCalorieTotal();
  const proteinTotal = meals.reduce((s, m) => s + (Number(m.protein) || 0), 0);
  const fatTotal = meals.reduce((s, m) => s + (Number(m.fat) || 0), 0);
  const carbsTotal = meals.reduce((s, m) => s + (Number(m.carbs) || 0), 0);
  const groups = MEAL_CATEGORIES.map(cat => {
    const items = meals.filter(m => m.category === cat);
    if (items.length === 0) return '';
    const rows = items.map(m => `
      <div class="list-row">
        <span class="val">${escapeHtml(m.name)}</span>
        <span style="display:flex; align-items:center; gap:8px;">
          <span class="val gold">${Number(m.calories).toLocaleString()} kcal${m.protein ? ` / P${m.protein}g` : ''}${m.fat ? ` / F${m.fat}g` : ''}${m.carbs ? ` / C${m.carbs}g` : ''}</span>
          <button type="button" class="delete-btn" data-delete-meal="${m.id}">${TRASH_ICON_SVG}</button>
        </span>
      </div>`).join('');
    return `<p class="section-title">${cat}</p><div class="list-card">${rows}</div>`;
  }).join('');

  const favoriteChips = state.favoriteMeals.map(f => `<span class="chip" data-favorite-tap="${f.id}">${escapeHtml(f.name)}(${f.calories}kcal${f.protein ? `/P${f.protein}g` : ''}${f.fat ? `/F${f.fat}g` : ''}${f.carbs ? `/C${f.carbs}g` : ''})<button type="button" class="chip-remove" data-favorite-remove="${f.id}">&times;</button></span>`).join('');

  return `
    ${renderLastAdvice()}
    <div class="field">
      <label>記録する日付</label>
      <input type="date" id="active-log-date-meal" value="${activeLogDate}">
    </div>
    ${activeLogDate === todayKey() ? renderRemainingStrip() : ''}
    <div class="field"><label>区分</label><select id="meal-category-select">${MEAL_CATEGORIES.map(c => `<option value="${c}" ${c === selectedMealCategory ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div class="field">
      <label>食べたもの</label>
      <input type="text" id="meal-name" list="meal-history-list" placeholder="鶏むね肉のサラダ">
      <datalist id="meal-history-list">
        ${[...new Set(state.meals.map(m => m.name))].map(n => `<option value="${escapeHtml(n)}"></option>`).join('')}
      </datalist>
    </div>
    <div class="row-2">
      <div class="field"><label>カロリー (kcal)</label><input type="number" id="meal-calories" inputmode="numeric" placeholder="350"></div>
      <div class="field"><label>たんぱく質 (g)</label><input type="number" id="meal-protein" inputmode="decimal" placeholder="25"></div>
    </div>
    <div class="row-2">
      <div class="field"><label>脂質 (g)</label><input type="number" id="meal-fat" inputmode="decimal" placeholder="15"></div>
      <div class="field"><label>炭水化物 (g)</label><input type="number" id="meal-carbs" inputmode="decimal" placeholder="50"></div>
    </div>
    <button type="button" class="secondary" id="ai-guess-meal-btn" style="margin-bottom:12px;">✨ 文字からAIカロリー・PFC推測 (Groq)</button>
    <button class="primary" id="add-meal-btn">記録を追加</button>
    <button class="secondary" id="save-favorite-btn" style="margin-bottom:12px;">☆ 今の内容を「よく食べるもの」に登録</button>

    <p class="section-title">${activeLogDate === todayKey() ? '今日' : activeLogDate} の記録</p>
    ${groups || `<div class="empty-hint">この日の記録はまだありません</div>`}
    <div class="list-card" style="margin-top:12px;"><div class="total-row"><span class="label">合計</span><span class="value">${total.toLocaleString()} / ${state.goals.dailyCalorieTarget.toLocaleString()} kcal</span></div>${(proteinTotal > 0 || fatTotal > 0 || carbsTotal > 0) ? `<div class="total-row"><span class="label">PFC合計</span><span class="value">P${proteinTotal}g / F${fatTotal}g / C${carbsTotal}g</span></div>` : ''}</div>

    <button type="button" class="accordion-toggle" id="fav-toggle-btn" style="margin-top:16px;">
      <span><i class="ti ti-star"></i> よく食べるものリスト (${state.favoriteMeals.length})</span>
      <i class="ti ${favListOpen ? 'ti-chevron-up' : 'ti-chevron-down'}"></i>
    </button>
    ${favListOpen ? `<div class="chip-row" style="margin-bottom:16px;">${favoriteChips || '<span class="sub" style="padding:6px;">登録がありません</span>'}</div>` : ''}

    <button type="button" class="accordion-toggle" id="photo-toggle-btn">
      <span><i class="ti ti-camera"></i> 写真から入力 (料理 / 成分表示)</span>
      <i class="ti ${photoSectionOpen ? 'ti-chevron-up' : 'ti-chevron-down'}"></i>
    </button>
    ${photoSectionOpen ? `
      <div class="field">
        <label>料理の写真から推測 (見た目からの推定)</label>
        <input type="file" accept="image/*" id="meal-photo-input">
        <div id="meal-photo-status" style="font-size:12px; color:var(--text-secondary); margin-top:4px;"></div>
      </div>
      <div class="field">
        <label>栄養成分表示の写真から読む (市販品はこちらの方が正確)</label>
        <input type="file" accept="image/*" id="meal-label-photo-input">
        <div id="meal-label-photo-status" style="font-size:12px; color:var(--text-secondary); margin-top:4px;"></div>
      </div>
    ` : ''}

    <button type="button" class="secondary" id="req-meal-advice-btn" style="margin-top:8px; width:100%;">✨ 現状からAIに食事のアドバイスをもらう</button>
  `;
}

let selectedHistoryDate = todayKey();
let [calendarYear, calendarMonth] = selectedHistoryDate.split('-').map(Number);

function renderHistory() {
  const dateKey = selectedHistoryDate;
  const workoutLogs = state.workoutLogs.filter(l => l.date === dateKey);
  const meals = state.meals.filter(m => m.date === dateKey);

  let totalWorkoutKcal = 0;
  const workoutRows = workoutLogs.map(l => {
    const ex = state.exercises.find(e => e.id === l.exerciseId);
    const parts = [];
    if (l.weight !== undefined) parts.push(`${l.weight}kg`);
    if (l.reps !== undefined) parts.push(`${l.reps}回`);
    if (l.time !== undefined) parts.push(formatDuration(l.time));
    const kcal = computeCaloriesBurned(ex, l);
    if (kcal !== null) totalWorkoutKcal += kcal;
    return `<div class="list-row"><span class="val">${escapeHtml(ex ? ex.name : '削除済種目')} <span class="sub">${parts.join(' × ')}</span></span><button type="button" class="delete-btn" data-delete-workout-log="${l.id}">${TRASH_ICON_SVG}</button></div>`;
  }).join('');

  let totalMealKcal = 0;
  const mealRows = meals.map(m => {
    totalMealKcal += (Number(m.calories) || 0);
    return `<div class="list-row"><span class="val">${escapeHtml(m.name)} <span class="sub">${m.category}</span></span><span style="display:flex; align-items:center; gap:8px;"><span class="val gold">${Number(m.calories).toLocaleString()} kcal${m.protein ? ` / P${m.protein}g` : ''}${m.fat ? ` / F${m.fat}g` : ''}${m.carbs ? ` / C${m.carbs}g` : ''}</span><button type="button" class="delete-btn" data-delete-meal="${m.id}">${TRASH_ICON_SVG}</button></span></div>`;
  }).join('');

  const netKcal = totalMealKcal - totalWorkoutKcal;

  const firstDay = new Date(calendarYear, calendarMonth - 1, 1).getDay();
  const daysInMonth = new Date(calendarYear, calendarMonth, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(`<div class="calendar-day empty"></div>`);
  for (let d = 1; d <= daysInMonth; d++) {
    const dk = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const hasRec = state.workoutLogs.some(l => l.date === dk) || state.meals.some(m => m.date === dk);
    cells.push(`<button type="button" class="calendar-day ${dk === todayKey() ? 'today' : ''} ${dk === selectedHistoryDate ? 'selected' : ''}" data-calendar-day="${dk}">${d}${hasRec ? '<span class="cal-dot"></span>' : ''}</button>`);
  }

  return `
    <div class="calendar-header">
      <button type="button" class="calendar-nav-btn" id="calendar-prev-btn">‹</button>
      <span style="font-weight:600;">${calendarYear}年${calendarMonth}月</span>
      <button type="button" class="calendar-nav-btn" id="calendar-next-btn">›</button>
    </div>
    <div class="calendar-grid">${['日','月','火','水','木','金','土'].map(w => `<div class="calendar-weekday">${w}</div>`).join('')}${cells.join('')}</div>
    <p class="section-title">${selectedHistoryDate} の筋トレ記録</p>
    <div class="list-card" style="margin-bottom:16px;">${workoutRows || `<div class="empty-hint">この日の筋トレ記録はありません</div>`}</div>
    <p class="section-title">${selectedHistoryDate} の食事記録</p>
    <div class="list-card" style="margin-bottom:16px;">${mealRows || `<div class="empty-hint">この日の食事記録はありません</div>`}</div>
    <p class="section-title">本日の総括</p>
    <div class="list-card" style="margin-top:8px;">
      <div class="total-row"><span class="label">総合カロリー (食事 - 筋トレ)</span><span class="value">${netKcal.toLocaleString()} kcal</span></div>
    </div>
  `;
}

function renderSettings() {
  const activeSet = getActiveSet();
  const bmiData = calculateBMI(state.settings.bodyHeightCm, state.settings.bodyWeightKg);

  return `
    <p class="section-title">基本情報</p>
    <div class="field"><label>名前</label><input type="text" id="user-name" value="${escapeHtml(state.settings.userName || '')}" placeholder="たろう"></div>
    <div class="field"><label>身長 (cm)</label><input type="number" id="body-height" inputmode="decimal" value="${state.settings.bodyHeightCm ?? ''}" placeholder="170"></div>
    <div class="field"><label>体重 (kg)</label><input type="number" id="body-weight" inputmode="decimal" value="${state.settings.bodyWeightKg ?? ''}" placeholder="65"></div>
    <div class="field"><label>目標体重 (kg) ※AIアドバイスの根拠に使います</label><input type="number" id="goal-weight" inputmode="decimal" value="${state.settings.goalWeightKg ?? ''}" placeholder="60"></div>
    <div class="bmi-card"><span class="label" style="margin:0;"><i class="ti ti-calculator"></i> 現在のBMI</span><span class="value gold">${bmiData ? `${bmiData.val} <span class="unit">(${bmiData.category})</span>` : '<span class="sub">身長・体重を入力で計算</span>'}</span></div>
    ${bmiData ? `<div class="bmi-detail-box">💡 ${bmiData.advice}</div>` : ''}
    <button class="primary" id="save-profile-btn" style="margin-bottom:20px;">基本情報を保存</button>

    <p class="section-title">目標設定</p>
    <div class="field"><label>1日の目標セット数</label><input type="number" id="goal-sets" value="${state.goals.dailySetTarget}"></div>
    <div class="field"><label>1日のカロリー上限 (kcal)</label><input type="number" id="goal-calories" value="${state.goals.dailyCalorieTarget}"></div>
    <div class="field"><label>1日のたんぱく質目標 (g)</label><input type="number" id="goal-protein" value="${state.goals.dailyProteinTarget || 100}"></div>
    <button class="primary" id="save-goals-btn" style="margin-bottom:20px;">目標を保存</button>

    <p class="section-title">キャラクター設定</p>
    <div class="list-card" style="padding:4px 16px; margin-bottom:16px;">
      <div class="toggle-row"><span>キャラを表示する</span><label class="switch"><input type="checkbox" id="toggle-mascot-enabled" ${state.settings.mascotEnabled ? 'checked' : ''}><span class="track"></span></label></div>
    </div>
    ${state.settings.mascotEnabled ? `
      <div class="field"><label>キャラクターからの呼ばれ方 (敬称)</label><div class="row-3"><button type="button" class="secondary honorific-btn" data-honorific="さん" style="${state.settings.honorific === 'さん' ? 'border-color:var(--gold); color:var(--gold);' : ''}">さん</button><button type="button" class="secondary honorific-btn" data-honorific="くん" style="${state.settings.honorific === 'くん' ? 'border-color:var(--gold); color:var(--gold);' : ''}">くん</button><button type="button" class="secondary honorific-btn" data-honorific="none" style="${state.settings.honorific === 'none' ? 'border-color:var(--gold); color:var(--gold);' : ''}">呼び捨て</button></div></div>
      <div class="field"><label>表示位置(ドラッグで変更可能)</label><button type="button" class="secondary" id="reset-mascot-position-btn">位置を右上に戻す</button></div>
      <div class="field"><label>使用セット</label><select id="mascot-set-select">${state.settings.mascotSets.map(s => `<option value="${s.id}" ${s.id === state.settings.activeMascotSetId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select></div>
      <div class="field"><label>セット追加</label><div class="row-2"><input type="text" id="new-set-name" placeholder="セット名(例: セットA)"><button type="button" class="secondary" id="add-mascot-set-btn">追加</button></div></div>
      <p class="section-title">画像登録 (端末内保存)</p>
      <div class="list-card" style="padding:12px 16px; margin-bottom:16px;">
        ${MASCOT_EXPRESSIONS.map(exp => `<div class="toggle-row" style="align-items:center;"><span style="display:flex; align-items:center; gap:8px;"><img src="${getMascotImage(exp)}" style="width:36px; height:36px; border-radius:50%; object-fit:cover;">${MASCOT_EXPRESSION_LABELS[exp]}</span><input type="file" accept="image/*" class="mascot-image-input" data-expression="${exp}"></div>`).join('')}
      </div>
    ` : ''}

    <p class="section-title">AI機能設定 (任意)</p>
    <div class="field">
      <label>Groq APIキー (アドバイス・テキスト生成・高速推測)</label>
      <input type="text" id="groq-api-key" value="${escapeHtml(state.settings.groqApiKey || '')}" placeholder="gsk_...">
    </div>
    <div class="field">
      <label>Gemini APIキー (食事の写真解析用)</label>
      <input type="text" id="gemini-api-key" value="${escapeHtml(state.settings.geminiApiKey || '')}" placeholder="AIキーを入力">
    </div>
    <button class="primary" id="save-api-keys-btn" style="margin-bottom:20px;">APIキーを保存</button>

    <p class="section-title">アプリの配色設定</p>
    <button type="button" class="accordion-toggle" id="accent-toggle-btn"><span><i class="ti ti-palette"></i> アクセント色設定 (ボタン・数値)</span><i class="ti ${themeAccentOpen ? 'ti-chevron-up' : 'ti-chevron-down'}"></i></button>
    ${themeAccentOpen ? `<div style="margin-bottom:16px; padding:0 4px;"><div class="color-palette-grid">${PRESET_ACCENTS.map(c => `<button type="button" class="color-swatch-btn ${state.settings.themeAccent === c ? 'active' : ''}" style="background:${c};" data-set-accent="${c}"></button>`).join('')}</div><div class="color-picker-trigger"><i class="ti ti-color-picker"></i> 🎨 微調整パレットを開く<input type="color" id="accent-color-picker" class="color-picker-hidden" value="${state.settings.themeAccent}"></div></div>` : ''}
    <button type="button" class="accordion-toggle" id="bg-toggle-btn"><span><i class="ti ti-brush"></i> 背景色設定</span><i class="ti ${themeBgOpen ? 'ti-chevron-up' : 'ti-chevron-down'}"></i></button>
    ${themeBgOpen ? `<div style="margin-bottom:20px; padding:0 4px;"><div class="color-palette-grid">${PRESET_BACKGROUNDS.map(c => `<button type="button" class="color-swatch-btn ${state.settings.themeBg === c ? 'active' : ''}" style="background:${c};" data-set-bg="${c}"></button>`).join('')}</div><div class="color-picker-trigger"><i class="ti ti-color-picker"></i> 🎨 微調整パレットを開く<input type="color" id="bg-color-picker" class="color-picker-hidden" value="${state.settings.themeBg}"></div></div>` : ''}

    <p class="section-title">バックアップ・データ管理</p>
    <button class="secondary" id="export-backup-btn" style="margin-bottom:10px;">JSONバックアップ保存</button>
    <input type="file" accept="application/json" id="import-backup-input">
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div'); div.textContent = str; return div.innerHTML;
}

const TABS = [
  { id: 'home', label: 'ホーム', icon: 'ti-home' },
  { id: 'workout', label: '筋トレ', icon: 'ti-barbell' },
  { id: 'meal', label: '食事', icon: 'ti-flame' },
  { id: 'history', label: '履歴', icon: 'ti-calendar' },
  { id: 'settings', label: '設定', icon: 'ti-settings' }
];
const TITLES = { home: '今日の記録', workout: '筋トレ記録', meal: '食事・カロリー記録', history: '過去の記録', settings: '設定' };

function render() {
  applyThemeColors();
  const app = document.getElementById('app');
  const dateStr = new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });

  let content = '';
  if (currentTab === 'home') content = renderHome();
  else if (currentTab === 'workout') content = renderWorkout();
  else if (currentTab === 'meal') content = renderMeal();
  else if (currentTab === 'history') content = renderHistory();
  else if (currentTab === 'settings') content = renderSettings();

  app.innerHTML = `
    <div class="topbar" style="display:flex; justify-content:space-between; align-items:center;">
      <div><p class="date">${dateStr}</p><h1>${TITLES[currentTab]}</h1></div>
      <button id="help-btn" style="background:none; border:none; color:var(--text-secondary); font-size:24px; cursor:pointer; padding:4px;"><i class="ti ti-help-circle"></i></button>
    </div>
    <div class="screen">${content}</div>
    <div class="tabbar">${TABS.map(t => `<button class="tab-btn ${t.id === currentTab ? 'active' : ''}" data-tab="${t.id}"><i class="ti ${t.icon}"></i><span>${t.label}</span></button>`).join('')}</div>
    <div class="mascot-wrap" id="mascot-wrap"></div>
    <div id="help-modal" class="modal-overlay" style="display:none;">
      <div class="modal-content">
        <h3 style="margin-top:0;">📖 アプリの使い方</h3>
        <ul style="text-align:left; font-size:13px; color:var(--text-primary); padding-left:20px; line-height:1.6;">
          <li><strong>ホーム:</strong> 日々の達成率や連続記録を確認できます。</li>
          <li><strong>筋トレ:</strong> 種目を選んで記録します。タイマー計測や種目の追加も可能です。</li>
          <li><strong>食事:</strong> 文字からAI推測(Groq)や写真解析(Gemini)が可能です。</li>
          <li><strong>履歴:</strong> 過去の記録や、日々の「総合カロリー」を確認できます。</li>
          <li><strong>設定:</strong> 目標、Groq/Geminiキー、キャラ、配色などを変更できます。</li>
        </ul>
        <button class="primary" id="close-help-btn" style="margin-top:16px;">閉じる</button>
      </div>
    </div>
  `;
  attachEvents(); renderMascot();
}

function attachEvents() {
  document.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));
  const closeAdviceBtn = document.getElementById('close-advice-btn');
  if (closeAdviceBtn) closeAdviceBtn.addEventListener('click', () => { lastAdvice = null; render(); });
  document.querySelectorAll('.weekly-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => { weeklyViewMode = btn.dataset.mode; render(); });
  });

  const addHaveToBtn = document.getElementById('add-haveto-btn');
  if (addHaveToBtn) {
    addHaveToBtn.addEventListener('click', () => {
      const input = document.getElementById('new-haveto-input');
      const text = input.value.trim();
      if (!text) return;
      state.haveToList.items.push({ id: uid(), text, done: false }); saveState(); render();
    });
  }
  const addWeightBtn = document.getElementById('add-weight-btn');
  if (addWeightBtn) {
    addWeightBtn.addEventListener('click', () => {
      const input = document.getElementById('input-weight-today');
      const val = Number(input ? input.value : '');
      if (!val || val < 20 || val > 300) { alert('体重を正しく入力してください'); return; }
      const today = todayKey();
      const existing = state.weightLogs.find(l => l.date === today);
      if (existing) existing.weight = val; else state.weightLogs.push({ id: uid(), date: today, weight: val });
      state.settings.bodyWeightKg = val;
      saveState(); render();
    });
  }
  document.querySelectorAll('[data-delete-weight]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('この体重記録を削除しますか?')) return;
      state.weightLogs = state.weightLogs.filter(l => l.id !== btn.dataset.deleteWeight); saveState(); render();
    });
  });
  document.querySelectorAll('[data-haveto-toggle]').forEach(chk => {
    chk.addEventListener('change', (e) => {
      const item = state.haveToList.items.find(i => i.id === chk.dataset.havetoToggle);
      if (!item) return;
      item.done = chk.checked; saveState();
      if (chk.checked) {
        const parentItem = chk.closest('.haveto-item');
        if (parentItem) {
          const colors = [state.settings.themeAccent, '#ffd166', '#06d6a0', '#ffffff', '#ff7b00'];
          for (let i = 0; i < 10; i++) {
            const dot = document.createElement('span'); dot.className = 'sparkle-particle';
            dot.style.left = `${chk.offsetLeft + 10}px`; dot.style.top = `${chk.offsetTop + 10}px`;
            dot.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            const angle = Math.random() * 2 * Math.PI; const dist = 20 + Math.random() * 35;
            dot.style.setProperty('--dx', `${Math.cos(angle) * dist}px`); dot.style.setProperty('--dy', `${Math.sin(angle) * dist}px`);
            parentItem.appendChild(dot); setTimeout(() => dot.remove(), 600);
          }
        }
        setTimeout(() => render(), 300);
      } else { render(); }
    });
  });
  document.querySelectorAll('[data-haveto-delete]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.haveToList.items = state.haveToList.items.filter(i => i.id !== btn.dataset.havetoDelete); saveState(); render();
    });
  });

  const dateWorkoutInput = document.getElementById('active-log-date-workout');
  if (dateWorkoutInput) { dateWorkoutInput.addEventListener('change', () => { activeLogDate = dateWorkoutInput.value; render(); }); }
  const exerciseSelect = document.getElementById('exercise-select');
  if (exerciseSelect) { exerciseSelect.addEventListener('change', () => { selectedExerciseId = exerciseSelect.value; selectedMetValue = null; render(); }); }
  const metSelect = document.getElementById('input-met');
  if (metSelect) { metSelect.addEventListener('change', () => { selectedMetValue = Number(metSelect.value); }); }
  const timerToggleBtn = document.getElementById('timer-toggle-btn');
  if (timerToggleBtn) {
    timerToggleBtn.addEventListener('click', () => {
      if (activeTimer && activeTimer.exerciseId === timerToggleBtn.dataset.exerciseId) stopTimerAndFillInput();
      else startTimer(timerToggleBtn.dataset.exerciseId);
    });
  }
  if (activeTimer) startTimerTickDisplay();

  const addSetBtn = document.getElementById('add-set-btn');
  if (addSetBtn) {
    addSetBtn.addEventListener('click', async () => {
      const ex = state.exercises.find(e => e.id === selectedExerciseId);
      const log = { id: uid(), exerciseId: ex.id, date: activeLogDate };
      log.met = ex.met || 5.0;
      if (ex.trackWeight) log.weight = Number(document.getElementById('input-weight').value) || 0;
      if (ex.trackReps) log.reps = Number(document.getElementById('input-reps').value) || 0;
      if (ex.trackTime) log.time = (Number(document.getElementById('input-time').value) || 0) * Number(document.getElementById('input-time-unit').value);
      const hasValue = (ex.trackWeight && log.weight > 0) || (ex.trackReps && log.reps > 0) || (ex.trackTime && log.time > 0);
      if (!hasValue) { alert('重量・回数・時間のいずれかを入力してください。空の記録は追加しません。'); return; }
      const prevBest = ex.trackWeight ? previousBestWeight(ex.id) : null;
      state.workoutLogs.push(log); saveState(); render(); triggerScreenGlow('workout');
      
      const isPR = ex.trackWeight && prevBest !== null && log.weight > prevBest;
      const apiKey = state.settings.groqApiKey;
      if (isPR) {
        showMascot('smile', '自己ベスト更新中…!', false);
        const aiText = await fetchGroqComment(`${personaInstruction()}ユーザーが「${ex.name}」で自己新記録(${log.weight}kg)を達成しました！大興奮で褒め称えるセリフを2文以内で返してください。前置きは不要です。`);
        showMascot('smile', aiText || pickLine('workoutPR'), true, `自己ベスト`);
      } else if (apiKey) {
        showMascot('smile', '筋肉バランス確認中…', false);
        const exNamesToday = [...new Set(currentLogWorkouts().map(l => { const e2 = state.exercises.find(e => e.id === l.exerciseId); return e2 ? e2.name : null; }).filter(Boolean))].join('、');
        const prompt = `ユーザーが「${ex.name}」を記録しました。\n${buildAIContext()}\nこの種目で使った部位と、今日の他の種目とのバランスを見て、次にやるべき具体的な種目名かケア方法を、数字や部位名を入れて2〜3文で提案してください。`;
        let aiText = await fetchGroqComment(prompt);
        if (aiText) aiText = `【筋トレ：${ex.name} に対して】\n` + aiText;
        showMascot('smile', aiText || pickLine('workoutAdd'), true, `筋トレ記録`);
      } else { showMascot('smile', pickLine('workoutAdd'), true, `筋トレ記録`); }
    });
  }
  document.querySelectorAll('[data-delete-workout-log]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('この筋トレ記録を削除しますか?')) return;
      state.workoutLogs = state.workoutLogs.filter(l => l.id !== btn.dataset.deleteWorkoutLog); saveState(); render();
    });
  });

  const workoutExerciseToggleBtn = document.getElementById('workout-exercise-toggle-btn');
  if (workoutExerciseToggleBtn) { workoutExerciseToggleBtn.addEventListener('click', () => { exerciseListOpen = !exerciseListOpen; render(); }); }
  const saveExerciseBtn = document.getElementById('save-exercise-btn');
  if (saveExerciseBtn) {
    saveExerciseBtn.addEventListener('click', () => {
      const name = document.getElementById('new-exercise-name').value.trim();
      if (!name) return;
      const trackWeight = document.getElementById('track-weight-chk').checked;
      const trackReps = document.getElementById('track-reps-chk').checked;
      const trackTime = document.getElementById('track-time-chk').checked;
      if (!trackWeight && !trackReps && !trackTime) { alert('重量・回数・時間から1つ以上選択してください'); return; }
      const newEx = { id: uid(), name, trackWeight, trackReps, trackTime };
      state.exercises.push(newEx); selectedExerciseId = newEx.id; saveState(); exerciseListOpen = true; render();
    });
  }
  document.querySelectorAll('[data-delete-exercise]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('削除しますか?')) return;
      state.exercises = state.exercises.filter(e => e.id !== btn.dataset.deleteExercise); saveState(); render();
    });
  });

  const reqWorkoutBtn = document.getElementById('req-workout-advice-btn');
  if (reqWorkoutBtn) {
    reqWorkoutBtn.addEventListener('click', async () => {
      if (!state.settings.groqApiKey) { alert('設定画面からGroq APIキーを登録してください'); return; }
      reqWorkoutBtn.textContent = '✨ AIトレーナーがメニューを考案中…'; reqWorkoutBtn.disabled = true;
      const exNamesToday = [...new Set(currentLogWorkouts().map(l => { const e2 = state.exercises.find(e => e.id === l.exerciseId); return e2 ? e2.name : null; }).filter(Boolean))].join('、');
      const prompt = `次の記録を根拠に、筋トレアドバイスを日本語で書いてください。\n${buildAIContext()}\n\nルール: 全体で350〜450字に収めること。構成は次の3項目のみ、各項目は2文まで。1. 今日の良い点(数字を根拠に) 2. 気になる点 3. 次回の具体メニュー(種目名・セット数・回数・重量の目安)と少し強くする進め方。途中で終わらせず、3.まで必ず書き切ること。Markdown記法(**や#、箇条書きの- )は使わず、見出しは「1. 」のように書くこと。`;
      const aiText = await fetchGroqComment(prompt, { maxTokens: 1200 });
      reqWorkoutBtn.textContent = '✨ 現状からAIに筋トレのアドバイスをもらう'; reqWorkoutBtn.disabled = false;
      if (aiText) presentAdvice('筋トレ相談', aiText);
    });
  }

  const reqMealBtn = document.getElementById('req-meal-advice-btn');
  if (reqMealBtn) {
    reqMealBtn.addEventListener('click', async () => {
      if (!state.settings.groqApiKey) { alert('設定画面からGroq APIキーを登録してください'); return; }
      reqMealBtn.textContent = '✨ AIトレーナーが食事を分析中…'; reqMealBtn.disabled = true;
      const todaysMealList = currentLogMeals().map(m => `${m.category}:${m.name}(${m.calories}kcal)`).join('、');
      const prompt = `次の記録を根拠に、食事アドバイスを日本語で書いてください。\n${buildAIContext()}\n\nルール: 全体で350〜450字に収めること。構成は次の3項目のみ、各項目は2文まで。1. 今日の良い点(数字を根拠に) 2. カロリーとPFC(たんぱく質・脂質・炭水化物)の過不足(記録に無い栄養素は断定せず、料理名からの推定は「推定」と書く) 3. 次の一食の具体案(食材名と量・おおよそのkcalとPFC量)と、目標体重へのペース評価を一言。途中で終わらせず、3.まで必ず書き切ること。Markdown記法(**や#、箇条書きの- )は使わず、見出しは「1. 」のように書くこと。`;
      const aiText = await fetchGroqComment(prompt, { maxTokens: 1200 });
      reqMealBtn.textContent = '✨ 現状からAIに食事のアドバイスをもらう'; reqMealBtn.disabled = false;
      if (aiText) presentAdvice('食事相談', aiText);
    });
  }

  const favToggleBtn = document.getElementById('fav-toggle-btn');
  if (favToggleBtn) { favToggleBtn.addEventListener('click', () => { favListOpen = !favListOpen; render(); }); }
  const photoToggleBtn = document.getElementById('photo-toggle-btn');
  if (photoToggleBtn) { photoToggleBtn.addEventListener('click', () => { photoSectionOpen = !photoSectionOpen; render(); }); }
  document.querySelectorAll('[data-favorite-tap]').forEach(chip => {
    chip.addEventListener('click', (e) => {
      if (e.target.closest('[data-favorite-remove]')) return;
      const fav = state.favoriteMeals.find(f => f.id === chip.dataset.favoriteTap);
      if (fav) addMealRecord(fav.name, fav.calories, selectedMealCategory, (fav.protein !== undefined && fav.protein !== null) ? fav.protein : null, (fav.fat !== undefined && fav.fat !== null) ? fav.fat : null, (fav.carbs !== undefined && fav.carbs !== null) ? fav.carbs : null);
    });
  });
  document.querySelectorAll('[data-favorite-remove]').forEach(btn => {
    btn.addEventListener('click', (e) => { e.stopPropagation(); state.favoriteMeals = state.favoriteMeals.filter(f => f.id !== btn.dataset.favoriteRemove); saveState(); render(); });
  });
  const saveFavoriteBtn = document.getElementById('save-favorite-btn');
  if (saveFavoriteBtn) {
    saveFavoriteBtn.addEventListener('click', () => {
      const name = document.getElementById('meal-name').value.trim(); const cal = document.getElementById('meal-calories').value;
      if (!name || cal === '') { alert('食べたものとカロリーを入力してください'); return; }
      const numOrNull = (id) => { const el = document.getElementById(id); if (!el || el.value === '' || isNaN(Number(el.value))) return null; return Number(el.value); };
      const favData = { calories: Number(cal) };
      const pVal = numOrNull('meal-protein'); if (pVal !== null) favData.protein = pVal;
      const fVal = numOrNull('meal-fat'); if (fVal !== null) favData.fat = fVal;
      const cVal = numOrNull('meal-carbs'); if (cVal !== null) favData.carbs = cVal;
      const existingFav = state.favoriteMeals.find(fv => fv.name === name);
      if (existingFav) { Object.assign(existingFav, favData); } else { state.favoriteMeals.push({ id: uid(), name, ...favData }); }
      saveState(); favListOpen = true; render();
    });
  }

  const mealPhotoInput = document.getElementById('meal-photo-input');
  if (mealPhotoInput) {
    mealPhotoInput.addEventListener('change', async () => {
      const file = mealPhotoInput.files && mealPhotoInput.files[0]; if (!file) return;
      const statusEl = document.getElementById('meal-photo-status');
      if (!state.settings.geminiApiKey) { if (statusEl) statusEl.textContent = '設定画面でGemini APIキーを登録してください'; return; }
      if (statusEl) statusEl.textContent = 'AIが写真から料理とカロリーを解析中…';
      const result = await fetchGeminiFoodRecognition(file);
      if (result.error) { if (statusEl) statusEl.textContent = `判定に失敗しました。手動で入力してください。(詳細: ${result.detail || result.error})`; return; }
      document.getElementById('meal-name').value = result.name; document.getElementById('meal-calories').value = result.calories;
      const proteinInput = document.getElementById('meal-protein');
      if (proteinInput && result.protein !== null && result.protein !== undefined) proteinInput.value = result.protein;
      const fatInput = document.getElementById('meal-fat');
      if (fatInput && result.fat !== null && result.fat !== undefined) fatInput.value = result.fat;
      const carbsInput = document.getElementById('meal-carbs');
      if (carbsInput && result.carbs !== null && result.carbs !== undefined) carbsInput.value = result.carbs;
      if (statusEl) statusEl.textContent = `判定結果を入力しました: ${result.name} (約${result.calories}kcal${result.protein ? ` / たんぱく質約${result.protein}g` : ''}${result.fat ? ` / 脂質約${result.fat}g` : ''}${result.carbs ? ` / 炭水化物約${result.carbs}g` : ''})${result.note ? ` ※${result.note}` : ''} ※量は写真からの推定です。記録前に数字を確認してください`;
    });
  }

  const labelPhotoInput = document.getElementById('meal-label-photo-input');
  if (labelPhotoInput) {
    labelPhotoInput.addEventListener('change', async () => {
      const file = labelPhotoInput.files && labelPhotoInput.files[0]; if (!file) return;
      const statusEl = document.getElementById('meal-label-photo-status');
      if (!state.settings.geminiApiKey) { if (statusEl) statusEl.textContent = '設定画面でGemini APIキーを登録してください'; return; }
      if (statusEl) statusEl.textContent = 'AIが成分表示を読み取り中…';
      const result = await fetchGeminiLabelRecognition(file);
      if (result.error) { if (statusEl) statusEl.textContent = `読み取りに失敗しました。手動で入力してください。(詳細: ${result.detail || result.error})`; return; }
      if (result.name) document.getElementById('meal-name').value = result.name;
      const setVal = (id, v) => { const el = document.getElementById(id); if (el && v !== null && v !== undefined) el.value = v; };
      setVal('meal-calories', result.calories); setVal('meal-protein', result.protein); setVal('meal-fat', result.fat); setVal('meal-carbs', result.carbs);
      if (statusEl) statusEl.textContent = `成分表示から入力しました: ${result.calories ?? '?'}kcal / P${result.protein ?? '?'}g / F${result.fat ?? '?'}g / C${result.carbs ?? '?'}g ${result.basis === 'per_100g' ? '※100gあたりの値です。食べる量に合わせて直してください' : '※1個・1食あたりの値として読みました'}${result.note ? ` ※${result.note}` : ''}`;
    });
  }

  const dateMealInput = document.getElementById('active-log-date-meal');
  if (dateMealInput) { dateMealInput.addEventListener('change', () => { activeLogDate = dateMealInput.value; render(); }); }
  const mealCategorySelect = document.getElementById('meal-category-select');
  if (mealCategorySelect) { mealCategorySelect.addEventListener('change', () => { selectedMealCategory = mealCategorySelect.value; }); }
  const addMealBtn = document.getElementById('add-meal-btn');
  if (addMealBtn) {
    addMealBtn.addEventListener('click', () => {
      const name = document.getElementById('meal-name').value.trim(); const cal = document.getElementById('meal-calories').value;
      if (!name || cal === '') { alert('食べたものとカロリーを入力してください'); return; }
      const proteinVal = document.getElementById('meal-protein') ? document.getElementById('meal-protein').value : '';
      const fatVal = document.getElementById('meal-fat') ? document.getElementById('meal-fat').value : '';
      const carbsVal = document.getElementById('meal-carbs') ? document.getElementById('meal-carbs').value : '';
      addMealRecord(name, Number(cal), document.getElementById('meal-category-select').value, proteinVal === '' ? null : Number(proteinVal), fatVal === '' ? null : Number(fatVal), carbsVal === '' ? null : Number(carbsVal));
    });
  }
  document.querySelectorAll('[data-delete-meal]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('この食事記録を削除しますか?')) return;
      state.meals = state.meals.filter(m => m.id !== btn.dataset.deleteMeal); saveState(); render();
    });
  });

  const prevBtn = document.getElementById('calendar-prev-btn');
  if (prevBtn) { prevBtn.addEventListener('click', () => { calendarMonth--; if (calendarMonth < 1) { calendarMonth = 12; calendarYear--; } render(); }); }
  const nextBtn = document.getElementById('calendar-next-btn');
  if (nextBtn) { nextBtn.addEventListener('click', () => { calendarMonth++; if (calendarMonth > 12) { calendarMonth = 1; calendarYear++; } render(); }); }
  document.querySelectorAll('[data-calendar-day]').forEach(btn => {
    btn.addEventListener('click', () => { selectedHistoryDate = btn.dataset.calendarDay; render(); });
  });

  const saveProfileBtn = document.getElementById('save-profile-btn');
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', () => {
      state.settings.userName = document.getElementById('user-name').value.trim();
      const hVal = document.getElementById('body-height').value; state.settings.bodyHeightCm = hVal === '' ? null : Number(hVal);
      const wVal = document.getElementById('body-weight').value; state.settings.bodyWeightKg = wVal === '' ? null : Number(wVal);
      const gVal = document.getElementById('goal-weight').value; state.settings.goalWeightKg = gVal === '' ? null : Number(gVal);
      saveState(); render(); alert('基本情報を保存しました');
    });
  }

  document.querySelectorAll('.honorific-btn').forEach((btn) => {
    btn.addEventListener('click', () => { state.settings.honorific = btn.dataset.honorific; saveState(); render(); });
  });
  const toggleMascotEnabled = document.getElementById('toggle-mascot-enabled');
  if (toggleMascotEnabled) { toggleMascotEnabled.addEventListener('change', () => { state.settings.mascotEnabled = toggleMascotEnabled.checked; saveState(); render(); }); }
  const mascotSetSelect = document.getElementById('mascot-set-select');
  if (mascotSetSelect) { mascotSetSelect.addEventListener('change', () => { state.settings.activeMascotSetId = mascotSetSelect.value; saveState(); render(); }); }
  const resetMascotPositionBtn = document.getElementById('reset-mascot-position-btn');
  if (resetMascotPositionBtn) { resetMascotPositionBtn.addEventListener('click', () => { state.settings.mascotPosition = null; saveState(); renderMascot(); alert('右上に戻しました'); }); }
  const addMascotSetBtn = document.getElementById('add-mascot-set-btn');
  if (addMascotSetBtn) {
    addMascotSetBtn.addEventListener('click', () => {
      const name = document.getElementById('new-set-name').value.trim(); if (!name) return;
      const id = 'set_' + uid(); state.settings.mascotSets.push({ id, name, images: {} }); state.settings.activeMascotSetId = id; saveState(); render();
    });
  }
  document.querySelectorAll('.mascot-image-input').forEach(input => {
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0]; if (!file) return;
      try {
        const dataUrl = await resizeImageFile(file); const active = getActiveSet();
        const key = mascotImageKey(active.id, input.dataset.expression);
        await idbSetImage(key, dataUrl); mascotImageCache[key] = dataUrl; render();
      } catch (e) { alert('画像の保存に失敗しました。'); }
    });
  });

  const saveGoalsBtn = document.getElementById('save-goals-btn');
  if (saveGoalsBtn) {
    saveGoalsBtn.addEventListener('click', () => {
      state.goals.dailySetTarget = Number(document.getElementById('goal-sets').value) || 0;
      state.goals.dailyCalorieTarget = Number(document.getElementById('goal-calories').value) || 0;
      state.goals.dailyProteinTarget = Number(document.getElementById('goal-protein').value) || 100;
      saveState(); alert('目標を保存しました');
    });
  }

  const saveApiKeysBtn = document.getElementById('save-api-keys-btn');
  if (saveApiKeysBtn) {
    saveApiKeysBtn.addEventListener('click', () => {
      state.settings.groqApiKey = document.getElementById('groq-api-key').value.trim();
      state.settings.geminiApiKey = document.getElementById('gemini-api-key').value.trim();
      saveState();
      alert('APIキーを保存しました');
    });
  }

  const accentToggleBtn = document.getElementById('accent-toggle-btn');
  if (accentToggleBtn) { accentToggleBtn.addEventListener('click', () => { themeAccentOpen = !themeAccentOpen; render(); }); }
  document.querySelectorAll('[data-set-accent]').forEach(btn => { btn.addEventListener('click', () => { state.settings.themeAccent = btn.dataset.setAccent; saveState(); render(); }); });
  const accentPicker = document.getElementById('accent-color-picker');
  if (accentPicker) {
    accentPicker.addEventListener('input', (e) => { state.settings.themeAccent = e.target.value; applyThemeColors(); });
    accentPicker.addEventListener('change', (e) => { state.settings.themeAccent = e.target.value; saveState(); render(); });
  }

  const bgToggleBtn = document.getElementById('bg-toggle-btn');
  if (bgToggleBtn) { bgToggleBtn.addEventListener('click', () => { themeBgOpen = !themeBgOpen; render(); }); }
  document.querySelectorAll('[data-set-bg]').forEach(btn => { btn.addEventListener('click', () => { state.settings.themeBg = btn.dataset.setBg; saveState(); render(); }); });
  const bgPicker = document.getElementById('bg-color-picker');
  if (bgPicker) {
    bgPicker.addEventListener('input', (e) => { state.settings.themeBg = e.target.value; applyThemeColors(); });
    bgPicker.addEventListener('change', (e) => { state.settings.themeBg = e.target.value; saveState(); render(); });
  }

  const exportBackupBtn = document.getElementById('export-backup-btn');
  if (exportBackupBtn) {
    exportBackupBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fitness-backup-${todayKey()}.json`; a.click();
    });
  }
  const importBackupInput = document.getElementById('import-backup-input');
  if (importBackupInput) {
    importBackupInput.addEventListener('change', () => {
      const file = importBackupInput.files && importBackupInput.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { state = JSON.parse(reader.result); saveState(); render(); alert('復元しました'); } catch (e) { alert('失敗しました'); }
      };
      reader.readAsText(file);
    });
  }

  const helpBtn = document.getElementById('help-btn');
  const closeHelpBtn = document.getElementById('close-help-btn');
  const helpModal = document.getElementById('help-modal');
  if (helpBtn && helpModal) { helpBtn.addEventListener('click', () => helpModal.style.display = 'flex'); }
  if (closeHelpBtn && helpModal) { closeHelpBtn.addEventListener('click', () => helpModal.style.display = 'none'); }

  const aiGuessBtn = document.getElementById('ai-guess-meal-btn');
  if (aiGuessBtn) {
    aiGuessBtn.addEventListener('click', async () => {
      const nameInput = document.getElementById('meal-name'); const name = nameInput.value.trim();
      if (!name) { alert('先に食べたものを入力してください'); return; }
      if (!state.settings.groqApiKey) { alert('設定画面からGroq APIキーを登録してください'); return; }
      const prevText = aiGuessBtn.textContent; aiGuessBtn.textContent = '推測中...'; aiGuessBtn.disabled = true;
      const prompt = `料理名「${name}」の一般的な1人前のカロリー(kcal、整数)とたんぱく質量(g、整数)、脂質量(g、整数)、炭水化物量(g、整数)を推測し、{\"calories\": 数値, \"protein_g\": 数値, \"fat_g\": 数値, \"carbs_g\": 数値} のJSON形式のみ返してください。前置きや解説は一切不要です。`;
      const resText = await fetchGroqComment(prompt, { jsonOnly: true });
      aiGuessBtn.textContent = prevText; aiGuessBtn.disabled = false;
      try {
        const cleaned = resText.replace(/```json|```/g, '').trim(); const parsed = JSON.parse(cleaned);
        document.getElementById('meal-calories').value = parsed.calories;
        const proteinInput = document.getElementById('meal-protein');
        if (proteinInput && parsed.protein_g !== undefined && parsed.protein_g !== null && !isNaN(Number(parsed.protein_g))) proteinInput.value = Math.round(Number(parsed.protein_g));
        const fatInput = document.getElementById('meal-fat');
        if (fatInput && parsed.fat_g !== undefined && parsed.fat_g !== null && !isNaN(Number(parsed.fat_g))) fatInput.value = Math.round(Number(parsed.fat_g));
        const carbsInput = document.getElementById('meal-carbs');
        if (carbsInput && parsed.carbs_g !== undefined && parsed.carbs_g !== null && !isNaN(Number(parsed.carbs_g))) carbsInput.value = Math.round(Number(parsed.carbs_g));
      } catch (e) { alert('推測に失敗しました。手動で入力してください。'); }
    });
  }

  const mealNameInput = document.getElementById('meal-name');
  if (mealNameInput) {
    mealNameInput.addEventListener('change', () => {
      const name = mealNameInput.value.trim();
      const sameName = [...state.meals].reverse().filter(m => m.name === name);
      const pastMeal = sameName[0];
      const calInput = document.getElementById('meal-calories');
      if (pastMeal && !calInput.value) { calInput.value = pastMeal.calories; }
      const fillLatest = (inputId, key) => {
        const input = document.getElementById(inputId);
        if (!input || input.value) return;
        const rec = sameName.find(m => m[key] !== undefined && m[key] !== null);
        if (rec) input.value = rec[key];
      };
      fillLatest('meal-protein', 'protein');
      fillLatest('meal-fat', 'fat');
      fillLatest('meal-carbs', 'carbs');
    });
  }
}

applyThemeColors();
render();
if (state.settings.mascotEnabled) showMascot('neutral', pickLine('open'));
checkEveningAlert();
loadMascotImageCache();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
