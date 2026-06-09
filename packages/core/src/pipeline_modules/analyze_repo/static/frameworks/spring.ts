import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { FrameworkAdapter } from './_base.js'
import type { StandardSlots, ManifestSet } from '../../types.js'
import { safeGlob } from '../helpers/glob.js'

export const springAdapter: FrameworkAdapter = {
  framework: 'spring',
  async extractSlots(_manifests: ManifestSet, identity, repoPath, signal): Promise<Partial<StandardSlots>> {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    void identity

    const entrypoint_files: string[] = []
    const routing_files: string[] = []

    const javaFiles = await safeGlob('**/*.{java,kt}', repoPath, signal)
    for (const rel of javaFiles.matches) {
      const full = resolve(repoPath, rel)
      if (!existsSync(full)) continue
      let content = ''
      try {
        content = readFileSync(full, 'utf-8')
      } catch {
        continue
      }
      if (/@SpringBootApplication/.test(content)) entrypoint_files.push(rel)
      if (/@RestController|@Controller|@RestControllerAdvice|@ControllerAdvice|@ExceptionHandler|@RequestMapping|@GetMapping|@PostMapping|@PutMapping|@DeleteMapping|@PatchMapping|@Scheduled|@EventListener|@KafkaListener|@RabbitListener|@JmsListener|@SqsListener|@MessageMapping|@SubscribeMapping|\bcoRouter\s*\{|\bRouterFunctions\.route\s*\(|\bRequestPredicates\.(GET|POST|PUT|DELETE|PATCH)\s*\(/.test(content)) {
        routing_files.push(rel)
      }
    }

    const schema_sources = detectSpringSchemas(repoPath)
    return {
      entrypoint_files: Array.from(new Set(entrypoint_files)),
      routing_files: Array.from(new Set(routing_files)),
      schema_sources,
      needsLLMRouting: false,
      needsLLMCustomDecorators: false,
    }
  },
}

function detectSpringSchemas(repoPath: string): StandardSlots['schema_sources'] {
  const sources: StandardSlots['schema_sources'] = []
  if (existsSync(resolve(repoPath, 'src/main/resources/application.yml')) || existsSync(resolve(repoPath, 'src/main/resources/application.properties'))) {
    sources.push({ orm: 'jpa', provider: null, schema_paths: ['src/main/resources/application.yml', 'src/main/resources/application.properties'], label: 'main' })
  }
  if (existsSync(resolve(repoPath, 'src/main/resources/mapper'))) {
    sources.push({ orm: 'mybatis', provider: null, schema_paths: ['src/main/resources/mapper/**/*.xml'], label: 'main' })
  }
  return sources
}
