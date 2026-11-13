/*
 * Testnizer deck runtime — inlined into every deck page.
 *
 * Without this script the slides are a plain scrolling column. With it:
 * one slide at a time on a 1920×1080 stage scaled to the window, #N in the URL
 * (1-based), keyboard / click / swipe navigation, and the EN/TR switch keeps
 * the slide you are on.
 */
(function () {
  var root = document.documentElement
  var stage = document.querySelector('.deck-stage')
  if (!stage) return
  var slides = Array.prototype.slice.call(stage.querySelectorAll('.slide'))
  var total = slides.length
  if (!total) return

  root.classList.add('js')

  var W = 1920
  var H = 1080
  var count = document.querySelector('[data-deck-count]')
  var prevBtn = document.querySelector('[data-deck-prev]')
  var nextBtn = document.querySelector('[data-deck-next]')
  var fsBtn = document.querySelector('[data-deck-fullscreen]')
  var progress = document.querySelector('.deck-progress')
  var controls = document.querySelector('.deck-controls')
  var langLinks = Array.prototype.slice.call(document.querySelectorAll('[data-deck-lang]'))
  var live = document.querySelector('[data-deck-live]')
  var current = 0

  function fit() {
    var vw = window.innerWidth
    var vh = window.innerHeight
    var k = Math.min(vw / W, vh / H)
    var tx = (vw - W * k) / 2
    var ty = (vh - H * k) / 2
    stage.style.setProperty('--k', String(k))
    stage.style.setProperty('--tx', tx + 'px')
    stage.style.setProperty('--ty', ty + 'px')
  }

  function fromHash() {
    var m = /^#(\d+)$/.exec(window.location.hash)
    if (!m) return 0
    var n = parseInt(m[1], 10)
    if (!(n >= 1)) return 0
    return Math.min(n, total) - 1
  }

  function show(i, opts) {
    i = Math.max(0, Math.min(total - 1, i))
    var changed = i !== current
    slides.forEach(function (s, idx) {
      var on = idx === i
      s.classList.toggle('is-active', on)
      s.setAttribute('aria-hidden', on ? 'false' : 'true')
      if ('inert' in s) s.inert = !on
    })
    current = i
    var n = i + 1
    if (count) count.textContent = n + ' / ' + total
    if (prevBtn) prevBtn.disabled = i === 0
    if (nextBtn) nextBtn.disabled = i === total - 1
    if (progress) progress.style.setProperty('--p', String(total > 1 ? i / (total - 1) : 1))
    langLinks.forEach(function (a) {
      var base = a.getAttribute('href').split('#')[0]
      a.setAttribute('href', base + '#' + n)
    })
    if (!opts || !opts.fromHash) {
      if (window.location.hash !== '#' + n) {
        try { history.replaceState(null, '', '#' + n) } catch (e) { window.location.hash = '#' + n }
      }
    }
    if (live && changed) live.textContent = slides[i].getAttribute('aria-label') || ''
  }

  function next() { show(current + 1) }
  function prev() { show(current - 1) }

  var hideTimer = 0
  function poke() {
    if (!controls) return
    controls.classList.add('is-visible')
    window.clearTimeout(hideTimer)
    hideTimer = window.setTimeout(function () { controls.classList.remove('is-visible') }, 2600)
  }

  function isInteractive(el) {
    return !!(el && el.closest && el.closest('a, button, input, select, textarea, label, summary, [data-no-advance]'))
  }

  document.addEventListener('keydown', function (e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return
    var t = e.target
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
    var k = e.key
    if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'PageDown' || (k === ' ' && !e.shiftKey)) {
      if (k === ' ' && isInteractive(t)) return
      e.preventDefault(); next(); poke()
    } else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || (k === ' ' && e.shiftKey)) {
      e.preventDefault(); prev(); poke()
    } else if (k === 'Home') {
      e.preventDefault(); show(0); poke()
    } else if (k === 'End') {
      e.preventDefault(); show(total - 1); poke()
    } else if (k === 'f' || k === 'F') {
      toggleFullscreen()
    }
  })

  // Click on the stage: the left quarter goes back, the rest goes forward.
  // Links and buttons inside a slide keep their own behaviour.
  stage.addEventListener('click', function (e) {
    if (isInteractive(e.target)) return
    var sel = window.getSelection && window.getSelection()
    if (sel && String(sel).length > 0) return
    if (e.clientX < window.innerWidth * 0.25) prev(); else next()
    poke()
  })

  var tx0 = null
  var ty0 = null
  stage.addEventListener('touchstart', function (e) {
    if (e.touches.length !== 1) { tx0 = null; return }
    tx0 = e.touches[0].clientX
    ty0 = e.touches[0].clientY
  }, { passive: true })
  stage.addEventListener('touchend', function (e) {
    if (tx0 === null) return
    var t = e.changedTouches[0]
    var dx = t.clientX - tx0
    var dy = t.clientY - ty0
    tx0 = null
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      if (dx < 0) next(); else prev()
      poke()
      // the synthetic click that follows a swipe must not advance again
      suppressClick = true
      window.setTimeout(function () { suppressClick = false }, 400)
    }
  }, { passive: true })
  var suppressClick = false
  stage.addEventListener('click', function (e) {
    if (suppressClick) { e.stopImmediatePropagation(); e.preventDefault() }
  }, true)

  if (prevBtn) prevBtn.addEventListener('click', function () { prev(); poke() })
  if (nextBtn) nextBtn.addEventListener('click', function () { next(); poke() })

  function toggleFullscreen() {
    var d = document
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) {
        (d.exitFullscreen || d.webkitExitFullscreen).call(d)
      } else {
        var el = d.documentElement
        ;(el.requestFullscreen || el.webkitRequestFullscreen).call(el)
      }
    } catch (e) { /* fullscreen not allowed here */ }
  }
  if (fsBtn) {
    if (!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen)) {
      fsBtn.hidden = true
    } else {
      fsBtn.addEventListener('click', toggleFullscreen)
    }
  }

  window.addEventListener('hashchange', function () { show(fromHash(), { fromHash: true }) })
  window.addEventListener('resize', fit)
  document.addEventListener('mousemove', poke, { passive: true })

  fit()
  current = -1
  show(fromHash())
  poke()
})()
