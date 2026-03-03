// ── State ──
const files = [];
let selectedTime = 'een avond';

// ── DOM refs ──
const zone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');

// ── Drag & drop ──
zone.addEventListener('click', () => fileInput.click());

zone.addEventListener('dragover', (e) => {
  e.preventDefault();
  zone.classList.add('drag-over');
});

zone.addEventListener('dragleave', () => {
  zone.classList.remove('drag-over');
});

zone.addEventListener('drop', (e) => {
  e.preventDefault();
  zone.classList.remove('drag-over');
  handleFiles([...e.dataTransfer.files]);
});

fileInput.addEventListener('change', () => {
  handleFiles([...fileInput.files]);
});

// ── Time buttons ──
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.time-btn').forEach(btn => {
    btn.addEventListener('click', () => selectTime(btn));
  });
});

// ── File handling ──
function handleFiles(newFiles) {
  newFiles.forEach((f) => {
    if ((f.type === 'application/pdf' || f.name.endsWith('.pdf')) &&
        !files.find((x) => x.name === f.name)) {
      files.push(f);
    }
  });
  renderFileList();
}

function renderFileList() {
  const list = document.getElementById('fileList');
  list.innerHTML = files
    .map(
      (f, i) => `
      <div class="file-item">
        <span class="fi-icon">📄</span>
        <span class="fi-name">${f.name}</span>
        <span class="fi-size">${(f.size / 1024 / 1024).toFixed(1)} MB</span>
        <button class="fi-remove" onclick="removeFile(${i})">×</button>
      </div>`
    )
    .join('');
}

function removeFile(i) {
  files.splice(i, 1);
  renderFileList();
}

// ── Time selector ──
function selectTime(btn) {
  document.querySelectorAll('.time-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  selectedTime = btn.dataset.time;
}

// ── Error display ──
function showError(msg) {
  const box = document.getElementById('errorBox');
  box.textContent = msg;
  box.style.display = 'block';
}

function hideError() {
  document.getElementById('errorBox').style.display = 'none';
}

// ── PDF text extraction ──
async function extractPdfText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const pdfjsLib = window['pdfjs-dist/build/pdf'];
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        const pdf = await pdfjsLib.getDocument({ data: e.target.result }).promise;
        let fullText = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          fullText += content.items.map((item) => item.str).join(' ') + '\n';
        }
        resolve(fullText.trim());
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Lezen mislukt'));
    reader.readAsArrayBuffer(file);
  });
}

// ── Check free analysis limit ──
async function checkFreeLimit() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return true;

  const { data: profile, error } = await sb.from('profiles')
    .select('free_analysis_used')
    .eq('id', session.user.id)
    .single();

  if (error || !profile) return true;
  return profile.free_analysis_used === true;
}

async function markAnalysisUsed() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return;

  await sb.from('profiles')
    .update({ free_analysis_used: true })
    .eq('id', session.user.id);
}

