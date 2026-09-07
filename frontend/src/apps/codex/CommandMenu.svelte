<script>
  import { onMount, tick } from 'svelte'
  import { commands as defaultCommands, commandSelection } from './commands.js'
  export let onselect = () => {}
  export let oncancel = () => {}
  export let error = ''
  export let commands = defaultCommands
  export let label = 'Codex'
  let selected = 0, dialog, list
  async function focusSelection() {
    await tick()
    const button = list?.querySelectorAll('button')[selected]
    button?.focus({ preventScroll: true })
    button?.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }
  export function control(action) {
    if (action === 'back') oncancel()
    else if (action === 'confirm') onselect(commands[selected])
    else {
      const next = commandSelection(selected, action, commands)
      if (next !== selected) { selected = next; focusSelection() }
    }
    return true
  }
  export function handleKeydown(event) {
    const action = { ArrowUp: 'up', ArrowDown: 'down', Escape: 'back', Enter: 'confirm', ' ': 'confirm' }[event.key]
    if (action) {
      event.preventDefault()
      if (!event.repeat || ['up', 'down'].includes(action)) {
        if (action === 'confirm' && event.target?.dataset.cancel !== undefined) oncancel()
        else control(action)
      }
    } else if (event.key === 'Tab') {
      event.preventDefault()
      const buttons = [list?.querySelectorAll('button')[selected], dialog?.querySelector('[data-cancel]')].filter(Boolean)
      const index = buttons.indexOf(document.activeElement)
      buttons[(index + 1) % buttons.length]?.focus({ preventScroll: true })
    }
    return true
  }
  onMount(() => { focusSelection() })
</script>

<div class="command-backdrop">
  <div bind:this={dialog} class="command-menu" role="dialog" aria-modal="true" aria-labelledby="command-title" aria-describedby="command-hint" tabindex="-1">
    <header><p>{label}</p><h2 id="command-title">Quick commands</h2></header>
    <div bind:this={list} class="command-list" role="toolbar" aria-label={`${label} slash commands`} aria-orientation="vertical">
      {#each commands as entry, index (entry.command)}
        <button class:selected={selected === index} tabindex={selected === index ? 0 : -1} onfocus={() => { selected = index }} onclick={() => onselect(entry)}>
          <span><strong>{entry.title}</strong><small>{entry.detail}</small></span><code>{entry.action === 'clear-input' ? '←' : entry.command}</code>
        </button>
      {/each}
    </div>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <footer><p id="command-hint">↑ ↓ Choose · × / A Select</p><button data-cancel onclick={oncancel}>○ Cancel <kbd>esc</kbd></button></footer>
  </div>
</div>

<style>
  .command-backdrop { position: absolute; inset: 0; z-index: 5; background: #06100fce; display: grid; place-items: center; padding: 16px; }
  .command-menu { width: min(560px, 100%); max-height: 100%; min-height: 0; display: flex; flex-direction: column; padding: 20px; background: #17312b; border: 1px solid #bde6cd45; border-radius: 20px; box-shadow: 0 18px 60px #0006; animation: arrive .16s ease-out; }
  header p { margin: 0 0 6px; color: #adcdbb; font-size: 11px; text-transform: uppercase; letter-spacing: .15em; }
  h2 { margin: 0 0 18px; font-size: 26px; font-weight: 500; }
  .command-list { display: flex; flex-direction: column; gap: 6px; overflow: auto; min-height: 0; padding: 4px; }
  button { border: 1px solid #ffffff20; border-radius: 10px; padding: 12px; background: #ffffff05; }
  .command-list button { display: flex; align-items: center; justify-content: space-between; gap: 14px; text-align: left; }
  .command-list button.selected { background: #c7efdc17; border-color: #c7efdc80; }
  button:focus-visible { outline: 2px solid #c7efdc; outline-offset: 1px; }
  strong, small { display: block; }
  strong { font-size: 14px; font-weight: 500; }
  small { font-size: 11px; color: #abc9bc; line-height: 1.5; margin-top: 4px; }
  code { font-size: 12px; color: #c6efd4; }
  footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 14px; font-size: 11px; }
  footer p { margin: 0; color: #abc9bc; }
  footer button { white-space: nowrap; font-size: 11px; }
  .error { color: #ffccc3; font-size: 12px; line-height: 1.5; }
  @keyframes arrive { from { opacity: 0; transform: translate3d(0, 12px, 0); } to { opacity: 1; transform: translate3d(0, 0, 0); } }
  @media (prefers-reduced-motion: reduce) { .command-menu { animation: none; } }
</style>
