
"use strict";

const CONFIG = {
  scores: {
    mood: 2,
    moodExtra: 1,
    craving: 4,
    signature: 3,
    tieBreak: 5
  },
  finalistMax: 3,
  closeScoreDelta: 4,
  strongLeadDelta: 5,
  hotPoolSize: 12,
  dynamicMaxChoices: 5
};

const state = {
  step: "start",
  pizzas: [],
  moods: [],
  concepts: [],
  pictograms: {},
  scores: new Map(),
  vetoed: new Set(),
  answers: [],
  positiveConcepts: new Set(),
  selectedMoodId: null,
  finalists: []
};

const $game = document.querySelector("#game");
const $field = document.querySelector("#field");
const $progressBar = document.querySelector("#progressBar");
const $stepLabel = document.querySelector("#stepLabel");
const $stepCount = document.querySelector("#stepCount");
const $scoreLegend = document.querySelector("#scoreLegend");
const $restartBtn = document.querySelector("#restartBtn");

async function boot() {
  const [pizzaData, conceptData, pictoData] = await Promise.all([
    fetch("./data/pizzas.json").then(r => r.json()),
    fetch("./data/concepts.json").then(r => r.json()),
    fetch("./data/pictograms.json").then(r => r.json())
  ]);

  state.pizzas = pizzaData.pizzas;
  state.moods = conceptData.moods;
  state.concepts = conceptData.concepts;
  state.pictograms = pictoData.ingredientPictograms;

  resetScores();
  renderField();
  renderStart();
}

function resetScores() {
  state.scores = new Map(state.pizzas.map(p => [p.id, 0]));
  state.vetoed = new Set();
  state.answers = [];
  state.positiveConcepts = new Set();
  state.selectedMoodId = null;
  state.finalists = [];
  state.step = "start";
}

function pizzaMatchesConcept(pizza, concept) {
  const ingredientMatch = (concept.ingredients || []).some(x => pizza.ingredients.includes(x));
  const tagMatch = (concept.tags || []).some(x => pizza.tags.includes(x));
  return ingredientMatch || tagMatch;
}

function scoreOf(pizza) {
  return state.scores.get(pizza.id) ?? 0;
}

function activePizzas() {
  return state.pizzas.filter(p => !state.vetoed.has(p.id));
}

function rankedPizzas() {
  return activePizzas()
    .slice()
    .sort((a, b) => scoreOf(b) - scoreOf(a) || a.id - b.id);
}

function topPool(limit = CONFIG.hotPoolSize) {
  const ranked = rankedPizzas();
  if (!ranked.length) return [];
  if (ranked.length <= limit) return ranked;

  // Important: never break a score tie by pizza id.
  // If 30 pizzas have the same score (e.g. wildcard mood), all 30 stay in the analysis pool.
  const cutoff = scoreOf(ranked[limit - 1]);
  return ranked.filter(p => scoreOf(p) >= cutoff);
}

function addScore(pizzaId, amount) {
  state.scores.set(pizzaId, scoreOf({ id: pizzaId }) + amount);
}

function applyMood(mood) {
  state.selectedMoodId = mood.id;
  for (const pizza of state.pizzas) {
    const matches = mood.tags.filter(tag => pizza.tags.includes(tag)).length;
    if (matches > 0) {
      addScore(pizza.id, CONFIG.scores.mood);
      if (matches > 1) addScore(pizza.id, CONFIG.scores.moodExtra);
    }
  }
  state.answers.push({ step: "mood", choice: mood.id });
}

function applyConcept(concept, amount, step) {
  for (const pizza of activePizzas()) {
    if (pizzaMatchesConcept(pizza, concept)) addScore(pizza.id, amount);
  }
  state.positiveConcepts.add(concept.id);
  state.answers.push({ step, choice: concept.id });
}

function applyVeto(concept) {
  for (const pizza of activePizzas()) {
    if (pizzaMatchesConcept(pizza, concept)) state.vetoed.add(pizza.id);
  }
  state.answers.push({ step: "veto", choice: concept.id });
}

