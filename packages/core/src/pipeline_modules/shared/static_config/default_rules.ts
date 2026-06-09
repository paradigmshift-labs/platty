import type {
  StaticAnalysisPatternProfileInput,
  StaticAnalysisPatternRule,
} from './types.js'
import { activateDefaultRuleIds, normalizeEcosystem } from './role_registry/index.js'

export const PRISMA_METHODS = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]

export const TYPEORM_REPO_METHODS = [
  'find',
  'findOne',
  'findOneBy',
  'findOneOrFail',
  'findBy',
  'findAndCount',
  'save',
  'insert',
  'update',
  'delete',
  'remove',
  'softDelete',
  'count',
  'exist',
  'createQueryBuilder',
]

// Drizzle relational query API methods (db.query.<table>.findMany()).
export const DRIZZLE_QUERY_METHODS = ['findMany', 'findFirst']

// Mongoose model methods (this.<field>Model.find(), etc.).
export const MONGOOSE_MODEL_METHODS = [
  'find',
  'findOne',
  'findById',
  'count',
  'countDocuments',
  'estimatedDocumentCount',
  'aggregate',
  'create',
  'insertMany',
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findByIdAndUpdate',
  'deleteOne',
  'deleteMany',
  'findOneAndDelete',
  'findByIdAndDelete',
]

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']

export function defaultStaticAnalysisPatternProfile(args: {
  language?: string | null
  frameworks?: string[] | null
  packages?: string[] | null
}): StaticAnalysisPatternProfileInput {
  const language = args.language ?? 'unknown'
  const frameworks = args.frameworks ?? []
  const ecosystem = normalizeEcosystem(language)
  const activatedRuleIds = new Set(activateDefaultRuleIds([
    ...frameworks.map((packageName) => ({ ecosystem, packageName })),
    ...(args.packages ?? []).map((packageName) => ({ ecosystem, packageName })),
  ]))
  return {
    version: 1,
    language,
    frameworks,
    rules: allDefaultRules(frameworks).filter((rule) => activatedRuleIds.has(rule.id)),
  }
}

function allDefaultRules(frameworks: string[]): StaticAnalysisPatternRule[] {
  return [
      ...defaultDbRules(),
      ...defaultTypeormRules(),
      ...defaultDrizzleRules(),
      ...defaultMongooseRules(),
      ...defaultApiClientRules(),
      ...defaultRouteRules(frameworks),
    ]
}

function defaultDbRules(): StaticAnalysisPatternRule[] {
  return [
    prismaRule('db.prisma.direct', 'prisma.{model}'),
    prismaRule('db.prisma.this', 'this.prisma.{model}'),
    prismaRule('db.prisma.service', 'prismaService.{model}'),
    prismaRule('db.prisma.this-service', 'this.prismaService.{model}'),
  ]
}

function defaultTypeormRules(): StaticAnalysisPatternRule[] {
  return [
    typeormRepositoryRule('db.typeorm.getRepository', 'getRepository({entity})'),
    typeormRepositoryRule('db.typeorm.datasource-getRepository', 'dataSource.getRepository({entity})'),
    typeormRepositoryRule('db.typeorm.this-datasource-getRepository', 'this.dataSource.getRepository({entity})'),
    typeormRepositoryRule('db.typeorm.manager-getRepository', 'manager.getRepository({entity})'),
  ]
}

function typeormRepositoryRule(id: string, chainPathPattern: string): StaticAnalysisPatternRule {
  return {
    id,
    state: 'active',
    source: 'default',
    target: 'relation.db_access',
    match: {
      relation: 'calls',
      targetSymbolIn: TYPEORM_REPO_METHODS,
      chainPathPattern,
    },
    emit: {
      targetFrom: 'chainPathCallArg:entity',
      operationFrom: 'targetSymbol',
    },
  }
}

