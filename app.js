// ── State ──
const files = [];
let selectedTime = 'een avond';
let userPlan = 'gratis';
let lastExtractedText = '';
let lastAnalyseResult = null;
let lastVakNaam = '';

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
  if (userPlan === 'gratis') return 3;
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
  return false;
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

function getTijdInstructies(tijd) {
  const instructies = {
    '1 uur': '- Must: MAX 3 onderwerpen — alleen het allerbelangrijkste dat zeker gevraagd wordt\n- Should: MAX 1\n- Skip: alles wat niet de absolute kern is',
    '2-3 uur': '- Must: 4-5 onderwerpen\n- Should: 2-3\n- Skip: details en voetnoten',
    'een avond': '- Must: 5-6 onderwerpen\n- Should: 3-4\n- Skip: randgevallen en details die nooit gevraagd worden',
    'een weekend': '- Must: 7-8 onderwerpen — alles wat fundamenteel is\n- Should: 4-5\n- Skip: alleen minieme details en uitzonderingen op uitzonderingen',
  };
  return instructies[tijd] || instructies['een avond'];
}

async function callAnalyzeAPI(text, vakNaam, vragenCount) {
  const token = await getAuthToken();
  if (!token) throw new Error('Niet ingelogd');

  const res = await fetch('https://analyze.aminaddarrazi2004.workers.dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      is_studieplan: false,
      messages: [
        {
          role: 'system',
          content: `Je bent een leraar die weet wat er op de toets komt. Je helpt een leerling van 15-17 jaar om slim te studeren.

TAALREGEL — ABSOLUTE PRIORITEIT BOVEN ALLES:
Schrijf op taalniveau B1. Dat betekent: gewone taal die iedereen begrijpt.

GOUDEN REGEL: Na elk vaktechnisch of moeilijk woord dat je gebruikt, schrijf je ALTIJD tussen haakjes wat het betekent in gewone taal.

Geef ALLEEN JSON terug. Geen tekst ervoor of erna.

JSON formaat:
{
  "must": [{"topic": "Korte simpele titel","summary": "4-5 zinnen in gewone taal.","reason": "Dit wordt gevraagd als [type vraag].","tip": "2-3 grappige ezelsbruggetjes."}],
  "should": [{"topic": "Korte simpele titel","summary": "2-3 zinnen in gewone taal.","reason": "Handig om te weten maar niet het belangrijkste.","tip": "1 ezelsbruggetje."}],
  "skip": [{"topic": "Wat je kunt overslaan","reason": "1 zin waarom je dit kunt skippen."}],
  "cheatsheet": "Spiekbriefje in gewone taal. Max 400 woorden.",
  "toetsvragen": [{"vraag": "Vraag zoals een leraar het zou stellen","a": "...","b": "...","c": "...","d": "...","antwoord": "A","uitleg": "Leg in 1-2 simpele zinnen uit waarom dit het goede antwoord is."}]
}`
        },
        {
          role: 'user',
          content: `Analyseer deze leerstof (${vakNaam}) voor een leerling met ${selectedTime} beschikbaar.

HOEVEEL ONDERWERPEN:
${getTijdInstructies(selectedTime)}

TOETSVRAGEN: Maak precies ${vragenCount} meerkeuzevragen.

LEERSTOF:
${text}`
        }
      ]
    })
  });

  if (!res.ok) {
    const err = await res.json();
    if (err.error === 'rate_limit_exceeded') throw new Error('Te veel analyses. Wacht een uur en probeer opnieuw.');
    if (err.error === 'free_limit_reached') throw new Error('free_limit_reached');
    if (err.error === 'upgrade_required') throw new Error('upgrade_required');
    throw new Error(err.error?.message || err.error || 'API fout');
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || '';
  const match1 = raw.match(/\{[\s\S]*\}/);
  if (!match1) throw new Error('Kon resultaten niet verwerken.');
  return JSON.parse(match1[0]);
}

