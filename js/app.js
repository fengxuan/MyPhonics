const STORAGE_KEY = "jianzi-jidu-progress-v1";

const state = {
  view: "home",
  unitId: "u1",
  step: 0,
  wordIndex: 0,
  sentenceIndex: -1,
  busy: false,
  quiz: null,
  reflex: null,
  timer: 0,
};

let progress = loadProgress();
let player = null;
let audioJob = 0;

function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (error) {
    /* keep the default record */
  }
  return { units: {}, reflexBest: 0, speed: 1100 };
}

function saveProgress() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function unitById(id) {
  return UNITS.find((unit) => unit.id === id);
}

function unitProgress(id) {
  return progress.units[id] || {};
}

function patchUnit(id, partial) {
  progress.units[id] = { ...unitProgress(id), ...partial };
  saveProgress();
}

function starred(id) {
  return (unitProgress(id).quiz || 0) >= 80;
}

function lessonItems(unit) {
  const items = [];
  (unit.slides || []).forEach((slide) => items.push({ type: "slide", slide }));
  (unit.sounds || []).forEach((id) => items.push({ type: "sound", id }));
  return items;
}

function reflexItems(unit) {
  if (unit.practice) return unit.practice;
  return (unit.sounds || []).map((id) => ({
    card: SOUNDS[id].card || SOUNDS[id].g,
    sound: id,
    cue: SOUNDS[id].cue || "",
  }));
}