function applyNoneOfConcepts(concepts, amount, step = "tieBreakNone") {
  for (const pizza of activePizzas()) {
    const matchesAny = concepts.some(concept => pizzaMatchesConcept(pizza, concept));
    if (!matchesAny) addScore(pizza.id, amount);
  }
  state.answers.push({ step, choice: "none_of_these" });
}

function conceptStats(concept, pool) {
  const matched = pool.filter(p => pizzaMatchesConcept(p, concept)).length;
  const ratio = pool.length ? matched / pool.length : 0;

  // Information-ish score: best around 50/50, with a small reward for useful coverage.
  const balance = 1 - Math.abs(0.5 - ratio) * 2;
  return { matched, ratio, balance };
}

function pickDynamicConcepts(kind) {
  const pool = topPool();
  const isSignature = kind === "signature";
  const isVeto = kind === "veto";

  let candidates = state.concepts.filter(c => {
    if (isSignature && !c.signature) return false;
    if (!isSignature && c.signature) return false;
    if (state.positiveConcepts.has(c.id)) return false;
    return true;
  });

  // Q2 must feel like a consequence of Q1:
  // keep the dynamic/statistical choice, but inside a coherent vocabulary for the selected mood.
  if (kind === "craving" && state.selectedMoodId && state.selectedMoodId !== "wildcard") {
    const mood = state.moods.find(m => m.id === state.selectedMoodId);
    const allowed = new Set(mood?.cravingConcepts || []);
    const affinityCandidates = candidates.filter(c => allowed.has(c.id));

    // Safety fallback: if a future data edit leaves too few valid concepts,
    // fall back to the global pool instead of breaking the screen.
    if (affinityCandidates.length >= 3) candidates = affinityCandidates;
  }

  if (isVeto) {
    // Veto prefers highly understandable "deal breaker" concepts.
    candidates = state.concepts.filter(c => {
      if (state.positiveConcepts.has(c.id)) return false;
      return c.vetoPreferred || ["mushroom", "spicy", "strong_cheese"].includes(c.id);
    });
  }

  const scored = candidates.map(c => {
    const stats = conceptStats(c, pool);
    let score = stats.balance;

    if (kind === "craving") {
      if (stats.ratio < 0.15 || stats.ratio > 0.60) score -= 1;
    }

    if (kind === "veto") {
      if (stats.ratio < 0.12 || stats.ratio > 0.65) score -= 1;
      if (c.vetoPreferred) score += 0.25;
    }

    if (kind === "signature") {
      // Rare is okay here, but a concept that matches nobody is useless.
      if (stats.matched === 0) score -= 5;
      else score += (1 - stats.ratio) * 0.35;
    }

    return { concept: c, ...stats, score };
  });

  return scored
    .filter(x => x.matched > 0 && x.matched < pool.length)
    .sort((a, b) => b.score - a.score || b.matched - a.matched)
    .slice(0, CONFIG.dynamicMaxChoices)
    .map(x => x.concept);
}

function determineFinalists() {
  const ranked = rankedPizzas();
  if (!ranked.length) return [];

  const topScore = scoreOf(ranked[0]);
  const secondScore = ranked[1] ? scoreOf(ranked[1]) : -Infinity;

  // A very clear winner may stand alone.
  if (!ranked[1] || topScore - secondScore >= CONFIG.strongLeadDelta) {
    return [ranked[0]];
  }

  // Keep only genuinely close candidates, never more than 3 here.
  const close = ranked.filter(p => topScore - scoreOf(p) <= CONFIG.closeScoreDelta);
  if (close.length <= CONFIG.finalistMax) return close;

  // Too many plausible survivors: tie-break required.
  return null;
}

function pickTieBreakConcepts() {
  const ranked = rankedPizzas();
  const topScore = scoreOf(ranked[0]);
  const contenders = ranked.filter(p => topScore - scoreOf(p) <= CONFIG.closeScoreDelta);

  const candidates = state.concepts
    .filter(c => !state.positiveConcepts.has(c.id))
    .map(c => ({ concept: c, ...conceptStats(c, contenders) }))
    .filter(x => x.matched > 0 && x.matched < contenders.length)
    .sort((a,b) => b.balance - a.balance || b.matched - a.matched)
    .slice(0, 5)
    .map(x => x.concept);

  return candidates;
}

