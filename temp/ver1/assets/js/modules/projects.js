// Render project cards from data.
export function renderProjects(container, list) {
  if (!container || !Array.isArray(list)) return;

  const frag = document.createDocumentFragment();

  list.forEach((p) => {
    const el = document.createElement(p.url ? 'a' : 'div');
    el.className = 'project reveal';
    if (p.url) {
      el.href = p.url;
      if (/^https?:/.test(p.url)) {
        el.target = '_blank';
        el.rel = 'noopener';
      }
    }

    const body = document.createElement('div');
    body.className = 'project__body';

    const tag = document.createElement('p');
    tag.className = 'project__tag';
    tag.textContent = p.tag;

    const name = document.createElement('h3');
    name.className = 'project__name';
    name.textContent = p.name;

    const desc = document.createElement('p');
    desc.className = 'project__desc';
    desc.textContent = p.description;

    body.append(tag, name, desc);
    el.append(body);

    if (p.url) {
      const arrow = document.createElement('span');
      arrow.className = 'project__arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '→';
      el.append(arrow);
    }

    frag.append(el);
  });

  container.replaceChildren(frag);
}
