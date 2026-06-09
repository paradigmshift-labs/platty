import type { ModelRaw, ModelRelation } from './types.js'

// ─── Helper functions ───────────────────────────────────────────────────────

/** PascalCase → camelCase (첫 글자만 소문자로) */
export function toCamelCase(name: string): string {
  if (!name) return name
  return name[0]!.toLowerCase() + name.slice(1)
}

/** 영어 간이 복수형 규칙 */
export function toPlural(name: string): string {
  if (!name) return name

  // ends with s, x, z, sh, ch → +es
  if (
    name.endsWith('s') ||
    name.endsWith('x') ||
    name.endsWith('z') ||
    name.endsWith('sh') ||
    name.endsWith('ch')
  ) {
    return name + 'es'
  }

  // 자음+y 끝 → drop y + ies
  if (name.endsWith('y') && name.length >= 2) {
    const beforeY = name[name.length - 2]!
    const vowels = 'aeiouAEIOU'
    if (!vowels.includes(beforeY)) {
      return name.slice(0, -1) + 'ies'
    }
  }

  // otherwise → +s
  return name + 's'
}

/** 소스 relation 타입의 역방향 타입 */
export function getInverseType(
  type: ModelRelation['type'],
): ModelRelation['type'] {
  switch (type) {
    case 'embedded':
      return 'embedded'
    case 'manyToOne':
      return 'oneToMany'
    case 'oneToMany':
      return 'manyToOne'
    case 'oneToOne':
      return 'oneToOne'
    case 'manyToMany':
      return 'manyToMany'
  }
}

/**
 * 역방향 relation 이름 생성
 * 충돌 시 relation_name 또는 sourceRel.name을 suffix로 사용
 */
export function generateInverseName(
  sourceModelName: string,
  sourceRel: ModelRelation,
  targetModel: ModelRaw,
): string {
  const baseName = toCamelCase(sourceModelName)
  const inverseType = getInverseType(sourceRel.type)

  let candidateName: string
  if (inverseType === 'oneToMany' || inverseType === 'manyToMany') {
    candidateName = toPlural(baseName)
  } else {
    candidateName = baseName
  }

  // 이름 충돌 방지: targetModel.relations + targetModel.fields에 같은 이름이 있으면 suffix
  const existingNames = new Set([
    ...targetModel.relations.map((r) => r.name),
    ...targetModel.fields.map((f) => f.name),
  ])

  if (!existingNames.has(candidateName)) {
    return candidateName
  }

  // 충돌 시: relation_name이 있으면 사용, 없으면 sourceRel.name + suffix
  if (sourceRel.relation_name) {
    return candidateName + '_' + sourceRel.relation_name
  } else {
    return candidateName + '_' + sourceRel.name
  }
}

/**
 * 역방향 relation 자동 생성
 * 불변식 #8: relation_name이 없으면 키 자체를 포함하지 않음
 */
export function generateInverse(
  sourceModel: ModelRaw,
  sourceRel: ModelRelation,
  targetModel: ModelRaw,
): ModelRelation {
  const inverseName = generateInverseName(sourceModel.name, sourceRel, targetModel)
  const inverseType = getInverseType(sourceRel.type)

  return {
    name: inverseName,
    target_model: sourceModel.name,
    type: inverseType,
    ...(sourceRel.relation_name ? { relation_name: sourceRel.relation_name } : {}),
    auto_generated: true,
    line: 0,
  }
}

/**
 * 역방향 관계 검색
 *
 * 매칭 우선순위:
 * 1. relation_name 매칭 (최우선)
 * 2. 모델 쌍 + 유일성 매칭 (relation_name 없는 경우)
 * 3. 매칭 실패 → null
 */
export function findInverse(
  sourceModel: ModelRaw,
  sourceRel: ModelRelation,
  targetModel: ModelRaw,
): ModelRelation | null {
  let candidates = targetModel.relations.filter(
    (r) => r.target_model === sourceModel.name,
  )

  // 자기참조: sourceRel 자신을 후보에서 제외
  if (sourceRel.target_model === sourceModel.name) {
    candidates = candidates.filter((r) => r !== sourceRel)
  }

  // 1) relation_name 매칭 (최우선)
  if (sourceRel.relation_name) {
    const matched = candidates.filter(
      (r) => r.relation_name === sourceRel.relation_name,
    )
    if (matched.length === 1) return matched[0]!
    return null
  }

  // 2) relation_name 없는 경우: unnamed 후보 중 유일 1개 매칭
  const unnamed = candidates.filter((r) => !r.relation_name)
  if (unnamed.length === 1) return unnamed[0]!

  return null
}

/**
 * 관계 타입 교정
 * FK 소유 여부와 리스트 여부를 기반으로 양방향 쌍의 타입을 교정한다.
 */
export function correctTypes(rel: ModelRelation, inverse: ModelRelation): void {
  if (rel.fk_fields && inverse.fk_fields) {
    return
  }

  const fkSide = rel.fk_fields ? rel : inverse.fk_fields ? inverse : null
  const nonFkSide = rel.fk_fields ? inverse : inverse.fk_fields ? rel : null

  if (fkSide !== null && nonFkSide !== null) {
    if (fkSide.type === 'oneToOne') {
      nonFkSide.type = 'oneToOne'
    } else {
      fkSide.type = 'manyToOne'
      nonFkSide.type = 'oneToMany'
    }
  } else if (fkSide === null && nonFkSide === null) {
    rel.type = 'manyToMany'
    inverse.type = 'manyToMany'
  }
}

// ─── Main function ───────────────────────────────────────────────────────────

/**
 * F3: mergeRelations
 *
 * 순수 함수, 동기 — 외부 I/O 없음, side effect 없음.
 * 입력 ModelRaw[]를 deep clone 후 변환하여 반환 (원본 불변).
 */
export function mergeRelations(models: ModelRaw[]): ModelRaw[] {
  const cloned: ModelRaw[] = structuredClone(models)
  const modelMap = new Map<string, ModelRaw>()
  for (const model of cloned) {
    modelMap.set(model.name, model)
  }

  for (const model of cloned) {
    for (const rel of model.relations) {
      if (rel.auto_generated === true) continue
      if (rel.type === 'embedded') continue

      const targetModel = modelMap.get(rel.target_model)
      if (targetModel === undefined) continue

      const inverse = findInverse(model, rel, targetModel)

      if (inverse !== null) {
        correctTypes(rel, inverse)
      } else {
        const generated = generateInverse(model, rel, targetModel)
        targetModel.relations.push(generated)
      }
    }
  }

  return cloned
}