function finalIcons(pizza, finalists) {
  const always = [];
  const distinctive = [];

  for (const ingredient of pizza.ingredients) {
    const meta = state.pictograms[ingredient];
    if (!meta) continue;
    if (meta.finalDisplay === "always") always.push({ ingredient, ...meta });
    if (meta.finalDisplay === "distinctive") distinctive.push({ ingredient, ...meta });
  }

  // Only keep a distinctive ingredient if it actually distinguishes this finalist.
  const usefulDistinctive = distinctive.filter(item => {
    return finalists.some(other => {
      if (other.id === pizza.id) return false;
      return !other.ingredients.includes(item.ingredient);
    });
  });

  // Deduplicate identical emoji while preserving order.
  const combined = [...always, ...usefulDistinctive];
  const seen = new Set();
  return combined.filter(item => {
    const key = item.icon;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 7);
}

function currentMaxScore() {
  let max = 0;

  if (state.answers.some(a => a.step === "mood")) max += 3;
  if (state.answers.some(a => a.step === "craving")) max += CONFIG.scores.craving;
  if (state.answers.some(a => a.step === "signature")) max += CONFIG.scores.signature;
  if (state.answers.some(a => a.step === "tieBreak" || a.step === "tieBreakNone")) {
    max += CONFIG.scores.tieBreak;
  }

  return max;
}

function scoreFillPercent(pizza) {
  const max = currentMaxScore();
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, (scoreOf(pizza) / max) * 100));
}

function renderField() {
  const maxScore = currentMaxScore();
  const finalistIds = new Set((state.finalists || []).map(p => p.id));

  $field.innerHTML = state.pizzas.map(p => {
    const classes = ["pizza-dot"];
    if (state.vetoed.has(p.id)) classes.push("out");
    if (state.step === "final" && finalistIds.has(p.id)) classes.push("finalist");

    const score = scoreOf(p);
    const fill = state.vetoed.has(p.id) ? 0 : scoreFillPercent(p);
    const title = maxScore > 0
      ? `Pizza ${String(p.id).padStart(2,"0")} · ${score}/${maxScore} pts`
      : `Pizza ${String(p.id).padStart(2,"0")} · 0 pt`;

    return `<span
      class="${classes.join(" ")}"
      style="--score-fill:${fill.toFixed(1)}%;"
      title="${title}"
      aria-label="${title}"
    >${String(p.id).padStart(2,"0")}</span>`;
  }).join("");

  if (maxScore <= 0) {
    $scoreLegend.textContent = "Les 30 pizzas rentrent en lice...";
  } else {
    $scoreLegend.textContent =
      `Remplissage = affinité cumulée · ${maxScore} pts max à ce stade · gris = éliminée`;
  }
}

function updateProgress(step, n, label) {
  const percent = Math.max(0, Math.min(100, (n / 4) * 100));
  $progressBar.style.width = `${percent}%`;
  $stepLabel.textContent = label;
  $stepCount.textContent = `${Math.min(n,4)} / 4`;
  state.step = step;
  renderField();
}

function renderStart() {
  updateProgress("start", 0, "Prête ?");
  $restartBtn.hidden = true;
  $game.innerHTML = `
    <div class="start">
      <div>
        <div class="kicker">30 pizzas entrent dans l'arène</div>
        <h2 class="question">Une seule en ressortira.</h2>
        <p class="helper">Suis juste tes envies. Je m'occupe des conséquences. 😌</p>
        <button class="primary" id="startBtn">Commencer le carnage 🍕</button>
        <div class="micro">Aucun nom de pizza ne sera maltraité pendant cette expérience.</div>
      </div>
    </div>`;
  document.querySelector("#startBtn").addEventListener("click", renderMood);
}

function choiceButton(choice, handler) {
  const button = document.createElement("button");
  button.className = "choice";
  button.type = "button";
  button.innerHTML = `
    <span class="choice-icon">${choice.icon || "•"}</span>
    <span class="choice-label">${choice.label}</span>`;
  button.addEventListener("click", () => handler(choice));
  return button;
}

