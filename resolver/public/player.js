const $ = (id) => document.getElementById(id)

const form = $('form')
const urlIn = $('embed')
const panel = $('out')
const heading = $('title')
const vid = $('vid')
const extensionPlayer = $('extension-player')
const extensionControls = $('extension-controls')
const extensionPlay = $('extension-play')
const extensionInstall = $('extension-install')
const err = $('err')
const btn = form.querySelector('button')
const rawOut = $('direct')
const relayOut = $('proxy')
const vlcOut = $('vlc')
const mpvOut = $('mpv')
const timing = $('timing')
const tResolve = $('t-resolve')
const tPlay = $('t-play')
const tTotal = $('t-total')

let hls = null
let timer = null
let videoPlayerExtension = null
const hlsReady = import('https://cdn.jsdelivr.net/npm/hls.js@1.5.20/+esm')

async function initializeVideoPlayerExtension() {
  if (!navigator.userAgent.includes('Firefox')) return
  if (!globalThis.VideoPlayer) return

  try {
    videoPlayerExtension = await globalThis.VideoPlayer.init()
    if (videoPlayerExtension.isInstalled()) {
      extensionControls.hidden = false
      extensionPlay.hidden = false
      return
    }
    extensionControls.hidden = false
    extensionPlay.hidden = true
    extensionInstall.hidden = false
  } catch (error) {
    console.warn('VideoPlayer extension integration unavailable', error)
  }
}

function fmtMs(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

function stopTimer() {
  if (timer) {
    cancelAnimationFrame(timer.raf)
    timer = null
  }
}

function startTimer() {
  stopTimer()
  timing.hidden = false
  tResolve.textContent = '0ms'
  tPlay.textContent = 'waiting'
  tTotal.textContent = '0ms'
  tResolve.className = 'timing__val is-live'
  tPlay.className = 'timing__val'
  tTotal.className = 'timing__val is-live'

  const t0 = performance.now()
  let resolveAt = null
  let playAt = null

  const tick = () => {
    const now = performance.now()
    if (resolveAt == null) tResolve.textContent = fmtMs(now - t0)
    if (resolveAt != null && playAt == null) {
      tPlay.textContent = fmtMs(now - resolveAt)
      tPlay.className = 'timing__val is-live'
    }
    if (playAt == null) tTotal.textContent = fmtMs(now - t0)
    if (playAt == null) timer.raf = requestAnimationFrame(tick)
  }

  timer = {
    raf: requestAnimationFrame(tick),
    markResolve() {
      if (resolveAt != null) return
      resolveAt = performance.now()
      tResolve.textContent = fmtMs(resolveAt - t0)
      tResolve.className = 'timing__val is-done'
      tPlay.textContent = '0ms'
      tPlay.className = 'timing__val is-live'
    },
    markPlay() {
      if (playAt != null) return
      playAt = performance.now()
      if (resolveAt == null) this.markResolve()
      tPlay.textContent = fmtMs(playAt - resolveAt)
      tPlay.className = 'timing__val is-done'
      tTotal.textContent = fmtMs(playAt - t0)
      tTotal.className = 'timing__val is-done'
      stopTimer()
    },
  }
  return timer
}

function vlcCmd(url) {
  return `vlc "${url}"`
}

function mpvCmd(url, name) {
  return `mpv --force-media-title="${name.replace(/"/g, '\\"')}" "${url}"`
}

function hlsErr(data) {
  if (data.details) return data.details
  const code = data.response?.code
  if (code && (code < 200 || code >= 300)) return `HTTP ${code}`
  return data.type || 'playback error'
}

function stop() {
  if (hls) {
    hls.destroy()
    hls = null
  }
}

function showBrowserPlayer() {
  extensionPlayer.hidden = true
  extensionPlayer.removeAttribute('src')
  vid.hidden = false
}

function extensionUrl(mediaUrl, title) {
  if (!videoPlayerExtension?.isInstalled()) {
    throw new Error('VideoPlayer extension is not installed')
  }

  const playerUrl = new URL(videoPlayerExtension.getDirectPlayer())
  const media = new URL(mediaUrl)
  media.searchParams.set('title', title)
  playerUrl.hash = media.href
  return playerUrl.href
}

function playWithVideoPlayerExtension(mediaUrl, title) {
  stop()
  vid.pause()
  const playerUrl = extensionUrl(mediaUrl, title)
  extensionPlayer.src = playerUrl
  vid.hidden = true
  extensionPlayer.hidden = false
}

async function play(relay, clock) {
  stop()
  showBrowserPlayer()
  const { default: Hls } = await hlsReady
  if (!Hls.isSupported()) throw new Error('HLS playback is not supported in this browser. Use VLC or MPV.')
  hls = new Hls()
  hls.loadSource(relay)
  hls.attachMedia(vid)
  await new Promise((resolve, reject) => {
    hls.on(Hls.Events.FRAG_BUFFERED, () => vid.play().catch(() => {}), { once: true })
    vid.addEventListener(
      'playing',
      () => {
        clock?.markPlay()
        resolve()
      },
      { once: true },
    )
    hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return
      reject(new Error(hlsErr(data)))
    })
  })
}

extensionPlay.addEventListener('click', () => {
  err.hidden = true
  try {
    playWithVideoPlayerExtension(relayOut.value, heading.textContent)
  } catch (error) {
    err.textContent = error.message
    err.hidden = false
  }
})

initializeVideoPlayerExtension()

document.querySelectorAll('[data-copy]').forEach((node) => {
  node.addEventListener('click', async () => {
    const field = $(node.dataset.copy)
    await navigator.clipboard.writeText(field.value)
    const label = node.textContent
    node.textContent = 'Copied'
    node.classList.add('ok')
    setTimeout(() => {
      node.textContent = label
      node.classList.remove('ok')
    }, 1200)
  })
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  btn.disabled = true
  err.hidden = true
  panel.hidden = true
  stop()
  showBrowserPlayer()
  const clock = startTimer()
  try {
    const res = await fetch('/api/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urlIn.value.trim() }),
    })
    const data = await res.json()
    if (!data.ok) throw new Error(`${data.stage || 'error'}: ${data.error || 'resolve failed'}`)
    if (!data.m3u8) throw new Error('missing stream URL in response')

    clock.markResolve()
    const name = data.slug.replace(/-/g, ' ')
    heading.textContent = `${name} · ${data.source} · stream ${data.stream}`
    panel.hidden = false
    rawOut.value = data.m3u8
    relayOut.value = data.m3u8
    vlcOut.value = vlcCmd(data.m3u8)
    mpvOut.value = mpvCmd(data.m3u8, name)
    await play(data.m3u8, clock)
  } catch (e) {
    stopTimer()
    timing.hidden = true
    err.textContent = e.message
    err.hidden = false
  } finally {
    btn.disabled = false
  }
})
