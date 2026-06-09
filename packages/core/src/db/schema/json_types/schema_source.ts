import { z } from 'zod'

/**
 * SchemaSource — repository의 ORM schema 위치 정보.
 * 한 repo에 여러 ORM 가능 (예: Prisma + 별 schema). M2 analyze_repo F2b 산출.
 */
export const SchemaSourceSchema = z.object({
  orm: z.string(),                                                // 'prisma', 'typeorm', 'drizzle' 등
  provider: z.enum(['postgresql', 'mysql', 'sqlite', 'mongodb', 'mariadb']).nullable(),
  schema_paths: z.array(z.string()),                              // 절대/상대 경로
  label: z.string(),                                              // 'main', 'analytics' 등 — 다중 schema 식별
})

export type SchemaSource = z.infer<typeof SchemaSourceSchema>