function renderChoices({kicker, question, helper, choices, onChoose, noneChoice}) {
  $game.innerHTML = `
    <div class="kicker">${kicker}</div>
    <h2 class="question">${question}</h2>
    <p class="helper">${helper}</p>
    <div class="choices" id="choices"></div>`;
  const container = document.querySelector("#choices");
  choices.forEach(choice => container.appendChild(choiceButton(choice, onChoose)));
  if (noneChoice) container.appendChild(choiceButton(noneChoice, onChoose));
}

function renderMood() {
  updateProgress("mood", 1, "Orientation générale");
  renderChoices({
    kicker: "ÉTAPE 1 · TON HUMEUR",
    question: "Dans quel mood tu souhaites manger ?",
    helper: "Pas besoin de réfléchir comme si ta vie en dépendait. Normalement.",
    choices: state.moods,
    onChoose: mood => {
      applyMood(mood);
      renderCraving();
    }
  });
}

function renderCraving() {
  updateProgress("craving", 2, "Envie du moment");
  const choices = pickDynamicConcepts("craving");
  renderChoices({
    kicker: "ÉTAPE 2 · LE PETIT APPEL",
    question: "Là, maintenant… lequel t'appelle ? ❤️",
    helper: "Choisis l'envie qui gagne. Les autres survivront peut-être quand même.",
    choices,
    onChoose: concept => {
      applyConcept(concept, CONFIG.scores.craving, "craving");
      renderVeto();
    }
  });
}

function renderVeto() {
  updateProgress("veto", 3, "Le sacrifice");
  const choices = pickDynamicConcepts("veto");
  const none = { id: "none", label: "Je mange de tout 😇", icon: "🕊️" };

  renderChoices({
    kicker: "ÉTAPE 3 · LE VETO",
    question: "Lequel peut ruiner une pizza à lui tout seul ? ☠️",
    helper: "Cette fois c'est sérieux : ce que tu choisis disparaît réellement.",
    choices,
    noneChoice: none,
    onChoose: concept => {
      if (concept.id !== "none") applyVeto(concept);
      else state.answers.push({ step: "veto", choice: "none" });
      renderSignature();
    }
  });
}

function renderSignature() {
  updateProgress("signature", 4, "Petit vice final");
  const choices = pickDynamicConcepts("signature");
  const none = { id: "none", label: "Pas de favoritisme 🎲", icon: "😇" };

  renderChoices({
    kicker: "ÉTAPE 4 · QUITTE À CRAQUER",
    question: "Une petite faiblesse particulière ? 😏",
    helper: "Dernier coup de pouce. Après ça, le jury délibère.",
    choices,
    noneChoice: none,
    onChoose: concept => {
      if (concept.id !== "none") applyConcept(concept, CONFIG.scores.signature, "signature");
      else state.answers.push({ step: "signature", choice: "none" });
      resolveFinal();
    }
  });
}

function resolveFinal() {
  let finalists = determineFinalists();

  if (finalists === null) {
    const tieChoices = pickTieBreakConcepts();
    if (tieChoices.length) {
      renderTieBreak(tieChoices);
      return;
    }
    finalists = rankedPizzas().slice(0, CONFIG.finalistMax);
  }

  renderFinalists(finalists);
}

function renderTieBreak(choices) {
  $stepLabel.textContent = "Prolongations";
  $stepCount.textContent = "😈";
  state.step = "tie";
  renderField();

  const none = {
    id: "none_of_these",
    label: "Rien de tout ça 😌",
    icon: "↩️"
  };

  renderChoices({
    kicker: "BON… ELLES REFUSENT DE MOURIR",
    question: "Il va encore falloir trancher. 😈",
    helper: "Parmi ces envies, laquelle gagne maintenant ? Ou aucune : ça aussi, c'est une vraie information.",
    choices,
    noneChoice: none,
    onChoose: concept => {
      if (concept.id === "none_of_these") {
        applyNoneOfConcepts(choices, CONFIG.scores.tieBreak);
      } else {
        applyConcept(concept, CONFIG.scores.tieBreak, "tieBreak");
      }

      let finalists = determineFinalists();
      if (finalists === null || !finalists?.length) finalists = rankedPizzas().slice(0, CONFIG.finalistMax);
      renderFinalists(finalists.slice(0, CONFIG.finalistMax));
    }
  });
}


