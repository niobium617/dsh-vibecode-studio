<script>
  const bump = (name) => {
    window.__clicks = (window.__clicks ?? 0) + 1
    window.__lastClick = name
  }
</script>

<main class="app">
  <h1 id="title" onclick={() => bump('title')}>Vibe S4 · Svelte</h1>
  <form id="form" onsubmit={(event) => { event.preventDefault(); bump('form') }}>
    <label for="name">Name</label>
    <input id="name" placeholder="Ada" onclick={() => bump('name')} />
    <textarea id="bio" placeholder="Bio" onclick={() => bump('bio')}></textarea>
    <select id="role" onclick={() => bump('role')}>
      <option value="dev">Developer</option>
      <option value="design">Designer</option>
    </select>
    <label class="row"><input id="agree" type="checkbox" onclick={() => bump('agree')} /> Agree</label>
    <button id="submit" type="submit" onclick={() => bump('submit')}>Submit</button>
  </form>
  <ul id="items">
    <li id="item-1" onclick={() => bump('item-1')}>Alpha</li>
    <li id="item-2" onclick={() => bump('item-2')}>Beta</li>
    <li id="item-3" onclick={() => bump('item-3')}>Gamma</li>
  </ul>
  <p id="footer" onclick={() => bump('footer')}>Footer · svelte</p>
</main>
