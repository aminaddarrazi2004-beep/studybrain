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
  // Verwijder markdown code blocks als Groq die teruggeeft
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
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
      showResults(result, files[0].name.replace('.pdf',''));
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
  const hasFullAccess = (userPlan === 'pro' || userPlan === 'elite');

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
        ${hasFullAccess ? `<p>${item.summary || ''}</p>` : `<p class="locked-text">🔒 Volledige uitleg beschikbaar vanaf Pro</p>`}
        <span class="topic-reason">${item.reason || ''}</span>
        ${hasFullAccess && item.tip ? `<span class="topic-tip">💡 ${item.tip}</span>` : ''}
        ${!hasFullAccess ? `<a href="index.html#pricing" class="upgrade-inline">Upgrade naar Pro →</a>` : ''}
      </div>`).join('');
  }
}

// ── Persoonlijk studieplan (Pro/Elite) ──
async function buildStudieplan(result, vakNaam) {
  const mustTopics = result.must.map(m => `- ${m.topic}: ${m.summary || ''}`).join('\n');
  const shouldTopics = result.should.map(s => `- ${s.topic}`).join('\n');

  const res = await fetch('https://analyze.aminaddarrazi2004.workers.dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content: `Je bent een topleraar die een student persoonlijk begeleidt. Je maakt een PERSOONLIJK STUDIEPLAN dat de stof uitlegt en de student stap voor stap voorbereidt op de toets.

IJZEREN REGELS:
- Je LEGT DE STOF UIT — geen instructies zoals "lees dit", "maak een schema", "bestudeer dit"
- Gebruik echte feiten, getallen, formules uit de stof
- Schrijf in gewone taal alsof je het uitlegt aan een vriend van 16 jaar
- Elk onderwerp krijgt een concreet dagelijks leven voorbeeld
- Geef specifieke ezelsbruggetjes die echt blijven hangen

Geef ALLEEN JSON terug.

JSON formaat:
{
  "samenvatting": "2-3 zinnen: wat is de rode draad van deze stof? Wat moet de student begrijpen?",
  "leerroute": [
    {
      "stap": 1,
      "onderwerp": "Naam van het onderwerp",
      "uitleg": "Leg de stof direct uit in 4-5 zinnen. Echte feiten, getallen, formules. Voorbeeld uit dagelijks leven. Schrijf energiek en duidelijk.",
      "onthoud": "De exacte zin die de student woordelijk moet kunnen opzeggen op de toets. Concreet en precies.",
      "ezelsbruggetje": "Een grappig, memorabel ezelsbruggetje. Mag raar zijn, dat helpt juist.",
      "valkuil": "De meest gemaakte fout bij dit onderwerp op toetsen.",
      "tijd": "15 min"
    }
  ],
  "herhalingsschema": [
    {"moment": "Direct na het lezen", "actie": "Specifiek: welke onderwerpen hardop nazeggen, wat opschrijven"},
    {"moment": "Vanavond voor het slapen", "actie": "Specifiek: welke 3 kernpunten nogmaals doorlopen"},
    {"moment": "Morgen ochtend", "actie": "Specifiek: wat als eerste herhalen en hoe"},
    {"moment": "1 uur voor de toets", "actie": "Specifiek: wat nog een keer doornemen, wat skippen"}
  ],
  "focuspunten": ["De 3 dingen die ZEKER in de toets komen, in volgorde van waarschijnlijkheid"],
  "geheimtip": "1 concrete tip die alleen een echte docent weet. Bijv: welk type vraag stellen ze altijd, welke valkuil trappen studenten altijd in."
}`
        },
        {
          role: 'user',
          content: `Maak een persoonlijk studieplan voor ${vakNaam}. De student heeft ${selectedTime} beschikbaar.

BELANGRIJK: Leg de inhoud zelf uit! Geef de kennis direct — niet zeggen wat ze moeten doen.

Onderwerpen om uit te leggen:
${mustTopics}

