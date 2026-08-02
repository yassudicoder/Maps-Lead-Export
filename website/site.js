/*
 * Maps Lead Export — landing site.
 *
 * No animation loops anywhere on this page, because no loop exists in the
 * product. Everything below is one-shot and gesture-bound: it runs because
 * the reader scrolled, pressed, or pointed, and then it stops.
 */
(function () {
  'use strict';

  var doc = document;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var wideStage = window.matchMedia('(min-width: 860px)').matches;

  /* ------------------------------------------------------------- theme */

  function currentTheme() {
    var explicit = doc.documentElement.getAttribute('data-theme');
    if (explicit === 'light' || explicit === 'dark') return explicit;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  Array.prototype.forEach.call(doc.querySelectorAll('[data-theme-toggle]'), function (btn) {
    btn.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      doc.documentElement.setAttribute('data-theme', next);
      try {
        localStorage.setItem('mle-theme', next);
      } catch (e) {}
    });
  });

  /* ------------------------------------------------- ledger gutter furniture */

  var gutter = doc.getElementById('gutter');

  function buildGutter() {
    if (!gutter) return;
    if (!window.matchMedia('(min-width: 1024px)').matches) {
      gutter.textContent = '';
      return;
    }
    var height = doc.documentElement.scrollHeight;
    var frag = doc.createDocumentFragment();
    var n = 1;
    for (var y = 96; y < height - 48; y += 72) {
      var num = doc.createElement('span');
      num.className = 'gnum';
      num.style.top = y + 'px';
      num.textContent = String(n);
      frag.appendChild(num);
      n += 1;
    }
    Array.prototype.forEach.call(doc.querySelectorAll('[data-letter]'), function (sec) {
      var letter = doc.createElement('span');
      letter.className = 'gletter';
      var top = sec.getBoundingClientRect().top + window.scrollY + 8;
      letter.style.top = top + 'px';
      letter.textContent = sec.getAttribute('data-letter');
      frag.appendChild(letter);
    });
    gutter.textContent = '';
    gutter.appendChild(frag);
  }

  var gutterTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(gutterTimer);
    gutterTimer = setTimeout(buildGutter, 150);
  });
  window.addEventListener('load', buildGutter);
  if (doc.fonts && doc.fonts.ready && doc.fonts.ready.then) {
    doc.fonts.ready.then(buildGutter);
  }
  buildGutter();

  /* ------------------------------------------------------------ reveals */

  var revealTargets = [];
  Array.prototype.forEach.call(doc.querySelectorAll('[data-reveal-group]'), function (group) {
    Array.prototype.forEach.call(group.querySelectorAll('.reveal'), function (el, i) {
      el.style.setProperty('--reveal-delay', i * 40 + 'ms');
    });
  });
  Array.prototype.forEach.call(doc.querySelectorAll('.reveal'), function (el) {
    revealTargets.push(el);
  });

  if ('IntersectionObserver' in window && !reducedMotion) {
    var revealIO = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in');
            revealIO.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2, rootMargin: '0px 0px -40px 0px' }
    );
    revealTargets.forEach(function (el) {
      revealIO.observe(el);
    });
  } else {
    revealTargets.forEach(function (el) {
      el.classList.add('in');
    });
  }

  /* -------------------------------------------------------------- stage
     Desktop: the reader's own scrolling moves the feed past the scan line,
     and each card that crosses lands its row — latched, like a collected
     row, never re-animated. Mobile: the rows land once, staggered, when
     the ledger scrolls into view. Reduced motion / no JS: already landed. */

  var stage = doc.getElementById('stage');
  var track = doc.getElementById('cardsTrack');
  var counter = doc.getElementById('ledgerCounter');

  if (stage && track && counter && !reducedMotion) {
    var rows = Array.prototype.slice.call(stage.querySelectorAll('.lrow'));
    var cards = Array.prototype.slice.call(track.querySelectorAll('.mcard'));
    var landedCount = 0;
    var unknownCount = 0;

    var updateCounter = function () {
      counter.textContent =
        landedCount +
        (landedCount === 1 ? ' row' : ' rows') +
        ' · ' +
        unknownCount +
        ' unknown kept · 0 guessed';
    };

    var land = function (row) {
      if (row.classList.contains('landed')) return;
      row.classList.add('landed');
      landedCount += 1;
      if (row.querySelector('.chip-unknown')) unknownCount += 1;
      updateCounter();
    };

    var arm = function () {
      rows.forEach(function (row) {
        row.classList.remove('landed');
      });
      stage.classList.add('armed');
      landedCount = 0;
      unknownCount = 0;
      updateCounter();
    };

    if (wideStage) {
      arm();

      var cardsPane = stage.querySelector('.stage-cards');
      var geom = null;

      var measure = function () {
        var paneH = cardsPane.clientHeight;
        var lineY = paneH * 0.42;
        var trackH = track.scrollHeight;
        geom = {
          lineY: lineY,
          start: lineY + 24,
          travel: trackH + 48,
          cardTops: cards.map(function (c) {
            return c.offsetTop + c.offsetHeight / 2;
          })
        };
      };

      var ticking = false;
      var apply = function () {
        ticking = false;
        if (!geom) measure();
        var vh = window.innerHeight;
        var rect = stage.getBoundingClientRect();
        var total = rect.height - vh;
        var p = total > 0 ? Math.min(1, Math.max(0, -rect.top / total)) : 1;
        var ty = geom.start - p * geom.travel;
        track.style.transform = 'translateY(' + ty + 'px)';
        cards.forEach(function (card, i) {
          var centre = ty + geom.cardTops[i];
          if (centre < geom.lineY) {
            if (!card.classList.contains('read')) {
              card.classList.add('read');
              var row = rows[i];
              if (row) land(row);
            }
          }
        });
      };

      var onScroll = function () {
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(apply);
        }
      };

      window.addEventListener('scroll', onScroll, { passive: true });
      window.addEventListener('resize', function () {
        geom = null;
        onScroll();
      });
      window.addEventListener('load', function () {
        geom = null;
        onScroll();
      });
      apply();
    } else if ('IntersectionObserver' in window) {
      arm();
      var ledger = stage.querySelector('.stage-ledger');
      var stageIO = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            stageIO.disconnect();
            rows.forEach(function (row, i) {
              setTimeout(function () {
                land(row);
              }, i * 90);
            });
          });
        },
        { threshold: 0.25 }
      );
      stageIO.observe(ledger);
    } else {
      // No way to watch the viewport: leave everything landed.
      stage.classList.remove('armed');
    }
  }

  /* ------------------------------------------------------- workflow line */

  var flowLine = doc.getElementById('flowLine');
  if (flowLine && 'IntersectionObserver' in window && !reducedMotion) {
    var flowIO = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            flowLine.classList.add('drawn');
            flowIO.disconnect();
          }
        });
      },
      { threshold: 0.4 }
    );
    flowIO.observe(flowLine.parentElement);
  } else if (flowLine) {
    flowLine.classList.add('drawn');
  }

  /* ------------------------------------------------------- filters demo */

  var filtersDemo = doc.getElementById('filtersDemo');
  var fCounter = doc.getElementById('fCounter');
  var fCounterLive = doc.getElementById('fCounterLive');

  if (filtersDemo && fCounter && !reducedMotion && 'IntersectionObserver' in window) {
    fCounter.textContent = '214';

    var tickCounter = function () {
      var from = 214;
      var to = 41;
      var duration = 600;
      var startTime = null;
      var step = function (now) {
        if (startTime === null) startTime = now;
        var t = Math.min(1, (now - startTime) / duration);
        var eased = 1 - Math.pow(1 - t, 3);
        fCounter.textContent = String(Math.round(from + (to - from) * eased));
        if (t < 1) {
          window.requestAnimationFrame(step);
        } else if (fCounterLive) {
          fCounterLive.textContent = 'Showing 41 of 214 collected · 12 unknown kept';
        }
      };
      window.requestAnimationFrame(step);
    };

    var filtersIO = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            filtersDemo.classList.add('in');
            tickCounter();
            filtersIO.disconnect();
          }
        });
      },
      { threshold: 0.35 }
    );
    filtersIO.observe(filtersDemo);
  } else if (filtersDemo) {
    filtersDemo.classList.add('in');
  }

  /* -------------------------------------------------------- radius plot */

  var plot = doc.getElementById('radiusPlot');
  if (plot) {
    var svg = plot.querySelector('svg');
    var dotsGroup = plot.querySelector('.plot-dots');
    var ring = plot.querySelector('.ring-circle');
    var ringLabel = plot.querySelector('.ring-label');
    var ringCount = doc.getElementById('ringCount');
    var R = 78;

    // A fixed scatter: no randomness at runtime, the same map every visit.
    var DOTS = [
      [150, 100], [185, 140], [120, 130], [170, 90], [140, 160], [200, 110],
      [110, 95], [160, 175], [215, 150], [40, 40], [70, 190], [280, 60],
      [260, 200], [30, 120], [90, 30], [250, 30], [300, 140], [60, 220],
      [230, 220], [290, 220], [20, 200], [120, 20], [200, 20], [300, 90]
    ];

    var svgNS = 'http://www.w3.org/2000/svg';
    var dotEls = DOTS.map(function (d) {
      var c = doc.createElementNS(svgNS, 'circle');
      c.setAttribute('cx', d[0]);
      c.setAttribute('cy', d[1]);
      c.setAttribute('r', 4);
      dotsGroup.appendChild(c);
      return c;
    });

    var setRing = function (cx, cy) {
      ring.setAttribute('cx', cx);
      ring.setAttribute('cy', cy);
      ringLabel.setAttribute('x', cx);
      ringLabel.setAttribute('y', Math.max(16, cy - R - 8));
      var inside = 0;
      dotEls.forEach(function (el, i) {
        var dx = DOTS[i][0] - cx;
        var dy = DOTS[i][1] - cy;
        var isIn = dx * dx + dy * dy <= R * R;
        el.classList.toggle('in', isIn);
        if (isIn) inside += 1;
      });
      if (ringCount) ringCount.textContent = String(inside);
    };

    setRing(160, 120);

    // The ring follows a fine pointer within the plot only; static on touch
    // and under reduced motion.
    if (window.matchMedia('(pointer: fine)').matches && !reducedMotion) {
      svg.addEventListener('pointermove', function (ev) {
        var rect = svg.getBoundingClientRect();
        var x = ((ev.clientX - rect.left) / rect.width) * 320;
        var y = ((ev.clientY - rect.top) / rect.height) * 240;
        setRing(Math.min(280, Math.max(40, x)), Math.min(200, Math.max(40, y)));
      });
      svg.addEventListener('pointerleave', function () {
        setRing(160, 120);
      });
    }
  }

  /* ---------------------------------------------------------- fail-loud */

  var breakBtn = doc.getElementById('breakBtn');
  var panelFac = doc.getElementById('panelFac');

  if (breakBtn && panelFac) {
    breakBtn.addEventListener('click', function () {
      var stopped = panelFac.getAttribute('data-state') !== 'stopped';
      var state = stopped ? 'stopped' : 'healthy';
      panelFac.setAttribute('data-state', state);
      breakBtn.setAttribute('aria-pressed', stopped ? 'true' : 'false');
      Array.prototype.forEach.call(panelFac.querySelectorAll('[data-healthy]'), function (el) {
        el.textContent = el.getAttribute(stopped ? 'data-stopped' : 'data-healthy');
      });
    });
  }

  /* ----------------------------------------------------------- popovers */

  var bom = doc.querySelector('.bom');
  var bomPop = doc.getElementById('pop-bom');

  if (bom && bomPop) {
    bom.addEventListener('click', function (ev) {
      ev.stopPropagation();
      var open = bomPop.hidden;
      bomPop.hidden = !open;
      bom.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    doc.addEventListener('click', function (ev) {
      if (!bomPop.hidden && ev.target !== bom) {
        bomPop.hidden = true;
        bom.setAttribute('aria-expanded', 'false');
      }
    });
    doc.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !bomPop.hidden) {
        bomPop.hidden = true;
        bom.setAttribute('aria-expanded', 'false');
      }
    });
    bomPop.hidden = true;
  }

  Array.prototype.forEach.call(doc.querySelectorAll('.fmark'), function (mark) {
    mark.addEventListener('click', function () {
      var target = doc.getElementById(mark.getAttribute('data-pop'));
      if (!target) return;
      var li = target.closest('li');
      Array.prototype.forEach.call(doc.querySelectorAll('.fnotes li.lit'), function (other) {
        if (other !== li) other.classList.remove('lit');
      });
      if (li) {
        li.classList.add('lit');
        li.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
      }
    });
  });

  /* -------------------------------------------------------- scroll fades */

  Array.prototype.forEach.call(doc.querySelectorAll('.scroll-x'), function (box) {
    var update = function () {
      var max = box.scrollWidth - box.clientWidth;
      box.classList.toggle('can-left', box.scrollLeft > 4);
      box.classList.toggle('can-right', box.scrollLeft < max - 4);
    };
    box.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    window.addEventListener('load', update);
    update();
  });

  /* ----------------------------------------------------------- waitlist
     Wired up during the TheOpenBox integration: set WAITLIST_ENDPOINT to
     the shared waitlist URL and the form POSTs {email} as JSON. Until
     then the form says, honestly, that it is not taking names. */

  var WAITLIST_ENDPOINT = '';

  Array.prototype.forEach.call(doc.querySelectorAll('[data-waitlist]'), function (form) {
    var msg = form.querySelector('.waitlist-msg');
    var input = form.querySelector('input[type="email"]');

    var say = function (text) {
      if (!msg) return;
      msg.textContent = text;
      msg.hidden = false;
    };

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (!input || !input.checkValidity()) {
        say('That does not look like an email address.');
        if (input) input.focus();
        return;
      }
      if (!WAITLIST_ENDPOINT) {
        say('Not taking names yet — sign-ups open when this page does.');
        return;
      }
      fetch(WAITLIST_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input.value, source: 'maps-lead-export' })
      })
        .then(function (res) {
          if (!res.ok) throw new Error('bad status');
          say('Done. One email, when it ships.');
          form.reset();
        })
        .catch(function () {
          say('That did not send. Try again in a moment.');
        });
    });
  });

  /* ------------------------------------------------------------ filename */

  var csvDate = doc.getElementById('csvDate');
  if (csvDate) {
    var now = new Date();
    var pad = function (v) {
      return v < 10 ? '0' + v : String(v);
    };
    csvDate.textContent = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  }
})();
