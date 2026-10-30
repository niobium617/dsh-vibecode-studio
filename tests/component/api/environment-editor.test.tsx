/**
 * T036 environment panel: the view shows plain values, secrets only as
 * configured / not configured, and unresolved placeholders with the exact
 * field that still needs one.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { EnvironmentEditor } from '../../../src/client/api/EnvironmentEditor'
import type { ApiEnvironmentView } from '../../../src/contracts/api'

const VIEW: ApiEnvironmentView = {
  name: 'Local',
  variables: [
    { name: 'baseUrl', secret: false, enabled: true, value: 'http://127.0.0.1:8080' },
    {
      name: 'token',
      secret: true,
      enabled: true,
      configured: true,
      writable: true,
      source: 'file',
    },
    {
      name: 'tenant',
      secret: true,
      enabled: false,
      configured: false,
      writable: false,
    },
  ],
}

afterEach(() => {
  cleanup()
})

describe('EnvironmentEditor', () => {
  it('lists plain values and secret states without any secret value', () => {
    const { container } = render(<EnvironmentEditor view={VIEW} />)

    expect(screen.getByText('Local')).toBeTruthy()
    expect(screen.getByText('{{baseUrl}}')).toBeTruthy()
    expect(screen.getByText('http://127.0.0.1:8080')).toBeTruthy()
    expect(screen.getByText('Configured')).toBeTruthy()
    expect(screen.getByText('from file')).toBeTruthy()
    expect(screen.getByText('Not configured')).toBeTruthy()
    expect(screen.getByText('· Disabled')).toBeTruthy()

    const secretRow = container.querySelector('[data-vibe-env-name="token"]')
    expect(secretRow?.getAttribute('data-vibe-env-secret')).toBe('1')
    expect(secretRow?.textContent).not.toContain('s3cret')
  })

  it('shows unresolved placeholders with their field and reason', () => {
    const { container } = render(
      <EnvironmentEditor
        view={VIEW}
        unresolved={[
          { name: 'token', where: 'headers[0].value', reason: 'secret_not_configured' },
          { name: 'host', where: 'url', reason: 'missing' },
          { name: 'tenant', where: 'query[0].value', reason: 'disabled' },
        ]}
      />,
    )

    const box = container.querySelector('[data-vibe-env-unresolved-list="1"]')
    expect(box?.textContent).toContain('Unresolved variables')
    expect(box?.textContent).toContain('token in headers[0].value')
    expect(box?.textContent).toContain('secret not configured')
    expect(box?.textContent).toContain('host in url')
    expect(box?.textContent).toContain('not defined')
    expect(box?.textContent).toContain('tenant in query[0].value')
    expect(box?.textContent).toContain('disabled')

    expect(container.querySelectorAll('[data-vibe-env-unresolved="1"]').length).toBe(2)
  })

  it('renders the empty state and the zh-CN catalog', () => {
    const { container, rerender } = render(
      <EnvironmentEditor view={{ variables: [] }} locale="zh-CN" />,
    )
    expect(container.querySelector('[data-vibe-state="empty"]')).toBeTruthy()
    expect(screen.getByText('没有变量')).toBeTruthy()
    expect(screen.getByText('只读')).toBeTruthy()

    rerender(<EnvironmentEditor view={VIEW} locale="zh-CN" />)
    expect(screen.getByText('已配置')).toBeTruthy()
    expect(screen.getByText('来源 file')).toBeTruthy()
    expect(screen.getByText('未配置')).toBeTruthy()
  })
})
