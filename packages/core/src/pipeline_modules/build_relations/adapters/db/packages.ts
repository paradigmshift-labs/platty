export const PRISMA_DB_PACKAGES = ['@prisma/client'] as const
export const TYPEORM_DB_PACKAGES = ['typeorm', '@nestjs/typeorm'] as const
export const MONGOOSE_DB_PACKAGES = ['mongoose', '@nestjs/mongoose'] as const
export const SEQUELIZE_DB_PACKAGES = ['sequelize', 'sequelize-typescript', '@nestjs/sequelize'] as const
export const DRIZZLE_DB_PACKAGES = ['drizzle-orm'] as const
export const KNEX_DB_PACKAGES = ['knex'] as const
export const KYSELY_DB_PACKAGES = ['kysely'] as const
export const SUPABASE_DB_PACKAGES = ['@supabase/supabase-js', 'package:supabase_flutter/supabase_flutter.dart'] as const
export const REDIS_DB_PACKAGES = ['redis', 'ioredis'] as const
export const MIKRO_ORM_DB_PACKAGES = ['@mikro-orm/core', 'mikro-orm'] as const
export const SQL_DRIVER_DB_PACKAGES = ['objection', 'pg', 'mysql2', 'sqlite3', 'better-sqlite3'] as const
export const SQFLITE_DB_PACKAGES = ['sqflite', 'package:sqflite/sqflite.dart'] as const

export const DB_CLIENT_PACKAGES = [
  ...PRISMA_DB_PACKAGES,
  ...TYPEORM_DB_PACKAGES,
  ...MONGOOSE_DB_PACKAGES,
  ...SEQUELIZE_DB_PACKAGES,
  ...DRIZZLE_DB_PACKAGES,
  ...KNEX_DB_PACKAGES,
  ...KYSELY_DB_PACKAGES,
  ...SUPABASE_DB_PACKAGES,
  ...REDIS_DB_PACKAGES,
  ...MIKRO_ORM_DB_PACKAGES,
  ...SQL_DRIVER_DB_PACKAGES,
  ...SQFLITE_DB_PACKAGES,
] as const

export const DB_CLIENT_PACKAGE_SET = new Set<string>(DB_CLIENT_PACKAGES)
export const PRISMA_DB_PACKAGE_SET = new Set<string>(PRISMA_DB_PACKAGES)
export const TYPEORM_DB_PACKAGE_SET = new Set<string>(TYPEORM_DB_PACKAGES)
export const MONGOOSE_DB_PACKAGE_SET = new Set<string>(MONGOOSE_DB_PACKAGES)
export const SEQUELIZE_DB_PACKAGE_SET = new Set<string>(SEQUELIZE_DB_PACKAGES)
export const DRIZZLE_DB_PACKAGE_SET = new Set<string>(DRIZZLE_DB_PACKAGES)
export const KNEX_DB_PACKAGE_SET = new Set<string>(KNEX_DB_PACKAGES)
export const KYSELY_DB_PACKAGE_SET = new Set<string>(KYSELY_DB_PACKAGES)
export const SUPABASE_DB_PACKAGE_SET = new Set<string>(SUPABASE_DB_PACKAGES)
export const REDIS_DB_PACKAGE_SET = new Set<string>(REDIS_DB_PACKAGES)
export const MIKRO_ORM_DB_PACKAGE_SET = new Set<string>(MIKRO_ORM_DB_PACKAGES)
export const SQFLITE_DB_PACKAGE_SET = new Set<string>(SQFLITE_DB_PACKAGES)

export function isDbClientPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && DB_CLIENT_PACKAGE_SET.has(pkg))
}

export function isKnexPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && KNEX_DB_PACKAGE_SET.has(pkg))
}

export function isKyselyPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && KYSELY_DB_PACKAGE_SET.has(pkg))
}

export function isMikroOrmPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && MIKRO_ORM_DB_PACKAGE_SET.has(pkg))
}

export function isMongoosePackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && MONGOOSE_DB_PACKAGE_SET.has(pkg))
}

export function isRedisPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && REDIS_DB_PACKAGE_SET.has(pkg))
}

export function isSequelizePackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && SEQUELIZE_DB_PACKAGE_SET.has(pkg))
}

export function isSqflitePackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && SQFLITE_DB_PACKAGE_SET.has(pkg))
}

export function isSupabaseDbPackage(pkg: string | null | undefined): boolean {
  return Boolean(pkg && SUPABASE_DB_PACKAGE_SET.has(pkg))
}

export function detectOrmFromPackage(pkg: string | null | undefined): string {
  if (!pkg) return 'unknown'
  if (pkg.includes('prisma')) return 'prisma'
  if (pkg.includes('typeorm')) return 'typeorm'
  if (pkg.includes('mongoose')) return 'mongoose'
  if (pkg.includes('sequelize')) return 'sequelize'
  if (pkg.includes('drizzle')) return 'drizzle'
  if (pkg.includes('knex')) return 'knex'
  if (pkg.includes('kysely')) return 'kysely'
  if (isRedisPackage(pkg)) return 'redis'
  if (pkg.includes('supabase')) return 'supabase'
  if (pkg.includes('mikro')) return 'mikroorm'
  if (isSqflitePackage(pkg)) return 'sqflite'
  return 'unknown'
}