// Drizzle relational query API: `db.query.<table>.findMany()` carries the table as
// the trailing chainPath segment (build_graph: chainPath='db.query.usersTable',
// targetSymbol='findMany', firstArg=null). The SQL builder form
// (`db.insert(t).values()` / `db.select().from(t)`) is intentionally NOT covered:
// build_graph does not capture the table on any single edge (the table only appears
// inside the *next* chained call's chainPath with embedded whitespace/`db` prefix),
// so it is left to the legacy build_relations drizzle adapter's multi-edge inference.
function defaultDrizzleRules(): StaticAnalysisPatternRule[] {
  return [
    {
      id: 'db.drizzle.query-relational',
      state: 'active',
      source: 'default',
      target: 'relation.db_access',
      match: {
        relation: 'calls',
        targetSymbolIn: DRIZZLE_QUERY_METHODS,
        chainPathPattern: 'db.query.{table}',
      },
      emit: {
        targetFrom: 'chainPathSegment:table',
        operationFrom: 'targetSymbol',
      },
    },
  ]
}

// Mongoose NestJS injected model: `this.<field>Model.find()` carries the model field
// as the trailing chainPath segment (build_graph: chainPath='this.catModel',
// targetSymbol='find', firstArg=null). The `Model` suffix is required in the pattern
// to avoid matching `this.usersService` / `this.userRepository` receivers that share
// method names. The bare `Model.find()` form is intentionally NOT covered: a
// capitalized receiver collides with `Object.create`/`Promise.all` etc. and needs the
// legacy adapter's import-evidence gating + model-registry correlation.
function defaultMongooseRules(): StaticAnalysisPatternRule[] {
  return [
    {
      id: 'db.mongoose.this-model',
      state: 'active',
      source: 'default',
      target: 'relation.db_access',
      match: {
        relation: 'calls',
        targetSymbolIn: MONGOOSE_MODEL_METHODS,
        chainPathPattern: 'this.{model}Model',
      },
      emit: {
        targetFrom: 'chainPathSegment:model',
        operationFrom: 'targetSymbol',
      },
    },
  ]
}

function prismaRule(id: string, chainPathPattern: string): StaticAnalysisPatternRule {
  return {
    id,
    state: 'active',
    source: 'default',
    target: 'relation.db_access',
    match: {
      relation: 'calls',
      targetSymbolIn: PRISMA_METHODS,
      chainPathPattern,
    },
    emit: {
      targetFrom: 'chainPathSegment:model',
      operationFrom: 'targetSymbol',
    },
  }
}

function defaultApiClientRules(): StaticAnalysisPatternRule[] {
  return HTTP_METHODS.map((method) => ({
    id: `api.axios.${method}`,
    state: 'active',
    source: 'default',
    target: 'relation.api_call',
    match: {
      relation: 'calls',
      targetSymbolIn: [method],
      chainPathEquals: 'axios',
    },
    emit: {
      targetFrom: 'firstArg',
      operationValue: method.toUpperCase(),
    },
  }))
}

function defaultRouteRules(frameworks: string[]): StaticAnalysisPatternRule[] {
  const normalized = frameworks.map((framework) => framework.toLowerCase())
  const rules: StaticAnalysisPatternRule[] = []
  if (normalized.some((framework) => framework.includes('react'))) {
    rules.push({
      id: 'route.react.jsx-route',
      state: 'active',
      source: 'default',
      target: 'route.entrypoint',
      match: {
        relation: 'renders',
        targetSymbolIn: ['Route'],
      },
      emit: {
        targetFrom: 'literalArg:path',
        operationValue: 'GET',
      },
    })
  }
  if (normalized.some((framework) => framework.includes('flutter'))) {
    rules.push({
      id: 'route.flutter.go-router',
      state: 'active',
      source: 'default',
      target: 'route.entrypoint',
      match: {
        relation: 'calls',
        targetSymbolIn: ['GoRoute'],
      },
      emit: {
        targetFrom: 'literalArg:path',
        operationValue: 'GET',
      },
    })
  }
  return rules
}
