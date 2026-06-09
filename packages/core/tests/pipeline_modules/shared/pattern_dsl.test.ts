import { describe, expect, it } from 'vitest'
import {
  classifyDslLegacyFacts,
  extractLiteralArgValue,
  matchPatternDslRules,
} from '@/pipeline_modules/shared/static_config/pattern_dsl.js'
import { defaultStaticAnalysisPatternProfile } from '@/pipeline_modules/shared/static_config/default_rules.js'
import type { CodeEdgeLike } from '@/pipeline_modules/build_relations/types.js'
import type { StaticAnalysisPatternRule } from '@/pipeline_modules/shared/static_config/types.js'
import type { CodeNodeLike } from '@/pipeline_modules/build_relations/types.js'

const baseEdge: CodeEdgeLike = {
  id: 1,
  repoId: 'r1',
  sourceId: 'r1:src/file.ts:handler',
  targetId: null,
  relation: 'calls',
  targetSpecifier: null,
  targetSymbol: null,
  typeRefSubtype: null,
  chainPath: null,
  firstArg: null,
  literalArgs: null,
  argExpressions: null,
  resolveStatus: 'resolved',
  confidence: null,
  source: 'static',
}

function edge(partial: Partial<CodeEdgeLike>): CodeEdgeLike {
  return { ...baseEdge, ...partial }
}

function node(id: string, filePath = 'src/file.ts'): CodeNodeLike {
  return {
    id,
    repoId: 'r1',
    type: 'function',
    name: id.split(':').pop() ?? id,
    filePath,
    lineStart: 1,
    lineEnd: 5,
    isTest: false,
    parseStatus: 'ok',
  }
}