async function buildCombinedStudieplan(vakResultaten) {
  const overzicht = vakResultaten.map(({ vakNaam, result }) => {
    return `Vak: ${vakNaam}\nBelangrijkste onderwerpen: ${result.must.map(m => m.topic).join(', ')}`;
  }).join('\n\n');
  const token = await getAuthToken();
  try {
    const res = await fetch('https://analyze.aminaddarrazi2004.workers.dev', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        is_studieplan: true,
        messages: [
          { role: 'system', content: `Je bent een studiecoach. Geef ALLEEN JSON terug.\n\nJSON formaat:\n{"weekplan": [{"dag": "Maandag", "taken": ["Vak X — onderwerp (30 min)"]}], "tips": ["Tip 1"]}` },
          { role: 'user', content: `Maak een weekplanning voor ${selectedTime}.\n\nVakken:\n${overzicht}` }
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
  } catch (err) { return null; }
}

function slaAnalyseOp(naam, result) {
  const analyses = JSON.parse(sessionStorage.getItem('studybrain-analyses') || '[]');
  const nu = new Date();
  const maanden = ['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
  analyses.unshift({ naam, datum: nu.getDate() + ' ' + maanden[nu.getMonth()], tijd: selectedTime, mustCount: result.must?.length || 0 });
  sessionStorage.setItem('studybrain-analyses', JSON.stringify(analyses.slice(0, 10)));
}

async function analyze() {
  hideError();
  if (files.length === 0) { showError('Upload minimaal één PDF bestand.'); return; }
  const used = await checkFreeLimit();
  if (used) { showUpgradeModal(); return; }

  document.getElementById('mainInterface').style.display = 'none';
  document.getElementById('loadingState').style.display = 'block';

  const isMultiVak = files.length > 1 && (userPlan === 'pro' || userPlan === 'elite');

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
      lastAnalyseResult = result;
      lastVakNaam = vakNaamClean;
      showResults(result, vakNaamClean);
    }
  } catch (err) {
    clearInterval(stepTimer);
    document.getElementById('mainInterface').style.display = 'block';
    document.getElementById('loadingState').style.display = 'none';
    if (err.message === 'free_limit_reached') showUpgradeModal();
    else if (err.message === 'upgrade_required') showUpgradeModal();
    else showError('Fout: ' + err.message);
  }
}

function showUpgradeModal() {
  const modal = document.getElementById('upgradeModal');
  if (modal) modal.classList.add('open');
}
function hideUpgradeModal() {
  const modal = document.getElementById('upgradeModal');
  if (modal) modal.classList.remove('open');
}

async function showResults(data, vakNaam) {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('resultsSection').style.display = 'block';
  document.getElementById('resultsSubtitle').textContent = `${vakNaam} · ${selectedTime}`;

  document.getElementById('mustList').innerHTML = (data.must || []).map(item => `
    <div class="res-item must">
      <div class="res-item-title">${item.topic}</div>
      <div class="res-item-body">${item.summary || ''}</div>
      ${item.tip ? `<div class="res-item-tip">💡 ${item.tip}</div>` : ''}
      <div class="res-item-reason">${item.reason || ''}</div>
    </div>`).join('');

  document.getElementById('shouldList').innerHTML = (data.should || []).map(item => `
    <div class="res-item should">
      <div class="res-item-title">${item.topic}</div>
      <div class="res-item-body">${item.summary || ''}</div>
      ${item.tip ? `<div class="res-item-tip">💡 ${item.tip}</div>` : ''}
      <div class="res-item-reason">${item.reason || ''}</div>
    </div>`).join('');

  document.getElementById('skipList').innerHTML = (data.skip || []).map(item => `
    <div class="res-item skip">
      <div class="res-item-title">${item.topic}</div>
      <div class="res-item-body">${item.reason || ''}</div>
    </div>`).join('');

  document.getElementById('cheatsheetContent').textContent = data.cheatsheet || '';
  renderToetsvragen(data.toetsvragen || []);

  if (userPlan === 'pro' || userPlan === 'elite' || userPlan === 'gratis') {
    // Voeg studieplan knop toe boven de tabs
    const existingBtn = document.getElementById('studieplanScrollBtn');
    if (existingBtn) existingBtn.remove();
    const btn = document.createElement('div');
    btn.id = 'studieplanScrollBtn';
    btn.innerHTML = `<button onclick="document.getElementById('studieplanContainer')?.scrollIntoView({behavior:'smooth'})" style="
      display:flex; align-items:center; gap:10px; width:100%;
      background: linear-gradient(135deg, #ff4d6d22, #ff4d6d11);
      border: 1.5px solid #ff4d6d;
      color: #ff4d6d; font-weight:700; font-size:14px;
      padding: 14px 20px; border-radius: 12px; cursor:pointer;
      margin-bottom: 16px; text-align:left;
    ">
      <span style="font-size:20px">📋</span>
      <span>Persoonlijk studieplan wordt gegenereerd...</span>
      <span style="margin-left:auto; font-size:18px">↓</span>
    </button>`;
    const resultsSubtitle = document.getElementById('resultsSubtitle');
    resultsSubtitle.parentNode.insertBefore(btn, resultsSubtitle.nextSibling);
    const existing = document.getElementById('studieplanContainer');
    if (existing) existing.remove();
    const studieplanSection = document.getElementById('toetsvragenSection');
    const planContainer = document.createElement('div');
    planContainer.id = 'studieplanContainer';
    studieplanSection.parentNode.insertBefore(planContainer, studieplanSection);

    planContainer.innerHTML = `<div class="sp-loading"><div class="sp-loading-steps">
      <div class="sp-loading-step" id="spstep0">Stof analyseren...</div>
      <div class="sp-loading-step" id="spstep1">Leerroute opstellen...</div>
      <div class="sp-loading-step" id="spstep2">Ezelsbruggetjes genereren...</div>
      <div class="sp-loading-step" id="spstep3">Herhalingsschema maken...</div>
    </div></div>`;

    // Toon status balk bovenaan
    const statusBar = document.getElementById('studieplanStatusBar');
    const statusBtn = document.getElementById('studieplanStatusBtn');
    const statusTxt = document.getElementById('studieplanStatusTxt');
    const statusDot = document.getElementById('studieplanStatusDot');
    if (statusBar) {
      statusBar.style.display = 'block';
      statusTxt.textContent = 'Studieplan genereren...';
      statusBtn.style.cursor = 'default';
      statusDot.style.animation = 'spPulse 1.2s ease-in-out infinite';
    }

    let spIdx = 0;
    const spTimer = setInterval(() => {
      document.querySelectorAll('.sp-loading-step').forEach((s,i) => {
        s.classList.toggle('sp-loading-step-active', i === spIdx);
        s.classList.toggle('sp-loading-step-done', i < spIdx);
      });
      spIdx = (spIdx + 1) % 4;
    }, 1800);

    const studieplanTimeout = setTimeout(() => {
      clearInterval(spTimer);
      renderStudieplanError('studieplanContainer', 'Studieplan duurde te lang. Probeer opnieuw.');
    }, 60000);

    buildStudieplan(data, vakNaam, lastExtractedText)
      .then(sp => {
        clearTimeout(studieplanTimeout);
        clearInterval(spTimer);
        if (sp) {
          renderStudieplan(sp, 'studieplanContainer');
          // Update status balk naar klaar
          const statusTxt2 = document.getElementById('studieplanStatusTxt');
          const statusDot2 = document.getElementById('studieplanStatusDot');
          const statusBtn2 = document.getElementById('studieplanStatusBtn');
          if (statusTxt2) statusTxt2.textContent = '📋 Bekijk jouw persoonlijk studieplan ↓';
          if (statusDot2) statusDot2.style.animation = 'none';
          if (statusBtn2) {
            statusBtn2.style.cursor = 'pointer';
            statusBtn2.style.background = 'rgba(255,77,109,0.15)';
            statusBtn2.onclick = () => document.getElementById('studieplanContainer')?.scrollIntoView({behavior:'smooth'});
          }
          const scrollBtn = document.getElementById('studieplanScrollBtn');
          if (scrollBtn) scrollBtn.innerHTML = `<button onclick="document.getElementById('studieplanContainer')?.scrollIntoView({behavior:'smooth'})" style="
            display:flex; align-items:center; gap:10px; width:100%;
            background: linear-gradient(135deg, #ff4d6d33, #ff4d6d11);
            border: 1.5px solid #ff4d6d;
            color: #ff4d6d; font-weight:700; font-size:14px;
            padding: 14px 20px; border-radius: 12px; cursor:pointer;
            margin-bottom: 16px; text-align:left;
          ">
            <span style="font-size:20px">📋</span>
            <span>Bekijk jouw persoonlijk studieplan</span>
            <span style="margin-left:auto; font-size:18px">↓</span>
          </button>`;
        }
        else renderStudieplanError('studieplanContainer', 'Studieplan kon niet worden gegenereerd.');
      })
      .catch(err => {
        clearTimeout(studieplanTimeout);
        clearInterval(spTimer);
        const statusBar2 = document.getElementById('studieplanStatusBar');
        if (statusBar2) statusBar2.style.display = 'none';
        renderStudieplanError('studieplanContainer', 'Er ging iets mis: ' + err.message);
      });
  }
}

function renderStudieplanError(containerId, message) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="sp-doc"><div class="sp-doc-header"><div class="sp-doc-label">Persoonlijk studieplan</div></div>
    <div class="sp-error"><p>${message}</p>
    <button class="sp-retry-btn" onclick="retryStudieplan()">Opnieuw proberen</button></div></div>`;
}

async function retryStudieplan() {
  const container = document.getElementById('studieplanContainer');
  if (!container) return;
  container.innerHTML = `<div class="sp-loading"><div class="sp-loading-steps"><div class="sp-loading-step sp-loading-step-active">Opnieuw proberen...</div></div></div>`;
  try {
    const vakNaam = lastVakNaam || document.getElementById('resultsSubtitle')?.textContent?.split(' · ')[0] || 'Onbekend';
    const result = lastAnalyseResult || { must: [], should: [] };
    const sp = await buildStudieplan(result, vakNaam, lastExtractedText);
    if (sp) renderStudieplan(sp, 'studieplanContainer');
    else renderStudieplanError('studieplanContainer', 'Studieplan kon niet worden gegenereerd.');
  } catch (err) {
    renderStudieplanError('studieplanContainer', 'Er ging iets mis: ' + err.message);
  }
}

async function buildStudieplan(result, vakNaam, rawText = '') {
  const cfg = getTijdConfig(selectedTime);
  const mustTopics = (result.must || []).map(m => `- ${m.topic}: ${m.summary || ''}`).join('\n');
  const shouldTopics = (result.should || []).map(s => `- ${s.topic}: ${s.summary || ''}`).join('\n');
  const token = await getAuthToken();

  const res = await fetch('https://analyze.aminaddarrazi2004.workers.dev', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      is_studieplan: true,
      messages: [
        {
          role: 'system',
          content: `Je schrijft een studieplan voor een leerling van 15-17 jaar. Gewone taal. Korte zinnen.
Geef ALLEEN JSON terug.
JSON formaat:
{
  "samenvatting": "2-3 zinnen.",
  "leerroute": [{"stap": 1,"onderwerp": "Naam","uitleg": "5 zinnen. Eindig met: Denk aan [voorbeeld].","onthoud": "Max 2 zinnen.","ezelsbruggetje": "Grappig en memorabel.","valkuil": "Meest gemaakte fout.","tijd": "15 min"}],
  "herhalingsschema": [{"moment": "Direct na het leren","actie": "Schrijf 3 dingen op uit je hoofd."}],
  "focuspunten": ["Onderwerp — soort vraag — Voorbeeld"],
  "geheimtip": "Concrete tip over hoe leraren nakijken."
}`
        },
        {
          role: 'user',
          content: `Studieplan voor: ${vakNaam}
Tijd: ${selectedTime}
Stappen: ${cfg.planStappen}
Herhaling: ${cfg.herhalingsSchema.join(' → ')}

Must learn:
${mustTopics}

Nice to know:
${shouldTopics}

Gebruik alleen de must/should topics hierboven. Verzin geen extra informatie.`
        }
      ]
    })
  });

  if (!res.ok) { throw new Error('API error: ' + res.status); }
  const data = await res.json();
  // Worker kan choices als array of als object teruggeven
  const choices = Array.isArray(data) ? data : (data.choices || []);
  // Gebruik parsed veld van Worker als beschikbaar
  if (choices[0]?.message?.parsed) {
    return choices[0].message.parsed;
  }
  // Fallback: parse zelf
  const raw = choices[0]?.message?.content || '';
  const match2 = raw.match(/\{[\s\S]*\}/);
  if (!match2) { throw new Error('Geen JSON gevonden'); }
  return JSON.parse(match2[0]);
}

function getTijdConfig(tijd) {
  const configs = {
    '1 uur':       { planStappen: 3, herhalingsSchema: ['Direct na het lezen', 'Na 30 min', '10 min voor de toets'] },
    '2-3 uur':     { planStappen: 5, herhalingsSchema: ['Direct na het lezen', 'Na 1 uur pauze', '1 uur voor de toets'] },
    'een avond':   { planStappen: 6, herhalingsSchema: ['Direct na het lezen', 'Na een korte pauze', 'Voor het slapen', 'Ochtend van de toets'] },
    'een weekend': { planStappen: 9, herhalingsSchema: ['Dag 1 avond', 'Dag 2 ochtend', 'Dag 2 middag', 'Ochtend van de toets'] },
  };
  return configs[tijd] || configs['een avond'];
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
      ${studieplan.samenvatting ? `<div class="sp-block"><div class="sp-intro">${studieplan.samenvatting}</div></div>` : ''}
      ${studieplan.focuspunten?.length ? `<div class="sp-block"><div class="sp-block-title">Dit komt in de toets</div>${studieplan.focuspunten.map((f,i) => `<div class="sp-focus-row"><span class="sp-focus-n">${i+1}</span><span>${f}</span></div>`).join('')}</div>` : ''}
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
                ${s.onthoud ? `<div class="sp-onthoud"><span class="sp-onthoud-label">Onthoud dit</span>${s.onthoud}</div>` : ''}
                ${s.ezelsbruggetje ? `<div class="sp-ezel"><span class="sp-ezel-label">Ezelsbruggetje</span>${s.ezelsbruggetje}</div>` : ''}
                ${s.valkuil ? `<div class="sp-valkuil"><span class="sp-valkuil-label">Let op</span>${s.valkuil}</div>` : ''}
              </div>
            </div>`).join('')}
        </div>
      </div>
      <div class="sp-block">
        <div class="sp-block-title">Herhalingsschema</div>
        ${(studieplan.herhalingsschema || []).map(h => `<div class="sp-herhaling-row"><div class="sp-herhaling-moment">${h.moment}</div><div class="sp-herhaling-actie">${h.actie}</div></div>`).join('')}
      </div>
      ${studieplan.geheimtip ? `<div class="sp-tip"><div class="sp-tip-label">Tip van een leraar</div><p>${studieplan.geheimtip}</p></div>` : ''}
    </div>`;
}

function downloadStudieplanPDF() {
  const el = document.querySelector('.sp-doc');
  if (!el) return;
  const newWin = window.open('', '_blank', 'width=800,height=900');
  newWin.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Studieplan — StudyBrain</title>
<style>body{font-family:Arial,sans-serif;max-width:680px;margin:0 auto;padding:32px;color:#1a1a2e;font-size:14px;line-height:1.6;}
.sp-doc-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #ff4d6d;}
.sp-doc-label{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#ff4d6d;}
.sp-doc-download{padding:8px 18px;background:#ff4d6d;border:none;border-radius:6px;color:white;font-size:13px;font-weight:700;cursor:pointer;}
.sp-block{margin-bottom:28px;}.sp-block-title{font-size:11px;font-weight:700;text-transform:uppercase;color:#888;margin-bottom:14px;padding-bottom:6px;border-bottom:1px solid #eee;}
.sp-intro{background:#f8f8ff;border-left:3px solid #ff4d6d;padding:12px 16px;margin-bottom:16px;border-radius:0 8px 8px 0;}
.sp-focus-row{display:flex;gap:10px;margin-bottom:6px;}.sp-focus-n{background:#ff4d6d;color:white;border-radius:50%;width:20px;height:20px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;}
.sp-step{margin-bottom:20px;border:1px solid #eee;border-radius:8px;overflow:hidden;}
.sp-step-header{display:flex;align-items:center;gap:10px;background:#fafafa;padding:10px 14px;border-bottom:1px solid #eee;}
.sp-step-num{font-size:10px;font-weight:700;color:#ff4d6d;text-transform:uppercase;}.sp-step-name{font-weight:700;font-size:14px;flex:1;}
.sp-step-time{font-size:11px;color:#888;background:#f0f0f0;padding:2px 8px;border-radius:20px;}.sp-step-body{padding:14px;}
.sp-onthoud{background:#fffde7;border-left:3px solid #ffc107;padding:8px 12px;margin:8px 0;border-radius:0 6px 6px 0;font-size:13px;}
.sp-onthoud-label{font-size:10px;font-weight:700;text-transform:uppercase;display:block;margin-bottom:3px;color:#f59e0b;}
.sp-ezel{background:#f0fff4;border-left:3px solid #00c853;padding:8px 12px;margin:8px 0;border-radius:0 6px 6px 0;font-size:13px;}
.sp-ezel-label{font-size:10px;font-weight:700;text-transform:uppercase;display:block;margin-bottom:3px;color:#00c853;}
.sp-valkuil{background:#fff3e0;border-left:3px solid #ff9800;padding:8px 12px;margin:8px 0;border-radius:0 6px 6px 0;font-size:13px;}
.sp-valkuil-label{font-size:10px;font-weight:700;text-transform:uppercase;display:block;margin-bottom:3px;color:#ff9800;}
.sp-herhaling-row{display:grid;grid-template-columns:160px 1fr;gap:12px;padding:10px 0;border-bottom:1px solid #f0f0f0;}
.sp-herhaling-moment{font-weight:700;font-size:13px;color:#ff4d6d;}
.sp-tip{background:#fffde7;border:1px solid #ffc107;border-radius:8px;padding:14px 16px;font-size:13px;}
.sp-tip-label{font-size:10px;font-weight:700;text-transform:uppercase;color:#f59e0b;margin-bottom:6px;}
@media print{.sp-doc-download{display:none!important;}}
</style></head><body>
<button class="sp-doc-download" onclick="window.print()">Opslaan als PDF</button>
${el.innerHTML}
<div style="margin-top:32px;text-align:center;font-size:11px;color:#aaa;border-top:1px solid #eee;padding-top:12px;">Gemaakt door StudyBrain — studybrain.nl</div>
</body></html>`);
  newWin.document.close();
}

