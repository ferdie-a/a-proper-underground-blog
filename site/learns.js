(function () {
  var EVERY_MS = 6500;
  var PILL_EPOCH = Date.UTC(2026, 0, 1);
  var PILL_WINDOW_MS = 6 * 60 * 60 * 1000;
  var MAX_SKIPPED = Math.pow(2, 53) - 1;
  var KEYS = { learnsStop: 'blog:learns:stopped', skipped: 'blog:learns:skipped' };
  var PAUSE = String.fromCharCode(0x2016);
  var PLAY = String.fromCharCode(0x25b6, 0xfe0e);

  function load(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, value); } catch (e) {}
  }

  function keyboardFocusIn(el) {
    try { return !!el.querySelector(':focus-visible'); }
    catch (e) { return el.contains(document.activeElement); }
  }

  function rotation(rootId, toggleId, stopKey, href) {
    var root = document.getElementById(rootId);
    if (!root) return;
    var rows = root.querySelectorAll('.blog-rotation li');
    var toggle = document.getElementById(toggleId);
    var current = 0;
    var stopped = load(stopKey) === '1';
    var hovered = false;
    var focused = false;

    function label() {
      toggle.textContent = stopped ? PLAY : PAUSE;
      toggle.setAttribute('aria-label', stopped ? 'Start rotation' : 'Stop rotation');
    }

    if (rows.length > 1 && toggle) {
      toggle.hidden = false;
      label();
      toggle.addEventListener('click', function () {
        stopped = !stopped;
        save(stopKey, stopped ? '1' : '0');
        label();
      });
      setInterval(function () {
        if (stopped || hovered || focused) return;
        if (keyboardFocusIn(rows[current])) return;
        rows[current].hidden = true;
        current = (current + 1) % rows.length;
        rows[current].hidden = false;
      }, EVERY_MS);

      var canHover = false;
      try { canHover = typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover)').matches; } catch (e) { canHover = false; }
      if (canHover) {
        root.addEventListener('mouseenter', function () { hovered = true; });
        root.addEventListener('mouseleave', function () { hovered = false; });
      }

      function checkFocus() {
        setTimeout(function () { focused = keyboardFocusIn(root); }, 0);
      }
      root.addEventListener('focusin', checkFocus);
      root.addEventListener('focusout', checkFocus);
    }

    root.addEventListener('click', function (event) {
      if (event.target.closest('a, button')) return;
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.button !== 0) return;
      if (window.getSelection && String(window.getSelection())) return;
      location.href = href;
    });
  }

  function pill() {
    var root = document.getElementById('pill');
    if (!root) return;
    var items = root.querySelectorAll('.pill-item');
    var n = items.length;
    if (n === 0) return;
    var skip = document.getElementById('pill-skip');

    var skipped = parseInt(load(KEYS.skipped), 10);
    if (!isFinite(skipped) || skipped < 0 || skipped > MAX_SKIPPED) skipped = 0;

    var windows = Math.floor((Date.now() - PILL_EPOCH) / PILL_WINDOW_MS);
    var current = ((windows + skipped) % n + n) % n;

    function setOpen(item, open) {
      var answer = item.querySelector('.pill-a');
      var button = item.querySelector('.pill-open');
      if (answer) answer.hidden = !open;
      if (button) {
        button.setAttribute('aria-expanded', String(open));
        button.setAttribute('aria-label', open ? 'Hide answer' : 'Show answer');
      }
    }

    function show(k) {
      for (var i = 0; i < n; i++) items[i].hidden = i !== k;
      setOpen(items[k], false);
      current = k;
    }

    Array.prototype.forEach.call(items, function (item) {
      var button = item.querySelector('.pill-open');
      var answer = item.querySelector('.pill-a');
      if (!button || !answer) return;
      button.hidden = false;
      button.addEventListener('click', function () { setOpen(item, answer.hidden); });
    });

    if (skip && n > 1) {
      skip.hidden = false;
      skip.addEventListener('click', function () {
        skipped = skipped + 1;
        save(KEYS.skipped, String(skipped));
        show((current + 1) % n);
      });
    }

    show(current);
  }

  rotation('blog-learns', 'blog-learns-toggle', KEYS.learnsStop, '/learns');
  pill();
})();
