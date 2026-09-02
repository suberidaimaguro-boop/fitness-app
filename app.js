/* ===== データ管理 ===== */
const STORAGE_KEY = 'fitnessAppData';
let storageAvailable = true;

function defaultState() {
  return {
    exercises: [
      { id: 'ex1', name: 'ベンチプレス', trackWeight: true, trackReps: true, trackTime: false, met: 6.0 },
      { id: 'ex2', name: 'プランク', trackWeight: false, trackReps: false, trackTime: true, met: 3.5 }
    ],
    workoutLogs: [],
    meals: [],
    goals: {
      dailySetTarget: 4,
      dailyCalorieTarget: 2000
    },
    settings: {
      geminiApiKey: '',
      userName: '',
      honorific: 'さん',
      bodyWeightKg: null,
      mascotEnabled: true,
      activeMascotSetId: 'set_default',
      mascotSets: [
        {
          id: 'set_default',
          name: 'デフォルト',
          images: {}
        }
      ]
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
        parsed.settings.mascotSets = [
          { id: 'set_default', name: 'デフォルト', images: oldImages }
        ];
        parsed.settings.activeMascotSetId = 'set_default';
      }
      if (parsed.settings.mascotEnabled === undefined) parsed.settings.mascotEnabled = true;
      if (parsed.settings.honorific === undefined) parsed.settings.honorific = 'さん';
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

// 日本（現地）時間の YYYY-MM-DD を確実に取得
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// 記録対象として選択中の日付（初期値は今日）
let activeLogDate = todayKey();

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

/* 確実に表示されるインラインSVGゴミ箱アイコン */
const TRASH_ICON_SVG = `
<svg viewBox="0 0 24 24">
  <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12M9 7V4a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
</svg>`;

/* 外枠ネオングロー演出トリガー */
function triggerScreenGlow(type) {
  let overlay = document.getElementById('screen-glow-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'screen-glow-overlay';
    overlay.className = 'screen-glow-overlay';
    document.body.appendChild(overlay);
  }
  overlay.className = 'screen-glow-overlay';
  void overlay.offsetWidth; // リフロー
  overlay.classList.add(type === 'workout' ? 'glow-workout' : 'glow-meal');
}

/* ===== マスコットセットのヘルパー ===== */
function getActiveSet() {
  const sets = state.settings.mascotSets;
  return sets.find(s => s.id === state.settings.activeMascotSetId) || sets[0];
}

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

// 選択中の日付に対する記録取得
function currentLogWorkouts() {
  return state.workoutLogs.filter(l => l.date === activeLogDate);
}

function currentLogMeals() {
  return state.meals.filter(m => m.date === activeLogDate);
}

function currentCalorieTotal() {
  return currentLogMeals().reduce((sum, m) => sum + (Number(m.calories) || 0), 0);
}

function computeStreak() {
  const days = new Set(state.workoutLogs.map(l => l.date));
  let streak = 0;
  let cur = new Date();
  while (true) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    const key = `${y}-${m}-${d}`;
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
  const weights = state.workoutLogs
    .filter(l => l.exerciseId === exerciseId && typeof l.weight === 'number')
    .map(l => l.weight);
  return weights.length === 0 ? null : Math.max(...weights);
}

function computeWeeklyAverageRate() {
  const dates = [];
  const cur = new Date();
  for (let i = 0; i < 7; i++) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() - 1);
  }
  const total = dates.reduce((sum, d) => sum + computeAchievementRateForDate(d), 0);
  return Math.round(total / dates.length);
}

/* ===== マスコット ===== */
const MASCOT_EXPRESSIONS = ['neutral', 'smile', 'dismay', 'angry', 'sad'];
const MASCOT_EXPRESSION_LABELS = {
  neutral: '通常',
  smile: '笑顔',
  dismay: '困り',
  angry: '怒り',
  sad: '悲しい'
};

const MASCOT_PLACEHOLDER = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <circle cx="50" cy="50" r="50" fill="#2a2a26"/>
  <circle cx="35" cy="42" r="6" fill="#6b675e"/>
  <circle cx="65" cy="42" r="6" fill="#6b675e"/>
  <path d="M35 65 Q50 75 65 65" stroke="#6b675e" stroke-width="4" fill="none" stroke-linecap="round"/>