describe('pattern DSL matcher', () => {
  it('matches call rules against graph evidence without source regex', () => {
    const rules: StaticAnalysisPatternRule[] = [{
      id: 'db.prisma.direct',
      state: 'active',
      source: 'default',
      target: 'relation.db_access',
      match: {
        relation: 'calls',
        targetSymbolIn: ['findMany', 'findFirst'],
        chainPathPattern: '{client}.{model}',
      },
      emit: {
        targetFrom: 'chainPathSegment:model',
        operationFrom: 'targetSymbol',
      },
    }]

    const facts = matchPatternDslRules({
      rules,
      edges: [edge({ targetSymbol: 'findMany', chainPath: 'prisma.user' })],
    })

    expect(facts).toEqual([expect.objectContaining({
      ruleId: 'db.prisma.direct',
      target: 'user',
      operation: 'findMany',
      evidenceEdgeIds: [1],
    })])
  })

  it('matches JSX wrapper props through literalArgs evidence', () => {
    const rules: StaticAnalysisPatternRule[] = [{
      id: 'route.jsx.wrapper',
      state: 'active',
      source: 'user',
      target: 'route.entrypoint',
      match: {
        relation: 'renders',
        targetSymbolIn: ['AppRoute'],
      },
      emit: {
        targetFrom: 'literalArg:path',
        operationValue: 'GET',
      },
    }]

    const facts = matchPatternDslRules({
      rules,
      edges: [edge({
        relation: 'renders',
        targetSymbol: 'AppRoute',
        literalArgs: '[{"path":"/admin/users","page":null}]',
      })],
    })

    expect(facts[0]).toMatchObject({
      target: '/admin/users',
      operation: 'GET',
      factKind: 'route.entrypoint',
    })
  })

  it('matches repository factory wrappers using call-expression chain text', () => {
    const rules: StaticAnalysisPatternRule[] = [{
      id: 'db.repository.factory',
      state: 'active',
      source: 'user',
      target: 'relation.db_access',
      match: {
        relation: 'calls',
        targetSymbolIn: ['find', 'findMany'],
        chainPathPattern: 'prismaRepository({model})',
      },
      emit: {
        targetFrom: 'chainPathCallArg:model',
        operationFrom: 'targetSymbol',
      },
    }]

    const facts = matchPatternDslRules({
      rules,
      edges: [edge({ targetSymbol: 'find', chainPath: "prismaRepository('user')" })],
    })

    expect(facts[0]).toMatchObject({
      target: 'user',
      operation: 'find',
      factKind: 'relation.db_access',
    })
  })

  it('ignores inactive candidate rules', () => {
    const rules: StaticAnalysisPatternRule[] = [{
      id: 'candidate',
      state: 'candidate',
      source: 'agent_candidate',
      target: 'relation.api_call',
      match: { relation: 'calls', targetSymbolIn: ['get'] },
      emit: { targetFrom: 'firstArg', operationValue: 'GET' },
    }]

    expect(matchPatternDslRules({
      rules,
      edges: [edge({ targetSymbol: 'get', firstArg: '/api/users' })],
    })).toEqual([])
  })

  it('ignores agent_candidate rules even if a malformed profile marks them active', () => {
    const rules: StaticAnalysisPatternRule[] = [{
      id: 'candidate.leaked-active',
      state: 'active',
      source: 'agent_candidate',
      target: 'relation.api_call',
      match: { relation: 'calls', targetSymbolIn: ['get'] },
      emit: { targetFrom: 'firstArg', operationValue: 'GET' },
    }]

    expect(matchPatternDslRules({
      rules,
      edges: [edge({ targetSymbol: 'get', firstArg: '/api/users' })],
    })).toEqual([])
  })

  it('emits facts from approved production and fixture rule sources', () => {
    const rules: StaticAnalysisPatternRule[] = [
      'default',
      'repository_metadata',
      'user',
      'approved',
      'fixture',
    ].map((source) => ({
      id: `source.${source}`,
      state: 'active',
      source: source as StaticAnalysisPatternRule['source'],
      target: 'relation.api_call',
      match: { relation: 'calls', targetSymbolIn: ['get'] },
      emit: { targetFrom: 'firstArg', operationValue: 'GET' },
    }))

    expect(matchPatternDslRules({
      rules,
      edges: [edge({ targetSymbol: 'get', firstArg: '/api/users' })],
    }).map((fact) => fact.ruleId)).toEqual([
      'source.default',
      'source.repository_metadata',
      'source.user',
      'source.approved',
      'source.fixture',
    ])
  })

  it('classifies DSL and legacy parity for telemetry', () => {
    const result = classifyDslLegacyFacts({
      dslFacts: [
        { key: 'GET /users -> handler', value: 'GET /users -> handler' },
        { key: 'POST /users -> handler', value: 'POST /users -> handler' },
        { key: 'GET /conflict -> handler', value: 'GET /conflict -> handler' },
      ],
      legacyFacts: [
        { key: 'GET /users -> handler', value: 'GET /users -> handler' },
        { key: 'GET /health -> handler', value: 'GET /health -> handler' },
        { key: 'GET /conflict -> handler', value: 'POST /conflict -> handler' },
      ],
    })

    expect(result.summary).toEqual({
      both: 1,
      dsl_only: 1,
      legacy_only: 1,
      conflict: 1,
    })
  })

  it('reads literal arg values defensively', () => {
    expect(extractLiteralArgValue('[{"path":"/x"}]', 'path')).toBe('/x')
    expect(extractLiteralArgValue('[{"path":null}]', 'path')).toBeNull()
    expect(extractLiteralArgValue('not-json', 'path')).toBeNull()
  })

  it('scopes matches to source files that import a package anchor', () => {
    const source = node(baseEdge.sourceId, 'src/users.ts')
    const rules: StaticAnalysisPatternRule[] = [{
      id: 'api.custom.with-axios-anchor',
      state: 'active',
      source: 'user',
      target: 'relation.api_call',
      match: {
        relation: 'calls',
        targetSymbolIn: ['get'],
        chainPathEquals: 'apiClient',
        importsContain: { packageName: 'axios' },
      },
      emit: { targetFrom: 'firstArg', operationValue: 'GET' },
    }]

    expect(matchPatternDslRules({
      rules,
      nodes: [source],
      edges: [
        edge({
          id: 2,
          sourceId: 'r1:src/users.ts:file',
          relation: 'imports',
          targetSpecifier: 'axios',
        }),
        edge({ targetSymbol: 'get', chainPath: 'apiClient', firstArg: '/users' }),
      ],
    })[0]).toMatchObject({ target: '/users' })

    expect(matchPatternDslRules({
      rules,
      nodes: [source],
      edges: [edge({ targetSymbol: 'get', chainPath: 'apiClient', firstArg: '/users' })],
    })).toEqual([])
  })

  it('requires explicit literal keys and decorator names when configured', () => {
    const rules: StaticAnalysisPatternRule[] = [{
      id: 'route.custom.decorator',
      state: 'active',
      source: 'approved',
      target: 'route.entrypoint',
      match: {
        relation: 'decorates',
        decoratorName: 'CustomGet',
        literalArgKey: 'path',
      },
      emit: { targetFrom: 'literalArg:path', operationValue: 'GET' },
    }]

    expect(matchPatternDslRules({
      rules,
      edges: [edge({
        relation: 'decorates',
        targetSymbol: 'CustomGet',
        literalArgs: '[{"path":"/users"}]',
      })],
    })[0]).toMatchObject({ target: '/users' })

    expect(matchPatternDslRules({
      rules,
      edges: [edge({
        relation: 'decorates',
        targetSymbol: 'OtherGet',
        literalArgs: '[{"path":"/users"}]',
      })],
    })).toEqual([])
  })

  it('emits TypeORM getRepository factory db_access facts from the default profile', () => {
    const profile = defaultStaticAnalysisPatternProfile({
      language: 'typescript',
      frameworks: [],
      packages: ['typeorm'],
    })

    const bare = matchPatternDslRules({
      rules: profile.rules ?? [],
      edges: [edge({ targetSymbol: 'find', chainPath: 'getRepository(User)' })],
    })
    expect(bare[0]).toMatchObject({
      ruleId: 'db.typeorm.getRepository',
      factKind: 'relation.db_access',
      target: 'User',
      operation: 'find',
    })

    const dataSource = matchPatternDslRules({
      rules: profile.rules ?? [],
      edges: [edge({ targetSymbol: 'save', chainPath: 'dataSource.getRepository(Order)' })],
    })
    expect(dataSource[0]).toMatchObject({
      ruleId: 'db.typeorm.datasource-getRepository',
      factKind: 'relation.db_access',
      target: 'Order',
      operation: 'save',
    })
  })

  it('emits Drizzle relational-query db_access facts from the default profile', () => {
    // Real shapes from build_graph of
    //   tests/fixtures/corpus/repo/pipeline/orm-drizzle/drizzle-orm (db.query.usersTable.findMany)
    // and the small turso-drizzle-todo fixture confirm chainPath='db.query.<table>',
    // targetSymbol='findMany'|'findFirst', firstArg=null.
    const profile = defaultStaticAnalysisPatternProfile({
      language: 'typescript',
      frameworks: [],
      packages: ['drizzle-orm/libsql'],
    })

    const findMany = matchPatternDslRules({
      rules: profile.rules ?? [],
      edges: [edge({ targetSymbol: 'findMany', chainPath: 'db.query.usersTable' })],
    })
    expect(findMany[0]).toMatchObject({
      ruleId: 'db.drizzle.query-relational',
      factKind: 'relation.db_access',
      target: 'usersTable',
      operation: 'findMany',
    })

    const findFirst = matchPatternDslRules({
      rules: profile.rules ?? [],
      edges: [edge({ targetSymbol: 'findFirst', chainPath: 'db.query.users' })],
    })
    expect(findFirst[0]).toMatchObject({
      ruleId: 'db.drizzle.query-relational',
      factKind: 'relation.db_access',
      target: 'users',
      operation: 'findFirst',
    })
  })

  it('emits Mongoose NestJS injected-model db_access facts from the default profile', () => {
    // Real shapes from build_graph of
    //   tests/fixtures/corpus/repo/pipeline/nestjs/mongoose-base (this.catModel.find / .create)
    // confirm chainPath='this.<field>Model', targetSymbol=<mongoose method>, firstArg=null.
    const profile = defaultStaticAnalysisPatternProfile({
      language: 'typescript',
      frameworks: [],
      packages: ['mongoose'],
    })

    const find = matchPatternDslRules({
      rules: profile.rules ?? [],
      edges: [edge({ targetSymbol: 'find', chainPath: 'this.catModel' })],
    })
    expect(find[0]).toMatchObject({
      ruleId: 'db.mongoose.this-model',
      factKind: 'relation.db_access',
      target: 'cat',
      operation: 'find',
    })

    const create = matchPatternDslRules({
      rules: profile.rules ?? [],
      edges: [edge({ targetSymbol: 'create', chainPath: 'this.userModel' })],
    })
    expect(create[0]).toMatchObject({
      ruleId: 'db.mongoose.this-model',
      factKind: 'relation.db_access',
      target: 'user',
      operation: 'create',
    })
  })

  it('does not match Mongoose this-model rule on non-model NestJS receivers', () => {
    // Guards against over-matching: services/repositories share method names with mongoose.
    // Real receivers from the corpus: this.usersService, this.userRepository, this.model.
    const profile = defaultStaticAnalysisPatternProfile({
      language: 'typescript',
      frameworks: [],
      packages: ['mongoose'],
    })

    for (const chainPath of ['this.usersService', 'this.userRepository', 'this.model']) {
      expect(matchPatternDslRules({
        rules: profile.rules ?? [],
        edges: [edge({ targetSymbol: 'find', chainPath })],
      })).toEqual([])
    }
  })

  it('does not activate Drizzle or Mongoose default rules when their packages are absent', () => {
    const profile = defaultStaticAnalysisPatternProfile({
      language: 'typescript',
      frameworks: [],
      packages: [],
    })
    expect((profile.rules ?? []).some((rule) => rule.id.startsWith('db.drizzle.'))).toBe(false)
    expect((profile.rules ?? []).some((rule) => rule.id.startsWith('db.mongoose.'))).toBe(false)
  })

  it('does not activate TypeORM getRepository rules when typeorm is absent', () => {
    const profile = defaultStaticAnalysisPatternProfile({
      language: 'typescript',
      frameworks: [],
      packages: [],
    })
    expect((profile.rules ?? []).some((rule) => rule.id.startsWith('db.typeorm.'))).toBe(false)
  })

  it('can scope rules to source file globs', () => {
    const rules: StaticAnalysisPatternRule[] = [{
      id: 'route.file-scoped',
      state: 'active',
      source: 'default',
      target: 'route.entrypoint',
      match: {
        relation: 'renders',
        targetSymbolIn: ['Route'],
        literalArgKey: 'path',
        fileGlob: 'src/routes/**',
      },
      emit: { targetFrom: 'literalArg:path', operationValue: 'GET' },
    }]

    expect(matchPatternDslRules({
      rules,
      nodes: [node(baseEdge.sourceId, 'src/routes/App.tsx')],
      edges: [edge({
        relation: 'renders',
        targetSymbol: 'Route',
        literalArgs: '[{"path":"/settings"}]',
      })],
    })[0]).toMatchObject({ target: '/settings' })

    expect(matchPatternDslRules({
      rules,
      nodes: [node(baseEdge.sourceId, 'src/components/App.tsx')],
      edges: [edge({
        relation: 'renders',
        targetSymbol: 'Route',
        literalArgs: '[{"path":"/settings"}]',
      })],
    })).toEqual([])
  })
})