function affinityPercent(pizza) {
  const max = currentMaxScore();
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((scoreOf(pizza) / max) * 100)));
}

function conceptById(id) {
  return state.concepts.find(c => c.id === id);
}

function moodById(id) {
  return state.moods.find(m => m.id === id);
}

function answerPresentation(answer) {
  if (answer.step === "mood") {
    const mood = moodById(answer.choice);
    return {
      icon: mood?.icon || "🧭",
      title: "Mood",
      label: mood?.label || answer.choice
    };
  }

  if (answer.step === "craving") {
    const concept = conceptById(answer.choice);
    return {
      icon: concept?.icon || "❤️",
      title: "Envie",
      label: concept?.label || answer.choice
    };
  }

  if (answer.step === "veto") {
    if (answer.choice === "none") {
      return { icon: "🕊️", title: "Veto", label: "Aucun, grande âme" };
    }
    const concept = conceptById(answer.choice);
    return {
      icon: "☠️",
      title: "Veto",
      label: concept?.label || answer.choice
    };
  }

  if (answer.step === "signature") {
    if (answer.choice === "none") {
      return { icon: "😇", title: "Faiblesse", label: "Aucune… officiellement" };
    }
    const concept = conceptById(answer.choice);
    return {
      icon: concept?.icon || "😏",
      title: "Faiblesse",
      label: concept?.label || answer.choice
    };
  }

  if (answer.step === "tieBreak") {
    const concept = conceptById(answer.choice);
    return {
      icon: concept?.icon || "🔥",
      title: "Départage",
      label: concept?.label || answer.choice
    };
  }

  if (answer.step === "tieBreakNone") {
    return {
      icon: "↩️",
      title: "Départage",
      label: "Rien de tout ça"
    };
  }

  return {
    icon: "•",
    title: answer.step,
    label: answer.choice
  };
}

function getPizzaProfile() {
  const mood = state.answers.find(a => a.step === "mood")?.choice;
  const craving = state.answers.find(a => a.step === "craving")?.choice;
  const signature = state.answers.find(a => a.step === "signature")?.choice;
  const tie = state.answers.find(a => a.step === "tieBreak")?.choice;

  const spicySignals = new Set(["spicy", "strong_cheese", "fennel_sausage"]);
  const premiumSignals = new Set(["truffle", "pistachio", "burrata", "italian_cold_cuts"]);
  const veggieSignals = new Set(["mushroom", "aubergine", "pesto", "goat"]);

  const chosen = new Set([craving, signature, tie].filter(Boolean));

  if (mood === "wildcard") {
    return {
      icon: "🎲",
      name: "Agent du chaos",
      tagline: "Tu as confié une partie du plan au destin. Il a pris ça très au sérieux."
    };
  }

  if (
    mood === "character" &&
    [...chosen].some(x => premiumSignals.has(x))
  ) {
    return {
      icon: "😈",
      name: "Chaos gourmand",
      tagline: "Tu voulais du caractère. Tu as surtout refusé toute demi-mesure."
    };
  }

  if (mood === "comfort" || [...chosen].filter(x => premiumSignals.has(x)).length >= 2) {
    return {
      icon: "🤤",
      name: "Gourmande sans remords",
      tagline: "Le mot « raisonnable » n'a manifestement jamais été invité à cette partie."
    };
  }

  if (mood === "classic") {
    return {
      icon: "😌",
      name: "Classique assumée",
      tagline: "Pas besoin de faire quinze saltos quand on sait ce qu'on aime."
    };
  }

  if (
    mood === "fresh" ||
    [...chosen].some(x => veggieSignals.has(x))
  ) {
    return {
      icon: "🌿",
      name: "Méditerranéenne",
      tagline: "Du soleil, du relief et juste assez de mauvaise foi pour appeler ça léger."
    };
  }

  if ([...chosen].some(x => spicySignals.has(x))) {
    return {
      icon: "🔥",
      name: "Caractère bien trempé",
      tagline: "Tu n'es clairement pas venue chercher une pizza qui s'excuse d'exister."
    };
  }

  return {
    icon: "🍕",
    name: "Instinctive",
    tagline: "Tu as suivi l'envie du moment. Et franchement, c'était le but."
  };
}

