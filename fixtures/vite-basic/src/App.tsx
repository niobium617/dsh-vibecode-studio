import { useState, type FormEvent } from 'react'

interface Item {
  id: number
  name: string
  note: string
}

const seedItems: Item[] = [
  { id: 1, name: 'Alpha', note: '首屏标题对齐' },
  { id: 2, name: 'Beta', note: '按钮间距偏小' },
  { id: 3, name: 'Gamma', note: '列表空态缺失' },
]

export function App() {
  const [count, setCount] = useState(0)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [items, setItems] = useState<Item[]>(seedItems)
  const [network, setNetwork] = useState('')

  function addItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setItems((current) => [...current, { id: Date.now(), name: trimmed, note: note.trim() }])
    setName('')
    setNote('')
  }

  async function send(path: string, init?: RequestInit) {
    try {
      const response = await fetch(path, init)
      const body = await response.text()
      setNetwork(`${init?.method ?? 'GET'} ${path} → ${response.status} ${body}`)
    } catch (error) {
      setNetwork(`${path} → ${String(error)}`)
    }
  }

  return (
    <main>
      <header>
        <h1>Vibe Studio Fixture</h1>
        <p data-testid="tagline">Minimal React app for preview, input, inspect and network checks.</p>
      </header>

      <section aria-labelledby="counter-heading">
        <h2 id="counter-heading">Counter</h2>
        <button data-testid="counter" onClick={() => setCount((value) => value + 1)}>
          Count: {count}
        </button>
      </section>

      <section aria-labelledby="form-heading">
        <h2 id="form-heading">Annotation form</h2>
        <form onSubmit={addItem}>
          <label htmlFor="item-name">Name</label>
          <input id="item-name" value={name} onChange={(event) => setName(event.target.value)} />
          <label htmlFor="item-note">Note</label>
          <textarea
            id="item-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <button type="submit">Add item</button>
        </form>
        <ul data-testid="item-list">
          {items.map((item) => (
            <li key={item.id} data-item-name={item.name}>
              <strong>{item.name}</strong> — {item.note}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="network-heading">
        <h2 id="network-heading">Network</h2>
        <div className="row">
          <button
            data-testid="echo-request"
            onClick={() =>
              void send('/api/echo', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ hello: '世界' }),
              })
            }
          >
            POST /api/echo
          </button>
          <button data-testid="boom-request" onClick={() => void send('/api/boom')}>
            GET /api/boom
          </button>
          <button data-testid="console-error" onClick={() => console.error('fixture: intentional console error')}>
            Trigger console error
          </button>
        </div>
        <output data-testid="network-output">{network}</output>
      </section>
    </main>
  )
}