// ── Main analyze function ──
async function analyze() {
  hideError();

  if (files.length === 0) {
    showError('Upload minimaal één PDF bestand.');
    return;
  }

  const used = await checkFreeLimit();
  if (used) {
    showError('Je gratis analyse is op. Upgrade naar een abonnement om door te gaan.');
    return;
  }

  document.getElementById('mainInterface').style.display = 'none';
  document.getElementById('loadingState').style.display = 'block';

  const loadingMessages = [
    'Lesstof aan het verwerken...',
    'Toetspatronen herkennen...',
    'Prioriteiten bepalen...',
    'Cheatsheet genereren...',
  ];
  let msgIndex = 0;
  const interval = setInterval(() => {
    document.getElementById('loadingMsg').textContent =
      loadingMessages[msgIndex++ % loadingMessages.length];
  }, 2500);

  try {
    let allText = '';
    for (const file of files) {
      const text = await extractPdfText(file);
      allText += `\n\n=== ${file.name} ===\n${text}`;
    }

    if (allText.length > 12000) {
      allText = allText.slice(0, 12000) + '\n\n[... tekst afgekapt vanwege lengte ...]';
    }

    const systemPrompt = `Je bent een ex-docent en examinator met 15 jaar ervaring in het schrijven van toetsen voor middelbare scholen en hbo-opleidingen. Je hebt honderden toetsen gemaakt en weet PRECIES hoe docenten denken als ze een toets samenstellen.

Je geheime wapen: je analyseert leerstof niet als een student, maar als de docent die de toets gaat maken.

JE DENKT ALS EEN DOCENT DIE EEN TOETS SCHRIJFT:
- "Welk concept is fundamenteel genoeg om altijd te toetsen?"
- "Wat is makkelijk te toetsen als meerkeuzevraag of open vraag?"
- "Welk onderdeel heb ik zelf de meeste aandacht aan besteed in de tekst?"
- "Wat is zo specifiek dat ik er een definitievraag van kan maken?"
- "Welk onderdeel verbindt alle andere concepten — dat toets ik altijd"

ANALYSEER DE LEERSTOF OP DEZE SIGNALEN (in volgorde van belang):
1. KRITISCH — Definities, formules, opsommingen met nummers → dit is ALTIJD toetsbaar
2. KRITISCH — Concepten die in meerdere hoofdstukken terugkomen → docent vindt dit fundamenteel
3. KRITISCH — Vetgedrukte of onderstreepte termen → docent heeft dit zelf gemarkeerd als belangrijk
4. BELANGRIJK — Voorbeelden die een concept illustreren → vaak gebruikt in toepassingsvragen
5. BELANGRIJK — Vergelijkingen tussen twee concepten ("X vs Y") → klassieke toetsvraag
6. OPTIONEEL — Historische context of achtergrondinfo → zelden getoetst tenzij specifiek benadrukt
7. SKIP — Randgevallen, uitzonderingen, voetnoten → docent heeft hier zelf geen toetsvraag van

EXTRA REGEL: Als iets maar 1 keer genoemd wordt en niet vetgedrukt is → bijna altijd SKIP
EXTRA REGEL: Als een concept een eigen paragraaf of kopje heeft → altijd MUST of SHOULD
EXTRA REGEL: Opsommingen van 3+ punten → docent gaat hier een vraag van maken, ALTIJD MUST

OUTPUT FORMAAT — Geef ALTIJD exact deze JSON structuur terug, niets anders:

{
  "must": [
    {
      "topic": "Naam van het onderwerp",
      "summary": "Leg het uit in 2-3 zinnen alsof je het uitlegt aan een student die 0 tijd heeft. Geen wollige taal. Direct en concreet.",
      "reason": "Zeg precies WAAROM dit in de toets komt. Niet vaag maar specifiek.",
      "tip": "Geef een ezelsbruggetje, geheugentruc of de snelste manier om dit te onthouden"
    }
  ],
  "should": [
    {
      "topic": "Naam van het onderwerp",
      "summary": "Korte samenvatting in 2 zinnen.",
      "reason": "Waarom het nuttig maar niet kritisch is — wees eerlijk",
      "tip": "Snelle manier om dit te begrijpen als je er 5 minuten aan besteedt"
    }
  ],
  "skip": [
    {
      "topic": "Naam van het onderwerp",
      "reason": "Waarom dit niet de moeite waard is met de beschikbare tijd — wees direct en eerlijk"
    }
  ],
  "cheatsheet": "Ultra-compacte cheatsheet. Schrijf dit alsof je de allerbeste student in de klas bent die zijn spiekbriefje deelt. Gebruik pijlen, gelijktekens, afkortingen. Groepeer per thema. Max 350 woorden. Geen volledige zinnen.",
  "toetsvragen": [
    "Voorspelde toetsvraag 1 — formuleer het precies zoals een docent het zou stellen",
    "Voorspelde toetsvraag 2",
    "Voorspelde toetsvraag 3"
  ]
}

TOON EN STIJL:
- Schrijf in het NEDERLANDS
- Klink als een slimme ouderejaars student die de stof door en door kent, niet als een AI
- Geen wollige taal — gewoon direct
- Durf HARD te zeggen wat je kunt skippen
- Must-learn: minimaal 3, maximaal 6 onderwerpen
- Should-learn: minimaal 2, maximaal 4 onderwerpen
- Geen preamble, geen uitleg buiten de JSON. Alleen de JSON.`;

    const response = await fetch('/.netlify/functions/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `De student heeft ${selectedTime} beschikbaar.\n\nHier is de leerstof:\n${allText}` }
        ]
      })
    });

    clearInterval(interval);

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'API fout');
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';

    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Kon resultaten niet verwerken.');
    const result = JSON.parse(jsonMatch[0]);

    await markAnalysisUsed();
    showResults(result);
  } catch (err) {
    clearInterval(interval);
    document.getElementById('mainInterface').style.display = 'block';
    document.getElementById('loadingState').style.display = 'none';
    showError('Fout: ' + err.message);
  }
}

// ── Render results ──
function renderTopics(list, containerId) {
  const el = document.getElementById(containerId);
  el.innerHTML = list
    .map(
      (item) => `
    <div class="topic-item">
      <h4>${item.topic}</h4>
      <p>${item.summary}</p>
      <span class="topic-reason">${item.reason}</span>
      ${item.tip ? `<span class="topic-tip">💡 ${item.tip}</span>` : ''}
    </div>`
    )
    .join('');
}

function showResults(data) {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('resultsSection').style.display = 'block';

  document.getElementById('resultsSubtitle').textContent =
    `Beschikbare tijd: ${selectedTime} · ${files.length} bestand(en) geanalyseerd`;

  renderTopics(data.must || [], 'mustList');
  renderTopics(data.should || [], 'shouldList');
  renderTopics(data.skip || [], 'skipList');

  document.getElementById('cheatsheetContent').textContent = data.cheatsheet || '';

  // Toetsvragen
  if (data.toetsvragen?.length) {
    const vragen = document.getElementById('toetsvragenList');
    if (vragen) {
      vragen.innerHTML = data.toetsvragen
        .map((v, i) => `<div class="toetsvraag"><span class="vr-num">${i + 1}</span><p>${v}</p></div>`)
        .join('');
      document.getElementById('toetsvragenSection').style.display = 'block';
    }
  }
}

// ── Reset ──
function reset() {
  document.getElementById('resultsSection').style.display = 'none';
  document.getElementById('mainInterface').style.display = 'block';
  files.length = 0;
  renderFileList();
  fileInput.value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
