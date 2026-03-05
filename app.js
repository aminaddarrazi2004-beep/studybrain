// ── State ──
const files = [];
let selectedTime = 'een avond';
let userPlan = 'gratis';

// ── DOM refs ──
const zone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');

// ── Drag & drop ──
zone.addEventListener('click', () => fileInput.click());
zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('drag-over'); handleFiles([...e.dataTransfer.files]); });
fileInput.addEventListener('change', () => handleFiles([...fileInput.files]));

// ── Time buttons ──
document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', () => selectTime(btn));
  });
  await loadUserPlan();
});

// ── Load user plan ──
async function loadUserPlan() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  const { data: profile } = await sb.from('profiles').select('plan').eq('id', session.user.id).single();
  if (profile?.plan) userPlan = profile.plan;
}

// ── Plan helpers ──
function getVragenCount() {
  if (userPlan === 'gratis') return 1;
  if (userPlan === 'starter') return 5;
  return 10; // pro of elite
}

function getMaxFiles() {
  if (userPlan === 'gratis' || userPlan === 'starter') return 1;
  if (userPlan === 'pro') return 3;
  return 4; // elite — max 4 vakken
}

// ── File handling ──
function handleFiles(newFiles) {
  const maxFiles = getMaxFiles();
  newFiles.forEach((f) => {
    if (files.length >= maxFiles) {
      showError(`Jouw plan ondersteunt maximaal ${maxFiles} bestand(en) tegelijk.`);
      return;
    }
    if ((f.type === 'application/pdf' || f.name.endsWith('.pdf')) && !files.find((x) => x.name === f.name)) {
      files.push(f);
    }
  });
  renderFileList();
}

function renderFileList() {
  const list = document.getElementById('fileList');
  list.innerHTML = files.map((f, i) => `
    <div class="file-item">
      <span class="fi-icon">📄</span>
      <span class="fi-name">${f.name}</span>
      <span class="fi-size">${(f.size/1024/1024).toFixed(1)} MB</span>
      <button class="fi-remove" onclick="removeFile(${i})">×</button>
    </div>`).join('');
}

function removeFile(i) { files.splice(i, 1); renderFileList(); }

function selectTime(btn) {
  document.querySelectorAll('.time-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  selectedTime = btn.dataset.time;
}

function showError(msg) {
  const box = document.getElementById('errorBox');
  box.textContent = msg;
  box.style.display = 'block';
}
function hideError() { document.getElementById('errorBox').style.display = 'none'; }

// ── PDF text extraction ──
async function extractPdfText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const pdfjsLib = window['pdfjs-dist/build/pdf'];
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const pdf = await pdfjsLib.getDocument({ data: e.target.result }).promise;
        let fullText = '';
        // Max 15 pagina's per PDF om context window te beschermen
        const maxPages = Math.min(pdf.numPages, 15);
        for (let i = 1; i <= maxPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          fullText += content.items.map((item) => item.str).join(' ') + '\n';
        }
        resolve(fullText.trim());
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Lezen mislukt'));
    reader.readAsArrayBuffer(file);
  });
}

// ── Free limit ──
async function checkFreeLimit() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return true;
  const { data: profile, error } = await sb.from('profiles').select('free_analysis_used, plan').eq('id', session.user.id).single();
  if (error || !profile) return true;
  if (profile.plan && profile.plan !== 'gratis') return false;
  return profile.free_analysis_used === true;
}

async function markAnalysisUsed() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  if (userPlan !== 'gratis') return;
  await sb.from('profiles').update({ free_analysis_used: true }).eq('id', session.user.id);
}

