<script>
  import { onMount } from 'svelte'
  export let stream = null
  let canvas
  onMount(() => {
    const ctx = canvas.getContext('2d')
    let audio, analyser, source, frame
    if (stream) {
      const Context = window.AudioContext || window.webkitAudioContext
      if (Context) {
        try {
        audio = new Context()
        analyser = audio.createAnalyser()
        analyser.fftSize = 2048
        source = audio.createMediaStreamSource(stream)
        source.connect(analyser)
        audio.resume().catch(() => {})
        } catch { analyser = undefined }
      }
    }
    const samples = new Uint8Array(2048)
    function draw() {
      const width = canvas.clientWidth, height = canvas.clientHeight, scale = window.devicePixelRatio || 1
      if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) { canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale) }
      ctx.setTransform(scale, 0, 0, scale, 0, 0)
      ctx.clearRect(0, 0, width, height)
      if (analyser) analyser.getByteTimeDomainData(samples)
      const count = 64, gap = width / count
      ctx.fillStyle = stream ? '#b8f0d1' : '#536d65'
      for (let i = 0; i < count; i++) {
        let peak = 0
        if (analyser) for (let j = i * 32; j < (i + 1) * 32; j++) peak = Math.max(peak, Math.abs(samples[j] - 128) / 128)
        const size = Math.max(3, Math.min(height - 8, peak * height * 2.5))
        ctx.beginPath()
        ctx.roundRect(i * gap + 1, (height - size) / 2, Math.max(2, gap - 4), size, 3)
        ctx.fill()
      }
      frame = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(frame); source?.disconnect(); if (audio) audio.close().catch(() => {}) }
  })
</script>
<canvas bind:this={canvas} aria-hidden="true"></canvas>
<style>canvas { display: block; width: 100%; height: 110px; }</style>
