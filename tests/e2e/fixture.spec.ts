import { expect, test } from '@playwright/test'

test.describe('vite-basic fixture', () => {
  test('renders the shell and drives the counter', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })

    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Vibe Studio Fixture' })).toBeVisible()
    await expect(page.getByTestId('counter')).toHaveText('Count: 0')
    await page.getByTestId('counter').click()
    await expect(page.getByTestId('counter')).toHaveText('Count: 1')
    expect(errors).toEqual([])
  })

  test('adds a Chinese annotation to the list', async ({ page }) => {
    await page.goto('/')

    await page.getByLabel('Name').fill('Ada')
    await page.getByLabel('Note').fill('按钮点击后没有反馈')
    await page.getByRole('button', { name: 'Add item' }).click()

    const item = page.locator('[data-item-name="Ada"]')
    await expect(item).toHaveText('Ada — 按钮点击后没有反馈')
    await expect(page.getByLabel('Name')).toHaveValue('')
  })

  test('serves fixture API endpoints', async ({ request }) => {
    const echo = await request.post('/api/echo', { data: { hello: '世界' } })
    expect(echo.status()).toBe(200)
    expect(await echo.json()).toMatchObject({
      method: 'POST',
      contentType: 'application/json',
    })

    const boom = await request.get('/api/boom')
    expect(boom.status()).toBe(500)
    expect(await boom.json()).toEqual({ error: 'fixture boom' })
  })
})