Aanvullende onderwerpen:
${shouldTopics}`
        }
      ]
    })
  });

  if (!res.ok) return null;
  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '';
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return JSON.parse(match[0]);
}

// ── Render studieplan ──
function renderStudieplan(studieplan, containerId) {
  const el = document.getElementById(containerId);
  if (!studieplan || !el) return;

  el.innerHTML = `
    <div class="studieplan" id="studieplan-content" style="display:none">
      <div class="sp-header">
        <h3>📋 Jouw persoonlijk studieplan</h3>
      </div>

      ${studieplan.samenvatting ? `
      <div class="sp-samenvatting">
        <div class="sp-label">📖 Rode draad</div>
        <p>${studieplan.samenvatting}</p>
      </div>` : ''}

      ${studieplan.focuspunten?.length ? `
      <div class="sp-focuspunten">
        <div class="sp-label">🎯 Dit komt zeker in de toets</div>
        ${studieplan.focuspunten.map((f, i) => `
          <div class="sp-focus-item">
            <span class="sp-focus-num">${i + 1}</span>
            <span>${f}</span>
          </div>`).join('')}
      </div>` : ''}

      <div class="sp-section">
        <div class="sp-label">🗺️ Leerroute — stap voor stap</div>
        ${studieplan.leerroute.map(s => `
          <div class="sp-stap">
            <div class="sp-stap-num">Stap ${s.stap}</div>
            <div class="sp-stap-body">
              <strong>${s.onderwerp}</strong>
              <p>${s.uitleg || ''}</p>
              ${s.onthoud ? `<div class="sp-onthoud">📌 Onthoud: ${s.onthoud}</div>` : ''}
              ${s.ezelsbruggetje ? `<div class="sp-ezel">🧠 ${s.ezelsbruggetje}</div>` : ''}
              ${s.valkuil ? `<div class="sp-valkuil">⚠️ Valkuil: ${s.valkuil}</div>` : ''}
              <span class="sp-tijd">⏱ ${s.tijd}</span>
            </div>
          </div>`).join('')}
      </div>

      <div class="sp-section">
        <div class="sp-label">🔁 Herhalingsschema</div>
        ${studieplan.herhalingsschema.map(h => `
          <div class="sp-herhaling">
            <strong>${h.moment}</strong>
            <p>${h.actie}</p>
          </div>`).join('')}
      </div>

      ${studieplan.geheimtip ? `
      <div class="sp-geheimtip">
        🎯 <strong>Geheime docenttip:</strong> ${studieplan.geheimtip}
      </div>` : ''}
    </div>

    <div class="sp-preview-card">
      <div class="sp-preview-icon">📋</div>
      <div class="sp-preview-text">
        <strong>Jouw persoonlijk studieplan is klaar</strong>
        <p>Leerroute, herhalingsschema, ezelsbruggetjes en docenttips — speciaal voor jouw stof.</p>
      </div>
      <button class="sp-download-btn" onclick="downloadStudieplanPDF()">⬇️ Download studieplan</button>
    </div>`;
}

// ── PDF download van studieplan ──
function downloadStudieplanPDF() {
  const el = document.getElementById('studieplan-content');
  if (!el) return;

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Studieplan — StudyBrain</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 700px; margin: 0 auto; padding: 32px; color: #1a1a2e; }
    h3 { font-size: 22px; margin-bottom: 20px; color: #c9184a; }
    .sp-label { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #888; margin: 20px 0 10px; display: block; }
    .sp-samenvatting p { font-size: 14px; line-height: 1.7; background: #f8f8ff; padding: 12px; border-radius: 8px; }
    .sp-focus-item { display: flex; gap: 10px; margin-bottom: 6px; font-size: 14px; }
    .sp-focus-num { background: #c9184a; color: white; border-radius: 50%; width: 22px; height: 22px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
    .sp-stap { display: flex; gap: 14px; margin-bottom: 16px; page-break-inside: avoid; }
    .sp-stap-num { background: #fff0f3; color: #c9184a; font-size: 11px; font-weight: 700; padding: 4px 8px; border-radius: 6px; height: fit-content; white-space: nowrap; }
    .sp-stap-body strong { font-size: 15px; display: block; margin-bottom: 4px; }
    .sp-stap-body p { font-size: 13px; color: #444; line-height: 1.6; margin-bottom: 6px; }
    .sp-onthoud { background: #fffde7; border-left: 3px solid #ffc107; padding: 6px 10px; font-size: 13px; margin: 6px 0; border-radius: 4px; }
    .sp-ezel { background: #f0fff4; border-left: 3px solid #00c853; padding: 6px 10px; font-size: 13px; margin: 6px 0; border-radius: 4px; }
    .sp-valkuil { background: #fff3e0; border-left: 3px solid #ff9800; padding: 6px 10px; font-size: 13px; margin: 6px 0; border-radius: 4px; }
    .sp-tijd { font-size: 11px; color: #888; background: #f5f5f5; padding: 2px 8px; border-radius: 20px; display: inline-block; margin-top: 4px; }
    .sp-herhaling { background: #f8f8ff; border-radius: 8px; padding: 10px 14px; margin-bottom: 8px; }
    .sp-herhaling strong { font-size: 13px; color: #c9184a; display: block; margin-bottom: 4px; }
    .sp-herhaling p { font-size: 13px; color: #444; margin: 0; line-height: 1.5; }
    .sp-geheimtip { background: #fffde7; border: 1px solid #ffc107; border-radius: 8px; padding: 12px 16px; font-size: 13px; margin-top: 16px; }
    .sp-download-btn, .sp-header, .sp-download-bottom { display: none !important; }
    .footer { margin-top: 32px; text-align: center; font-size: 11px; color: #aaa; border-top: 1px solid #eee; padding-top: 12px; }
  </style>
</head>
<body>
  ${el.innerHTML}
  <div class="footer">Gegenereerd door StudyBrain — studybrain.pages.dev</div>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'studieplan-studybrain.html';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

async function showResults(data, vakNaam) {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('resultsSection').style.display = 'block';
  document.getElementById('resultsSubtitle').textContent = `Beschikbare tijd: ${selectedTime} · ${files.length} bestand(en) geanalyseerd`;
  renderTopics(data.must || [], 'mustList');
  renderTopics(data.should || [], 'shouldList');
  renderTopics(data.skip || [], 'skipList', true);
  document.getElementById('cheatsheetContent').textContent = data.cheatsheet || '';
  renderToetsvragen(data.toetsvragen || []);

  // Persoonlijk studieplan voor Pro en Elite
  if (userPlan === 'pro' || userPlan === 'elite') {
    const studieplanSection = document.getElementById('toetsvragenSection');
    const planContainer = document.createElement('div');
    planContainer.id = 'studieplanContainer';
    planContainer.innerHTML = `<div style="padding:20px;text-align:center;color:#6b6b8a">📋 Studieplan wordt gegenereerd...</div>`;
    studieplanSection.parentNode.insertBefore(planContainer, studieplanSection);

    const studieplan = await buildStudieplan(data, vakNaam || files[0]?.name?.replace('.pdf','') || 'dit vak');
    renderStudieplan(studieplan, 'studieplanContainer');
  }
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
