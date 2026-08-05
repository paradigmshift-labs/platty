export const CAPTURE_MATRIX_SCHEMA = 'platty-design-capture-matrix.v1'
export const CAPTURE_SOURCE_INVENTORY_SCHEMA = 'platty-design-capture-source-inventory.v1'
export const REVIEW_PRESENTATION_SCHEMA = 'platty-design-review-presentation.v1'
export const REVIEW_HANDOFF_SCHEMA = 'platty-design-review-handoff.v1'

export const MATRIX_STRING_FIELDS = [
  'id', 'actor', 'screenId', 'route', 'state', 'viewport', 'shellVariant',
  'activeNavigation', 'expectedResult', 'observableResult', 'screenshotPath',
  'screenshotHash', 'status', 'entryAction', 'url', 'capturedAt', 'consoleResult',
  'memoScreenId', 'functionSpecId',
]
export const SOURCE_INVENTORY_ROW_FIELDS = [
  'id', 'actor', 'screenId', 'route', 'state', 'viewport', 'shellVariant',
  'activeNavigation',
]
export const PRESENTATION_STRING_FIELDS = [
  'matrixRowId', 'screenshotPath', 'caption', 'observableResult',
  'functionSpecification', 'memoScreenId', 'displayStatus', 'screenId', 'state',
  'viewport',
]
export const IA_STRING_FIELDS = ['fromScreenId', 'toScreenId', 'relationship']
export const PRODUCT_EVIDENCE_FIELDS = [
  'sellerHeaderVisible', 'sellerNavigationVisible', 'activeNavigationVisible',
  'contentVisible', 'reviewUiAbsent',
]
export const BROWSER_REGION_FIELDS = ['header', 'navigation', 'activeNavigation', 'content']
export const SELLER_SHELL_VARIANTS = new Set(['seller', 'seller-console'])

export const AUTHORIZATION_QUESTIONS = [
  '현재 검토 결과를 PRD에 반영하시겠습니까?',
  '확정된 화면과 IA를 Figma로 옮기시겠습니까? 선택하면 PRD에도 함께 반영됩니다.',
]

export function decisionResult(prdAnswer, figmaAnswer) {
  if (!['yes', 'no'].includes(prdAnswer) || !['yes', 'no'].includes(figmaAnswer)) return null
  if (figmaAnswer === 'yes') return 'reflect-prd-then-deliver-figma'
  return prdAnswer === 'yes' ? 'reflect-prd' : 'preserve-only'
}
