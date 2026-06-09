/**
 * analyze_repo — 공유 Zod 스키마
 *
 * StackInfoSchema, SchemaSourceSchema 및 이들이 의존하는 path 검증 헬퍼.
 * 원래 f2b_detect_stack.ts에 있었으나 dead code 정리 시 이 파일로 분리.
 */

import path from 'node:path'
import { z } from 'zod'

// ──────────────────────────────────────────────────────────────────────────────
// Path validation helpers (schema superRefine에서만 사용)
// ──────────────────────────────────────────────────────────────────────────────

function isUnsafePath(value: string): boolean {
  return value.includes('../') || value.includes('..\\') || path.isAbsolute(value) || isUnsafeControlString(value)
}

function isUnsafeControlString(value: string): boolean {
  return /[\u0000-\u001F]/.test(value)
}

function isUnsafeBaseUrl(value: string): boolean {
  return value.includes('../') ||
    value.includes('..\\') ||
    path.isAbsolute(value) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) ||
    isUnsafeControlString(value) ||
    value !== value.trim()
}

// ──────────────────────────────────────────────────────────────────────────────
// Schemas
// ──────────────────────────────────────────────────────────────────────────────

export const SchemaSourceSchema = z.object({
  orm: z.string().min(1),
  provider: z.enum(['postgresql', 'mysql', 'sqlite', 'mongodb', 'mariadb']).nullable(),
  schema_paths: z.array(z.string()),
  label: z.string().min(1),
}).strict()

// CustomDecoratorMapping schema (v2 신규 — build_route v2 BLOCKER)
const CustomDecoratorMappingSchemaInline = z.object({
  expands_to: z.array(z.string().min(1)).min(1),
  file: z.string().min(1),
  dynamic: z.boolean().default(false),
  fallback_to_llm: z.boolean().default(false),
}).strict()

export const StackInfoSchema = z.object({
  type: z.enum(['backend', 'frontend', 'fullstack', 'mobile']),
  language: z.string().min(1),
  framework: z.string().min(1),
  schema_sources: z.array(SchemaSourceSchema).max(10),
  routing_files: z.array(z.string()),
  routing_libs: z.array(z.string()).default([]),                                                  // ★ v2 신규
  entrypoint_files: z.array(z.string()),
  path_aliases: z.record(z.string(), z.string()),
  base_url: z.string().nullable(),
  custom_decorators: z.record(z.string(), CustomDecoratorMappingSchemaInline).default({}),        // ★ v2 신규
}).strict().superRefine((data, ctx) => {
  const pathFields = [
    ...data.routing_files,
    ...data.entrypoint_files,
    ...data.schema_sources.flatMap((source) => source.schema_paths),
    ...Object.values(data.path_aliases),
    ...Object.values(data.custom_decorators).map((d) => d.file),
  ]

  for (const value of pathFields) {
    if (isUnsafePath(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `위험한 경로: ${value}`,
      })
    }
  }

  // (d) 위험 키 거부: __proto__, constructor, prototype
  const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype'])
  const walk = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (dangerousKeys.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `허용되지 않는 키: ${key}` })
      }
      walk(nested)
    }
  }
  walk(data.path_aliases)

  // (e) base_url: 상대 경로만 허용
  if (data.base_url !== null && isUnsafeBaseUrl(data.base_url)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `허용되지 않는 base_url: ${data.base_url}`,
    })
  }
})
