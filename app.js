// ── State ──
const files = [];
let selectedTime = 'een avond';

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
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', () => selectTime(btn));
  });
});

// ── File handling ──
function handleFiles(newFiles) {
  newFiles.forEach((f) => {
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
        for (let i = 1; i <= pdf.numPages; i++) {
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
  const { data: profile, error } = await sb.from('profiles').select('free_analysis_used').eq('id', session.user.id).single();
  if (error || !profile) return true;
  return profile.free_analysis_used === true;
}

async function markAnalysisUsed() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;
  await sb.from('profiles').update({ free_analysis_used: true }).eq('id', session.user.id);
}

// ── Main analyze ──
async function analyze() {
  hideError();
  if (files.length === 0) { showError('Upload minimaal één PDF bestand.'); return; }

  const used = false; // tijdelijk uit voor testen

  document.getElementById('mainInterface').style.display = 'none';
  document.getElementById('loadingState').style.display = 'block';

  const msgs = ['Lesstof aan het verwerken...', 'Toetspatronen herkennen...', 'Prioriteiten bepalen...', 'Cheatsheet genereren...'];
  let mi = 0;
  const iv = setInterval(() => { document.getElementById('loadingMsg').textContent = msgs[mi++ % msgs.length]; }, 2500);

  try {
    let allText = '';
    for (const file of files) {
      const text = await extractPdfText(file);
      allText += `\n\n=== ${file.name} ===\n${text}`;
    }
    if (allText.length > 12000) allText = allText.slice(0, 12000) + '\n\n[... afgekapt ...]';

    const res = await fetch('/.netlify/functions/analyze', {
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
    {"vraag":"...","a":"...","b":"...","c":"...","d":"...","antwoord":"A","uitleg":"1-2 zinnen waarom correct."},
    {"vraag":"...","a":"...","b":"...","c":"...","d":"...","antwoord":"B","uitleg":"1-2 zinnen waarom correct."},
    {"vraag":"...","a":"...","b":"...","c":"...","d":"...","antwoord":"C","uitleg":"1-2 zinnen waarom correct."}
  ]
}`
          },
          {
            role: 'user',
            content: `Analyseer deze leerstof voor een student met ${selectedTime} beschikbaar.

CONTROLEER VOOR JE BEGINT:
- Staat er een vergelijkingstabel met getallen? → die onderwerpen zijn ALTIJD must
- Staat er iets over enzymen/denaturatie? → ALTIJD must  
- Staat er celademhaling aeroob vs anaeroob? → ALTIJD must
- Schrijf NOOIT "essentieel voor het begrijpen" in het reason veld
- Geef ALTIJD precies 3 toetsvragen met 4 opties

LEERSTOF:
${allText}`
          }
        ]
      })
    });

    clearInterval(iv);
    if (!res.ok) { const err = await res.json(); throw new Error(err.error?.message || 'API fout'); }

    const data = await res.json();
    const raw = data.choices?.[0]?.message?.content || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Kon resultaten niet verwerken.');
    const result = JSON.parse(match[0]);

    await markAnalysisUsed();
    showResults(result);
  } catch (err) {
    clearInterval(iv);
    document.getElementById('mainInterface').style.display = 'block';
    document.getElementById('loadingState').style.display = 'none';
    showError('Fout: ' + err.message);
  }
}

// ── Render ──
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

function renderToetsvragen(vragen) {
  const section = document.getElementById('toetsvragenSection');
  const list = document.getElementById('toetsvragenList');
  if (!vragen?.length) return;
  list.innerHTML = vragen.map((v, i) => `
    <div class="toetsvraag">
      <div class="vr-header"><span class="vr-num">Vraag ${i + 1}</span></div>
      <p class="vr-vraag">${v.vraag}</p>
      <div class="vr-opties">
        <div class="vr-optie">A. ${v.a}</div>
        <div class="vr-optie">B. ${v.b}</div>
        <div class="vr-optie">C. ${v.c}</div>
        <div class="vr-optie">D. ${v.d}</div>
      </div>
      <div class="vr-antwoord">✅ Antwoord: <strong>${v.antwoord}</strong> — ${v.uitleg}</div>
    </div>`).join('');
  section.style.display = 'block';
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
  renderFileList();
  fileInput.value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
