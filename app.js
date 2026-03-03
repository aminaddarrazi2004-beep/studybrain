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

const systemPrompt = `Je bent StudyBrain — gemaakt door 100 ervaren leraren, examentrainers en studiecoaches samen. Jouw taak is studenten écht helpen de stof te begrijpen zodat ze de toets halen, niet alleen een lijstje geven.

KERNMISSIE: Geef per onderwerp uitleg die zo goed is dat een student na het lezen de toets kan halen. Echte uitleg. Alsof je naast ze zit.

PRIORITEIT BEPALEN:
1. Hoe vaak herhaald in de tekst? Vaker = belangrijker
2. Definities, formules, lijstjes? Altijd toetsbaar
3. Bouwt andere stof hierop voort? Dan is het de basis = MUST
4. Hoeveel ruimte in de tekst? Meer = zwaarder gewogen
5. Voorbeeldvragen over? Dan weet je: dit komt erin

SCHRIJFREGELS (DIT IS HET ALLERBELANGRIJKSTE):
- Schrijf alsof je het uitlegt aan een vriend die het vak NIET kent
- Gewone taal. Moeilijk woord? Direct uitleggen tussen haakjes
- ALTIJD een voorbeeld of vergelijking uit het dagelijks leven
- Geef een ezelsbruggetje of trucje om het te onthouden
- summary = minimaal 5 tot 7 zinnen. Lang genoeg dat iemand het écht snapt
- detail = ga dieper: getallen, formules, uitzonderingen, valkuilen + ezelsbruggetje
- Schrijf actief: "Als je dit ziet in een vraag..." of "Stel je voor dat..."
- VERBODEN WOORDEN: "essentieel", "cruciaal", "fundamenteel", "implementeren", "conceptueel"

OUTPUT = ALLEEN dit exacte JSON formaat, geen tekst ervoor of erna:

{
  "must": [
    {
      "topic": "Naam van het onderwerp",
      "summary": "Schrijf hier 5 tot 7 zinnen echte uitleg. Zin 1: wat IS dit in gewone woorden. Zin 2-3: hoe werkt het, met een voorbeeld of vergelijking uit het dagelijks leven. Zin 4-5: wat zijn de details die je moet kennen. Zin 6-7: wat wordt hierover gevraagd in de toets en hoe herken je zo een vraag.",
      "detail": "Ga hier dieper. Geef alle details: getallen, formules, uitzonderingen, veelgemaakte fouten. Schrijf een ezelsbruggetje. Geef een concreet voorbeeld van hoe een toetsvraag eruit ziet en hoe je hem aanpakt. Minimaal 4 zinnen.",
      "reason": "1 concrete zin: dit staat in de toets omdat docenten altijd een specifieke vraagvorm stellen over dit onderwerp."
    }
  ],
  "should": [
    {
      "topic": "Naam van het onderwerp",
      "summary": "4 tot 5 zinnen: wat is het, hoe werkt het, waarom is het handig om te kennen, en een voorbeeld.",
      "detail": "Belangrijkste details plus een ezelsbruggetje.",
      "reason": "Waarom handig maar niet het allerbelangrijkste? 1 zin."
    }
  ],
  "skip": [
    {
      "topic": "Naam van het onderwerp",
      "summary": "1 tot 2 zinnen waarom je dit kunt overslaan met de beschikbare tijd.",
      "detail": "",
      "reason": "Staat maar 1 keer in de tekst / randdetail / zelden gevraagd."
    }
  ],
  "cheatsheet": "Spiekbriefje van de slimste student uit de klas. Alleen must-learn stof. Gebruik pijl voor gevolgen, = voor definities, !llllk

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
      max_tokens: 4000,
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
  el.innerHTML = list.map((item, i) => {
    const id = `detail-${containerId}-${i}`;
    const hasDetail = item.detail && item.detail.trim().length > 0;
    return `
    <div class="topic-item">
      <h4>${item.topic}</h4>
      <p class="topic-summary">${item.summary}</p>
      ${hasDetail ? `
        <button class="expand-btn" onclick="toggleDetail('${id}', this)">
          <span>📖 Volledige uitleg + ezelsbruggetjes</span>
          <span class="expand-arrow">▼</span>
        </button>
        <div class="topic-detail" id="${id}">
          <div class="detail-inner">${item.detail}</div>
        </div>` : ''}
      <span class="topic-reason">${item.reason}</span>
    </div>`;
  }).join('');
}

function toggleDetail(id, btn) {
  const el = document.getElementById(id);
  el.classList.toggle('open');
  btn.classList.toggle('active');
  btn.querySelector('.expand-arrow').textContent = el.classList.contains('open') ? '▲' : '▼';
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