function renderAnswerRecap() {
  const visible = state.answers
    .map(answerPresentation)
    .filter(Boolean);

  return `
    <div class="recap">
      <div class="recap-title">Ton parcours</div>
      <div class="recap-list">
        ${visible.map(item => `
          <div class="recap-row">
            <span class="recap-icon">${item.icon}</span>
            <span class="recap-key">${item.title}</span>
            <span class="recap-value">${item.label}</span>
          </div>
        `).join("")}
      </div>
    </div>`;
}

function pickRandomFinalist() {
  if (!state.finalists?.length) return null;
  return state.finalists[Math.floor(Math.random() * state.finalists.length)];
}

function renderFinalists(finalists) {
  state.finalists = finalists.slice(0, CONFIG.finalistMax);
  state.step = "final";
  $stepLabel.textContent = state.finalists.length === 1 ? "Verdict" : "Finalistes";
  $stepCount.textContent = `${state.finalists.length} 🍕`;
  $progressBar.style.width = "100%";
  renderField();
  $restartBtn.hidden = false;

  const plural = state.finalists.length > 1;
  $game.innerHTML = `
    <div class="kicker">LE DERNIER PROBLÈME</div>
    <h2 class="question">${plural ? "Choisis ton numéro." : "Ton chemin a parlé."}</h2>
    <p class="helper">${plural
      ? "Je te laisse quelques indices. Les noms restent classifiés. 😏"
      : "Aucune négociation nécessaire. Voilà ce que tu as fabriqué. 😌"}</p>
    <div class="final-grid" id="finalGrid"></div>
    ${plural ? `
      <div class="chaos-zone">
        <div class="chaos-copy">Toujours incapable de trancher ?</div>
        <button id="chaosBtn" class="chaos-button" type="button">🎲 Laisser le destin choisir</button>
      </div>
    ` : ""}`;

  const grid = document.querySelector("#finalGrid");

  state.finalists.forEach(pizza => {
    const icons = finalIcons(pizza, state.finalists);
    const affinity = affinityPercent(pizza);
    const card = document.createElement("button");
    card.type = "button";
    card.className = "final-card";
    card.innerHTML = `
      <div class="final-number">${String(pizza.id).padStart(2,"0")}</div>
      <div class="pictos">${icons.map(x => `<span>${x.icon}</span>`).join("")}</div>
      <div class="affinity">
        <span class="affinity-value">${affinity}%</span>
        <span class="affinity-label">d'affinité avec ton parcours</span>
      </div>`;
    card.addEventListener("click", () => renderWinner(pizza));
    grid.appendChild(card);
  });

  const chaosBtn = document.querySelector("#chaosBtn");
  if (chaosBtn) {
    chaosBtn.addEventListener("click", () => {
      const chosen = pickRandomFinalist();
      if (chosen) renderWinner(chosen, true);
    });
  }
}


function renderDeliverySlip(pizza) {
  return `
    <div class="delivery-slip">
      <div class="delivery-label">COMMANDE VALIDÉE ✅</div>
      <div class="delivery-copy">
        Veuillez indiquer le numéro
        <strong>${String(pizza.id).padStart(2, "0")}</strong>
        à votre livreur.
      </div>
      <div class="delivery-subcopy">
        Celui-ci fera le nécessaire. 🚗🍕
      </div>
    </div>`;
}

function renderRatingWidget() {
  return `
    <div class="rating-card">
      <div class="rating-title">Comment s'est passée votre expérience ?</div>
      <div class="rating-subtitle">
        Votre avis compte énormément pour cette entreprise composée d'une seule personne.
      </div>

      <div class="rating-stars" role="radiogroup" aria-label="Note de satisfaction">
        ${[1,2,3,4,5].map(n => `
          <button
            type="button"
            class="star-button"
            data-rating="${n}"
            aria-label="${n} étoile${n > 1 ? "s" : ""}"
            role="radio"
            aria-checked="false"
          >★</button>
        `).join("")}
      </div>

      <div id="ratingMessage" class="rating-message" aria-live="polite"></div>
    </div>`;
}