function quizItems(unit) {
  const seen = new Set();
  return reflexItems(unit).filter((item) => {
    if (seen.has(item.sound)) return false;
    seen.add(item.sound);
    return true;
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function esc(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shuffle(list) {
  const copy = list.slice();
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function stopAudio() {
  if (!player) return;
  const audio = player;
  player = null;
  const finish = audio._finish;
  audio._finish = null;
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  if (finish) finish();
}

const AUDIO_VERSION = "6";

function playFile(path) {
  stopAudio();
  path = `${path}?v=${AUDIO_VERSION}`;
  return new Promise((resolve) => {
    const audio = new Audio(path);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (player === audio) player = null;
      resolve();
    };
    audio._finish = finish;
    player = audio;
    audio.onended = finish;
    audio.onerror = finish;
    audio.play().catch(finish);
  });
}

async function playSoundId(id) {
  const job = audioJob;
  const sound = SOUNDS[id];
  if (!sound || sound.silent) return;
  if (sound.word) return playWord(sound.word);
  if (sound.sequence) {
    for (const piece of sound.sequence) {
      if (audioJob !== job) return;
      await playFile(`audio/sounds/${SOUNDS[piece].file}`);
      if (audioJob !== job) return;
      await wait(60);
    }
    return;
  }
  await playFile(`audio/sounds/${sound.file}`);
}

function audioName(word) {
  return word === "I" ? "I" : word.toLowerCase();
}

function playWord(word) {
  return playFile(`audio/words/${audioName(word)}.mp3`);
}

function clearTimer() {
  clearTimeout(state.timer);
  state.timer = 0;
}

function go(view, extra) {
  audioJob += 1;
  stopAudio();
  clearTimer();
  state.busy = false;
  state.view = view;
  if (extra) Object.assign(state, extra);
  render();
  window.scrollTo(0, 0);
}

function kindClass(id) {
  return `kind-${SOUNDS[id].kind}`;
}

function cardText(sound) {
  return sound.card || sound.g;
}

function topbar() {
  const rulesOn = state.view === "rules" || state.view === "rule";
  return `
    <header class="topbar">
      <button class="brand" data-act="home">
        <span class="logo">Aa</span>
        <span><strong>见字即读</strong><small>自然拼读 · 英式音标</small></span>
      </button>
      <nav>
        <button data-act="home" class="${state.view === "home" ? "on" : ""}">地图</button>
        <button data-act="rules" class="${rulesOn ? "on" : ""}">规律</button>
        <button data-act="reflex-setup" data-scope="all" class="${state.view === "reflex" ? "on" : ""}">闪电反应</button>
      </nav>
    </header>
  `;
}

function footer() {
  const stars = UNITS.filter((unit) => starred(unit.id)).length;
  return `
    <footer class="footer">
      已过关 ${stars} / ${UNITS.length} 课。音标和本音来自新东方国际音标表。例句单词仍是美式录音，少数元音和单词会有一点差别。
      <button data-act="reset">清除学习记录</button>
    </footer>
  `;
}

function render() {
  const body = {
    home: renderHome,
    unit: renderUnit,
    learn: renderLearn,
    blend: renderBlend,
    quiz: renderQuiz,
    sentences: renderSentences,
    reflex: renderReflex,
    rules: renderRules,
    rule: renderRule,
  }[state.view]();
  document.getElementById("app").innerHTML = `${topbar()}<main>${body}</main>${footer()}`;
}

function renderHome() {
  const demo = ["s", "a", "t", "p", "i", "n"].map((id) => {
    const sound = SOUNDS[id];
    return `<button class="demo-tile ${kindClass(id)}" data-act="play-sound" data-id="${id}">${esc(sound.g)}<small>${esc(sound.ipa)}</small></button>`;
  }).join("");
  const next = UNITS.find((unit) => !starred(unit.id)) || UNITS[0];
  const cards = UNITS.map((unit) => {
    const record = unitProgress(unit.id);
    const mark = starred(unit.id) ? "★" : "☆";
    return `
      <button class="path-card" data-act="open-unit" data-id="${unit.id}">
        <span class="num">${unit.n}</span>
        <span><strong>${esc(unit.title)}</strong><small>${esc(unit.goal)}</small></span>
        <span class="star ${starred(unit.id) ? "" : "off"}">${mark}<small>${record.quiz || 0}</small></span>
      </button>`;
  }).join("");
  return `
    <section class="hero">
      <div>
        <p class="kicker">See it. Say it.</p>
        <h1>看见字母，<br>嘴巴自己会读。</h1>
        <p class="lead">按自然拼读的顺序，先把每个字母的本音练成条件反射，再把音素拼成单词。不背字母名，读的是音。</p>
        <div class="hero-actions">
          <button class="btn" data-act="open-unit" data-id="${next.id}">从第 ${next.n} 课开始</button>
          <button class="btn light" data-act="reflex-setup" data-scope="all">先做一轮闪电反应</button>
        </div>
      </div>
      <div class="demo">
        <p>点一个字母，听它的本音</p>
        <div class="demo-row">${demo}</div>
      </div>
    </section>
    <section class="steps">
      <div class="step"><b>1. 认本音</b><span>看见字母，立刻对上音。元音和辅音分开记。</span></div>
      <div class="step"><b>2. 拼单词</b><span>从左到右拆开，再合成。辅音后面不加“呃”。</span></div>
      <div class="step"><b>3. 练到会反应</b><span>字母先闪出来，你先读，再听标准音对照。</span></div>
    </section>
    <h2>学习地图</h2>
    <div class="path">${cards}</div>
  `;
}

function renderUnit() {
  const unit = unitById(state.unitId);
  const record = unitProgress(unit.id);
  const chips = reflexItems(unit).map((item) => `
    <button class="mini ${kindClass(item.sound)}" data-act="play-sound" data-id="${item.sound}">
      ${esc(item.card)}<small>${esc(item.cue || SOUNDS[item.sound].ipa)}</small>
    </button>`).join("");
  return `
    <section class="page-head">
      <button class="back" data-act="home">← 地图</button>
      <p class="kicker">第 ${unit.n} 课</p>
      <h1>${esc(unit.title)}</h1>
      <p class="lead">${esc(unit.goal)}</p>
      <div class="chips">${chips}</div>
      <div class="action-grid">
        <button data-act="open-learn">认本音<span>听清每个音</span></button>
        <button data-act="open-blend">拼读工坊<span>拆开再合成</span></button>
        <button data-act="open-quiz">过关测验<span>${record.quiz || 0} 分</span></button>
        <button data-act="reflex-setup" data-scope="${unit.id}">闪电反应<span>看见就读</span></button>
        ${unit.sentences ? `<button data-act="open-sentences">读句子<span>把词连成句</span></button>` : ""}
      </div>
      <p class="status">认音 ${record.learn ? "已学" : "还没学完"} · 拼读 ${record.blend ? "已练" : "还没练"} · ${starred(unit.id) ? "已过关 ★" : "80 分过关"}</p>
    </section>
  `;
}

function renderLearn() {
  const unit = unitById(state.unitId);
  const items = lessonItems(unit);
  const index = Math.max(0, Math.min(state.step, items.length - 1));
  const item = items[index];
  const dots = items.map((_, dot) => `<i class="${dot === index ? "on" : ""}"></i>`).join("");
  const body = item.type === "sound" ? soundLesson(item.id) : slideLesson(item.slide);
  const last = index === items.length - 1;
  return `
    <button class="back" data-act="open-unit">← 第 ${unit.n} 课</button>
    <div class="dots">${dots}</div>
    <article class="lesson">${body}</article>
    <div class="pager" style="margin-top:14px">
      <button class="btn light" data-act="learn-prev" ${index === 0 ? "disabled" : ""}>上一个</button>
      ${last
        ? `<button class="btn-blend" data-act="finish-learn">去拼这些词</button>`
        : `<button class="btn" data-act="learn-next">下一个</button>`}
    </div>
  `;
}

function soundLesson(id) {
  const sound = SOUNDS[id];
  const label = cardText(sound);
  const wide = label.length > 2 ? "wide" : "";
  const keyword = sound.keyword
    ? `<div class="keyword"><span>${sound.emoji}</span><span>${esc(sound.keyword)} · ${esc(sound.zh)}</span></div>`
    : "";
  return `
    <button class="giant ${kindClass(id)} ${wide}" data-act="play-sound" data-id="${id}">${esc(label)}</button>
    <div class="ipa-lg">${esc(sound.ipa)}</div>
    <p class="hint">${esc(sound.hint)}</p>
    ${keyword}
    <div class="controls" style="justify-content:center">
      <button class="btn-sound" data-act="play-sound" data-id="${id}">听本音</button>
      ${sound.keyword ? `<button class="btn light" data-act="play-word" data-word="${esc(sound.keyword)}">听例词 ${esc(sound.keyword)}</button>` : ""}
    </div>
  `;
}

function slideLesson(slide) {
  const listens = (slide.words || []).map((entry) => `
    <button class="btn light" data-act="play-word" data-word="${esc(entry)}">${esc(entry)}</button>`).join("");
  const pairs = (slide.pairs || []).map(([left, right]) => `
    <span class="pair">
      <button class="btn light" data-act="play-word" data-word="${esc(left)}">${esc(left)}</button>
      <i>→</i>
      <button class="btn light" data-act="play-word" data-word="${esc(right)}">${esc(right)}</button>
    </span>`).join("");
  const soundButton = slide.sound
    ? `<button class="btn-sound" data-act="play-sound" data-id="${slide.sound}">听这个音 ${esc(SOUNDS[slide.sound].ipa)}</button>`
    : "";
  return `
    <h2>${esc(slide.title)}</h2>
    <p class="hint">${esc(slide.body)}</p>
    <div class="pairs">${pairs}</div>
    <div class="controls" style="justify-content:center">${soundButton}${listens}</div>
  `;
}

function renderSentences() {
  const unit = unitById(state.unitId);
  const sentences = unit.sentences || [];
  const index = Math.max(0, Math.min(state.step, sentences.length - 1));
  const sentence = sentences[index];
  const words = sentence.words.map((entry, wordIndex) => `
    <button class="${state.sentenceIndex === wordIndex ? "on" : ""}" data-act="play-word" data-word="${esc(audioName(entry))}">${esc(entry)}</button>`).join("");
  return `
    <button class="back" data-act="open-unit">← 第 ${unit.n} 课</button>
    <article class="panel">
      <p class="progress-label">${index + 1} / ${sentences.length}</p>
      <h1>读句子</h1>
      <p class="hint">${esc(sentence.zh)}</p>
      <p class="sentence">${words}</p>
      <div class="hero-actions">
        <button class="btn-sound" data-act="play-sentence">逐词听</button>
        <button class="btn light" data-act="sentence-prev" ${index === 0 ? "disabled" : ""}>上一句</button>
        <button class="btn light" data-act="sentence-next" ${index === sentences.length - 1 ? "disabled" : ""}>下一句</button>
      </div>
    </article>
  `;
}

async function playSentence() {
  const job = audioJob;
  const sentence = unitById(state.unitId).sentences[state.step];
  for (let index = 0; index < sentence.words.length; index += 1) {
    if (audioJob !== job || state.view !== "sentences") return;
    state.sentenceIndex = index;
    render();
    await playWord(audioName(sentence.words[index]));
    await wait(140);
  }
  if (audioJob === job) state.sentenceIndex = -1;
}

function renderBlend() {
  const unit = unitById(state.unitId);
  const index = Math.max(0, Math.min(state.wordIndex, unit.words.length - 1));
  const current = unit.words[index];
  const shelf = unit.words.map((entry, entryIndex) => `
    <button class="shelf-btn ${entryIndex === index ? "active" : ""}" data-act="pick-word" data-i="${entryIndex}">${entry.emoji} ${esc(entry.w)}</button>`).join("");
  const cards = current.parts.map((piece, pieceIndex) => {
    const sound = SOUNDS[piece.s];
    const wide = piece.g.length > 1 ? "wide" : "";
    return `
      <div class="slot">
        <button class="card ${kindClass(piece.s)} ${wide}" id="card-${pieceIndex}" data-act="play-part" data-i="${pieceIndex}">${esc(piece.g)}</button>
        <span class="ipa">${esc(sound.ipa)}</span>
      </div>`;
  }).join("");
  return `
    <button class="back" data-act="open-unit">← 第 ${unit.n} 课</button>
    <div class="page-head">
      <h1>拼读工坊</h1>
      <p class="lead">先点字母听本音，再拆开读，最后聚成一个词。${esc(unit.goal)}</p>
    </div>
    <div class="shelf">${shelf}</div>
    <section class="stage" id="stage">
      <div class="track">${cards}</div>
      <div class="result" id="result">
        <span class="res-emoji">${current.emoji}</span>
        <span><b>${esc(current.w)}</b><small>${esc(current.zh)}</small></span>
      </div>
      <div class="formula" id="formula">${formula(current)}</div>
      <div class="controls">
        <button class="btn-sound" data-act="sound-out">1. 拆开读音素</button>
        <button class="btn-blend" data-act="merge">2. 合成！读单词</button>
      </div>
    </section>
  `;
}

function formula(entry) {
  return entry.parts.map((piece) => {
    if (piece.s === "silent") return `${piece.g} 不发音`;
    return SOUNDS[piece.s].ipa;
  }).join("  ·  ");
}

function renderQuiz() {
  const quiz = state.quiz;
  const unit = unitById(quiz.unitId);
  if (quiz.i >= quiz.questions.length) return renderQuizDone(unit);
  const question = quiz.questions[quiz.i];
  const choices = question.choices.map((choice) => {
    let mark = "";
    if (quiz.locked) {
      if (choice.key === question.answer) mark = "good";
      else if (choice.key === quiz.picked) mark = "bad";
    }
    return `
      <button class="choice ${mark}" data-act="answer" data-key="${esc(choice.key)}" ${quiz.locked ? "disabled" : ""}>
        ${esc(choice.main)}${choice.sub ? `<small>${esc(choice.sub)}</small>` : ""}
      </button>`;
  }).join("");
  const promptExtra = question.show
    ? `<div class="giant ${question.sound ? kindClass(question.sound) : ""}" style="font-size:4.2rem">${esc(question.show)}</div>`
    : "";
  const feedback = quiz.locked
    ? `<div class="feedback">${quiz.ok ? "对了。" : "先听正确的那个。"} <button class="btn" data-act="quiz-next">继续</button></div>`
    : `<button class="btn light" data-act="replay">再听一次</button>`;
  return `
    <button class="back" data-act="open-unit">← 第 ${unit.n} 课</button>
    <article class="quiz-card panel">
      <p class="progress-label">${quiz.i + 1} / ${quiz.questions.length}</p>
      <h2>${esc(question.prompt)}</h2>
      ${promptExtra}
      <div class="choices">${choices}</div>
      ${feedback}
    </article>
  `;
}

function renderQuizDone(unit) {
  const total = state.quiz.questions.length;
  const pct = Math.round((state.quiz.score / total) * 100);
  const passed = pct >= 80;
  return `
    <article class="panel">
      <p class="kicker">第 ${unit.n} 课</p>
      <h1>${pct} 分</h1>
      <p class="lead">${passed ? "这一课过关了。看见这些字母时，继续用闪电反应把速度提上去。" : "还差一点点。回到拼读工坊，把没听清的音再拆一次。"}</p>
      <div class="hero-actions">
        <button class="btn" data-act="open-quiz">再测一次</button>
        <button class="btn light" data-act="open-blend">回拼读工坊</button>
        <button class="btn light" data-act="reflex-setup" data-scope="${unit.id}">闪电反应</button>
      </div>
    </article>
  `;
}

function renderReflex() {
  const reflex = state.reflex;
  if (reflex.phase === "ready") return renderReflexReady();
  if (reflex.phase === "done") return renderReflexDone();
  const item = reflex.deck[reflex.i];
  const face = reflex.phase === "think"
    ? `<div class="reflex-face ${kindClass(item.sound)}">${esc(item.card)}${item.cue ? `<small>${esc(item.cue)}</small>` : ""}</div><p>先读出来。</p>`
    : `<div class="reflex-face ${kindClass(item.sound)}">${esc(item.card)}${item.cue ? `<small>${esc(item.cue)}</small>` : ""}</div><p>对照标准音。你读对了吗？</p>
       <div class="hero-actions" style="justify-content:center">
         <button class="btn-blend" data-act="reflex-mark" data-hit="1">读对了</button>
         <button class="btn light" data-act="reflex-mark" data-hit="0">没对上</button>
         <button class="btn light" data-act="replay">再听一次</button>
       </div>`;
  return `
    <article class="reflex-card panel" style="text-align:center">
      <p class="progress-label">${reflex.i + 1} / ${reflex.deck.length} · 已对 ${reflex.hits}</p>
      ${face}
    </article>
  `;
}

function renderReflexReady() {
  const speeds = [
    [1600, "慢"],
    [1100, "正常"],
    [700, "快"],
  ].map(([value, label]) => `
    <button class="speed-btn ${progress.speed === value ? "on" : ""}" data-act="set-speed" data-speed="${value}">${label}</button>`).join("");
  const scopeLabel = state.reflex.scope === "all"
    ? "全部已学规律"
    : state.reflex.scope === "learned"
      ? "学过的课"
      : `第 ${unitById(state.reflex.scope).n} 课`;
  return `
    <article class="panel">
      <p class="kicker">闪电反应</p>
      <h1>先读，再听。</h1>
      <p class="lead">字母亮出来以后先自己读。停一拍，标准音才出现。读对了就点“读对了”。这一轮：${esc(scopeLabel)}。最好成绩 ${progress.reflexBest || 0} 分。</p>
      <div class="speed-row">${speeds}</div>
      <button class="btn" data-act="reflex-start">开始</button>
    </article>
  `;
}

function renderReflexDone() {
  const reflex = state.reflex;
  return `
    <article class="panel">
      <p class="kicker">这一轮</p>
      <h1>${reflex.pct} 分</h1>
      <p class="lead">${reflex.hits} / ${reflex.deck.length} 个音，你在听到标准音之前就读对了。最好成绩 ${progress.reflexBest || 0} 分。</p>
      <div class="hero-actions">
        <button class="btn" data-act="reflex-start">再来一轮</button>
        <button class="btn light" data-act="home">回地图</button>
      </div>
    </article>
  `;
}

function renderRules() {
  const cards = RULES.map((rule) => `
    <button class="rule-card" data-act="open-rule" data-id="${rule.id}">
      <b>${esc(rule.title)}</b>
      <span>${esc(rule.body.slice(0, 42))}…</span>
    </button>`).join("");
  return `
    <p class="kicker">规律手册</p>
    <h1>看见字母时，用这些规律决定读音。</h1>
    <div class="rule-list">${cards}</div>
  `;
}

function renderRule() {
  const rule = RULES.find((item) => item.id === state.ruleId);
  const listens = rule.listens.map((item) => {
    if (item.word) return `<button class="btn light" data-act="play-word" data-word="${esc(item.word)}">${esc(item.label)}</button>`;
    return `<button class="btn-sound" data-act="play-sound" data-id="${item.sound}">${esc(item.label)}</button>`;
  }).join("");
  return `
    <button class="back" data-act="rules">← 全部规律</button>
    <article class="panel">
      <h1>${esc(rule.title)}</h1>
      <p class="lead">${esc(rule.body)}</p>
      <div class="listens">${listens}</div>
    </article>
  `;
}

function collectChoicePool(unit) {
  const pool = [];
  const seen = new Set();
  const push = (item) => {
    if (seen.has(item.sound)) return;
    seen.add(item.sound);
    pool.push(item);
  };
  quizItems(unit).forEach(push);
  if (pool.length >= 4) return pool;
  UNITS.forEach((candidate) => quizItems(candidate).forEach(push));
  return pool;
}

function pickFour(correct, pool) {
  const others = shuffle(pool.filter((item) => item.sound !== correct.sound)).slice(0, 3);
  return shuffle([correct, ...others]);
}

function makeQuiz(unit) {
  const pool = collectChoicePool(unit);
  const questions = [];
  shuffle(pool).slice(0, Math.min(3, pool.length)).forEach((item) => {
    questions.push({
      type: "hear-sound",
      prompt: "听一听，选出这个音",
      sound: item.sound,
      answer: item.sound,
      choices: pickFour(item, pool).map((choice) => ({
        key: choice.sound,
        main: choice.card,
        sub: choice.cue || SOUNDS[choice.sound].ipa,
      })),
    });
  });
  const shown = shuffle(pool)[0];
  questions.push({
    type: "see-sound",
    prompt: "这个写法读哪个音？选出例词",
    show: shown.card,
    sound: shown.sound,
    answer: shown.sound,
    choices: pickFour(shown, pool).map((choice) => ({
      key: choice.sound,
      main: `${SOUNDS[choice.sound].emoji} ${SOUNDS[choice.sound].keyword || SOUNDS[choice.sound].g}`,
      sub: SOUNDS[choice.sound].zh || SOUNDS[choice.sound].ipa,
    })),
  });
  const wordPool = unit.words.length >= 4 ? unit.words : UNITS[0].words.concat(unit.words);
  shuffle(wordPool).slice(0, 2).forEach((entry) => {
    const options = shuffle([entry, ...shuffle(wordPool.filter((item) => item.w !== entry.w)).slice(0, 3)]);
    questions.push({
      type: "hear-word",
      prompt: "听单词，选出拼写",
      word: entry.w,
      answer: entry.w,
      choices: options.map((option) => ({ key: option.w, main: option.w, sub: "" })),
    });
  });
  shuffle(wordPool).slice(0, 2).forEach((entry) => {
    const options = shuffle([entry, ...shuffle(wordPool.filter((item) => item.w !== entry.w)).slice(0, 3)]);
    questions.push({
      type: "read-word",
      prompt: "读出这个词，再选出意思",
      show: entry.w,
      answer: entry.w,
      choices: options.map((option) => ({ key: option.w, main: option.emoji, sub: option.zh })),
    });
  });
  return { unitId: unit.id, questions: shuffle(questions), i: 0, score: 0, locked: false, picked: null, ok: false };
}

function currentQuestion() {
  return state.quiz.questions[state.quiz.i];
}

function replayCurrent() {
  const view = state.view;
  if (view === "quiz" && state.quiz && state.quiz.i < state.quiz.questions.length) {
    const question = currentQuestion();
    if (question.word) return playWord(question.word);
    if (question.sound && question.type !== "read-word") return playSoundId(question.sound);
  }
  if (view === "reflex" && state.reflex && state.reflex.phase === "hear") {
    return playSoundId(state.reflex.deck[state.reflex.i].sound);
  }
  if (view === "blend") {
    return playWord(unitById(state.unitId).words[state.wordIndex].w);
  }
  return null;
}

function resetStage() {
  const stage = document.getElementById("stage");
  if (!stage) return;
  stage.classList.remove("merged");
  document.getElementById("result").classList.remove("show");
  document.getElementById("formula").classList.remove("show");
  stage.querySelectorAll(".card.active").forEach((card) => card.classList.remove("active"));
}

function setBlendLocked(locked) {
  document.querySelectorAll("[data-act=sound-out], [data-act=merge], [data-act=pick-word], [data-act=play-part]").forEach((button) => {
    button.disabled = locked;
  });
}

async function soundOut() {
  if (state.busy || state.view !== "blend") return;
  const job = audioJob;
  state.busy = true;
  setBlendLocked(true);
  resetStage();
  const entry = unitById(state.unitId).words[state.wordIndex];
  for (let index = 0; index < entry.parts.length; index += 1) {
    if (audioJob !== job) return;
    const card = document.getElementById(`card-${index}`);
    if (!card) return;
    card.classList.add("active");
    if (entry.parts[index].s === "silent") await wait(420);
    else {
      await playSoundId(entry.parts[index].s);
      await wait(90);
    }
    if (audioJob !== job) return;
    card.classList.remove("active");
    await wait(70);
  }
  if (audioJob === job) {
    state.busy = false;
    setBlendLocked(false);
  }
}

async function mergeWord() {
  if (state.busy || state.view !== "blend") return;
  const job = audioJob;
  state.busy = true;
  setBlendLocked(true);
  resetStage();
  const entry = unitById(state.unitId).words[state.wordIndex];
  const stage = document.getElementById("stage");
  if (!stage) return;
  stage.classList.add("merged");
  await wait(380);
  if (audioJob !== job) return;
  await playWord(entry.w);
  if (audioJob !== job) return;
  const result = document.getElementById("result");
  const line = document.getElementById("formula");
  if (result) result.classList.add("show");
  if (line) line.classList.add("show");
  patchUnit(state.unitId, { blend: true });
  state.busy = false;
  setBlendLocked(false);
}

function startQuiz() {
  state.quiz = makeQuiz(unitById(state.unitId));
  go("quiz");
  playQuestionAudio();
}

function playQuestionAudio() {
  if (!state.quiz || state.quiz.i >= state.quiz.questions.length) return;
  const question = currentQuestion();
  if (question.type === "hear-sound") playSoundId(question.sound);
  if (question.type === "hear-word") playWord(question.word);
}

function answerQuiz(key) {
  if (!state.quiz || state.quiz.locked) return;
  const question = currentQuestion();
  state.quiz.locked = true;
  state.quiz.picked = key;
  state.quiz.ok = key === question.answer;
  if (state.quiz.ok) state.quiz.score += 1;
  render();
  if (question.type === "hear-word" || question.type === "read-word") playWord(question.type === "hear-word" ? question.word : question.show);
  else playSoundId(question.answer);
}

function finishQuestion() {
  state.quiz.i += 1;
  state.quiz.locked = false;
  state.quiz.picked = null;
  if (state.quiz.i >= state.quiz.questions.length) {
    const pct = Math.round((state.quiz.score / state.quiz.questions.length) * 100);
    const previous = unitProgress(state.quiz.unitId).quiz || 0;
    patchUnit(state.quiz.unitId, { quiz: Math.max(previous, pct) });
  }
  render();
  playQuestionAudio();
}

function buildDeck(scope) {
  let items = [];
  if (scope === "all" || scope === "learned") {
    UNITS.forEach((unit) => {
      if (scope === "learned" && !unitProgress(unit.id).learn && !starred(unit.id)) return;
      items.push(...reflexItems(unit));
    });
    if (!items.length) items = reflexItems(UNITS[0]);
  } else {
    items = reflexItems(unitById(scope));
  }
  if (!items.length) items = reflexItems(UNITS[0]);
  let deck = shuffle(items);
  while (deck.length < 12) deck = deck.concat(shuffle(items));
  return deck.slice(0, 12);
}

function openReflex(scope) {
  state.reflex = { scope, deck: buildDeck(scope), i: 0, phase: "ready", hits: 0, pct: 0, token: 0 };
  go("reflex");
}

function beginReflexRound() {
  state.reflex.phase = "think";
  state.reflex.token += 1;
  const token = state.reflex.token;
  render();
  state.timer = setTimeout(() => {
    if (!state.reflex || state.reflex.token !== token || state.view !== "reflex") return;
    revealReflex();
  }, progress.speed || 1100);
}

async function revealReflex() {
  state.reflex.phase = "hear";
  render();
  await playSoundId(state.reflex.deck[state.reflex.i].sound);
}

function markReflex(hit) {
  if (!state.reflex || state.reflex.phase !== "hear") return;
  if (hit) state.reflex.hits += 1;
  state.reflex.i += 1;
  if (state.reflex.i >= state.reflex.deck.length) {
    const pct = Math.round((state.reflex.hits / state.reflex.deck.length) * 100);
    state.reflex.phase = "done";
    state.reflex.pct = pct;
    progress.reflexBest = Math.max(progress.reflexBest || 0, pct);
    if (state.reflex.scope !== "all" && state.reflex.scope !== "learned") {
      const previous = unitProgress(state.reflex.scope).reflex || 0;
      patchUnit(state.reflex.scope, { reflex: Math.max(previous, pct) });
    } else saveProgress();
    render();
    return;
  }
  beginReflexRound();
}

document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-act]");
  if (!target || target.disabled) return;
  const act = target.dataset.act;
  if (act === "home") return go("home");
  if (act === "rules") return go("rules");
  if (act === "open-unit") {
    state.unitId = target.dataset.id || state.unitId;
    return go("unit");
  }
  if (act === "open-learn") {
    state.step = 0;
    return go("learn");
  }
  if (act === "open-blend") {
    state.wordIndex = 0;
    return go("blend");
  }
  if (act === "open-quiz") return startQuiz();
  if (act === "open-sentences") {
    state.step = 0;
    state.sentenceIndex = -1;
    return go("sentences");
  }
  if (act === "sentence-prev") {
    state.step = Math.max(0, state.step - 1);
    state.sentenceIndex = -1;
    return go("sentences");
  }
  if (act === "sentence-next") {
    const total = (unitById(state.unitId).sentences || []).length;
    state.step = Math.min(total - 1, state.step + 1);
    state.sentenceIndex = -1;
    return go("sentences");
  }
  if (act === "play-sentence") return playSentence();
  if (act === "open-rule") {
    state.ruleId = target.dataset.id;
    return go("rule");
  }
  if (act === "play-sound") return playSoundId(target.dataset.id);
  if (act === "play-word") return playWord(target.dataset.word);
  if (act === "learn-prev") {
    state.step = Math.max(0, state.step - 1);
    return go("learn");
  }
  if (act === "learn-next") {
    state.step += 1;
    return go("learn");
  }
  if (act === "finish-learn") {
    patchUnit(state.unitId, { learn: true });
    state.wordIndex = 0;
    return go("blend");
  }
  if (act === "pick-word") {
    if (state.busy) return;
    state.wordIndex = Number(target.dataset.i);
    return go("blend");
  }
  if (act === "play-part") {
    if (state.busy) return;
    const index = Number(target.dataset.i);
    const entry = unitById(state.unitId).words[state.wordIndex];
    const card = document.getElementById(`card-${index}`);
    card.classList.add("active");
    return playSoundId(entry.parts[index].s).then(() => card.classList.remove("active"));
  }
  if (act === "sound-out") return soundOut();
  if (act === "merge") return mergeWord();
  if (act === "answer") return answerQuiz(target.dataset.key);
  if (act === "quiz-next") return finishQuestion();
  if (act === "replay") return replayCurrent();
  if (act === "reflex-setup") return openReflex(target.dataset.scope);
  if (act === "set-speed") {
    progress.speed = Number(target.dataset.speed);
    saveProgress();
    return render();
  }
  if (act === "reflex-start") {
    state.reflex.deck = buildDeck(state.reflex.scope);
    state.reflex.i = 0;
    state.reflex.hits = 0;
    return beginReflexRound();
  }
  if (act === "reflex-mark") return markReflex(target.dataset.hit === "1");
  if (act === "reset") {
    progress = { units: {}, reflexBest: 0, speed: progress.speed || 1100 };
    saveProgress();
    return go("home");
  }
  return null;
});

document.addEventListener("keydown", (event) => {
  if (event.code !== "Space" || event.target.closest("button")) return;
  event.preventDefault();
  replayCurrent();
});

render();
