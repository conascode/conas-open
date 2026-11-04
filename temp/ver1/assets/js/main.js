// Entry point — wires up each feature module.
import { initNav } from './modules/nav.js';
import { initReveal } from './modules/reveal.js';
import { renderProjects } from './modules/projects.js';
import { projects } from './data/projects.js';

document.documentElement.classList.add('js');

document.addEventListener('DOMContentLoaded', () => {
  renderProjects(document.querySelector('[data-projects]'), projects);
  initNav();
  initReveal();

  const year = document.querySelector('[data-year]');
  if (year) year.textContent = new Date().getFullYear();
});