function showMultiResults(vakResultaten, weekplan) {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('resultsSection').style.display = 'block';
  document.getElementById('resultsSubtitle').textContent = `${files.length} vakken · ${selectedTime}`;
  document.getElementById('mustList').innerHTML = vakResultaten.map(({ vakNaam, result }) => `
    <div class="vak-sectie">
      <h3 class="vak-titel">${vakNaam}</h3>
      <div class="vak-blok must-blok"><div class="blok-label">MUST LEARN</div>${result.must.map(item => `<div class="res-item must"><div class="res-item-title">${item.topic}</div><div class="res-item-body">${item.summary || ''}</div>${item.tip ? `<div class="res-item-tip">💡 ${item.tip}</div>` : ''}</div>`).join('')}</div>
      <div class="vak-blok should-blok"><div class="blok-label">NICE TO KNOW</div>${result.should.map(item => `<div class="res-item should"><div class="res-item-title">${item.topic}</div><div class="res-item-body">${item.summary || ''}</div></div>`).join('')}</div>
      <div class="vak-blok skip-blok"><div class="blok-label">SKIP</div>${result.skip.map(item => `<div class="res-item skip"><div class="res-item-title">${item.topic}</div><div class="res-item-body">${item.reason || ''}</div></div>`).join('')}</div>
      <div class="vak-cheatsheet"><div class="blok-label">Cheatsheet</div><pre>${result.cheatsheet || ''}</pre></div>
    </div>`).join('<hr class="vak-divider">');
  if (weekplan?.weekplan) {
    document.getElementById('shouldList').innerHTML = `<div class="weekplan"><h3>Weekplanning</h3>${weekplan.weekplan.map(dag => `<div class="dag-item"><strong>${dag.dag}</strong><ul>${dag.taken.map(t => `<li>${t}</li>`).join('')}</ul></div>`).join('')}</div>`;
  }
  const alleVragen = vakResultaten.flatMap(({ vakNaam, result }) => (result.toetsvragen || []).map(v => ({ ...v, vakNaam })));
  renderToetsvragen(alleVragen);
}

