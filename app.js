/* ===== データ管理 ===== */
const STORAGE_KEY = 'fitnessAppData';
let storageAvailable = true;

function defaultState() {
  return {
    exercises: [
      { id: 'ex1', name: 'ベンチプレス', trackWeight: true, trackReps: true, trackTime: false },
      { id: 'ex2', name: 'プランク', trackWeight: false, trackReps: false, trackTime: true }
    ],
    workoutLogs: [],
    meals: [],
    goals: { dailySetTarget: 4, dailyCalorieTarget: 2000 },
    settings: {
      geminiApiKey: '',
      userName: '',
      honorific: 'さん',
      bodyWeightKg: null,
      mascotEnabled: true,
      activeMascotSetId: 'set_default',
      mascotSets: [{ id: 'set_default', name: 'デフォルト', images: {} }]
    },
    favoriteMeals: []
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.settings.mascotSets) {
        const oldImages = parsed.settings.mascotImages || {};
        parsed.settings.mascotSets = [{ id: 'set_default', name: 'デフォルト', images: oldImages }];
        parsed.settings.activeMascotSetId = 'set_default';
      }
      if (parsed.settings.mascotEnabled === undefined) parsed.settings.mascotEnabled = true;
      return parsed;
    }
  } catch (e) {
    storageAvailable = false;
  }
  return defaultState();
}

let state = loadState();
if (!state.settings) state.settings = defaultState().settings;
if (!state.settings.mascotSets || state.settings.mascotSets.length === 0) {
  state.settings.mascotSets = [{ id: 'set_default', name: 'デフォルト', images: {} }];
  state.settings.activeMascotSetId = 'set_default';
}
if (state.settings.mascotEnabled === undefined) state.settings.mascotEnabled = true;
if (!state.favoriteMeals) state.favoriteMeals = [];

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    storageAvailable = false;
  }
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function getActiveSet() {
  const sets = state.settings.mascotSets;
  return sets.find(s => s.id === state.settings.activeMascotSetId) || sets[0];
}

const TRASH_ICON_SVG = `<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12M9 7V4a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"/></svg>`;

/* ===== 集計ロジック ===== */
function todaysWorkoutLogs() {
  return state.workoutLogs.filter(l => l.date === todayKey());
}

function todaysMeals() {
  return state.meals.filter(m => m.date === todayKey());
}

function todaysCalorieTotal() {
  return todaysMeals().reduce((sum, m) => sum + (Number(m.calories) || 0), 0);
}

