import { z } from 'zod'

/**
 * CustomDecoratorMapping — analyze_repo F2b가 추출하는 wrapper 데코레이터/HOC alias 매핑.
 *
 * NestJS `applyDecorators(Get(...), Post(...))` 같은 회사 자체 wrapper나 React HOC를
 * 표준 데코레이터로 expand한다. build_route v2가 룰 엔진의 alias 추적에 사용.
 *
 * SOT: specs/analyze_repo/architecture.md §3.1, §5.3
 */
export const CustomDecoratorMappingSchema = z.object({
  expands_to: z.array(z.string().min(1)).min(1),                  // ['Get', 'Post']
  file: z.string().min(1),                                          // 'src/common/decorators/api-get.ts'
  dynamic: z.boolean().default(false),                              // switch/조건문 분기 → fallback_to_llm
  fallback_to_llm: z.boolean().default(false),                      // 정적 추적 어려움 → build_route LLM 위임
}).strict()

export type CustomDecoratorMapping = z.infer<typeof CustomDecoratorMappingSchema>
