import { describe, expect, it } from 'vitest'
import { buildReportPreviewPayload, type ReportMeta } from './messageExport'

describe('buildReportPreviewPayload', () => {
  it('returns html document plus content and meta for downloads', () => {
    const meta: ReportMeta = {
      title: 'My report',
      username: 'alice',
      prompt: 'test login',
      timestamp: '2026-08-04 10:00',
    }
    const content = '## Results\n\nAll good.'
    const payload = buildReportPreviewPayload(content, meta)

    expect(payload.title).toBe('My report')
    expect(payload.content).toBe(content)
    expect(payload.meta).toEqual(meta)
    expect(payload.html).toContain('<!DOCTYPE html>')
    expect(payload.html).toContain('My report')
    expect(payload.html).toContain('All good')
  })

  it('uses default title when meta.title is empty', () => {
    const payload = buildReportPreviewPayload('hi', {})
    expect(payload.title).toBe('AgentBrowser report')
    expect(payload.html).toContain('AgentBrowser report')
  })
})
