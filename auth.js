// StudyBrain — Auth via Supabase
// Stap 1: ga naar supabase.com, maak gratis account
// Stap 2: nieuw project aanmaken
// Stap 3: Settings > API > kopieer URL en anon key hieronder

const SUPABASE_URL = 'JOUW_SUPABASE_URL_HIER';
const SUPABASE_KEY = 'JOUW_SUPABASE_ANON_KEY_HIER';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function showMsg(id, tekst, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = tekst;
  el.className = 'msg ' + type;
  el.style.display = 'block';
}

async function doSignup() {
  const email = document.getElementById('signupEmail').value.trim();
  const pw1   = document.getElementById('signupPassword').value;
  const pw2   = document.getElementById('signupPassword2').value;
  if (!email || !pw1) return showMsg('signupError', 'Vul je e-mail en wachtwoord in.', 'error');
  if (pw1.length < 6)  return showMsg('signupError', 'Wachtwoord minimaal 6 tekens.', 'error');
  if (pw1 !== pw2)     return showMsg('signupError', 'Wachtwoorden komen niet overeen.', 'error');
  const btn = document.getElementById('signupBtn');
  btn.disabled = true; btn.textContent = 'Bezig...';
  const { error } = await sb.auth.signUp({ email, password: pw1 });
  if (error) {
    showMsg('signupError', 'Fout: ' + error.message, 'error');
    btn.disabled = false; btn.textContent = 'Account aanmaken';
  } else {
    showMsg('signupSuccess', 'Gelukt! Controleer je e-mail om je account te bevestigen.', 'success');
    btn.textContent = 'E-mail verstuurd!';
  }
}

async function doLogin() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  if (!email || !password) return showMsg('loginError', 'Vul je e-mail en wachtwoord in.', 'error');
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = 'Bezig...';
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    showMsg('loginError', 'Verkeerd e-mailadres of wachtwoord.', 'error');
    btn.disabled = false; btn.textContent = 'Inloggen';
  } else {
    window.location.href = 'app.html';
  }
}

async function doLogout() {
  await sb.auth.signOut();
  window.location.href = 'index.html';
}

async function checkAccess() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) window.location.href = 'login.html';
}
