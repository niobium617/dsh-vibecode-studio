const LOGO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Crect width='40' height='40' fill='%233b82f6'/%3E%3C/svg%3E"

const bump = (name) => {
  window.__clicks = (window.__clicks ?? 0) + 1
  window.__lastClick = name
}

export default function App() {
  return (
    <main id="app-main" className="app" onClick={() => bump('app-main')}>
      <header id="page-header">
        <h1 id="title" onClick={() => bump('title')}>Vibe source · React</h1>
        <p id="intro">Thirty elements, one pick</p>
      </header>
      <a id="docs-link" href="#docs" onClick={() => bump('docs-link')}>Docs</a>
      <button id="primary-button" onClick={() => bump('primary-button')}>Primary</button>
      <button id="secondary-button" onClick={() => bump('secondary-button')}>Secondary</button>
      <form id="profile-form" onSubmit={(event) => { event.preventDefault(); bump('profile-form') }}>
        <label id="name-label" htmlFor="name">Name</label>
        <input id="name" name="name" placeholder="Ada" onClick={() => bump('name')} />
        <input id="email" name="email" type="email" placeholder="ada@example.com" onClick={() => bump('email')} />
        <textarea id="bio" name="bio" placeholder="Bio" onClick={() => bump('bio')} />
        <select id="role" name="role" onClick={() => bump('role')}>
          <option value="dev">Developer</option>
          <option value="design">Designer</option>
        </select>
        <fieldset id="plan-fieldset">
          <label><input id="plan-free" type="radio" name="plan" onClick={() => bump('plan-free')} /> Free</label>
          <label><input id="plan-pro" type="radio" name="plan" onClick={() => bump('plan-pro')} /> Pro</label>
        </fieldset>
        <label><input id="agree" type="checkbox" onClick={() => bump('agree')} /> Agree</label>
        <button id="submit" type="submit" onClick={() => bump('submit')}>Submit</button>
      </form>
      <ul id="items">
        <li id="item-1" onClick={() => bump('item-1')}>Alpha</li>
        <li id="item-2" onClick={() => bump('item-2')}>Beta</li>
        <li id="item-3" onClick={() => bump('item-3')}>Gamma</li>
      </ul>
      <table id="data-table">
        <thead>
          <tr><th id="head-cell">Name</th></tr>
        </thead>
        <tbody>
          <tr><td id="body-cell">Ada</td></tr>
        </tbody>
      </table>
      <img id="logo" alt="Logo" width="40" height="40" src={LOGO} onClick={() => bump('logo')} />
      <section id="details">
        <h2>Details</h2>
      </section>
      <article id="article">Article body</article>
      <aside id="notes">Notes</aside>
      <footer id="footer" onClick={() => bump('footer')}>Footer · react</footer>
    </main>
  )
}