let toetsvragenData = [];
let gebruikersAntwoorden = {};

function renderToetsvragen(vragen) {
  const section = document.getElementById('toetsvragenSection');
  if (!vragen?.length) return;
  toetsvragenData = vragen;
  gebruikersAntwoorden = {};
  document.getElementById('toetsvragenList').innerHTML = vragen.map((v, i) => `
    <div class="toetsvraag" id="vraag-${i}">
      <div class="vr-header"><span class="vr-num">Vraag ${i + 1}</span>${v.vakNaam ? `<span class="vr-vak">${v.vakNaam}</span>` : ''}</div>
      <p class="vr-vraag">${v.vraag}</p>
      <div class="vr-opties">${['a','b','c','d'].map(l => `<div class="vr-optie" id="optie-${i}-${l}" onclick="selectAntwoord(${i}, '${l.toUpperCase()}', this)">${l.toUpperCase()}. ${v[l]}</div>`).join('')}</div>
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
    if (gekozen === correct) { goed++; feedback.innerHTML = `Goed! ${v.uitleg}`; feedback.className = 'vr-feedback correct-feedback'; }
    else { feedback.innerHTML = `Fout. Het goede antwoord is <strong>${correct}</strong> — ${v.uitleg}`; feedback.className = 'vr-feedback incorrect-feedback'; }
    feedback.style.display = 'block';
  });
  const totaal = toetsvragenData.length;
  const pct = Math.round((goed / totaal) * 100);
  document.getElementById('toetsScore').innerHTML = `<div class="score-box"><strong>${goed}/${totaal}</strong> goed — ${pct}%${pct === 100 ? ' 🎉 Perfect!' : pct >= 70 ? ' — Goed bezig!' : ' — Nog even oefenen!'}</div>`;
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