// ── API call helper ──
async function callAnalyzeAPI(text, vakNaam, vragenCount) {
  const res = await fetch('https://analyze.aminaddarrazi2004.workers.dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content: `Je bent een Nederlandse ex-examinator met 15 jaar ervaring. Je schrijft studieplannen vanuit het perspectief van de docent die de toets maakt.

IJZEREN REGELS — NOOIT BREKEN:
- Vergelijkingstabellen (X vs Y met getallen zoals 38 ATP vs 2 ATP) → ALTIJD must
- Enzymen + denaturatie → ALTIJD must
- Celademhaling aeroob/anaeroob → ALTIJD must
- Fotosynthese met formule → ALTIJD must als het een eigen hoofdstuk heeft
- VERBODEN zinnen in reason: "essentieel voor het begrijpen", "kritisch voor", "belangrijk onderwerp", "komt vaak terug"
- reason moet ALTIJD een specifiek toetstype noemen: "definitievraag", "vergelijkingsvraag", "rekenvraag", "invulvraag"

Geef ALLEEN JSON terug. Geen tekst ervoor of erna.

JSON formaat:
{
  "must": [{"topic":"...","summary":"4-5 zinnen met echte feiten, getallen en formules uit de tekst. Simpele taal voor 16-jarige. Dagelijks leven voorbeeld.","reason":"Docenten toetsen dit als [type vraag] omdat [specifieke reden met details uit de tekst].","tip":"2-3 gekke ezelsbruggetjes die blijven hangen."}],
  "should": [{"topic":"...","summary":"3 zinnen met echte inhoud.","reason":"Specifiek waarom nuttig maar niet kritisch.","tip":"1 ezelsbruggetje."}],
  "skip": [{"topic":"...","reason":"Max 1 zin. Direct en eerlijk."}],
  "cheatsheet": "Spiekbriefje met → = ! symbolen. Groepeer per thema. Max 400 woorden. Alleen kernwoorden.",
  "toetsvragen": [
    {"vraag":"...","a":"...","b":"...","c":"...","d":"...","antwoord":"A","uitleg":"1-2 zinnen waarom correct."}
  ]
}`
        },
        {
          role: 'user',
          content: `Analyseer deze leerstof (${vakNaam}) voor een student met ${selectedTime} beschikbaar.

TIJDSLOT REGELS — VOLG DIT STRIKT:
${selectedTime === '30 minuten' ? `
- Must: MAX 2 onderwerpen — alleen het allerbelangrijkste
- Should: MAX 1 onderwerp
- Skip: ALLES wat niet in must zit — wees genadeloos` : ''}
${selectedTime === '1 uur' ? `
- Must: MAX 3 onderwerpen
- Should: MAX 2 onderwerpen
- Skip: alles wat niet kritisch is` : ''}
${selectedTime === '2-3 uur' ? `
- Must: 4-5 onderwerpen
- Should: 2-3 onderwerpen
- Skip: alleen echt onbelangrijke details` : ''}
${selectedTime === 'een avond' ? `
- Must: 5-6 onderwerpen — alles wat getoetst kan worden
- Should: 3-4 onderwerpen
- Skip: alleen randgevallen en voetnoten` : ''}

TOETSVRAGEN: Genereer precies ${vragenCount} toetsvragen met 4 opties (a,b,c,d).

LEERSTOF:
${text}`
        }
      ]
    })
  });

  if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || 'API fout'); }
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Kon resultaten niet verwerken.');
  return JSON.parse(match[0]);
}

// ── Gecombineerd studieplan (Elite/Pro met meerdere vakken) ──
async function buildCombinedStudieplan(vakResultaten) {
  // Maak een compact overzicht van alle must-items per vak
  const overzicht = vakResultaten.map(({ vakNaam, result }) => {
    const mustTopics = result.must.map(m => m.topic).join(', ');
    return `Vak: ${vakNaam}\nBelangrijkste onderwerpen: ${mustTopics}`;
  }).join('\n\n');

  const res = await fetch('https://analyze.aminaddarrazi2004.workers.dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content: `Je bent een studiecoach die weekplanningen maakt voor studenten. Geef ALLEEN JSON terug.

JSON formaat:
{
  "weekplan": [
    {"dag": "Maandag", "taken": ["Vak X — onderwerp A (30 min)", "Vak Y — onderwerp B (45 min)"]},
    {"dag": "Dinsdag", "taken": ["..."]}
  ],
  "tips": ["Algemene studietip 1", "Tip 2", "Tip 3"]
}`
        },
        {
          role: 'user',
          content: `Maak een weekplanning voor deze student die ${selectedTime} per dag beschikbaar heeft.

Verwerk spaced repetition: belangrijke onderwerpen meerdere keren inplannen.

Vakken en onderwerpen:
${overzicht}`
        }
      ]
    })
  });

  if (!res.ok) return null;
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '';
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return JSON.parse(match[0]);
}

// ── Main analyze ──
async function analyze() {
  hideError();
  if (files.length === 0) { showError('Upload minimaal één PDF bestand.'); return; }

  const used = await checkFreeLimit();
  if (used) { showUpgradeModal(); return; }

  document.getElementById('mainInterface').style.display = 'none';
  document.getElementById('loadingState').style.display = 'block';

  const isMultiVak = files.length > 1 && (userPlan === 'pro' || userPlan === 'elite');
  const msgs = isMultiVak
    ? ['Vakken verwerken...', 'Elk vak analyseren...', 'Prioriteiten bepalen...', 'Weekplanning maken...', 'Cheatsheets genereren...']
    : ['Lesstof aan het verwerken...', 'Toetspatronen herkennen...', 'Prioriteiten bepalen...', 'Cheatsheet genereren...'];

  let mi = 0;
  const iv = setInterval(() => { document.getElementById('loadingMsg').textContent = msgs[mi++ % msgs.length]; }, 2500);

  const vragenCount = getVragenCount();

  try {
    if (isMultiVak) {
      // ── Multi-vak: elk bestand apart analyseren ──
      const vakResultaten = [];

      for (const file of files) {
        const vakNaam = file.name.replace('.pdf', '');
        let text = await extractPdfText(file);
        // Max 10.000 tekens per vak zodat kwaliteit hoog blijft
        if (text.length > 10000) text = text.slice(0, 10000) + '\n\n[... afgekapt ...]';
        const result = await callAnalyzeAPI(text, vakNaam, vragenCount);
        vakResultaten.push({ vakNaam, result });
      }

      // Gecombineerd weekplan bouwen
      const weekplan = await buildCombinedStudieplan(vakResultaten);

      clearInterval(iv);
      await markAnalysisUsed();
      showMultiResults(vakResultaten, weekplan);

    } else {
      // ── Enkel bestand ──
      let text = await extractPdfText(files[0]);
      if (text.length > 12000) text = text.slice(0, 12000) + '\n\n[... afgekapt ...]';
      const result = await callAnalyzeAPI(text, files[0].name, vragenCount);

      clearInterval(iv);
      await markAnalysisUsed();
      showResults(result);
    }

  } catch (err) {
    clearInterval(iv);
    document.getElementById('mainInterface').style.display = 'block';
    document.getElementById('loadingState').style.display = 'none';
    showError('Fout: ' + err.message);
  }
}

// ── Upgrade modal ──
function showUpgradeModal() {
  document.getElementById('upgradeModal').style.display = 'flex';
}
function hideUpgradeModal() {
  document.getElementById('upgradeModal').style.display = 'none';
}

// ── Render enkel vak ──
function renderTopics(list, containerId, isSkip = false) {
  const el = document.getElementById(containerId);
  if (isSkip) {
    el.innerHTML = list.map((item) => `
      <div class="topic-item">
        <h4>${item.topic}</h4>
        <span class="topic-reason">${item.reason || ''}</span>
      </div>`).join('');
  } else {
    el.innerHTML = list.map((item) => `
      <div class="topic-item">
        <h4>${item.topic}</h4>
        <p>${item.summary || ''}</p>
        <span class="topic-reason">${item.reason || ''}</span>
        ${item.tip ? `<span class="topic-tip">💡 ${item.tip}</span>` : ''}
      </div>`).join('');
  }
}

// ── Render multi-vak resultaten ──
function showMultiResults(vakResultaten, weekplan) {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('resultsSection').style.display = 'block';
  document.getElementById('resultsSubtitle').textContent = `${files.length} vakken geanalyseerd · ${selectedTime} beschikbaar`;

  // Toon elk vak apart als tab of sectie
  const container = document.getElementById('mustList');
  container.innerHTML = vakResultaten.map(({ vakNaam, result }) => `
    <div class="vak-sectie">
      <h3 class="vak-titel">📚 ${vakNaam}</h3>

      <div class="vak-blok must-blok">
        <div class="blok-label">🔥 MUST LEARN</div>
        ${result.must.map(item => `
          <div class="topic-item">
            <h4>${item.topic}</h4>
            <p>${item.summary || ''}</p>
            <span class="topic-reason">${item.reason || ''}</span>
            ${item.tip ? `<span class="topic-tip">💡 ${item.tip}</span>` : ''}
          </div>`).join('')}
      </div>

      <div class="vak-blok should-blok">
        <div class="blok-label">⚡ NICE TO KNOW</div>
        ${result.should.map(item => `
          <div class="topic-item">
            <h4>${item.topic}</h4>
            <p>${item.summary || ''}</p>
            ${item.tip ? `<span class="topic-tip">💡 ${item.tip}</span>` : ''}
          </div>`).join('')}
      </div>

      <div class="vak-blok skip-blok">
        <div class="blok-label">⏭ SKIP</div>
        ${result.skip.map(item => `
          <div class="topic-item">
            <h4>${item.topic}</h4>
            <span class="topic-reason">${item.reason || ''}</span>
          </div>`).join('')}
      </div>

      <div class="vak-cheatsheet">
        <div class="blok-label">📝 Cheatsheet</div>
        <pre>${result.cheatsheet || ''}</pre>
      </div>
    </div>
  `).join('<hr class="vak-divider">');

  // Weekplan tonen als het er is
  if (weekplan?.weekplan) {
    const weekContainer = document.getElementById('shouldList');
    weekContainer.innerHTML = `
      <div class="weekplan">
        <h3>📅 Jouw weekplanning</h3>
        ${weekplan.weekplan.map(dag => `
          <div class="dag-item">
            <strong>${dag.dag}</strong>
            <ul>${dag.taken.map(t => `<li>${t}</li>`).join('')}</ul>
          </div>`).join('')}
        ${weekplan.tips ? `
          <div class="weekplan-tips">
            <strong>💡 Studietips</strong>
            <ul>${weekplan.tips.map(t => `<li>${t}</li>`).join('')}</ul>
          </div>` : ''}
      </div>`;
  }

  // Alle toetsvragen samenvoegen
  const alleVragen = vakResultaten.flatMap(({ vakNaam, result }) =>
    (result.toetsvragen || []).map(v => ({ ...v, vakNaam }))
  );
  renderToetsvragen(alleVragen);
}

// ── Oefentoets ──
let toetsvragenData = [];
let gebruikersAntwoorden = {};

function renderToetsvragen(vragen) {
  const section = document.getElementById('toetsvragenSection');
  if (!vragen?.length) return;
  toetsvragenData = vragen;
  gebruikersAntwoorden = {};

  const list = document.getElementById('toetsvragenList');
  list.innerHTML = vragen.map((v, i) => `
    <div class="toetsvraag" id="vraag-${i}">
      <div class="vr-header">
        <span class="vr-num">Vraag ${i + 1}</span>
        ${v.vakNaam ? `<span class="vr-vak">${v.vakNaam}</span>` : ''}
      </div>
      <p class="vr-vraag">${v.vraag}</p>
      <div class="vr-opties">
        ${['a','b','c','d'].map(l => `
          <div class="vr-optie" id="optie-${i}-${l}" onclick="selectAntwoord(${i}, '${l.toUpperCase()}', this)">
            ${l.toUpperCase()}. ${v[l]}
          </div>`).join('')}
      </div>
      <div class="vr-feedback" id="feedback-${i}" style="display:none"></div>
    </div>`).join('');

  document.getElementById('submitToets').style.display = 'block';
  section.style.display = 'block';
}

function selectAntwoord(vraagIndex, letter, el) {
  document.querySelectorAll(`#vraag-${vraagIndex} .vr-optie`).forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  gebruikersAntwoorden[vraagIndex] = letter;
}

function submitToets() {
  let goed = 0;
  toetsvragenData.forEach((v, i) => {
    const gekozen = gebruikersAntwoorden[i];
    const correct = v.antwoord.toUpperCase();
    const feedback = document.getElementById(`feedback-${i}`);

    document.querySelectorAll(`#vraag-${i} .vr-optie`).forEach(o => {
      const letter = o.textContent.trim()[0];
      if (letter === correct) o.classList.add('correct');
      else if (letter === gekozen && gekozen !== correct) o.classList.add('incorrect');
      o.onclick = null;
    });

    if (gekozen === correct) {
      goed++;
      feedback.innerHTML = `✅ Goed! ${v.uitleg}`;
      feedback.className = 'vr-feedback correct-feedback';
    } else {
      feedback.innerHTML = `❌ Fout. Juist antwoord: <strong>${correct}</strong> — ${v.uitleg}`;
      feedback.className = 'vr-feedback incorrect-feedback';
    }
    feedback.style.display = 'block';
  });

  document.getElementById('toetsScore').innerHTML = `
    <div class="score-box">
      🎯 Jouw score: <strong>${goed}/${toetsvragenData.length}</strong>
      ${goed === toetsvragenData.length ? ' — Perfect! 🔥' : goed >= toetsvragenData.length/2 ? ' — Goed bezig! 💪' : ' — Nog even oefenen! 📚'}
    </div>`;
  document.getElementById('submitToets').style.display = 'none';
}

function showResults(data) {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('resultsSection').style.display = 'block';
  document.getElementById('resultsSubtitle').textContent = `Beschikbare tijd: ${selectedTime} · ${files.length} bestand(en) geanalyseerd`;
  renderTopics(data.must || [], 'mustList');
  renderTopics(data.should || [], 'shouldList');
  renderTopics(data.skip || [], 'skipList', true);
  document.getElementById('cheatsheetContent').textContent = data.cheatsheet || '';
  renderToetsvragen(data.toetsvragen || []);
}

function reset() {
  document.getElementById('resultsSection').style.display = 'none';
  document.getElementById('toetsvragenSection').style.display = 'none';
  document.getElementById('mainInterface').style.display = 'block';
  files.length = 0;
  toetsvragenData = [];
  gebruikersAntwoorden = {};
  renderFileList();
  fileInput.value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
