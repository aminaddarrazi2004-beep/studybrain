// ── State ──
const files = [];
let selectedTime = 'een avond';
let userPlan = 'gratis';
let lastExtractedText = '';

// ── DOM refs ──
const zone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');

// ── Drag & drop ──
zone.addEventListener('click', () => fileInput.click());
zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('drag-over'); });
zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('drag-over'); handleFiles([...e.dataTransfer.files]); });
fileInput.addEventListener('change', () => handleFiles([...fileInput.files]));

document.addEventListener('DOMContentLoaded', async () => {
  document.querySelectorAll('.time-btn').forEach(btn => btn.addEventListener('click', () => selectTime(btn)));
  await loadUserPlan();
});

async function loadUserPlan() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  const { data: profile } = await sb.from('profiles').select('plan').eq('id', session.user.id).single();
  if (profile?.plan) userPlan = profile.plan;
}

function getVragenCount() {
  if (userPlan === 'gratis') return 1;
  if (userPlan === 'starter') return 5;
  return 10;
}

function getMaxFiles() {
  if (userPlan === 'gratis' || userPlan === 'starter') return 1;
  if (userPlan === 'pro') return 3;
  return 4;
}

function handleFiles(newFiles) {
  const maxFiles = getMaxFiles();
  newFiles.forEach((f) => {
    if (files.length >= maxFiles) { showError(`Jouw plan ondersteunt maximaal ${maxFiles} bestand(en) tegelijk.`); return; }
    if ((f.type === 'application/pdf' || f.name.endsWith('.pdf')) && !files.find((x) => x.name === f.name)) files.push(f);
  });
  renderFileList();
}

