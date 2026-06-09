// P5: class field initializer RHS walk
// `private readonly prisma = SGlobal.prismaPrimary` 패턴
// 1) RHS의 chain reference가 graph에 발화 (property 노드 source)
// 2) method body의 `this.prisma.x.y()` chain root → property 노드로 매핑
import { describe, it, expect } from 'vitest'
import { TypeScriptParserAdapter } from '@/pipeline_modules/build_graph/adapters/typescript.js'

function parse(content: string, filePath = 'src/x.ts') {
  const adapter = new TypeScriptParserAdapter()
  return adapter.parseFile(content, filePath, 'r1')
}

describe('P5: class field initializer RHS walk', () => {
  it('FI-01: `private readonly prisma = SGlobal.prismaPrimary` — RHS calls edge가 property 노드 source로 발화', () => {
    const r = parse(`
      import { SGlobal } from './SGlobal'
      export class Usecase {
        private readonly prisma = SGlobal.prismaPrimary
      }
    `)
    // property 노드 발화 (기존 동작)
    const propNode = r.nodes.find((n) => n.type === 'property' && n.name === 'Usecase.prisma')
    expect(propNode, 'property 노드 발화').toBeDefined()

    // RHS member chain — property 노드 source의 calls edge
    // (member_expression `SGlobal.prismaPrimary` — chain 또는 property access로 발화)
    const rhsEdge = r.edges.find(
      (e) =>
        e.source_id.endsWith(':Usecase.prisma') &&
        (e.target_symbol === 'SGlobal' || e.target_symbol === 'prismaPrimary'),
    )
    expect(rhsEdge, 'field initializer RHS reference가 graph에 발화').toBeDefined()
  })

  it('FI-02: 어댑터가 (className, fieldName, rhsRoot) 매핑 정보를 노출', () => {
    const r = parse(`
      import { SGlobal } from './SGlobal'
      export class Usecase {
        private readonly prisma = SGlobal.prismaPrimary
        private readonly kysely = SGlobal.kysely
      }
    `)
    // 어댑터 결과에 fieldInitializers 또는 동등 정보 있는지
    // (세부 형식은 어댑터 spec 결정 — 우선 RHS edge 발화만 검증)
    const propPrisma = r.nodes.find((n) => n.name === 'Usecase.prisma')
    const propKysely = r.nodes.find((n) => n.name === 'Usecase.kysely')
    expect(propPrisma).toBeDefined()
    expect(propKysely).toBeDefined()

    // 두 property 모두 RHS edge 발화
    const prismaRhs = r.edges.find((e) => e.source_id.endsWith(':Usecase.prisma'))
    const kyselyRhs = r.edges.find((e) => e.source_id.endsWith(':Usecase.kysely'))
    expect(prismaRhs, 'prisma field RHS edge').toBeDefined()
    expect(kyselyRhs, 'kysely field RHS edge').toBeDefined()
  })
})