</svg>`);

function getMascotImage(expression) {
  const activeSet = getActiveSet();
  const custom = activeSet.images && activeSet.images[expression];
  return custom || MASCOT_PLACEHOLDER;
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
  workoutAdd: ['頑張っててえらいぞ!', 'ナイスセット!その調子!', 'えらいえらい、ちゃんと続けてる!'],
  mealSnackAdd: ['もう、食べすぎたらダメだぞ!', '間食はほどほどにね…', 'うーん、それ食べ過ぎじゃない?'],
  mealNormalAdd: ['ちゃんと記録できてえらい!', 'いいね、その調子!', '記録ばっちりだね!'],
  weeklyGood: ['すごいよ!今週は達成率{rate}%、めっちゃがんばったね!', '{rate}%!完璧すぎる、尊敬しちゃう!'],
  weeklyMid: ['今週は{rate}%。まあまあだけど、来週はもう一声いこう!', '{rate}%か、悪くないよ!でももっとできるはず!'],
  weeklyBad: ['今週は{rate}%…ちょっと物足りないぞ。来週はがんばろ!', '{rate}%か…ちょっと心配。来週は一緒にがんばろ!'],
  workoutPR: ['自己ベスト更新、めっちゃすごいじゃん!', 'え、今の記録更新!?マジで尊敬する!'],
  mealOverTarget: ['あちゃー、カロリーオーバーしちゃったね。調整しよ!', '食べすぎ注意報!でも仕方ない、明日がんばろ!']
};

function honorificSuffix() {
  const h = state.settings.honorific;
  return h === 'none' ? '' : h;
}

function greetingPrefix() {
  const name = (state.settings.userName || '').trim();
  if (!name) return '';
  return `${name}${honorificSuffix()}、`;
}

function pickLine(key, rate) {
  const arr = MASCOT_LINES[key];
  const line = arr[Math.floor(Math.random() * arr.length)];
  const filled = rate !== undefined ? line.replace('{rate}', rate) : line;
  return `${greetingPrefix()}${filled}`;
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
      <img src="${getMascotImage(mascotExpression)}" alt="キャラクター">
    </button>
  `;
  const btn = document.getElementById('mascot-avatar-btn');
  if (btn) {
    btn.addEventListener('click', () => {
      mascotBubbleVisible = !mascotBubbleVisible;
      renderMascot();
      if (mascotBubbleVisible && mascotHideTimer) {
        clearTimeout(mascotHideTimer);
        mascotHideTimer = setTimeout(() => {
          mascotBubbleVisible = false;
          renderMascot();
        }, 5000);
      }
    });
  }
}

async function fetchGeminiComment(prompt) {
  const apiKey = state.settings.geminiApiKey;
  if (!apiKey) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch (e) {
    return null;
  }
}

function personaInstruction() {
  const name = (state.settings.userName || '').trim();
  const nameNote = name
    ? `ユーザーの名前は「${name}」です。「${name}${honorificSuffix()}」と呼びかけてください。`
    : 'ユーザーの名前は分かっていないので、呼びかけは省略してください。';
  return `あなたは筋トレ管理アプリの応援キャラです。口調はタメ口寄りのフランクで元気な感じにしてください(「〜だよ」ではなく「〜だぞ!」「〜じゃん!」のようなノリ)。${nameNote}`;
}

