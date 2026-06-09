import type { RelationCandidateAdapter } from './types.js'
import { axiosInstanceApiAdapter } from './api/axios_instances.js'
import { graphQLClientApiAdapter } from './api/graphql_clients.js'
import { httpClientApiAdapter } from './api/http_clients.js'
import { httpLibraryApiAdapter } from './api/http_libraries.js'
import { orpcClientApiAdapter } from './api/orpc_clients.js'
import { queryHookApiAdapter } from './api/query_hooks.js'
import { springRestClientApiAdapter } from './api/spring_rest_client.js'
import { trpcClientApiAdapter } from './api/trpc_clients.js'
import { driftDbAdapter } from './db/drift.js'
import { drizzleDbAdapter } from './db/drizzle.js'
import { knexDbAdapter } from './db/knex.js'
import { kyselyDbAdapter } from './db/kysely.js'
import { mikroOrmDbAdapter } from './db/mikroorm.js'
import { mongooseDbAdapter } from './db/mongoose.js'
import { prismaDbAdapter } from './db/prisma.js'
import { redisDbAdapter } from './db/redis.js'
import { sequelizeDbAdapter } from './db/sequelize.js'
import { sqfliteDbAdapter } from './db/sqflite.js'
import { supabaseDbAdapter } from './db/supabase.js'
import { typeormDbAdapter } from './db/typeorm.js'
import { routerCallExternalLinkAdapter, routerCallNavigationAdapter } from './navigation/router_calls.js'

export const relationCandidateAdapters: RelationCandidateAdapter[] = [
  prismaDbAdapter,
  typeormDbAdapter,
  mongooseDbAdapter,
  driftDbAdapter,
  drizzleDbAdapter,
  kyselyDbAdapter,
  knexDbAdapter,
  sqfliteDbAdapter,
  supabaseDbAdapter,
  sequelizeDbAdapter,
  mikroOrmDbAdapter,
  redisDbAdapter,
  axiosInstanceApiAdapter,
  httpLibraryApiAdapter,
  queryHookApiAdapter,
  graphQLClientApiAdapter,
  trpcClientApiAdapter,
  orpcClientApiAdapter,
  springRestClientApiAdapter,
  httpClientApiAdapter,
  routerCallNavigationAdapter,
  routerCallExternalLinkAdapter,
]
