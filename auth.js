// StudyBrain — Auth via Supabase
const SUPABASE_URL = 'https://wtfzqpaectqrbprmxjqp.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind0ZnpxcGFlY3RxcmJwcm14anFwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI1NzE4NDYsImV4cCI6MjA4ODE0Nzg0Nn0.LeJqnukvUpVJZyG_2pjwS0xnl24ATdV6Mi6qqZeVbJ4';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: true,
    storageKey: 'studybrain-auth',
    storage: window.localStorage,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  }
});

// Verwerk email verificatie
(async () => {
  const hash = window.location.hash;
  if (hash && hash.includes('access_token')) {
    const { error } = await sb.auth.getSession();
    if (!error) {
      window.location.href = 'login.html?verified=1';
    }
  }
})();

function showMsg(id, tekst, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = tekst;
  el.className = 'msg ' + type;
  el.style.display = 'block';
}

window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('verified') === '1') {
    showMsg('loginError', '✅ E-mail bevestigd! Je kunt nu inloggen.', 'success');
  }

  const savedEmail = localStorage.getItem('studybrain-remember-email');
  if (savedEmail) {
    const emailField = document.getElementById('loginEmail');
    const rememberBox = document.getElementById('rememberMe');
    if (emailField) emailField.value = savedEmail;
    if (rememberBox) rememberBox.checked = true;
  }
});

async function doSignup() {
  const email = document.getElementById('signupEmail').value.trim();
  const pw1   = document.getElementById('signupPassword').value;
  const pw2   = document.getElementById('signupPassword2').value;
  if (!email || !pw1) return showMsg('signupError', 'Vul je e-mail en wachtwoord in.', 'error');
  if (pw1.length < 6)  return showMsg('signupError', 'Wachtwoord minimaal 6 tekens.', 'error');
  if (pw1 !== pw2)     return showMsg('signupError', 'Wachtwoorden komen niet overeen.', 'error');
  const btn = document.getElementById('signupBtn');
  btn.disabled = true; btn.textContent = 'Bezig...';

  const { error } = await sb.auth.signUp({
    email,
    password: pw1,
    options: { emailRedirectTo: 'https://studybrain.pages.dev/login.html' }
  });

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
  const remember = document.getElementById('rememberMe')?.checked;
  if (!email || !password) return showMsg('loginError', 'Vul je e-mail en wachtwoord in.', 'error');
  const btn = document.getElementById('loginBtn');
  btn.disabled = true; btn.textContent = 'Bezig...';

  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    showMsg('loginError', 'Verkeerd e-mailadres of wachtwoord.', 'error');
    btn.disabled = false; btn.textContent = 'Inloggen';
  } else {
    if (remember) {
      localStorage.setItem('studybrain-remember-email', email);
    } else {
      localStorage.removeItem('studybrain-remember-email');
    }
    // ✅ Terug naar homepage met success melding
    window.location.href = 'index.html?ingelogd=1';
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
