// Legal pages use the same explicit language choice as the app, including in dialogs.
(() => {
  const main = document.querySelector('main');
  const english = main.innerHTML;
  const korean = document.getElementById('legal-ko').innerHTML;
  let locale;
  try { locale = localStorage.getItem('inheritance:locale'); } catch { /* Browser preference is enough. */ }
  if (!['en', 'ko'].includes(locale)) {
    const preferred = navigator.languages.find(value => /^(ko|en)(-|$)/i.test(value)) || 'en';
    locale = /^ko/i.test(preferred) ? 'ko' : 'en';
  }
  const show = language => {
    main.innerHTML = language === 'ko' ? korean : english;
    document.documentElement.lang = language;
    document.title = main.querySelector('h1').textContent + ' · Inheritance';
    document.querySelectorAll('[data-language]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.language === language));
    });
  };
  document.querySelectorAll('[data-language]').forEach(button => button.addEventListener('click', () => {
    const language = button.dataset.language;
    try { localStorage.setItem('inheritance:locale', language); } catch { /* Switching still works here. */ }
    show(language);
  }));
  show(locale);
})();