async function runMascotOpeningLogic() {
  if (!state.settings.mascotEnabled) return;
  const day = new Date().getDay();
  if (day === 0) {
    const rate = computeWeeklyAverageRate();
    const expression = rate >= 80 ? 'smile' : rate >= 50 ? 'neutral' : 'dismay';
    const fallbackKey = rate >= 80 ? 'weeklyGood' : rate >= 50 ? 'weeklyMid' : 'weeklyBad';
    showMascot('neutral', '今週の振り返り中…', false);
    const aiText = await fetchGeminiComment(`${personaInstruction()}今週の目標達成率は${rate}%でした。感情を込めて日本語で2文以内でセリフのみ返してください。`);
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
        <text x="90" y="108" text-anchor="middle" font-size="13" fill="var(--text-secondary)">本日のノルマ達成率</text>
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

  return `
    <div class="field">
      <label>記録する日付</label>
      <input type="date" id="active-log-date-workout" value="${activeLogDate}">
    </div>
    <div class="field"><label>種目</label><select id="exercise-select">${state.exercises.map(e => `<option value="${e.id}" ${e.id === ex.id ? 'selected' : ''}>${escapeHtml(e.name)}</option>`).join('')}</select></div>
    ${inputs.join('')}
    <button class="primary" id="add-set-btn">記録を追加</button>
    <p class="section-title">${activeLogDate === todayKey() ? '今日' : activeLogDate} の記録</p>
    <div class="list-card">${logRows || `<div class="empty-hint">まだ記録がありません</div>`}</div>
    ${state.settings.bodyWeightKg ? `<div class="list-card" style="margin-top:12px;"><div class="total-row"><span class="label">消費カロリー(この種目)</span><span class="value">約${totalBurned.toLocaleString()} kcal</span></div></div>` : ''}
  `;
}

function fileToBase64Raw(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = reader.result;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

async function fetchGeminiFoodRecognition(file) {
  const apiKey = state.settings.geminiApiKey;
  if (!apiKey) return { error: 'no_key' };
  try {
    const base64Data = await fileToBase64Raw(file);
    const prompt = '料理の名前と推定カロリー(kcal、整数)を判定し、{"name": "料理名", "calories": 数値} のJSONのみ返してください。';
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: file.type || 'image/jpeg', data: base64Data } }, { text: prompt }] }]
      })
    });
    if (!res.ok) return { error: 'failed' };
    const data = await res.json();
    const parsed = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text?.replace(/```json|```/g, '').trim());
    return { name: parsed.name, calories: Math.round(parsed.calories) };
  } catch (e) {
    return { error: 'exception' };
  }
}

/* ===== 描画: 食事 ===== */
let selectedMealCategory = '朝食';
const MEAL_CATEGORIES = ['朝食', '昼食', '間食', '夜ご飯'];

function addMealRecord(name, calNum, category) {
  state.meals.push({ id: uid(), category, name, calories: calNum, date: activeLogDate });
  saveState();
  render();
  triggerScreenGlow('meal');
  showMascot('smile', pickLine(category === '間食' ? 'mealSnackAdd' : 'mealNormalAdd'));
}

