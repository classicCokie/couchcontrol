<script>
  export let type
</script>

<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if type === 'agent'}
    <path d="M12 2v20M2 12h20M5 5l14 14M5 19 19 5" />
  {:else if type === 'mail'}
    <rect x="3" y="5" width="18" height="14" rx="3" /><path d="m4 7 8 6 8-6" />
  {:else if type === 'chatbot'}
    <path d="M7 19 3 22V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3Z" /><path d="M7 8h10M7 12h6" />
  {:else if type === 'browser'}
    <circle cx="12" cy="12" r="9" /><ellipse cx="12" cy="12" rx="4" ry="9" /><path d="M3 12h18" />
  {:else if type === 'write'}
    <path d="m14 5 5 5M4 20l5-1L21 7a2 2 0 0 0 0-3l-1-1a2 2 0 0 0-3 0L5 15Z" /><path d="M13 21h8" />
  {:else if type === 'codex'}
    <rect x="2" y="3" width="20" height="18" rx="4" /><path d="m6 8 4 4-4 4m7 0h5" />
  {:else if type === 'settings'}
    <path d="m9 3-.5 3-2 1-2.8-1-2 3.5L4 11v2l-2.3 1.5 2 3.5 2.8-1 2 1 .5 3h6l.5-3 2-1 2.8 1 2-3.5L20 13v-2l2.3-1.5-2-3.5-2.8 1-2-1-.5-3Z" /><circle cx="12" cy="12" r="3" />
  {/if}
</svg>
