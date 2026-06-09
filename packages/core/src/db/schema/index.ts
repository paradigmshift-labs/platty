// V2 메인 DB schema 진실 출처.
// 모듈별 schema 파일을 여기서 re-export하여 drizzle-kit이 한 진입점으로 인식.

export * from './enums.js'
export * from './core.js'
export * from './pipeline_runs.js'
export * from './code_graph.js'
export * from './build_route.js'
export * from './build_models.js'
export * from './build_relations.js'
export * from './build_docs.js'
export * from './build_service_map.js'
export * from './build_epics.js'
export * from './project_settings.js'
export * from './sync.js'
export * from './project_analysis_v2.js'
export * from './static_analysis_configs.js'
export * from './build_business_docs_generation.js'
export * from './shared_code_segments.js'

// M3+ 추가 예정:
//   - routes (M6 — routes, route_entries, route_api_calls, unresolved_refs)
//   - models (M5 — entity 통합)
//   - design (M8 — design_docs, ucl_docs, ucs_docs, open_questions, document_links, document_versions)
//   - deps (M7 — doc_test_links, doc_db_refs, verdicts)
//   - arch (M8 — arch_components, arch_route_refs)
//   - chat (M12 — chat_sessions, chat_messages)
