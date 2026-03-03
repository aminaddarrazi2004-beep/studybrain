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
    .map((f, i) => `
      <div class="file-item">
        <span class="fi-icon">📄</span>
        <span class="fi-name">${f.name}</span>
        <span class="fi-size">${(f.size / 1024 / 1024).toFixed(1)} MB</span>
        <button class="fi-remove" onclick="removeFile(${i})">×</button>
      </div>`)
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
  if (!apiKey) { showError('Vul eerst je Groq API key in.'); return; }
  if (files.length === 0) { showError('Upload minimaal één PDF bestand.'); return; }

  document.getElementById('mainInterface').style.display = 'none';
  document.getElementById('loadingState').style.display = 'block';

  const loadingMessages = [
    'Lesstof aan het verwerken...',
    'Toetspatronen herkennen...',
    'Uitleg per onderwerp schrijven...',
    'Voorbeelden en ezelsbruggetjes toevoegen...',
    'Studieplan samenstellen...',
  ];
  let msgIndex = 0;
  const interval = setInterval(() => {
    document.getElementById('loadingMsg').textContent =
      loadingMessages[msgIndex++ % loadingMessages.length];
  }, 2800);

  try {
    let allText = '';
    for (const file of files) {
      const text = await extractPdfText(file);
      allText += `\n\n=== ${file.name} ===\n${text}`;
    }

    if (allText.length > 14000) {
      allText = allText.slice(0, 14000) + '\n\n[... tekst afgekapt ...]';
    }

    const systemPrompt = `Je bent StudyBrain, gemaakt door 100 ervaren leraren, examentrainers en studiecoaches. Jouw taak is studenten echt helpen de stof te begrijpen zodat ze de toets halen.

KERNMISSIE: Geef per onderwerp uitleg die zo goed is dat een student na het lezen de toets kan halen. Echte uitleg. Alsof je naast ze zit en het uitlegt.

PRIORITEIT BEPALEN:
1. Hoe vaak herhaald in de tekst? Vaker = belangrijker
2. Definities, formules, lijstjes? Altijd toetsbaar
3. Bouwt andere stof hierop voort? Dan is het de basis, MUST
4. Hoeveel ruimte in de tekst? Meer = zwaarder gewogen
5. Voorbeeldvragen over? Dan weet je: dit komt erin

SCHRIJFREGELS:
- Schrijf alsof je het uitlegt aan een vriend die het vak NIET kent
- Gewone taal, moeilijk woord altijd direct uitleggen tussen haakjes
- Gebruik altijd een voorbeeld of vergelijking uit het dagelijks leven
- Geef een ezelsbruggetje of trucje om het te onthouden
- summary is minimaal 5 tot 7 zinnen, lang genoeg dat iemand het echt snapt
- detail gaat dieper met getallen, formules, uitzonderingen, valkuilen en een ezelsbruggetje
- Schrijf actief, bijvoorbeeld: Als je dit ziet in een vraag, of Stel je voor dat

OUTPUT is ALLEEN dit exacte JSON formaat, geen tekst ervoor of erna:

{
  "must": [
    {
      "topic": "Naam van het onderwerp",
      "summary": "Schrijf hier 5 tot 7 zinnen echte uitleg. Begin met wat dit IS in gewone woorden. Leg dan uit hoe het werkt met een voorbeeld of vergelijking uit het dagelijks leven. Bespreek de details die je moet kennen. Sluit af met wat hierover gevraagd wordt in de toets en hoe je zo een vraag herkent.",
      "detail": "Ga hier dieper in. Geef alle details: getallen, formules, uitzonderingen, veelgemaakte fouten. Schrijf een ezelsbruggetje. Geef een concreet voorbeeld van hoe een toetsvraag eruit ziet en hoe je hem aanpakt. Minimaal 4 zinnen.",
      "reason": "1 concrete zin waarom dit in de toets komt, specifiek en niet vaag."
    }
  ],
  "should": [
    {
      "topic": "Naam van het onderwerp",
      "summary": "4 tot 5 zinnen: wat is het, hoe werkt het, waarom is het handig om te kennen, en een voorbeeld.",
      "detail": "Belangrijkste details plus een ezelsbruggetje.",
      "reason": "Waarom handig maar niet het allerbelangrijkste, 1 zin."
    }
  ],
  "skip": [
    {
      "topic": "Naam van het onderwerp",
      "summary": "1 tot 2 zinnen waarom je dit kunt overslaan.",
      "detail": "",
      "reason": "Staat maar 1 keer in de tekst of randdetail of zelden gevraagd."
    }
  ],
  "cheatsheet": "Spiekbriefje van de slimste student. Alleen must-learn stof. Gebruik pijltjes voor gevolgen, = voor definities, ! voor let op, en emojis. Per onderwerp de kern in max 2 regels. Eindig met: TOP 3 TOETSVRAGEN — VRAAG: [vraag] ANTWOORD: [antwoord]"
}

Must 5 tot 7 onderwerpen. Should 3 tot 5. Skip de rest. Alles in Nederlands. Geen tekst buiten de JSON.`;

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

function showResults(data) {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('resultsSection').style.display = 'block';

  document.getElementById('resultsSubtitle').textContent =
    `Beschikbare tijd: ${selectedTime} · ${files.length} bestand(en) geanalyseerd`;

  renderTopics(data.must || [], 'mustList');
  renderTopics(data.should || [], 'shouldList');
  renderTopics(data.skip || [], 'skipList');

  const cs = document.getElementById('cheatsheetContent');
  cs.innerHTML = (data.cheatsheet || '').replace(/\n/g, '<br>');
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