function setupRatingWidget() {
  const messages = {
    1: "Nous sommes navrés. Une enquête interne vient d'être ouverte. Le livreur est actuellement entendu. 😐",
    2: "Le service qualité prend votre mécontentement très au sérieux. Enfin… autant que possible. 😅",
    3: "« Correct. » Cette avalanche d'enthousiasme nous va droit au cœur. 😐",
    4: "Merci ! Votre livreur conserve son poste pour samedi. 😌",
    5: "Excellente expérience. Votre livreur envisage désormais une carrière dans la logistique gastronomique. 🍕✨"
  };

  const buttons = [...document.querySelectorAll(".star-button")];
  const message = document.querySelector("#ratingMessage");

  if (!buttons.length || !message) return;

  buttons.forEach(button => {
    button.addEventListener("click", () => {
      const rating = Number(button.dataset.rating);

      buttons.forEach((star, index) => {
        const active = index < rating;
        star.classList.toggle("selected", active);
        star.setAttribute("aria-checked", Number(star.dataset.rating) === rating ? "true" : "false");
      });

      message.innerHTML = `
        <div class="rating-thanks">Merci pour votre retour.</div>
        <div class="rating-response">${messages[rating]}</div>
        <div class="rating-legal">
          Celui-ci ne sera absolument pas transmis à qui que ce soit.
        </div>`;
    });
  });
}

function renderWinner(pizza, chosenByChaos = false) {
  state.step = "winner";
  $stepLabel.textContent = "Destin scellé";
  $stepCount.textContent = "🍕";
  const icons = finalIcons(pizza, [pizza]);
  const profile = getPizzaProfile();
  const affinity = affinityPercent(pizza);

  $field.querySelectorAll(".pizza-dot").forEach((el, i) => {
    const isWinner = state.pizzas[i].id === pizza.id;
    el.classList.toggle("out", !isWinner);
    el.classList.toggle("chosen", isWinner);
    el.classList.remove("finalist");
  });

  $game.innerHTML = `
    <div class="winner">
      <div class="winner-inner">
        <div class="kicker">${chosenByChaos ? "LE DESTIN A TRANCHÉ" : "CHOIX ENREGISTRÉ"}</div>
        <div class="winner-number">${String(pizza.id).padStart(2,"0")}</div>
        <div class="pictos">${icons.map(x => `<span>${x.icon}</span>`).join("")}</div>

        <div class="winner-affinity">
          <strong>${affinity}%</strong>
          <span>d'affinité avec ton parcours</span>
        </div>

        <div class="profile-card">
          <div class="profile-eyebrow">PROFIL PIZZA DÉTECTÉ</div>
          <div class="profile-name">${profile.icon} ${profile.name}</div>
          <div class="profile-tagline">${profile.tagline}</div>
        </div>

        ${renderAnswerRecap()}

        ${renderDeliverySlip(pizza)}

        <p class="helper winner-copy">
          C'est noté. Maintenant, aucune tentative de corruption du pizzaiolo ne sera tolérée...
        </p>

        ${renderRatingWidget()}

        <div class="final-callback">
          <span>⚠️ - Température réglementaire des pizzas livrées non garantie.</span>
          <span>🌰 - Toute commande livrée inclut un sachet de noisettes pour l’hiver.</span>
          <span>🧥 - N'oubliez pas votre pull pour une soirée plus agréable.</span>
        </div>
      </div>
    </div>`;

  setupRatingWidget();
}

$restartBtn.addEventListener("click", () => {
  resetScores();
  renderField();
  renderStart();
});

boot().catch(err => {
  console.error(err);
  $game.innerHTML = `
    <h2 class="question">Petit souci de chargement 😅</h2>
    <p class="helper">Le jeu doit être servi par un petit serveur HTTP (GitHub Pages fonctionne parfaitement). Voir le README.</p>`;
});
