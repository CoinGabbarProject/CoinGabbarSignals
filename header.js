(() => {
  const root = document.documentElement;
  const header = document.getElementById('site-header');
  const navLinks = [...document.querySelectorAll('[data-nav]')];
  const mobileMenuButton = document.querySelector('.cgs-mobile-menu-trigger');
  const mobileMenu = document.getElementById('cgs-mobile-menu');
  const mobileSearchButton = document.querySelector('.cgs-search__mobile-trigger');
  const mobileSearch = document.querySelector('.cgs-mobile-search');
  const mobileSearchInput = document.getElementById('mobile-search');
  const desktopSearch = document.getElementById('desktop-search');
  const clearButton = document.querySelector('.cgs-search__clear');
  const closeSearch = document.querySelector('[data-close-search]');
  const themeButton = document.querySelector('.cgs-theme');
  const accountButton = document.querySelector('.cgs-account');

  function setActiveNav(id) {
    navLinks.forEach(link => {
      const active = link.dataset.nav === id;
      if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
    });
  }

  navLinks.forEach(link => link.addEventListener('click', () => setActiveNav(link.dataset.nav)));

  function setMenu(open) {
    mobileMenu.hidden = !open;
    mobileMenuButton.setAttribute('aria-expanded', String(open));
    mobileMenuButton.setAttribute('aria-label', open ? 'Close navigation menu' : 'Open navigation menu');
    if (open) {
      mobileSearch.hidden = true;
      requestAnimationFrame(() => mobileMenu.querySelector('a')?.focus());
    }
  }
  mobileMenuButton.addEventListener('click', () => setMenu(mobileMenu.hidden));

  function setMobileSearch(open) {
    mobileSearch.hidden = !open;
    if (open) {
      mobileMenu.hidden = true;
      mobileMenuButton.setAttribute('aria-expanded', 'false');
      requestAnimationFrame(() => mobileSearchInput.focus());
    } else mobileSearchInput.value = '';
  }
  mobileSearchButton.addEventListener('click', () => setMobileSearch(true));
  closeSearch.addEventListener('click', () => setMobileSearch(false));

  function updateClear() { clearButton.hidden = desktopSearch.value.length === 0; }
  desktopSearch.addEventListener('input', updateClear);
  clearButton.addEventListener('click', () => { desktopSearch.value = ''; updateClear(); desktopSearch.focus(); });
  [desktopSearch, mobileSearchInput].forEach(input => input.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (input === mobileSearchInput) setMobileSearch(false); else { input.value = ''; updateClear(); }
    }
  }));

  const themeStorageKey = 'cgs-theme';
  function applyTheme(theme) {
    root.dataset.theme = theme;
    themeButton.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    themeButton.title = theme === 'dark' ? 'Light theme' : 'Dark theme';
    const icon = themeButton.querySelector('.cgs-icon');
    icon.className = 'cgs-icon ' + (theme === 'dark' ? 'cgs-icon--sun' : 'cgs-icon--moon');
  }
  const storedTheme = localStorage.getItem(themeStorageKey);
  applyTheme(storedTheme === 'light' ? 'light' : 'dark');
  themeButton.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem(themeStorageKey, next);
    applyTheme(next);
  });

  accountButton.addEventListener('click', () => {
    const expanded = accountButton.getAttribute('aria-expanded') === 'true';
    accountButton.setAttribute('aria-expanded', String(!expanded));
    // Authentication is intentionally not implemented in Part 06A.
  });

  document.addEventListener('click', event => {
    if (!header.contains(event.target)) { setMenu(false); setMobileSearch(false); accountButton.setAttribute('aria-expanded', 'false'); }
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { setMenu(false); setMobileSearch(false); accountButton.setAttribute('aria-expanded', 'false'); }
  });

  // Market status is intentionally configuration-ready, not a fake real-time feed.
  window.CoinGabbarSignalsHeader = {
    setMarketStatus({ state = 'DATA_DELAYED', label = 'Data delayed', meta = 'Awaiting live feed', severity = 'warning' } = {}) {
      const el = document.getElementById('market-status');
      if (!el) return;
      el.dataset.state = state;
      el.dataset.severity = severity;
      el.querySelector('strong').textContent = label;
      el.querySelector('small').textContent = meta;
      el.setAttribute('aria-label', `Market status: ${label}`);
      el.title = meta;
      const mobile = document.querySelector('.cgs-mobile-menu__status span:last-child');
      if (mobile) mobile.textContent = label;
    },
    setAccount({ loggedIn = false, name = 'Log in' } = {}) {
      const avatar = accountButton.querySelector('.cgs-account__avatar');
      const label = accountButton.querySelector('.cgs-account__copy strong');
      avatar.textContent = loggedIn ? name.trim().slice(0, 1).toUpperCase() : '?';
      label.textContent = loggedIn ? name : 'Log in';
      accountButton.setAttribute('aria-label', loggedIn ? `Account: ${name}` : 'Account: Log in');
    }
  };
})();