function renderFileList() {
  const list = document.getElementById('fileList');
  list.innerHTML = files.map((f, i) => `
    <div class="file-item">
      <span class="fi-icon"></span>
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

function showError(msg) { const box = document.getElementById('errorBox'); box.textContent = msg; box.style.display = 'block'; }
function hideError() { document.getElementById('errorBox').style.display = 'none'; }

async function extractPdfText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const pdfjsLib = window['pdfjs-dist/build/pdf'];
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const pdf = await pdfjsLib.getDocument({ data: e.target.result }).promise;
        let fullText = '';
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
  if (!session || userPlan !== 'gratis') return;
  await sb.from('profiles').update({ free_analysis_used: true }).eq('id', session.user.id);
}

async function getAuthToken() {
  const { data: { session } } = await sb.auth.getSession();
  return session?.access_token || null;
}

async function callAnalyzeAPI(text, vakNaam, vragenCount) {
  const token = await getAuthToken();
  if (!token) throw new Error('Niet ingelogd');
  const res = await fetch('https://analyze.aminaddarrazi2004.workers.dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
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
  "must": [{"topic":"...","summary":"4-5 zinnen met echte feiten, getallen en formules uit de tekst. Simpele taal voor 16-jarige. Dagelijks leven voorbeeld.","reason":"Docenten toetsen dit als [type vraag] omdat [specifieke reden].","tip":"2-3 gekke ezelsbruggetjes die blijven hangen."}],
  "should": [{"topic":"...","summary":"3 zinnen met echte inhoud.","reason":"Specifiek waarom nuttig maar niet kritisch.","tip":"1 ezelsbruggetje."}],
  "skip": [{"topic":"...","reason":"Max 1 zin. Direct en eerlijk."}],
  "cheatsheet": "Spiekbriefje met → = ! symbolen. Groepeer per thema. Max 400 woorden. Alleen kernwoorden.",
  "toetsvragen": [{"vraag":"...","a":"...","b":"...","c":"...","d":"...","antwoord":"A","uitleg":"1-2 zinnen waarom correct."}]
}`
        },
        {
          role: 'user',
          content: `Analyseer deze leerstof (${vakNaam}) voor een student met ${selectedTime} beschikbaar.

TIJDSLOT REGELS:
${selectedTime === '30 minuten' ? '- Must: MAX 2 onderwerpen\n- Should: MAX 1\n- Skip: alles wat niet must is' : ''}
${selectedTime === '1 uur' ? '- Must: MAX 3 onderwerpen\n- Should: MAX 2\n- Skip: alles wat niet kritisch is' : ''}
${selectedTime === '2-3 uur' ? '- Must: 4-5 onderwerpen\n- Should: 2-3\n- Skip: onbelangrijke details' : ''}
${selectedTime === 'een avond' ? '- Must: 5-6 onderwerpen\n- Should: 3-4\n- Skip: randgevallen en voetnoten' : ''}

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
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Kon resultaten niet verwerken.');
  return JSON.parse(match[0]);
}

async function buildCombinedStudieplan(vakResultaten) {
  const overzicht = vakResultaten.map(({ vakNaam, result }) => {
    return `Vak: ${vakNaam}\nBelangrijkste onderwerpen: ${result.must.map(m => m.topic).join(', ')}`;
  }).join('\n\n');

  const token = await getAuthToken();
  const res = await fetch('https://analyze.aminaddarrazi2004.workers.dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: `Je bent een studiecoach. Geef ALLEEN JSON terug.\n\nJSON formaat:\n{\n  "weekplan": [{"dag": "Maandag", "taken": ["Vak X — onderwerp A (30 min)"]}],\n  "tips": ["Tip 1", "Tip 2"]\n}` },
        { role: 'user', content: `Maak een weekplanning voor ${selectedTime} per dag beschikbaar.\n\nVakken:\n${overzicht}` }
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

function slaAnalyseOp(naam, result) {
  const analyses = JSON.parse(localStorage.getItem('studybrain-analyses') || '[]');
  const nu = new Date();
  const maanden = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
  analyses.unshift({ naam, datum: nu.getDate() + ' ' + maanden[nu.getMonth()], tijd: selectedTime, mustCount: result.must?.length || 0 });
  localStorage.setItem('studybrain-analyses', JSON.stringify(analyses.slice(0, 10)));
}

async function analyze() {
  hideError();
  if (files.length === 0) { showError('Upload minimaal één PDF bestand.'); return; }
  const used = await checkFreeLimit();
  if (used) { showUpgradeModal(); return; }

  document.getElementById('mainInterface').style.display = 'none';
  document.getElementById('loadingState').style.display = 'block';

  const isMultiVak = files.length > 1 && (userPlan === 'pro' || userPlan === 'elite');

  // Loading progress animatie
  let stepIdx = 0;
  function advanceStep() {
    if (stepIdx > 0) {
      const prev = document.getElementById('lstep' + (stepIdx - 1));
      if (prev) { prev.classList.remove('active'); prev.classList.add('done'); }
    }
    const cur = document.getElementById('lstep' + stepIdx);
    if (cur) cur.classList.add('active');
    const fill = document.getElementById('loadingBarFill');
    if (fill) fill.style.width = ((stepIdx + 1) * 25) + '%';
    stepIdx++;
  }
  advanceStep();
  const stepTimer = setInterval(() => { if (stepIdx < 4) advanceStep(); }, 2500);

  const vragenCount = getVragenCount();

  try {
    if (isMultiVak) {
      const vakResultaten = [];
      for (const file of files) {
        const vakNaam = file.name.replace('.pdf', '');
        let text = await extractPdfText(file);
        if (text.length > 10000) text = text.slice(0, 10000) + '\n\n[... afgekapt ...]';
        const result = await callAnalyzeAPI(text, vakNaam, vragenCount);
        vakResultaten.push({ vakNaam, result });
      }
      const weekplan = await buildCombinedStudieplan(vakResultaten);
      clearInterval(stepTimer);
      await markAnalysisUsed();
      showMultiResults(vakResultaten, weekplan);
    } else {
      let text = await extractPdfText(files[0]);
      if (text.length > 12000) text = text.slice(0, 12000) + '\n\n[... afgekapt ...]';
      lastExtractedText = text;
      const result = await callAnalyzeAPI(text, files[0].name, vragenCount);
      clearInterval(stepTimer);
      await markAnalysisUsed();
      const vakNaamClean = files[0].name.replace('.pdf', '').replace('.PDF', '');
      slaAnalyseOp(vakNaamClean, result);
      showResults(result, vakNaamClean);
    }
  } catch (err) {
    clearInterval(stepTimer);
    document.getElementById('mainInterface').style.display = 'block';
    document.getElementById('loadingState').style.display = 'none';
    if (err.message === 'free_limit_reached') showUpgradeModal();
    else showError('Fout: ' + err.message);
  }
}

function showUpgradeModal() { document.getElementById('upgradeModal').style.display = 'flex'; }
function hideUpgradeModal() { document.getElementById('upgradeModal').style.display = 'none'; }

// ── RESULTATEN — schoon en leesbaar ──
function showResults(data, vakNaam) {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('resultsSection').style.display = 'block';
  document.getElementById('resultsSubtitle').textContent = `${vakNaam} · ${selectedTime}`;

  const hasAccess = (userPlan === 'pro' || userPlan === 'elite');

  // Must learn
  document.getElementById('mustList').innerHTML = (data.must || []).map(item => `
    <div class="res-item">
      <div class="res-item-title">${item.topic}</div>
      ${hasAccess
        ? `<div class="res-item-body">${item.summary || ''}</div>
           ${item.tip ? `<div class="res-item-tip">${item.tip}</div>` : ''}`
        : `<div class="res-item-locked">Volledige uitleg + ezelsbruggetje beschikbaar vanaf Pro <a href="index.html#pricing" class="upgrade-inline">Upgrade →</a></div>`
      }
      <div class="res-item-reason">${item.reason || ''}</div>
    </div>`).join('');

  // Should
  document.getElementById('shouldList').innerHTML = (data.should || []).map(item => `
    <div class="res-item">
      <div class="res-item-title">${item.topic}</div>
      ${hasAccess
        ? `<div class="res-item-body">${item.summary || ''}</div>
           ${item.tip ? `<div class="res-item-tip">${item.tip}</div>` : ''}`
        : `<div class="res-item-locked">Beschikbaar vanaf Pro <a href="index.html#pricing" class="upgrade-inline">Upgrade →</a></div>`
      }
    </div>`).join('');

  // Skip
  document.getElementById('skipList').innerHTML = (data.skip || []).map(item => `
    <div class="res-item res-item-skip">
      <div class="res-item-title">${item.topic}</div>
      <div class="res-item-body">${item.reason || ''}</div>
    </div>`).join('');

  // Cheatsheet
  document.getElementById('cheatsheetContent').textContent = data.cheatsheet || '';

  // Oefentoets
  renderToetsvragen(data.toetsvragen || []);

  // Pro/Elite: genereer studieplan
  if (hasAccess) {
    const studieplanSection = document.getElementById('toetsvragenSection');
    let planContainer = document.getElementById('studieplanContainer');
    if (!planContainer) {
      planContainer = document.createElement('div');
      planContainer.id = 'studieplanContainer';
      studieplanSection.parentNode.insertBefore(planContainer, studieplanSection);
    }
    planContainer.innerHTML = `
      <div class="sp-loading">
        <div class="sp-loading-steps">
          <div class="sp-loading-step" id="spstep0">Stof analyseren...</div>
          <div class="sp-loading-step" id="spstep1">Leerroute opstellen...</div>
          <div class="sp-loading-step" id="spstep2">Ezelsbruggetjes genereren...</div>
          <div class="sp-loading-step" id="spstep3">Herhalingsschema maken...</div>
        </div>
      </div>`;

    // Animate stappen
    let spIdx = 0;
    const spTimer = setInterval(() => {
      document.querySelectorAll('.sp-loading-step').forEach((s,i) => {
        s.classList.toggle('sp-loading-step-active', i === spIdx);
        s.classList.toggle('sp-loading-step-done', i < spIdx);
      });
      spIdx = (spIdx + 1) % 4;
    }, 1800);

    buildStudieplan(data, vakNaam, lastExtractedText).then(sp => {
      clearInterval(spTimer);
      renderStudieplan(sp, 'studieplanContainer');
    });
  }
}

// ── STUDIEPLAN — lees het, ken het, haal de toets ──
async function buildStudieplan(result, vakNaam, rawText = '') {
  const cfg = getTijdConfig(selectedTime);
  const mustTopics = result.must.map(m => `- ${m.topic}: ${m.summary || ''}`).join('\n');
  const shouldTopics = result.should.map(s => `- ${s.topic}: ${s.summary || ''}`).join('\n');

  const token = await getAuthToken();
  const res = await fetch('https://analyze.aminaddarrazi2004.workers.dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content: `Je bent een ervaren eindexamendocent. Je schrijft een studieplan dat een leerling van boven naar beneden leest en daarna de toets kan halen — zonder de originele PDF te hoeven lezen.

ABSOLUTE REGELS:
1. Geen instructies zoals "lees dit" of "bestudeer dat". JIJ legt de stof direct uit.
2. Elke uitleg is minimaal 6 zinnen. Gebruik echte feiten, getallen en formules uit de lesstof.
3. Schrijf voor een 16-jarige. Korte zinnen. Gewone woorden.
4. Elk onderwerp eindigt met een concreet voorbeeld: "Denk aan..."
5. Ezelsbruggetje = grappig en memorabel, niet saai.
6. Valkuil = de meest gemaakte fout, specifiek en eerlijk.
7. Herhalingsschema gebaseerd op spaced repetition — bewezen leertechniek.

Geef ALLEEN JSON terug.

JSON formaat:
{
  "samenvatting": "2-3 zinnen: het grote plaatje. Waarom hangt deze stof samen?",
  "leerroute": [
    {
      "stap": 1,
      "onderwerp": "Naam van het onderwerp",
      "uitleg": "Minimaal 6 zinnen. Leg volledig uit met begrippen, getallen, formules. Eindig met: Denk aan [dagelijks voorbeeld].",
      "onthoud": "De exacte definitie/regel die op de toets gevraagd wordt. 1-2 zinnen, precies.",
      "ezelsbruggetje": "Grappig en memorabel. Leg uit hoe je het gebruikt.",
      "valkuil": "Specifieke fout die leerlingen maken + hoe je hem vermijdt.",
      "tijd": "15 min"
    }
  ],
  "herhalingsschema": [
    {"moment": "Direct na het leren", "actie": "Sluit alles. Schrijf uit je hoofd de 3 hoofdpunten op. Check daarna."},
    {"moment": "Na 1 uur", "actie": "Zeg per onderwerp het ezelsbruggetje op. Wat weet je nog?"},
    {"moment": "Voor het slapen", "actie": "Lees alleen de 'Onthoud' blokken door. Niets meer."},
    {"moment": "Dag van de toets", "actie": "Lees de cheatsheet 1x door. Schrijf daarna uit je hoofd op wat je weet."}
  ],
  "focuspunten": [
    "Onderwerp — wat voor vraag: definitievraag/rekenvraag/vergelijkingsvraag — Voorbeeldvraag zoals op de toets"
  ],
  "geheimtip": "Concrete tip van een docent: wat kosten direct punten, wat wil de corrector zien, welke formuleringen werken."
}`
        },
        {
          role: 'user',
          content: `Maak een persoonlijk studieplan voor: ${vakNaam}
Beschikbare tijd: ${selectedTime}
Aantal stappen: ${cfg.planStappen}
Herhalingsmomenten: ${cfg.herhalingsSchema.join(' → ')}

MUST-onderwerpen (dit staat zeker in de toets):
${mustTopics}

SHOULD-onderwerpen:
${shouldTopics}

ORIGINELE LESSTOF (gebruik alleen feiten hieruit, verzin niets):
${rawText ? rawText.slice(0, 8000) : 'Niet beschikbaar'}`
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

function renderStudieplan(studieplan, containerId) {
  const el = document.getElementById(containerId);
  if (!studieplan || !el) return;

  el.innerHTML = `
    <div class="sp-doc">

      <div class="sp-doc-header">
        <div class="sp-doc-label">Persoonlijk studieplan</div>
        <button class="sp-doc-download" onclick="downloadStudieplanPDF()">Opslaan als PDF</button>
      </div>

      ${studieplan.samenvatting ? `
      <div class="sp-intro">
        <p>${studieplan.samenvatting}</p>
      </div>` : ''}

      ${studieplan.focuspunten?.length ? `
      <div class="sp-block">
        <div class="sp-block-title">Dit komt in de toets</div>
        <div class="sp-focus-list">
          ${studieplan.focuspunten.map((f, i) => `
            <div class="sp-focus-row">
              <span class="sp-focus-n">${i + 1}</span>
              <span>${f}</span>
            </div>`).join('')}
        </div>
      </div>` : ''}

      <div class="sp-block">
        <div class="sp-block-title">Leer de stof — stap voor stap</div>
        <div class="sp-steps">
          ${(studieplan.leerroute || []).map(s => `
            <div class="sp-step">
              <div class="sp-step-header">
                <span class="sp-step-num">Stap ${s.stap}</span>
                <span class="sp-step-name">${s.onderwerp}</span>
                <span class="sp-step-time">${s.tijd || ''}</span>
              </div>
              <div class="sp-step-body">
                <p class="sp-step-uitleg">${s.uitleg || ''}</p>
                ${s.onthoud ? `<div class="sp-onthoud"><span class="sp-onthoud-label">Onthoud</span>${s.onthoud}</div>` : ''}
                ${s.ezelsbruggetje ? `<div class="sp-ezel"><span class="sp-ezel-label">Ezelsbruggetje</span>${s.ezelsbruggetje}</div>` : ''}
                ${s.valkuil ? `<div class="sp-valkuil"><span class="sp-valkuil-label">Let op</span>${s.valkuil}</div>` : ''}
              </div>
            </div>`).join('')}
        </div>
      </div>

      <div class="sp-block">
        <div class="sp-block-title">Herhalingsschema — bewezen leertechniek</div>
        <div class="sp-herhaling-list">
          ${(studieplan.herhalingsschema || []).map((h, i) => `
            <div class="sp-herhaling-row">
              <div class="sp-herhaling-moment">${h.moment}</div>
              <div class="sp-herhaling-actie">${h.actie}</div>
            </div>`).join('')}
        </div>
        <div class="sp-herhaling-uitleg">
          Spaced repetition: je herhaalt de stof op steeds grotere intervallen. Bewezen de meest effectieve leertechniek.
        </div>
      </div>

      ${studieplan.geheimtip ? `
      <div class="sp-tip">
        <div class="sp-tip-label">Docenttip</div>
        <p>${studieplan.geheimtip}</p>
      </div>` : ''}

    </div>`;
}

function getTijdConfig(tijd) {
  const configs = {
    '30 minuten': { planStappen: 2, herhalingsSchema: ['Direct nu', '10 min voor de toets'] },
    '1 uur': { planStappen: 3, herhalingsSchema: ['Direct na het lezen', 'Over 30 min', '10 min voor de toets'] },
    '2-3 uur': { planStappen: 5, herhalingsSchema: ['Direct na het lezen', 'Na 1 uur pauze', '1 uur voor de toets'] },
    'een avond': { planStappen: 6, herhalingsSchema: ['Direct na het lezen', 'Na een korte pauze', 'Voor het slapen', 'Ochtend van de toets'] },
    '1-2 dagen': { planStappen: 8, herhalingsSchema: ['Dag 1 avond', 'Dag 2 ochtend', 'Dag 2 middag', '1 uur voor de toets'] },
    'een week': { planStappen: 10, herhalingsSchema: ['Dag 1', 'Dag 3', 'Dag 5', 'Dag 7 ochtend'] }
  };
  return configs[tijd] || configs['een avond'];
}

function downloadStudieplanPDF() {
  const el = document.querySelector('.sp-doc');
  if (!el) return;

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Studieplan — StudyBrain</title>
<style>
  @media print { .sp-doc-download { display: none !important; } body { margin: 0; } }
  body { font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; padding: 32px; color: #1a1a2e; font-size: 14px; line-height: 1.6; }
  .sp-doc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; padding-bottom: 16px; border-bottom: 2px solid #ff4d6d; }
  .sp-doc-label { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #ff4d6d; }
  .sp-doc-download { padding: 8px 18px; background: #ff4d6d; border: none; border-radius: 6px; color: white; font-size: 13px; font-weight: 700; cursor: pointer; }
  .sp-intro { background: #f8f8ff; border-left: 3px solid #ff4d6d; padding: 12px 16px; margin-bottom: 24px; border-radius: 0 8px 8px 0; font-size: 14px; color: #333; }
  .sp-block { margin-bottom: 28px; }
  .sp-block-title { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #888; margin-bottom: 14px; padding-bottom: 6px; border-bottom: 1px solid #eee; }
  .sp-focus-row { display: flex; gap: 10px; margin-bottom: 6px; align-items: flex-start; }
  .sp-focus-n { background: #ff4d6d; color: white; border-radius: 50%; width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; }
  .sp-step { margin-bottom: 20px; page-break-inside: avoid; border: 1px solid #eee; border-radius: 8px; overflow: hidden; }
  .sp-step-header { display: flex; align-items: center; gap: 10px; background: #fafafa; padding: 10px 14px; border-bottom: 1px solid #eee; }
  .sp-step-num { font-size: 10px; font-weight: 700; color: #ff4d6d; text-transform: uppercase; letter-spacing: 0.05em; }
  .sp-step-name { font-weight: 700; font-size: 14px; flex: 1; }
  .sp-step-time { font-size: 11px; color: #888; background: #f0f0f0; padding: 2px 8px; border-radius: 20px; }
  .sp-step-body { padding: 14px; }
  .sp-step-uitleg { margin-bottom: 10px; color: #333; }
  .sp-onthoud { background: #fffde7; border-left: 3px solid #ffc107; padding: 8px 12px; margin: 8px 0; border-radius: 0 6px 6px 0; font-size: 13px; }
  .sp-onthoud-label, .sp-ezel-label, .sp-valkuil-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 3px; }
  .sp-onthoud-label { color: #f59e0b; }
  .sp-ezel { background: #f0fff4; border-left: 3px solid #00c853; padding: 8px 12px; margin: 8px 0; border-radius: 0 6px 6px 0; font-size: 13px; }
  .sp-ezel-label { color: #00c853; }
  .sp-valkuil { background: #fff3e0; border-left: 3px solid #ff9800; padding: 8px 12px; margin: 8px 0; border-radius: 0 6px 6px 0; font-size: 13px; }
  .sp-valkuil-label { color: #ff9800; }
  .sp-herhaling-row { display: grid; grid-template-columns: 160px 1fr; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f0f0f0; }
  .sp-herhaling-moment { font-weight: 700; font-size: 13px; color: #ff4d6d; }
  .sp-herhaling-actie { font-size: 13px; color: #333; }
  .sp-herhaling-uitleg { font-size: 12px; color: #888; margin-top: 10px; font-style: italic; }
  .sp-tip { background: #fffde7; border: 1px solid #ffc107; border-radius: 8px; padding: 14px 16px; font-size: 13px; color: #333; }
  .sp-tip-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #f59e0b; margin-bottom: 6px; }
  .footer { margin-top: 32px; text-align: center; font-size: 11px; color: #aaa; border-top: 1px solid #eee; padding-top: 12px; }
</style>
</head>
<body>
  <button class="sp-doc-download" onclick="window.print()">Opslaan als PDF</button>
  ${el.innerHTML}
  <div class="footer">Gegenereerd door StudyBrain — studybrain.app</div>
</body>
</html>`;

  const newWin = window.open('', '_blank', 'width=800,height=900');
  newWin.document.write(htmlContent);
  newWin.document.close();
}

// ── Multi-vak ──
function showMultiResults(vakResultaten, weekplan) {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('resultsSection').style.display = 'block';
  document.getElementById('resultsSubtitle').textContent = `${files.length} vakken · ${selectedTime}`;

  const container = document.getElementById('mustList');
  container.innerHTML = vakResultaten.map(({ vakNaam, result }) => `
    <div class="vak-sectie">
      <h3 class="vak-titel">${vakNaam}</h3>
      <div class="vak-blok must-blok">
        <div class="blok-label">MUST LEARN</div>
        ${result.must.map(item => `<div class="res-item"><div class="res-item-title">${item.topic}</div><div class="res-item-body">${item.summary || ''}</div>${item.tip ? `<div class="res-item-tip">${item.tip}</div>` : ''}</div>`).join('')}
      </div>
      <div class="vak-blok should-blok">
        <div class="blok-label">NICE TO KNOW</div>
        ${result.should.map(item => `<div class="res-item"><div class="res-item-title">${item.topic}</div><div class="res-item-body">${item.summary || ''}</div></div>`).join('')}
      </div>
      <div class="vak-blok skip-blok">
        <div class="blok-label">SKIP</div>
        ${result.skip.map(item => `<div class="res-item res-item-skip"><div class="res-item-title">${item.topic}</div><div class="res-item-body">${item.reason || ''}</div></div>`).join('')}
      </div>
      <div class="vak-cheatsheet">
        <div class="blok-label">Cheatsheet</div>
        <pre>${result.cheatsheet || ''}</pre>
      </div>
    </div>`).join('<hr class="vak-divider">');

  if (weekplan?.weekplan) {
    document.getElementById('shouldList').innerHTML = `
      <div class="weekplan">
        <h3>Weekplanning</h3>
        ${weekplan.weekplan.map(dag => `
          <div class="dag-item">
            <strong>${dag.dag}</strong>
            <ul>${dag.taken.map(t => `<li>${t}</li>`).join('')}</ul>
          </div>`).join('')}
        ${weekplan.tips ? `<div class="weekplan-tips"><strong>Studietips</strong><ul>${weekplan.tips.map(t => `<li>${t}</li>`).join('')}</ul></div>` : ''}
      </div>`;
  }

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

  document.getElementById('toetsvragenList').innerHTML = vragen.map((v, i) => `
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
      feedback.innerHTML = `Goed — ${v.uitleg}`;
      feedback.className = 'vr-feedback correct-feedback';
    } else {
      feedback.innerHTML = `Fout. Juist antwoord: <strong>${correct}</strong> — ${v.uitleg}`;
      feedback.className = 'vr-feedback incorrect-feedback';
    }
    feedback.style.display = 'block';
  });
  document.getElementById('toetsScore').innerHTML = `<div class="score-box">Score: <strong>${goed}/${toetsvragenData.length}</strong>${goed === toetsvragenData.length ? ' — Perfect!' : goed >= toetsvragenData.length / 2 ? ' — Goed bezig!' : ' — Nog even oefenen!'}</div>`;
  document.getElementById('submitToets').style.display = 'none';
}

function reset() {
  document.getElementById('resultsSection').style.display = 'none';
  document.getElementById('toetsvragenSection').style.display = 'none';
  document.getElementById('mainInterface').style.display = 'block';
  const planContainer = document.getElementById('studieplanContainer');
  if (planContainer) planContainer.remove();
  files.length = 0;
  toetsvragenData = [];
  gebruikersAntwoorden = {};
  renderFileList();
  fileInput.value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
