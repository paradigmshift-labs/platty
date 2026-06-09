import { describe, expect, it } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

const adapter = new TypeScriptParserAdapter()

function parse(content: string) {
  return adapter.parseFile(content, 'src/page.tsx', 'r1')
}

describe('TypeScript JSX static target extraction', () => {
  it('records Next Link href wrapper first argument as a render target', () => {
    const result = parse(`
      import Link from 'next/link'
      import { preserveQueryParams } from './query'
      import { ROUTES } from './routes'

      export function Page() {
        return <Link href={preserveQueryParams(ROUTES.orders)}>Orders</Link>
      }
    `)

    const edge = result.edges.find((e) => e.relation === 'renders' && e.target_symbol === 'Link')
    expect(edge).toMatchObject({
      target_specifier: 'next/link',
      first_arg: 'ROUTES.orders',
      literal_args: JSON.stringify([{ href: null }]),
    })
  })

  it('records semantic lowercase anchor href constants for external link relations', () => {
    const result = parse(`
      import { EXTERNAL_LINKS } from './links'

      export function Footer() {
        return <a href={EXTERNAL_LINKS.support}>Support</a>
      }
    `)

    const edge = result.edges.find((e) => e.relation === 'renders' && e.target_symbol === 'a')
    expect(edge).toMatchObject({
      first_arg: 'EXTERNAL_LINKS.support',
      literal_args: JSON.stringify([{ href: null }]),
    })
  })

  it('still ignores non-semantic lowercase layout elements', () => {
    const result = parse(`
      export function Card() {
        return <div data-id="x">Card</div>
      }
    `)

    expect(result.edges.some((e) => e.relation === 'renders' && e.target_symbol === 'div')).toBe(false)
  })

  it('records window.location.href assignment as a browser navigation edge', () => {
    const result = parse(`
      export function Home() {
        window.location.href = 'https://seller.example.com'
      }
    `)

    const edge = result.edges.find((e) => e.relation === 'calls' && e.target_symbol === 'assign')
    expect(edge).toMatchObject({
      chain_path: 'window.location',
      first_arg: 'https://seller.example.com',
      literal_args: JSON.stringify(['https://seller.example.com']),
    })
  })
})
