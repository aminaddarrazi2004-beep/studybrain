# 🧠 StudyBrain

> Upload je lesstof. Wij vertellen je precies wat je moet leren.

StudyBrain is een AI-powered studietool voor studenten die weinig tijd hebben. Upload je PDF(s), geef aan hoeveel tijd je hebt, en krijg binnen seconden een geprioriteerd studieplan.

## ✨ Features

- 📄 **PDF upload** — sleep één of meerdere bestanden erin
- ⏰ **Tijdselectie** — van 30 minuten tot een hele avond
- 🔥 **Must learn** — wat sowieso in de toets komt
- ⚡ **Nice to know** — handig als je nog tijd hebt
- ⏭️ **Skip** — eerlijk advies over wat je kunt overslaan
- 📝 **Cheatsheet** — ultra-compact spiekbriefje van de kernstof

## 🚀 Deployment (Netlify)

1. Fork of clone deze repo
2. Ga naar [netlify.com](https://netlify.com) → **Add new site** → **Import from Git**
3. Selecteer je repository
4. Build settings: laat alles leeg (pure HTML/CSS/JS, geen build step nodig)
5. Klik **Deploy site** — klaar!

## 🔑 API Key

StudyBrain gebruikt de **Groq API** (gratis):

1. Maak een account op [console.groq.com](https://console.groq.com)
2. Ga naar **API Keys** → **Create API Key**
3. Kopieer je key (begint met `gsk_`)
4. Plak hem in het invoerveld van StudyBrain

De key wordt **nooit opgeslagen** — hij leeft alleen in je browser-sessie.

## 🛠️ Lokaal draaien

Geen build stap nodig. Open gewoon `index.html` in je browser, of gebruik een lokale server:

```bash
# Met Python
python3 -m http.server 3000

# Met Node.js (npx)
npx serve .
```

Ga daarna naar `http://localhost:3000`

## 📁 Projectstructuur

```
studybrain/
├── index.html      # HTML structuur
├── style.css       # Styling & animaties
├── app.js          # App logica & API calls
└── README.md       # Dit bestand
```

## ⚠️ Let op

- Werkt het beste met **tekst-PDFs** (niet gescand)
- Lange documenten worden afgekapt op ~12.000 tekens
- Je Groq API key wordt niet opgeslagen of gedeeld

## 🤝 Tech stack

- Vanilla HTML/CSS/JS — geen framework
- [PDF.js](https://mozilla.github.io/pdf.js/) voor PDF-verwerking
- [Groq API](https://console.groq.com) met `llama-3.3-70b-versatile`
- Google Fonts (Syne + DM Sans)
