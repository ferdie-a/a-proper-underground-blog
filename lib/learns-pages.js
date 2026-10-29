import { escapeHtml } from '../site/lib/post.js';
import { PENCIL, ARROW } from './icons.js';

const pieceUrl = (slug) => `/learns/${escapeHtml(slug)}`;

export function renderList(pieces) {
  const rows = pieces.map((p) => `<article><h2><a href="${p.href}">${escapeHtml(p.title)}</a></h2> <address>${escapeHtml(p.date)}</address></article>`);
  return `<section class="list">\n${rows.join('\n')}\n</section>`;
}

export function renderLearnsBox(learns, section) {
  if (learns.length === 0) return '';
  const rows = learns.map((l, n) => `<li${n === 0 ? '' : ' hidden'}><a href="${pieceUrl(l.slug)}">${escapeHtml(l.title)}</a></li>`);
  return `<section class="blog-box blog-learns" id="blog-learns">
<h2 class="blog-title"><a href="/learns">${escapeHtml(section.title)}</a> ${PENCIL}</h2>
<button class="blog-toggle" id="blog-learns-toggle" type="button" hidden></button>
<ul class="blog-rotation">
${rows.join('\n')}
</ul>
</section>
`;
}

function renderPill(pill, n) {
  return `<div class="pill-item" data-pill="${n}"${n === 0 ? '' : ' hidden'}>
<p class="pill-q">${escapeHtml(pill.question)} <button class="pill-open" type="button" aria-expanded="true" aria-label="Hide answer" hidden>${ARROW}</button></p>
<div class="pill-a">
<p>${escapeHtml(pill.answer)}</p>
<p class="pill-from">from <a href="${pieceUrl(pill.slug)}">${escapeHtml(pill.title)}</a></p>
</div>
</div>`;
}

export function renderLearnsPage(learns, section) {
  const pills = [...learns].reverse().flatMap((l) => l.pills.map((p) => ({ ...p, slug: l.slug, title: l.title })));
  return `<h2 class="blog-page-title">${escapeHtml(section.title)}</h2>
<p class="blog-intro">${escapeHtml(section.intro)}</p>
<section class="pill" id="pill">
<h3 class="pill-title">Learning Pill</h3>
${pills.map(renderPill).join('\n')}
<p class="pill-skip"><button id="pill-skip" type="button" hidden>skip</button></p>
</section>
${renderList(learns.map((l) => ({ ...l, href: pieceUrl(l.slug) })))}`;
}
