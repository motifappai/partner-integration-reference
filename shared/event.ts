export interface AssessmentPublishedEvent {
  id: string
  event: 'assessment.published'
  version: 1
  timestamp: string
  organizationId: string
  data: {
    surface: 'MARKET' | 'ASSET' | 'PORTFOLIO'
    subjectId: string
    portfolioId: string | null
    revision: number
    language: string
  }
}

export function isAssessmentPublishedEvent(
  value: unknown
): value is AssessmentPublishedEvent {
  if (typeof value !== 'object' || value === null || !('data' in value)) {
    return false
  }
  const assessment = value.data
  return (
    'id' in value &&
    typeof value.id === 'string' &&
    'event' in value &&
    value.event === 'assessment.published' &&
    'version' in value &&
    value.version === 1 &&
    'timestamp' in value &&
    typeof value.timestamp === 'string' &&
    Number.isFinite(Date.parse(value.timestamp)) &&
    'organizationId' in value &&
    typeof value.organizationId === 'string' &&
    typeof assessment === 'object' &&
    assessment !== null &&
    'surface' in assessment &&
    (assessment.surface === 'MARKET' ||
      assessment.surface === 'ASSET' ||
      assessment.surface === 'PORTFOLIO') &&
    'subjectId' in assessment &&
    typeof assessment.subjectId === 'string' &&
    'portfolioId' in assessment &&
    (assessment.portfolioId === null || typeof assessment.portfolioId === 'string') &&
    'revision' in assessment &&
    typeof assessment.revision === 'number' &&
    Number.isInteger(assessment.revision) &&
    assessment.revision > 0 &&
    'language' in assessment &&
    typeof assessment.language === 'string'
  )
}
