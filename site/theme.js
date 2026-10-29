(function () {
  var KEY = 'blog:theme';
  var root = document.documentElement;

  var saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);

  function current() {
    return root.getAttribute('data-theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }

  var PASSWORD = 'blog:password';
  function writeLink() {
    var link = document.getElementById('write');
    if (!link) return;
    var password = '';
    try { password = localStorage.getItem(PASSWORD) || ''; } catch (e) {}
    link.hidden = password === '';
  }
  document.addEventListener('DOMContentLoaded', writeLink);
  window.addEventListener('pageshow', function (event) { if (event.persisted) writeLink(); });

  document.addEventListener('DOMContentLoaded', function () {
    var button = document.getElementById('theme');
    if (!button) return;
    function label() { button.textContent = current() === 'dark' ? 'light' : 'dark'; }
    button.hidden = false;
    label();
    button.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem(KEY, next); } catch (e) {}
      label();
    });
  });
})();
