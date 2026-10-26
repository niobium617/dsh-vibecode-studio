const bump = (name) => {
  window.__clicks = (window.__clicks ?? 0) + 1
  window.__lastClick = name
}

export default function App() {
  return (
    <main className="app">
      <h1 id="title" onClick={() => bump('title')}>Vibe S4 · React</h1>
      <form id="form" onSubmit={(event) => { event.preventDefault(); bump('form') }}>
        <label htmlFor="name">Name</label>
        <input id="name" name="name" placeholder="Ada" onClick={() => bump('name')} />
        <textarea id="bio" name="bio" placeholder="Bio" onClick={() => bump('bio')} />
        <select id="role" name="role" onClick={() => bump('role')}>
          <option value="dev">Developer</option>
          <option value="design">Designer</option>
        </select>
        <label className="row"><input id="agree" type="checkbox" onClick={() => bump('agree')} /> Agree</label>
        <button id="submit" type="submit" onClick={() => bump('submit')}>Submit</button>
      </form>
      <ul id="items">
        <li id="item-1" onClick={() => bump('item-1')}>Alpha</li>
        <li id="item-2" onClick={() => bump('item-2')}>Beta</li>
        <li id="item-3" onClick={() => bump('item-3')}>Gamma</li>
      </ul>
      <p id="footer" onClick={() => bump('footer')}>Footer · react</p>
    </main>
  )
}