function computeStreak() {
  const days = new Set(state.workoutLogs.map(l => l.date));
  let streak = 0;
  let cur = new Date();
  while (true) {
    const key = cur.toISOString().slice(0, 10);
    if (days.has(key)) {
      streak++;
      cur.setDate(cur.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

function computeAchievementRateForDate(dateKey) {
  const goals = state.goals;
  const setCount = state.workoutLogs.filter(l => l.date === dateKey).length;
  const setRate = goals.dailySetTarget > 0 ? Math.min(setCount / goals.dailySetTarget, 1) : 0;
  const calTotal = state.meals.filter(m => m.date === dateKey).reduce((s, m) => s + (Number(m.calories) || 0), 0);
  const calRate = goals.dailyCalorieTarget > 0 ? Math.min(calTotal / goals.dailyCalorieTarget, 1) : 0;
  return Math.round((setRate * 0.6 + calRate * 0.4) * 100);
}

function computeAchievementRate() {
  return computeAchievementRateForDate(todayKey());
}

function previousBestWeight(exerciseId) {
  const weights = state.workoutLogs.filter(l => l.exerciseId === exerciseId && typeof l.weight === 'number').map(l => l.weight);
  return weights.length === 0 ? null : Math.max(...weights);
}

function computeWeeklyAverageRate() {
  const dates = [];
  const cur = new Date();
  for (let i = 0; i < 7; i++) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() - 1);
  }
  const total = dates.reduce((sum, d) => sum + computeAchievementRateForDate(d), 0);
  return Math.round(total / dates.length);
}

/* ===== マスコット ===== */
const MASCOT_EXPRESSIONS = ['neutral', 'smile', 'dismay', 'angry', 'sad'];
const MASCOT_EXPRESSION_LABELS = { neutral: '通常', smile: '笑顔', dismay: '困り', angry: '怒り', sad: '悲しい' };
const MASCOT_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="50" fill="#2a2a26"/>
  <circle cx="35" cy="42" r="6" fill="#6b675e"/>
  <circle cx="65" cy="42" r="6" fill="#6b675e"/>
  <path d="M35 65 Q50 75 65 65" stroke="#6b675e" stroke-width="4" fill="none" stroke-linecap="round"/>
</svg>`);

function getMascotImage(expression) {
  const activeSet = getActiveSet();
  return (activeSet.images && activeSet.images[expression]) || MASCOT_PLACEHOLDER;
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
        if (width > height && width > maxSize) {
          height = Math.round(height * (maxSize / width));
          width = maxSize;
        } else if (height > maxSize) {
          width = Math.round(width * (maxSize / height));
          height = maxSize;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const MASCOT_LINES = {
  open: ['今日もがんばろ!', 'おかえり!今日の調子はどう?', 'よし、今日も記録つけていこ!'],
  monday: ['今週もがんばろ!応援してるよ!', '新しい週スタート!一緒にがんばろ!'],
  workoutAdd: ['頑張っててえらいぞ!', 'ナイスセット!その調子!'],
  mealSnackAdd: ['もう、食べすぎたらダメだぞ!', '間食はほどほどにね…'],
  mealNormalAdd: ['ちゃんと記録できてえらい!', 'いいね、その調子!'],
  weeklyGood: ['すごいよ!今週は達成率{rate}%、めっちゃがんばったね!'],
  weeklyMid: ['今週は{rate}%。まあまあだけど、来週はもう一声いこう!'],
  weeklyBad: ['今週は{rate}%…ちょっと物足りないぞ。来週はがんばろ!'],
  workoutPR: ['自己ベスト更新、めっちゃすごいじゃん!'],
  mealOverTarget: ['あちゃー、今日はカロリーオーバーしちゃったね。明日調整しよ!']
};

function greetingPrefix() {
  const name = (state.settings.userName || '').trim();
  const h = state.settings.honorific === 'none' ? '' : state.settings.honorific;
  return name ? `${name}${h}、` : '';
}

function pickLine(key, rate) {
  const arr = MASCOT_LINES[key];
  const line = arr[Math.floor(Math.random() * arr.length)];
  return `${greetingPrefix()}${rate !== undefined ? line.replace('{rate}', rate) : line}`;
}

let mascotExpression = 'neutral';
let mascotMessage = '';
let mascotBubbleVisible = false;
let mascotHideTimer = null;

function showMascot(expression, message, autoHide = true) {
  if (!state.settings.mascotEnabled) return;
  mascotExpression = expression;
  mascotMessage = message;
  mascotBubbleVisible = true;
  renderMascot();
  if (mascotHideTimer) clearTimeout(mascotHideTimer);
  if (autoHide) {
    mascotHideTimer = setTimeout(() => {
      mascotBubbleVisible = false;
      renderMascot();
    }, 5000);
  }
}

function renderMascot() {
  const wrap = document.getElementById('mascot-wrap');
  if (!wrap) return;
  if (!state.settings.mascotEnabled) {
    wrap.innerHTML = '';
    return;
  }
  wrap.innerHTML = `
    <div class="mascot-bubble ${mascotBubbleVisible ? 'show' : ''}">${escapeHtml(mascotMessage)}</div>
    <button class="mascot-avatar-btn" id="mascot-avatar-btn">
      <img src="${getMascotImage(mascotExpression)}" alt="キャラ">
    </button>
  `;
  const btn = document.getElementById('mascot-avatar-btn');
  if (btn) {
    btn.addEventListener('click', () => {
      mascotBubbleVisible = !mascotBubbleVisible;
      renderMascot();
    });
  }
}

async function fetchGeminiComment(prompt) {
  const apiKey = state.settings.geminiApiKey;
  if (!apiKey) return null;
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (e) {
    return null;
  }
}

function personaInstruction() {
  const name = (state.settings.userName || '').trim();
  const h = state.settings.honorific === 'none' ? '' : state.settings.honorific;
  const nameNote = name ? `ユーザーの名前は「${name}」です。「${name}${h}」と呼んでください。` : '';
  return `筋トレ管理アプリの応援キャラとして口調はタメ口寄りのフランクで元気なノリにしてください。${nameNote}`;
}

async function runMascotOpeningLogic() {
  if (!state.settings.mascotEnabled) return;
  const day = new Date().getDay();
  if (day === 0) {
    const rate = computeWeeklyAverageRate();
    const expression = rate >= 80 ? 'smile' : rate >= 50 ? 'neutral' : 'dismay';
    const fallbackKey = rate >= 80 ? 'weeklyGood' : rate >= 50 ? 'weeklyMid' : 'weeklyBad';
    showMascot('neutral', '今週の振り返り中…', false);
    const aiText = await fetchGeminiComment(`${personaInstruction()}今週の目標達成率は${rate}%でした。感情を込め日本語で2文以内でセリフのみ返してください。`);
    showMascot(expression, aiText || pickLine(fallbackKey, rate));
  } else if (day === 1) {
    showMascot('smile', pickLine('monday'));
  } else {
    showMascot('neutral', pickLine('open'));
  }
}

/* ===== ルーター ===== */
let currentTab = 'home';
function setTab(tab) {
  currentTab = tab;
  render();
}

/* ===== 描画: ホーム ===== */
function renderHome() {
  const rate = computeAchievementRate();
  const circumference = 2 * Math.PI * 68;
  const offset = circumference * (1 - rate / 100);
  const setCount = todaysWorkoutLogs().length;
  const calTotal = todaysCalorieTotal();
  const streak = computeStreak();

  return `
    <div class="gauge-wrap">
      <svg width="180" height="180" viewBox="0 0 180 180">
        <circle cx="90" cy="90" r="68" fill="none" stroke="var(--border-strong)" stroke-width="14"/>
        <circle cx="90" cy="90" r="68" fill="none" stroke="var(--gold)" stroke-width="14"
          stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"
          transform="rotate(-90 90 90)"/>
        <text x="90" y="86" text-anchor="middle" font-size="34" font-weight="500" fill="var(--text-primary)">${rate}%</text>
        <text x="90" y="108" text-anchor="middle" font-size="13" fill="var(--text-secondary)">ノルマ達成率</text>
      </svg>
    </div>
    <div class="stat-grid">
      <div class="stat-card">
        <p class="label"><i class="ti ti-flame"></i>カロリー</p>
        <p class="value gold">${calTotal.toLocaleString()} <span class="unit">/ ${state.goals.dailyCalorieTarget.toLocaleString()} kcal</span></p>
      </div>
      <div class="stat-card">
        <p class="label"><i class="ti ti-barbell"></i>筋トレ</p>
        <p class="value">${setCount} <span class="unit">/ ${state.goals.dailySetTarget} セット</span></p>
      </div>
    </div>
    <div class="streak-row">
      <span class="label" style="display:flex;align-items:center;gap:6px;margin:0;"><i class="ti ti-flame-filled" style="color:var(--gold);"></i>連続記録</span>
      <span class="value gold" style="font-size:20px;">${streak}日</span>
    </div>
  `;
}

/* ===== 描画: 筋トレ ===== */
let selectedExerciseId = null;

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
  const met = (ex && ex.met) || 5.0;
  return Math.round(met * weight * durationHours);
}

function renderWorkout() {
  if (state.exercises.length === 0) return `<div class="empty-hint">設定タブから種目を登録してください</div>`;
  if (!selectedExerciseId || !state.exercises.find(e => e.id === selectedExerciseId)) {
    selectedExerciseId = state.exercises[0].id;
  }
  const ex = state.exercises.find(e => e.id === selectedExerciseId);

  const inputs = [];
  if (ex.trackWeight) inputs.push(`<div class="field"><label>重量 (kg)</label><input type="number" id="input-weight" inputmode="decimal" placeholder="60"></div>`);
  if (ex.trackReps) inputs.push(`<div class="field"><label>回数</label><input type="number" id="input-reps" inputmode="numeric" placeholder="10"></div>`);
  if (ex.trackTime) inputs.push(`<div class="field"><label>時間</label><div class="row-2"><input type="number" id="input-time" inputmode="numeric" placeholder="30"><select id="input-time-unit"><option value="1">秒</option><option value="60">分</option><option value="3600">時間</option></select></div></div>`);

  const logs = todaysWorkoutLogs().filter(l => l.exerciseId === ex.id);
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

  return `
    <div class="field"><label>種目</label><select id="exercise-select">${state.exercises.map(e => `<option value="${e.id}" ${e.id === ex.id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`).join('')}</select></div>
    ${inputs.join('')}
    <button class="primary" id="add-set-btn">記録を追加</button>
    <p class="section-title">今日の記録</p>
    <div class="list-card">${logRows || `<div class="empty-hint">まだ記録がありません</div>`}</div>
    ${state.settings.bodyWeightKg ? `<div class="list-card" style="margin-top:12px;"><div class="total-row"><span class="label">消費カロリー(この種目)</span><span class="value">約${totalBurned.toLocaleString()} kcal</span></div></div>` : ''}
  `;
}

/* ===== 描画: 食事 ===== */
let selectedMealCategory = '朝食';
const MEAL_CATEGORIES = ['朝食', '昼食', '間食', '夜ご飯'];

function addMealRecord(name, calNum, category) {
  state.meals.push({ id: uid(), category, name, calories: calNum, date: todayKey() });
  saveState();
  render();
  showMascot('smile', pickLine(category === '間食' ? 'mealSnackAdd' : 'mealNormalAdd'));
}

function renderMeal() {
  const meals = todaysMeals();
  const total = todaysCalorieTotal();

  const groups = MEAL_CATEGORIES.map(cat => {
    const items = meals.filter(m => m.category === cat);
    if (items.length === 0) return '';
    const rows = items.map(m => `
      <div class="list-row">
        <span class="val">${escapeHtml(m.name)}</span>
        <span style="display:flex; align-items:center; gap:8px;">
          <span class="val gold">${Number(m.calories).toLocaleString()} kcal</span>
          <button type="button" class="delete-btn" data-delete-meal="${m.id}">${TRASH_ICON_SVG}</button>
        </span>
      </div>`).join('');
    return `<p class="section-title">${cat}</p><div class="list-card">${rows}</div>`;
  }).join('');

  const favoriteChips = state.favoriteMeals.map(f => `
    <span class="chip" data-favorite-tap="${f.id}">${escapeHtml(f.name)}(${f.calories}kcal)<button type="button" class="chip-remove" data-favorite-remove="${f.id}">&times;</button></span>
  `).join('');

  return `
    ${state.favoriteMeals.length > 0 ? `<p class="section-title">よく食べるもの</p><div class="chip-row">${favoriteChips}</div>` : ''}
    <div class="field"><label>区分</label><select id="meal-category-select">${MEAL_CATEGORIES.map(c => `<option value="${c}" ${c === selectedMealCategory ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div class="field"><label>食べたもの</label><input type="text" id="meal-name" placeholder="鶏むね肉のサラダ"></div>
    <div class="field"><label>カロリー (kcal)</label><input type="number" id="meal-calories" inputmode="numeric" placeholder="350"></div>
    <button class="primary" id="add-meal-btn">記録を追加</button>
    <button class="secondary" id="save-favorite-btn" style="margin-bottom:16px;">☆ よく食べるものに登録</button>
    ${groups || `<div class="empty-hint">今日の記録はまだありません</div>`}
    <div class="list-card" style="margin-top:12px;"><div class="total-row"><span class="label">合計</span><span class="value">${total.toLocaleString()} / ${state.goals.dailyCalorieTarget.toLocaleString()} kcal</span></div></div>
  `;
}

/* ===== 描画: 履歴 ===== */
let selectedHistoryDate = todayKey();
let [calendarYear, calendarMonth] = selectedHistoryDate.split('-').map(Number);

function renderHistory() {
  const dateKey = selectedHistoryDate;
  const workoutLogs = state.workoutLogs.filter(l => l.date === dateKey);
  const meals = state.meals.filter(m => m.date === dateKey);

  const workoutRows = workoutLogs.map(l => {
    const ex = state.exercises.find(e => e.id === l.exerciseId);
    const parts = [];
    if (l.weight !== undefined) parts.push(`${l.weight}kg`);
    if (l.reps !== undefined) parts.push(`${l.reps}回`);
    if (l.time !== undefined) parts.push(formatDuration(l.time));
    return `
      <div class="list-row">
        <span class="val">${escapeHtml(ex ? ex.name : '削除済種目')} <span class="sub">${parts.join(' × ')}</span></span>
        <button type="button" class="delete-btn" data-delete-workout-log="${l.id}">${TRASH_ICON_SVG}</button>
      </div>`;
  }).join('');

  const mealRows = meals.map(m => `
    <div class="list-row">
      <span class="val">${escapeHtml(m.name)} <span class="sub">${m.category}</span></span>
      <span style="display:flex; align-items:center; gap:8px;">
        <span class="val gold">${Number(m.calories).toLocaleString()} kcal</span>
        <button type="button" class="delete-btn" data-delete-meal="${m.id}">${TRASH_ICON_SVG}</button>
      </span>
    </div>`).join('');

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
      <span>${calendarYear}年${calendarMonth}月</span>
      <button type="button" class="calendar-nav-btn" id="calendar-next-btn">›</button>
    </div>
    <div class="calendar-grid">
      ${['日','月','火','水','木','金','土'].map(w => `<div class="calendar-weekday">${w}</div>`).join('')}
      ${cells.join('')}
    </div>
    <p class="section-title">${selectedHistoryDate} の筋トレ記録</p>
    <div class="list-card" style="margin-bottom:16px;">${workoutRows || `<div class="empty-hint">記録なし</div>`}</div>
    <p class="section-title">${selectedHistoryDate} の食事記録</p>
    <div class="list-card">${mealRows || `<div class="empty-hint">記録なし</div>`}</div>
  `;
}

/* ===== 描画: 設定 ===== */
function renderSettings() {
  const activeSet = getActiveSet();
  const exerciseRows = state.exercises.map(e => `
    <div class="list-row">
      <span class="val">${escapeHtml(e.name)}</span>
      <button type="button" class="delete-btn" data-delete-exercise="${e.id}">${TRASH_ICON_SVG}</button>
    </div>`).join('');

  return `
    <p class="section-title">基本設定</p>
    <div class="field"><label>名前</label><input type="text" id="user-name" value="${escapeHtml(state.settings.userName || '')}" placeholder="たろう"></div>
    <div class="field"><label>体重 (kg)</label><input type="number" id="body-weight" value="${state.settings.bodyWeightKg ?? ''}" placeholder="60"></div>
    <button class="primary" id="save-profile-btn">基本情報を保存</button>

    <p class="section-title">種目登録</p>
    <div class="field"><label>種目名</label><input type="text" id="new-exercise-name" placeholder="腕立て伏せ"></div>
    <button class="primary" id="save-exercise-btn">種目を追加</button>
    <div class="list-card" style="margin-bottom:20px;">${exerciseRows || `<div class="empty-hint">種目なし</div>`}</div>

    <p class="section-title">キャラクター表示</p>
    <div class="list-card" style="padding:4px 16px; margin-bottom:16px;">
      <div class="toggle-row">
        <span>キャラを表示する</span>
        <label class="switch"><input type="checkbox" id="toggle-mascot-enabled" ${state.settings.mascotEnabled ? 'checked' : ''}><span class="track"></span></label>
      </div>
    </div>

    <p class="section-title">キャラセット管理</p>
    <div class="field">
      <label>使用セット</label>
      <select id="mascot-set-select">${state.settings.mascotSets.map(s => `<option value="${s.id}" ${s.id === state.settings.activeMascotSetId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select>
    </div>
    <div class="field">
      <label>セット追加</label>
      <div class="row-2">
        <input type="text" id="new-set-name" placeholder="セット名(例: セットA)">
        <button type="button" class="secondary" id="add-mascot-set-btn">追加</button>
      </div>
    </div>

    <p class="section-title">画像登録 (端末内保存)</p>
    <div class="list-card" style="padding:12px 16px; margin-bottom:16px;">
      ${MASCOT_EXPRESSIONS.map(exp => `
        <div class="toggle-row" style="align-items:center;">
          <span style="display:flex; align-items:center; gap:8px;">
            <img src="${getMascotImage(exp)}" style="width:32px; height:32px; border-radius:50%; object-fit:cover;">
            ${MASCOT_EXPRESSION_LABELS[exp]}
          </span>
          <input type="file" accept="image/*" class="mascot-image-input" data-expression="${exp}">
        </div>`).join('')}
    </div>

    <p class="section-title">目標設定</p>
    <div class="field"><label>1日の目標セット数</label><input type="number" id="goal-sets" value="${state.goals.dailySetTarget}"></div>
    <div class="field"><label>1日のカロリー上限</label><input type="number" id="goal-calories" value="${state.goals.dailyCalorieTarget}"></div>
    <button class="primary" id="save-goals-btn">目標を保存</button>

    <p class="section-title">Gemini APIキー(任意)</p>
    <div class="field"><input type="text" id="gemini-api-key" value="${escapeHtml(state.settings.geminiApiKey || '')}" placeholder="APIキー"></div>
    <button class="primary" id="save-api-key-btn">APIキーを保存</button>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ===== メイン描画 ===== */
const TABS = [
  { id: 'home', label: 'ホーム', icon: 'ti-home' },
  { id: 'workout', label: '筋トレ', icon: 'ti-barbell' },
  { id: 'meal', label: '食事', icon: 'ti-flame' },
  { id: 'history', label: '履歴', icon: 'ti-calendar' },
  { id: 'settings', label: '設定', icon: 'ti-settings' }
];

function render() {
  const app = document.getElementById('app');
  let content = '';
  if (currentTab === 'home') content = renderHome();
  else if (currentTab === 'workout') content = renderWorkout();
  else if (currentTab === 'meal') content = renderMeal();
  else if (currentTab === 'history') content = renderHistory();
  else if (currentTab === 'settings') content = renderSettings();

  app.innerHTML = `
    <div class="topbar"><h1 style="margin:0;">筋トレ・食事管理</h1></div>
    <div class="screen">${content}</div>
    <div class="tabbar">
      ${TABS.map(t => `<button class="tab-btn ${t.id === currentTab ? 'active' : ''}" data-tab="${t.id}"><i class="ti ${t.icon}"></i><span>${t.label}</span></button>`).join('')}
    </div>
    <div class="mascot-wrap" id="mascot-wrap"></div>
  `;

  attachEvents();
  renderMascot();
}

function attachEvents() {
  document.querySelectorAll('[data-tab]').forEach(btn => btn.addEventListener('click', () => setTab(btn.dataset.tab)));

  // 筋トレ記録追加
  const addSetBtn = document.getElementById('add-set-btn');
  if (addSetBtn) {
    addSetBtn.addEventListener('click', () => {
      const ex = state.exercises.find(e => e.id === selectedExerciseId);
      const log = { id: uid(), exerciseId: ex.id, date: todayKey() };
      if (ex.trackWeight) log.weight = Number(document.getElementById('input-weight').value) || 0;
      if (ex.trackReps) log.reps = Number(document.getElementById('input-reps').value) || 0;
      if (ex.trackTime) log.time = (Number(document.getElementById('input-time').value) || 0) * Number(document.getElementById('input-time-unit').value);
      state.workoutLogs.push(log);
      saveState();
      render();
      showMascot('smile', pickLine('workoutAdd'));
    });
  }

  // 筋トレログ削除
  document.querySelectorAll('[data-delete-workout-log]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('この筋トレ記録を削除しますか?')) return;
      state.workoutLogs = state.workoutLogs.filter(l => l.id !== btn.dataset.deleteWorkoutLog);
      saveState();
      render();
    });
  });

  // 食事追加
  const addMealBtn = document.getElementById('add-meal-btn');
  if (addMealBtn) {
    addMealBtn.addEventListener('click', () => {
      const name = document.getElementById('meal-name').value.trim();
      const cal = document.getElementById('meal-calories').value;
      if (!name || cal === '') { alert('食べたものとカロリーを入力してください'); return; }
      addMealRecord(name, Number(cal), document.getElementById('meal-category-select').value);
    });
  }

  // 食事ログ削除
  document.querySelectorAll('[data-delete-meal]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('この食事記録を削除しますか?')) return;
      state.meals = state.meals.filter(m => m.id !== btn.dataset.deleteMeal);
      saveState();
      render();
    });
  });

  // カレンダー操作
  const prevBtn = document.getElementById('calendar-prev-btn');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      calendarMonth--;
      if (calendarMonth < 1) { calendarMonth = 12; calendarYear--; }
      render();
    });
  }
  const nextBtn = document.getElementById('calendar-next-btn');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      calendarMonth++;
      if (calendarMonth > 12) { calendarMonth = 1; calendarYear++; }
      render();
    });
  }
  document.querySelectorAll('[data-calendar-day]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedHistoryDate = btn.dataset.calendarDay;
      render();
    });
  });

  // 基本情報保存
  const saveProfBtn = document.getElementById('save-profile-btn');
  if (saveProfBtn) {
    saveProfBtn.addEventListener('click', () => {
      state.settings.userName = document.getElementById('user-name').value.trim();
      state.settings.bodyWeightKg = Number(document.getElementById('body-weight').value) || null;
      saveState();
      alert('保存しました');
    });
  }

  // キャラ表示トグル
  const toggleMascot = document.getElementById('toggle-mascot-enabled');
  if (toggleMascot) {
    toggleMascot.addEventListener('change', () => {
      state.settings.mascotEnabled = toggleMascot.checked;
      saveState();
      render();
    });
  }

  // セット追加
  const addSet = document.getElementById('add-mascot-set-btn');
  if (addSet) {
    addSet.addEventListener('click', () => {
      const name = document.getElementById('new-set-name').value.trim();
      if (!name) return;
      const id = 'set_' + uid();
      state.settings.mascotSets.push({ id, name, images: {} });
      state.settings.activeMascotSetId = id;
      saveState();
      render();
    });
  }

  // 画像アップロード
  document.querySelectorAll('.mascot-image-input').forEach(input => {
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const dataUrl = await resizeImageFile(file);
      const active = getActiveSet();
      if (!active.images) active.images = {};
      active.images[input.dataset.expression] = dataUrl;
      saveState();
      render();
    });
  });

  // 目標保存
  const saveGoals = document.getElementById('save-goals-btn');
  if (saveGoals) {
    saveGoals.addEventListener('click', () => {
      state.goals.dailySetTarget = Number(document.getElementById('goal-sets').value) || 0;
      state.goals.dailyCalorieTarget = Number(document.getElementById('goal-calories').value) || 0;
      saveState();
      alert('目標を保存しました');
    });
  }

  // APIキー保存
  const saveApiKey = document.getElementById('save-api-key-btn');
  if (saveApiKey) {
    saveApiKey.addEventListener('click', () => {
      state.settings.geminiApiKey = document.getElementById('gemini-api-key').value.trim();
      saveState();
      alert('APIキーを保存しました');
    });
  }
}

render();
runMascotOpeningLogic();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
