import { describe, expect, it } from 'vitest'
import {
  REPORT_DOCUMENT_TITLE,
  REPORT_PROJECT,
  buildReportPreviewPayload,
  contentToHtmlBody,
  type ReportMeta,
} from './messageExport'

describe('buildReportPreviewPayload', () => {
  it('always brands as AI Assistant Test Execution Report', () => {
    const meta: ReportMeta = {
      title: 'My report',
      username: 'alice',
      prompt: 'test login',
      timestamp: '2026-08-04 10:00',
    }
    const content = '## Results\n\nAll good.'
    const payload = buildReportPreviewPayload(content, meta)

    expect(payload.title).toBe(REPORT_DOCUMENT_TITLE)
    expect(payload.content).toBe(content)
    expect(payload.meta.title).toBe(REPORT_DOCUMENT_TITLE)
    expect(payload.html).toContain('<!DOCTYPE html>')
    expect(payload.html).toContain(REPORT_DOCUMENT_TITLE)
    expect(payload.html).toContain(`Project</th><td>${REPORT_PROJECT}</td>`)
    expect(payload.html).toContain('All good')
    expect(payload.html).not.toContain('My report')
  })

  it('uses fixed title when meta.title is empty', () => {
    const payload = buildReportPreviewPayload('hi', {})
    expect(payload.title).toBe(REPORT_DOCUMENT_TITLE)
    expect(payload.html).toContain(REPORT_DOCUMENT_TITLE)
    expect(payload.html).toContain(`Project</th><td>${REPORT_PROJECT}</td>`)
  })
})

describe('contentToHtmlBody tables', () => {
  it('renders markdown pipe tables with borders and status badges', () => {
    const md = [
      'AI Assistant Test Execution Report',
      '',
      '| Requirement | Status | Details |',
      '|---|---|---|',
      '| Upload English document | PASS | uploaded successfully |',
      '| Filename in Arabic | FAIL | English filename used |',
    ].join('\n')
    const html = contentToHtmlBody(md)
    expect(html).toContain('<table class="md-table">')
    expect(html).toContain('<th>')
    expect(html).toContain('Upload English document')
    expect(html).toContain('status-badge status-pass')
    expect(html).toContain('status-badge status-fail')
    expect(html).toContain('PASS')
    expect(html).toContain('FAIL')
  })

  it('renders pipe tables even without separator row', () => {
    const md = [
      '| TC ID | Test Scenario | Status | Duration | Evidence / Notes |',
      '| AB-TC-001 | Login | PASS | 12s | Opened login page |',
    ].join('\n')
    const html = contentToHtmlBody(md)
    expect(html).toContain('md-table')
    expect(html).toContain('AB-TC-001')
    expect(html).toContain('12s')
    expect(html).toContain('Evidence / Notes')
  })
})
