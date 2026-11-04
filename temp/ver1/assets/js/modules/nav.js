// Mobile menu open/close + header shadow on scroll.
export function initNav() {
  const header = document.querySelector('[data-header]');
  const toggle = document.querySelector('[data-menu-toggle]');
  const nav = document.querySelector('[data-nav]');
  if (!header || !toggle || !nav) return;

  const label = toggle.querySelector('.visually-hidden');

  const setOpen = (open) => {
    toggle.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
    document.body.classList.toggle('is-locked', open);
    if (label) label.textContent = open ? '메뉴 닫기' : '메뉴 열기';
  };

  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  // 메뉴 안의 링크를 누르면 닫기
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });

  // 화면이 넓어지면 열린 상태 해제
  window.matchMedia('(min-width: 768px)').addEventListener('change', (e) => {
    if (e.matches) setOpen(false);
  });

  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}
