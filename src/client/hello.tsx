/**
 * T007 hello panel: proves the client bundle loads and React/JSX/hooks work
 * inside the DSH right sidebar. T010 replaces it with the Studio shell.
 */
import * as React from 'react'

export function Hello(): React.ReactElement {
  const [count, setCount] = React.useState(0)

  return (
    <div
      data-vibe-hello="1"
      style={{ padding: 12, font: '13px/1.5 system-ui, sans-serif', display: 'grid', gap: 8 }}
    >
      <strong>Hello from Vibe Studio</strong>
      <div>Client bundle loaded. React and JSX are working.</div>
      <button type="button" onClick={() => setCount((value) => value + 1)}>
        Clicked {count} {count === 1 ? 'time' : 'times'}
      </button>
    </div>
  )
}
