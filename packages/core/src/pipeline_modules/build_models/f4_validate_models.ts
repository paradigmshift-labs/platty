import type { ModelRaw, BuildModelsVerdict } from './types.js'

export function validateModels(models: ModelRaw[]): { models: ModelRaw[]; verdicts: BuildModelsVerdict[] } {
  const verdicts: BuildModelsVerdict[] = []

  const modelNameSet = new Set(models.map(m => m.name))

  const modelFieldMap = new Map<string, Set<string>>()
  for (const model of models) {
    modelFieldMap.set(model.name, new Set(model.fields.map(f => f.name)))
  }

  for (const model of models) {
    // Rule 1: NO_PK
    if (model.fields.every(f => !f.primary)) {
      verdicts.push({
        model_name: model.name,
        level: 'warning',
        code: 'NO_PK',
        detail: 'No primary key found',
      })
    }

    // Rule 4: DUPLICATE_FIELD
    const fieldNameCounts = new Map<string, number>()
    for (const field of model.fields) {
      fieldNameCounts.set(field.name, (fieldNameCounts.get(field.name) ?? 0) + 1)
    }
    for (const [name, count] of fieldNameCounts) {
      if (count >= 2) {
        verdicts.push({
          model_name: model.name,
          level: 'warning',
          code: 'DUPLICATE_FIELD',
          detail: `Duplicate field '${name}'`,
        })
      }
    }

    // Rules 2 & 3: per relation
    for (const relation of model.relations) {
      // Rule 2: ORPHAN_RELATION
      if (!modelNameSet.has(relation.target_model)) {
        verdicts.push({
          model_name: model.name,
          level: 'warning',
          code: 'ORPHAN_RELATION',
          detail: `Relation target '${relation.target_model}' not found for '${relation.name}'`,
        })
      }

      // Rule 3a: FK_MISMATCH — fk_fields
      if (relation.fk_fields) {
        const thisFieldSet = modelFieldMap.get(model.name)!
        for (const fieldName of relation.fk_fields) {
          if (!thisFieldSet.has(fieldName)) {
            verdicts.push({
              model_name: model.name,
              level: 'error',
              code: 'FK_MISMATCH',
              detail: `FK field '${fieldName}' not found in '${model.name}'`,
            })
          }
        }
      }

      // Rule 3b: FK_MISMATCH — references (only if target exists)
      if (relation.references && modelNameSet.has(relation.target_model)) {
        const targetFieldSet = modelFieldMap.get(relation.target_model)!
        for (const fieldName of relation.references) {
          if (!targetFieldSet.has(fieldName)) {
            verdicts.push({
              model_name: model.name,
              level: 'error',
              code: 'FK_MISMATCH',
              detail: `Reference field '${fieldName}' not found in '${relation.target_model}'`,
            })
          }
        }
      }
    }
  }

  return { models, verdicts }
}
