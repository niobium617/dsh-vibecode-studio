<script>
  const LOGO =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='%233b82f6'/%3E%3C/svg%3E"

  const bump = (name) => {
    window.__clicks = (window.__clicks ?? 0) + 1
    window.__lastClick = name
  }
</script>

<main id="app-main" class="app" onclick={() => bump('app-main')}>
  <header id="page-header">
    <h1 id="title" onclick={() => bump('title')}>Vibe source · Svelte</h1>
    <p id="intro">Thirty elements, one pick</p>
  </header>
  <a id="docs-link" href="#docs" onclick={() => bump('docs-link')}>Docs</a>
  <button id="primary-button" onclick={() => bump('primary-button')}>Primary</button>
  <button id="secondary-button" onclick={() => bump('secondary-button')}>Secondary</button>
  <form id="profile-form" onsubmit={(event) => { event.preventDefault(); bump('profile-form') }}>
    <label id="name-label" for="name">Name</label>
    <input id="name" name="name" placeholder="Ada" onclick={() => bump('name')} />
    <input id="email" name="email" type="email" placeholder="ada@example.com" onclick={() => bump('email')} />
    <textarea id="bio" name="bio" placeholder="Bio" onclick={() => bump('bio')}></textarea>
    <select id="role" name="role" onclick={() => bump('role')}>
      <option value="dev">Developer</option>
      <option value="design">Designer</option>
    </select>
    <fieldset id="plan-fieldset">
      <label><input id="plan-free" type="radio" name="plan" onclick={() => bump('plan-free')} /> Free</label>
      <label><input id="plan-pro" type="radio" name="plan" onclick={() => bump('plan-pro')} /> Pro</label>
    </fieldset>
    <label><input id="agree" type="checkbox" onclick={() => bump('agree')} /> Agree</label>
    <button id="submit" type="submit" onclick={() => bump('submit')}>Submit</button>
  </form>
  <ul id="items">
    <li id="item-1" onclick={() => bump('item-1')}>Alpha</li>
    <li id="item-2" onclick={() => bump('item-2')}>Beta</li>
    <li id="item-3" onclick={() => bump('item-3')}>Gamma</li>
  </ul>
  <table id="data-table">
    <thead>
      <tr><th id="head-cell">Name</th></tr>
    </thead>
    <tbody>
      <tr><td id="body-cell">Ada</td></tr>
    </tbody>
  </table>
  <img id="logo" alt="Logo" width="40" height="40" src={LOGO} onclick={() => bump('logo')} />
  <section id="details">
    <h2>Details</h2>
  </section>
  <article id="article">Article body</article>
  <aside id="notes">Notes</aside>
  <footer id="footer" onclick={() => bump('footer')}>Footer · svelte</footer>
</main>
