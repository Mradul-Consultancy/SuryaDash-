/* ═══════════════════════════════════════════════════════════════
   ux-polish.js  ·  Loading states, form validation, mobile nav,
                    welcome overlay
   ═══════════════════════════════════════════════════════════════ */
(function(global) {
  'use strict';

  const $ = id => document.getElementById(id);

  /* ═══ BUTTON LOADING STATES ══════════════════════════════════ */
  function setBtnLoading(btn, loading, loadingText) {
    if (!btn) return;
    if (loading) {
      btn.dataset.origText = btn.textContent;
      btn.textContent = loadingText || 'Working…';
      btn.disabled = true;
      btn.style.opacity = '.65';
      btn.style.cursor = 'wait';
    } else {
      btn.textContent = btn.dataset.origText || btn.textContent;
      btn.disabled = false;
      btn.style.opacity = '';
      btn.style.cursor = '';
    }
  }

  /* ═══ FORM VALIDATION ════════════════════════════════════════ */
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function showFieldError(inputId, msg) {
    const input = $(inputId);
    if (!input) return;
    input.style.borderColor = 'var(--al-crit)';
    let err = document.getElementById(inputId + '-error');
    if (!err) {
      err = document.createElement('div');
      err.id = inputId + '-error';
      err.className = 'field-error';
      input.parentNode.appendChild(err);
    }
    err.textContent = msg;
    err.style.display = 'block';
  }

  function clearFieldError(inputId) {
    const input = $(inputId);
    if (input) input.style.borderColor = '';
    const err = document.getElementById(inputId + '-error');
    if (err) err.style.display = 'none';
  }

  function validateAuthForm() {
    let ok = true;
    const email = $('auth-email')?.value.trim() || '';
    const pass  = $('auth-pass')?.value || '';

    clearFieldError('auth-email');
    clearFieldError('auth-pass');

    if (!email) { showFieldError('auth-email', 'Email is required.'); ok = false; }
    else if (!EMAIL_RE.test(email)) { showFieldError('auth-email', 'Enter a valid email address.'); ok = false; }

    if (!pass) { showFieldError('auth-pass', 'Password is required.'); ok = false; }
    else if (pass.length < 6) { showFieldError('auth-pass', 'Password must be at least 6 characters.'); ok = false; }

    return ok;
  }

  function validateDifferentialThresholds() {
    const on  = +($('set-dton')?.value  || 0);
    const off = +($('set-dtoff')?.value || 0);
    clearFieldError('set-dton');
    if (on <= off) {
      showFieldError('set-dton', `ON threshold (${on}°C) must be greater than OFF threshold (${off}°C).`);
      return false;
    }
    return true;
  }

  /* ═══ LOADING SKELETON — shown until first real data arrives ═ */
  function showSkeleton() {
    document.querySelectorAll('.s-val').forEach(el => el.classList.add('skeleton-pulse'));
    document.querySelectorAll('.kpi-value').forEach(el => el.classList.add('skeleton-pulse'));
  }
  function hideSkeleton() {
    document.querySelectorAll('.skeleton-pulse').forEach(el => el.classList.remove('skeleton-pulse'));
  }

  /* ═══ CONNECTING OVERLAY (first load only) ══════════════════ */
  function showConnectingOverlay() {
    let ov = $('connecting-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'connecting-overlay';
      ov.className = 'connecting-overlay';
      ov.innerHTML = `<div class="connecting-spinner"></div><div class="connecting-text">Connecting to your SuryaDash…</div>`;
      document.body.appendChild(ov);
    }
    ov.style.display = 'flex';
  }
  function hideConnectingOverlay() {
    const ov = $('connecting-overlay');
    if (ov) ov.style.opacity = '0';
    setTimeout(() => { if (ov) ov.style.display = 'none'; }, 300);
  }

  /* ═══ WELCOME OVERLAY (after successful sign-up) ═════════════ */
  function showWelcome(email) {
    let w = $('welcome-overlay');
    if (!w) {
      w = document.createElement('div');
      w.id = 'welcome-overlay';
      w.className = 'welcome-overlay';
      w.innerHTML = `
        <div class="welcome-card">
          <div class="welcome-icon">🎉</div>
          <h2>Welcome aboard!</h2>
          <p>Your account <strong>${email}</strong> is ready. We've created your first site —
          you can rename it or add more from the site switcher up top.</p>
          <button class="auth-btn primary" onclick="document.getElementById('welcome-overlay').remove()" style="width:100%;margin-top:16px">Let's go →</button>
        </div>`;
      document.body.appendChild(w);
    }
  }

  /* ═══ STICKY MOBILE BOTTOM NAV ═══════════════════════════════ */
  function initMobileNav() {
    if (window.innerWidth > 640) return;
    if ($('mobile-bottom-nav')) return;

    const nav = document.createElement('div');
    nav.id = 'mobile-bottom-nav';
    nav.className = 'mobile-bottom-nav';
    nav.innerHTML = `
      <button class="mnav-btn active" data-tab="dashboard" onclick="switchTab('dashboard');mnavSync('dashboard')">📊<span>Home</span></button>
      <button class="mnav-btn" data-tab="analytics" onclick="switchTab('analytics');mnavSync('analytics')">📈<span>Stats</span></button>
      <button class="mnav-btn" data-tab="report" onclick="switchTab('report');mnavSync('report')">📄<span>Report</span></button>
      <button class="mnav-btn" data-tab="settings" onclick="switchTab('settings');mnavSync('settings')">⚙<span>Settings</span></button>
    `;
    document.body.appendChild(nav);
  }

  global.mnavSync = function(tab) {
    document.querySelectorAll('.mnav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  };

  /* ═══ Public API ═════════════════════════════════════════════ */
  global.UX = {
    setBtnLoading,
    showFieldError, clearFieldError,
    validateAuthForm, validateDifferentialThresholds,
    showSkeleton, hideSkeleton,
    showConnectingOverlay, hideConnectingOverlay,
    showWelcome,
    initMobileNav
  };

  window.addEventListener('resize', () => {
    if (window.innerWidth <= 640) initMobileNav();
    else { const n = $('mobile-bottom-nav'); if (n) n.remove(); }
  });

})(window);
