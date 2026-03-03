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

// ── Main analyze function ──
async function analyze() {
  hideError();

  const apiKey = document.getElementById('apiKey').value.trim();
  if (!apiKey) {
    showError('Vul eerst je Groq API key in.');
    return;
  }
  if (files.length === 0) {
    showError('Upload minimaal één PDF bestand.');
    return;
  }

  // Switch to loading state
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
    // Extract text from all PDFs
    let allText = '';
    for (const file of files) {
      const text = await extractPdfText(file);
      allText += `\n\n=== ${file.name} ===\n${text}`;
    }

    // Truncate to avoid token limits (~12k chars ≈ ~3k tokens)
    if (allText.length > 12000) {
      allText =
        allText.slice(0, 12000) + '\n\n[... tekst afgekapt vanwege lengte ...]';
    }

const systemPrompt = `Je bent StudyBrain — een studiecoach gemaakt door 100 ervaren leraren samen. Je weet precies hoe toetsen werken en wat docenten belangrijk vinden.

JOUW MISSIE: Analyseer de lesstof en geef een studieplan dat eerlijk, duidelijk en makkelijk te begrijpen is.

HOE JE ANALYSEERT:
1. Wat wordt vaak herhaald? → Dat is belangrijk
2. Zijn er definities, lijstjes of formules? → Die komen in de toets
3. Staat iets vetgedrukt of in een kader? → Dat benadrukt de docent
4. Zijn er oefenvragen of voorbeelden? → Dan weet je hoe de toets eruitziet
5. Hoeveel pagina's gaan over één onderwerp? → Meer pagina's = meer gewicht
6. Is het een basisonderwerp waar alles op voortbouwt? → Dan MOET je het kennen

SCHRIJFSTIJL — DIT IS CRUCIAAL:
- Schrijf alsof je het uitlegt aan een vriend die het vak niet kent
- Gebruik gewone, makkelijke woorden. GEEN vakjargon tenzij je het gelijk uitlegt
- Korte zinnen. Maximaal 15 woorden per zin
- Als je een moeilijk woord gebruikt, leg het dan gelijk uit tussen haakjes
- Schrijf alsof je zegt: "Oké luister, dit is wat je moet weten:"
- Gebruik concrete voorbeelden als dat helpt
- VERBODEN woorden: "fundamenteel", "essentieel", "cruciaal", "implementeren", "analyseren", "conceptueel"

OUTPUT — geef ALTIJD precies dit JSON formaat terug, niks anders:

{
  "must": [
    {
      "topic": "Naam van het onderwerp (kort en duidelijk)",
      "summary": "Leg dit uit in gewone taal. Alsof je het aan iemand uitlegt die nul verstand heeft van het vak. Gebruik een voorbeeld als dat helpt. Maximaal 3 korte zinnen.",
      "reason": "Zeg in 1 zin waarom dit sowieso in de toets komt. Wees specifiek, niet vaag."
    }
  ],
  "should": [
    {
      "topic": "Naam van het onderwerp",
      "summary": "Korte uitleg in gewone taal. Wat is het en waarom is het handig om te weten?",
      "reason": "1 zin: waarom is dit nuttig maar niet het allerbelangrijkste?"
    }
  ],
  "skip": [
    {
      "topic": "Naam van het onderwerp",
      "summary": "Waarom kun je dit overslaan? Wees eerlijk en direct.",
      "reason": "Staat maar 1 keer in de tekst / te gedetailleerd / randinformatie"
    }
  ],
  "cheatsheet": "Maak een spiekbriefje met ALLEEN de must-learn stof. Schrijf het als snelle aantekeningen. Gebruik pijlen (→), symbolen en emoji's als visuele hulp. Alles in simpele taal. Max 300 woorden."
}

REGELS:
- Must-learn: MAX 5 tot 7 onderwerpen
- Should-learn: 3 tot 5 onderwerpen  
- Skip: alles wat niet de moeite waard is
- Schrijf in het NEDERLANDS
- Wees eerlijk: niet alles is belangrijk, durf dingen in de skip te zetten
- Geen inleiding, geen uitleg buiten de JSON. Alleen de JSON.`;

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 2000,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: `De student heeft ${selectedTime} beschikbaar.\n\nHier is de leerstof:\n${allText}`,
          },
        ],
      }),
    });

    clearInterval(interval);

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'API fout');
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '';

    // Parse JSON
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Kon resultaten niet verwerken.');
    const result = JSON.parse(jsonMatch[0]);

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