function renderMeal() {
  const meals = currentLogMeals();
  const total = currentCalorieTotal();

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
    <div class="field">
      <label>記録する日付</label>
      <input type="date" id="active-log-date-meal" value="${activeLogDate}">
    </div>
    ${state.favoriteMeals.length > 0 ? `<p class="section-title">よく食べるもの(タップで記録)</p><div class="chip-row">${favoriteChips}</div>` : ''}
    <div class="field">
      <label>写真から自動入力(任意・Gemini APIキーが必要)</label>
      <input type="file" accept="image/*" id="meal-photo-input">
      <div id="meal-photo-status" style="font-size:12px; color:var(--text-secondary); margin-top:4px;"></div>
    </div>
    <div class="field"><label>区分</label><select id="meal-category-select">${MEAL_CATEGORIES.map(c => `<option value="${c}" ${c === selectedMealCategory ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
    <div class="field"><label>食べたもの</label><input type="text" id="meal-name" placeholder="鶏むね肉のサラダ"></div>
    <div class="field"><label>カロリー (kcal)</label><input type="number" id="meal-calories" inputmode="numeric" placeholder="350"></div>
    <button class="primary" id="add-meal-btn">記録を追加</button>
    <button class="secondary" id="save-favorite-btn" style="margin-bottom:16px;">☆ 今の内容を「よく食べるもの」に登録</button>
    <p class="section-title">${activeLogDate === todayKey() ? '今日' : activeLogDate} の記録</p>
    ${groups || `<div class="empty-hint">この日の記録はまだありません</div>`}
    <div class="list-card" style="margin-top:12px;"><div class="total-row"><span class="label">合計</span><span class="value">${total.toLocaleString()} / ${state.goals.dailyCalorieTarget.toLocaleString()} kcal</span></div></div>
  `;
}

/* ===== 描画: 履歴 ===== */
let selectedHistoryDate = todayKey();
let [calendarYear, calendarMonth] = selectedHistoryDate.split('-').map(Number);
let yearMonthPickerOpen = false;
let pickerYearStart = null;
const PICKER_ITEM_HEIGHT = 40;

function renderYearMonthPicker() {
  const years = [];
  for (let i = 0; i <= 20; i++) years.push(pickerYearStart + i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  return `
    <div class="picker-overlay" id="picker-overlay">
      <div class="picker-sheet">
        <p class="picker-title">年月を選択</p>
        <div class="picker-columns">
          <div class="picker-col" id="picker-year-col"><div class="picker-pad"></div>${years.map(y => `<div class="picker-item">${y}年</div>`).join('')}<div class="picker-pad"></div></div>
          <div class="picker-col" id="picker-month-col"><div class="picker-pad"></div>${months.map(m => `<div class="picker-item">${m}月</div>`).join('')}<div class="picker-pad"></div></div>
          <div class="picker-highlight"></div>
        </div>
        <div class="picker-actions">
          <button type="button" class="secondary" id="picker-cancel-btn">キャンセル</button>
          <button type="button" class="primary" id="picker-confirm-btn">決定</button>
        </div>
      </div>
    </div>
  `;
}

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
      <button type="button" class="cal-title-btn" id="calendar-title-btn">${calendarYear}年${calendarMonth}月 <i class="ti ti-chevron-down"></i></button>
      <button type="button" class="calendar-nav-btn" id="calendar-next-btn">›</button>
    </div>
    <div class="calendar-grid">
      ${['日','月','火','水','木','金','土'].map(w => `<div class="calendar-weekday">${w}</div>`).join('')}
      ${cells.join('')}
    </div>
    <p class="section-title">${selectedHistoryDate} の筋トレ記録</p>
    <div class="list-card" style="margin-bottom:16px;">${workoutRows || `<div class="empty-hint">この日の筋トレ記録はありません</div>`}</div>
    <p class="section-title">${selectedHistoryDate} の食事記録</p>
    <div class="list-card">${mealRows || `<div class="empty-hint">この日の食事記録はありません</div>`}</div>
    ${yearMonthPickerOpen ? renderYearMonthPicker() : ''}
  `;
}

/* ===== 描画: 設定 ===== */
function renderSettings() {
  const activeSet = getActiveSet();
  const exerciseRows = state.exercises.map(e => {
    const tags = [];
    if (e.trackWeight) tags.push('重量');
    if (e.trackReps) tags.push('回数');
    if (e.trackTime) tags.push('時間');
    return `
      <div class="list-row">
        <span class="val">${escapeHtml(e.name)}</span>
        <span class="sub" style="display:flex; align-items:center; gap:10px;">
          ${tags.join('・') || 'なし'}
          <button type="button" class="delete-btn" data-delete-exercise="${e.id}">${TRASH_ICON_SVG}</button>
        </span>
      </div>`;
  }).join('');

  return `
    <p class="section-title">基本情報</p>
    <div class="field"><label>名前</label><input type="text" id="user-name" value="${escapeHtml(state.settings.userName || '')}" placeholder="たろう"></div>
    <div class="field">
      <label>敬称</label>
      <div class="row-3">
        <button type="button" class="secondary honorific-btn" data-honorific="さん" style="${state.settings.honorific === 'さん' ? 'border-color:var(--gold); color:var(--gold);' : ''}">さん</button>
        <button type="button" class="secondary honorific-btn" data-honorific="くん" style="${state.settings.honorific === 'くん' ? 'border-color:var(--gold); color:var(--gold);' : ''}">くん</button>
        <button type="button" class="secondary honorific-btn" data-honorific="none" style="${state.settings.honorific === 'none' ? 'border-color:var(--gold); color:var(--gold);' : ''}">呼び捨て</button>
      </div>
    </div>
    <div class="field"><label>体重 (kg) ※消費カロリー計算に使用</label><input type="number" id="body-weight" inputmode="decimal" value="${state.settings.bodyWeightKg ?? ''}" placeholder="60"></div>
    <button class="primary" id="save-profile-btn">基本情報を保存</button>

    <p class="section-title">新しい種目を登録</p>
    <div class="field"><label>種目名</label><input type="text" id="new-exercise-name" placeholder="プランク"></div>
    <div class="list-card" style="padding:4px 16px; margin-bottom:16px;">
      <div class="toggle-row"><span>重量を記録する</span><label class="switch"><input type="checkbox" id="toggle-weight"><span class="track"></span></label></div>
      <div class="toggle-row"><span>回数を記録する</span><label class="switch"><input type="checkbox" id="toggle-reps" checked><span class="track"></span></label></div>
      <div class="toggle-row"><span>時間を記録する</span><label class="switch"><input type="checkbox" id="toggle-time"><span class="track"></span></label></div>
    </div>
    <div class="field">
      <label>運動強度(MET値)</label>
      <input type="number" id="new-exercise-met" inputmode="decimal" step="0.1" placeholder="5.0">
    </div>
    <button class="primary" id="save-exercise-btn">この種目を保存</button>
    <div class="list-card" style="margin:16px 0 20px;">${exerciseRows || `<div class="empty-hint">まだ種目がありません</div>`}</div>

    <p class="section-title">キャラクター表示設定</p>
    <div class="list-card" style="padding:4px 16px; margin-bottom:16px;">
      <div class="toggle-row">
        <span>キャラクターを表示する</span>
        <label class="switch"><input type="checkbox" id="toggle-mascot-enabled" ${state.settings.mascotEnabled ? 'checked' : ''}><span class="track"></span></label>
      </div>
    </div>

    <p class="section-title">キャラクターセット管理</p>
    <div class="field">
      <label>使用するセット</label>
      <select id="mascot-set-select">${state.settings.mascotSets.map(s => `<option value="${s.id}" ${s.id === state.settings.activeMascotSetId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select>
    </div>
    <div class="field">
      <label>新しいセットを追加</label>
      <div class="row-2">
        <input type="text" id="new-set-name" placeholder="セット名(例: セットA)">
        <button type="button" class="secondary" id="add-mascot-set-btn">追加</button>
      </div>
    </div>
    ${state.settings.mascotSets.length > 1 ? `
      <button type="button" class="secondary" id="delete-mascot-set-btn" style="color:var(--danger); border-color:var(--danger); margin-bottom:16px;">
        現在選択中の「${escapeHtml(activeSet.name)}」セットを削除
      </button>
    ` : ''}

    <p class="section-title">「${escapeHtml(activeSet.name)}」の画像登録 (端末内のみ保存)</p>
    <div class="list-card" style="padding:12px 16px; margin-bottom:16px;">
      ${MASCOT_EXPRESSIONS.map(exp => `
        <div class="toggle-row" style="align-items:center;">
          <span style="display:flex; align-items:center; gap:10px;">
            <img src="${getMascotImage(exp)}" style="width:36px; height:36px; border-radius:50%; object-fit:cover; border:1px solid var(--border-strong);">
            ${MASCOT_EXPRESSION_LABELS[exp]}
          </span>
          <input type="file" accept="image/*" class="mascot-image-input" data-expression="${exp}">
        </div>`).join('')}
    </div>

    <p class="section-title">目標(ノルマ)設定</p>
    <div class="field"><label>1日の筋トレ目標セット数</label><input type="number" id="goal-sets" value="${state.goals.dailySetTarget}"></div>
    <div class="field"><label>1日の摂取カロリー上限 (kcal)</label><input type="number" id="goal-calories" value="${state.goals.dailyCalorieTarget}"></div>
    <button class="primary" id="save-goals-btn">目標を保存</button>

    <p class="section-title">AIコメント(任意)</p>
    <div class="field"><input type="text" id="gemini-api-key" value="${escapeHtml(state.settings.geminiApiKey || '')}" placeholder="Gemini APIキー"></div>
    <button class="primary" id="save-api-key-btn">APIキーを保存</button>

    <p class="section-title">バックアップ</p>
    <p style="font-size:12px; color:var(--text-secondary); margin:0 0 12px;">全データ(記録・画像・設定)を端末外に書き出せます。安全のためGitHub等には絶対に公開しないでください。</p>
    <button class="secondary" id="export-backup-btn" style="margin-bottom:10px;">JSONでバックアップを保存</button>
    <input type="file" accept="application/json" id="import-backup-input">
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
const TITLES = { home: '今日の記録', workout: '筋トレ記録', meal: '食事・カロリー記録', history: '過去の記録', settings: '設定' };

function render() {
  const app = document.getElementById('app');
  const dateStr = new Date().toLocaleDateString('ja-JP', { month: 'long', day: 'numeric', weekday: 'short' });

  let content = '';
  if (currentTab === 'home') content = renderHome();
  else if (currentTab === 'workout') content = renderWorkout();
  else if (currentTab === 'meal') content = renderMeal();
  else if (currentTab === 'history') content = renderHistory();
  else if (currentTab === 'settings') content = renderSettings();

  app.innerHTML = `
    <div class="topbar"><p class="date">${dateStr}</p><h1>${TITLES[currentTab]}</h1></div>
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

  // ---- 筋トレ ----
  const dateWorkoutInput = document.getElementById('active-log-date-workout');
  if (dateWorkoutInput) {
    dateWorkoutInput.addEventListener('change', () => {
      activeLogDate = dateWorkoutInput.value;
      render();
    });
  }

  const exerciseSelect = document.getElementById('exercise-select');
  if (exerciseSelect) {
    exerciseSelect.addEventListener('change', () => {
      selectedExerciseId = exerciseSelect.value;
      render();
    });
  }
  const addSetBtn = document.getElementById('add-set-btn');
  if (addSetBtn) {
    addSetBtn.addEventListener('click', () => {
      const ex = state.exercises.find(e => e.id === selectedExerciseId);
      const log = { id: uid(), exerciseId: ex.id, date: activeLogDate };
      if (ex.trackWeight) {
        const v = document.getElementById('input-weight').value;
        if (v === '') { alert('重量を入力してください'); return; }
        log.weight = Number(v);
      }
      if (ex.trackReps) {
        const v = document.getElementById('input-reps').value;
        if (v === '') { alert('回数を入力してください'); return; }
        log.reps = Number(v);
      }
      if (ex.trackTime) {
        const v = document.getElementById('input-time').value;
        if (v === '') { alert('時間を入力してください'); return; }
        log.time = Number(v) * Number(document.getElementById('input-time-unit').value);
      }

      const prevBest = ex.trackWeight ? previousBestWeight(ex.id) : null;
      state.workoutLogs.push(log);
      saveState();
      render();
      triggerScreenGlow('workout');

      const isPR = ex.trackWeight && prevBest !== null && log.weight > prevBest;
      showMascot('smile', pickLine(isPR ? 'workoutPR' : 'workoutAdd'));
    });
  }

  document.querySelectorAll('[data-delete-workout-log]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('この筋トレ記録を削除しますか?')) return;
      state.workoutLogs = state.workoutLogs.filter(l => l.id !== btn.dataset.deleteWorkoutLog);
      saveState();
      render();
    });
  });

  // ---- 食事: よく食べるもの ----
  document.querySelectorAll('[data-favorite-tap]').forEach(chip => {
    chip.addEventListener('click', (e) => {
      if (e.target.closest('[data-favorite-remove]')) return;
      const fav = state.favoriteMeals.find(f => f.id === chip.dataset.favoriteTap);
      if (fav) addMealRecord(fav.name, fav.calories, fav.category);
    });
  });
  document.querySelectorAll('[data-favorite-remove]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.favoriteMeals = state.favoriteMeals.filter(f => f.id !== btn.dataset.favoriteRemove);
      saveState();
      render();
    });
  });
  const saveFavoriteBtn = document.getElementById('save-favorite-btn');
  if (saveFavoriteBtn) {
    saveFavoriteBtn.addEventListener('click', () => {
      const name = document.getElementById('meal-name').value.trim();
      const cal = document.getElementById('meal-calories').value;
      if (!name || cal === '') { alert('食べたものとカロリーを入力してから登録してください'); return; }
      state.favoriteMeals.push({ id: uid(), name, calories: Number(cal), category: document.getElementById('meal-category-select').value });
      saveState();
      render();
    });
  }

  // ---- 食事: 写真AI ----
  const mealPhotoInput = document.getElementById('meal-photo-input');
  if (mealPhotoInput) {
    mealPhotoInput.addEventListener('change', async () => {
      const file = mealPhotoInput.files && mealPhotoInput.files[0];
      if (!file) return;
      const statusEl = document.getElementById('meal-photo-status');
      if (!state.settings.geminiApiKey) {
        if (statusEl) statusEl.textContent = '先に設定でGemini APIキーを登録してください';
        return;
      }
      if (statusEl) statusEl.textContent = '判定中…';
      const result = await fetchGeminiFoodRecognition(file);
      if (result.error) {
        if (statusEl) statusEl.textContent = '判定に失敗しました。手入力してください。';
        return;
      }
      document.getElementById('meal-name').value = result.name;
      document.getElementById('meal-calories').value = result.calories;
      if (statusEl) statusEl.textContent = '判定結果を入力しました(編集できます)';
    });
  }

  // ---- 食事追加・削除 ----
  const dateMealInput = document.getElementById('active-log-date-meal');
  if (dateMealInput) {
    dateMealInput.addEventListener('change', () => {
      activeLogDate = dateMealInput.value;
      render();
    });
  }

  const mealCategorySelect = document.getElementById('meal-category-select');
  if (mealCategorySelect) {
    mealCategorySelect.addEventListener('change', () => {
      selectedMealCategory = mealCategorySelect.value;
    });
  }
  const addMealBtn = document.getElementById('add-meal-btn');
  if (addMealBtn) {
    addMealBtn.addEventListener('click', () => {
      const name = document.getElementById('meal-name').value.trim();
      const cal = document.getElementById('meal-calories').value;
      if (!name || cal === '') { alert('食べたものとカロリーを入力してください'); return; }
      addMealRecord(name, Number(cal), document.getElementById('meal-category-select').value);
    });
  }
  document.querySelectorAll('[data-delete-meal]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('この食事記録を削除しますか?')) return;
      state.meals = state.meals.filter(m => m.id !== btn.dataset.deleteMeal);
      saveState();
      render();
    });
  });

  // ---- 履歴 ----
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
  const calendarTitleBtn = document.getElementById('calendar-title-btn');
  if (calendarTitleBtn) {
    calendarTitleBtn.addEventListener('click', () => {
      pickerYearStart = calendarYear - 10;
      yearMonthPickerOpen = true;
      render();
    });
  }
  const pickerOverlay = document.getElementById('picker-overlay');
  if (pickerOverlay) {
    const yearCol = document.getElementById('picker-year-col');
    const monthCol = document.getElementById('picker-month-col');
    yearCol.scrollTop = (calendarYear - pickerYearStart) * PICKER_ITEM_HEIGHT;
    monthCol.scrollTop = (calendarMonth - 1) * PICKER_ITEM_HEIGHT;

    pickerOverlay.addEventListener('click', (e) => {
      if (e.target === pickerOverlay) { yearMonthPickerOpen = false; render(); }
    });
    document.getElementById('picker-cancel-btn').addEventListener('click', () => {
      yearMonthPickerOpen = false; render();
    });
    document.getElementById('picker-confirm-btn').addEventListener('click', () => {
      calendarYear = pickerYearStart + Math.round(yearCol.scrollTop / PICKER_ITEM_HEIGHT);
      calendarMonth = Math.round(monthCol.scrollTop / PICKER_ITEM_HEIGHT) + 1;
      yearMonthPickerOpen = false; render();
    });
  }
  document.querySelectorAll('[data-calendar-day]').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedHistoryDate = btn.dataset.calendarDay;
      render();
    });
  });

  // ---- 設定: 基本情報・敬称 ----
  let pendingHonorific = state.settings.honorific;
  document.querySelectorAll('.honorific-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      pendingHonorific = btn.dataset.honorific;
      document.querySelectorAll('.honorific-btn').forEach((b) => {
        b.style.borderColor = '';
        b.style.color = '';
      });
      btn.style.borderColor = 'var(--gold)';
      btn.style.color = 'var(--gold)';
    });
  });
  const saveProfileBtn = document.getElementById('save-profile-btn');
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', () => {
      state.settings.userName = document.getElementById('user-name').value.trim();
      state.settings.honorific = pendingHonorific;
      const weightVal = document.getElementById('body-weight').value;
      state.settings.bodyWeightKg = weightVal === '' ? null : Number(weightVal);
      saveState();
      render();
      alert('基本情報を保存しました');
    });
  }

  // ---- 設定: 種目 ----
  const saveExerciseBtn = document.getElementById('save-exercise-btn');
  if (saveExerciseBtn) {
    saveExerciseBtn.addEventListener('click', () => {
      const name = document.getElementById('new-exercise-name').value.trim();
      if (!name) { alert('種目名を入力してください'); return; }
      const trackWeight = document.getElementById('toggle-weight').checked;
      const trackReps = document.getElementById('toggle-reps').checked;
      const trackTime = document.getElementById('toggle-time').checked;
      if (!trackWeight && !trackReps && !trackTime) { alert('記録項目を1つ以上ONにしてください'); return; }
      const metInput = document.getElementById('new-exercise-met').value;
      state.exercises.push({ id: uid(), name, trackWeight, trackReps, trackTime, met: metInput === '' ? 5.0 : Number(metInput) });
      saveState();
      render();
    });
  }
  document.querySelectorAll('[data-delete-exercise]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('この種目を削除しますか?')) return;
      state.exercises = state.exercises.filter(e => e.id !== btn.dataset.deleteExercise);
      saveState();
      render();
    });
  });

  // ---- 設定: キャラクター ----
  const toggleMascotEnabled = document.getElementById('toggle-mascot-enabled');
  if (toggleMascotEnabled) {
    toggleMascotEnabled.addEventListener('change', () => {
      state.settings.mascotEnabled = toggleMascotEnabled.checked;
      saveState();
      render();
    });
  }
  const mascotSetSelect = document.getElementById('mascot-set-select');
  if (mascotSetSelect) {
    mascotSetSelect.addEventListener('change', () => {
      state.settings.activeMascotSetId = mascotSetSelect.value;
      saveState();
      render();
    });
  }
  const addMascotSetBtn = document.getElementById('add-mascot-set-btn');
  if (addMascotSetBtn) {
    addMascotSetBtn.addEventListener('click', () => {
      const name = document.getElementById('new-set-name').value.trim();
      if (!name) return;
      const newId = 'set_' + uid();
      state.settings.mascotSets.push({ id: newId, name, images: {} });
      state.settings.activeMascotSetId = newId;
      saveState();
      render();
    });
  }
  const deleteMascotSetBtn = document.getElementById('delete-mascot-set-btn');
  if (deleteMascotSetBtn) {
    deleteMascotSetBtn.addEventListener('click', () => {
      const active = getActiveSet();
      if (!confirm(`「${active.name}」セットを削除しますか?`)) return;
      state.settings.mascotSets = state.settings.mascotSets.filter(s => s.id !== active.id);
      state.settings.activeMascotSetId = state.settings.mascotSets[0].id;
      saveState();
      render();
    });
  }
  document.querySelectorAll('.mascot-image-input').forEach(input => {
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      try {
        const dataUrl = await resizeImageFile(file);
        const active = getActiveSet();
        if (!active.images) active.images = {};
        active.images[input.dataset.expression] = dataUrl;
        saveState();
        render();
      } catch (e) {
        alert('画像の読み込みに失敗しました');
      }
    });
  });

  // ---- 設定: 目標・API・バックアップ ----
  const saveGoalsBtn = document.getElementById('save-goals-btn');
  if (saveGoalsBtn) {
    saveGoalsBtn.addEventListener('click', () => {
      state.goals.dailySetTarget = Number(document.getElementById('goal-sets').value) || 0;
      state.goals.dailyCalorieTarget = Number(document.getElementById('goal-calories').value) || 0;
      saveState();
      render();
      alert('目標を保存しました');
    });
  }
  const saveApiKeyBtn = document.getElementById('save-api-key-btn');
  if (saveApiKeyBtn) {
    saveApiKeyBtn.addEventListener('click', () => {
      state.settings.geminiApiKey = document.getElementById('gemini-api-key').value.trim();
      saveState();
      alert('APIキーを保存しました');
    });
  }
  const exportBackupBtn = document.getElementById('export-backup-btn');
  if (exportBackupBtn) {
    exportBackupBtn.addEventListener('click', () => {
      const json = JSON.stringify(state, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const d = new Date();
      const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      a.href = url;
      a.download = `fitness-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    });
  }
  const importBackupInput = document.getElementById('import-backup-input');
  if (importBackupInput) {
    importBackupInput.addEventListener('change', () => {
      const file = importBackupInput.files && importBackupInput.files[0];
      if (!file) return;
      if (!confirm('現在のデータは上書きされます。復元しますか?')) {
        importBackupInput.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!parsed.exercises || !parsed.settings) throw new Error('invalid');
          state = parsed;
          if (!state.favoriteMeals) state.favoriteMeals = [];
          saveState();
          render();
          alert('復元しました');
        } catch (e) {
          alert('ファイルの読み込みに失敗しました');
        }
      };
      reader.readAsText(file);
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
