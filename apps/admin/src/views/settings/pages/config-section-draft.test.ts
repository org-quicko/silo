import { describe, expect, test } from 'bun:test'
import type { ConfigField, ConfigSectionView } from '../../../api/types/settings'
import { ConfigSectionDraft } from './config-section-draft'

const level: ConfigField = {
  key: 'level',
  type: 'enum',
  values: ['debug', 'info'],
  env: 'SILO_LOG_LEVEL',
  label: 'Level',
}
const file: ConfigField = { key: 'file', type: 'string', restart: true, label: 'File' }
const requests: ConfigField = { key: 'requests', type: 'boolean', label: 'Requests' }
const keep: ConfigField = { key: 'max_files', type: 'number', restart: true, label: 'Keep' }

const section = (patch: Partial<ConfigSectionView> = {}): ConfigSectionView => ({
  table: 'log',
  title: 'Logging',
  summary: 'How much the server writes down.',
  fields: [level, file, requests, keep],
  file: {},
  in_force: { level: 'info', requests: false, max_files: 3 },
  overrides: [],
  writable: true,
  restart_pending: [],
  ...patch,
})

/**
 * The rules one settings card has to get right (D47).
 *
 * Each of these is a way the page could write something nobody chose: seeding a
 * box from a default and saving it back as a decision, sending `""` for a field
 * whose absence is what makes it mean "the console", or reporting a value as in
 * force when the process has not picked it up yet.
 */
describe('ConfigSectionDraft', () => {
  test('a draft is seeded from the file, never from what is in force', () => {
    // The file says nothing, so the boxes are empty. Seeding "info" here would
    // save silo's own default into the file as though somebody had picked it.
    expect(ConfigSectionDraft.of(section())).toEqual({
      level: '',
      file: '',
      requests: false,
      max_files: '',
    })
  })

  test('every value is a string, a number or a boolean, so no input goes uncontrolled', () => {
    const draft = ConfigSectionDraft.of(section({ file: { level: 'debug', max_files: 5 } }))
    expect(Object.values(draft).every((v) => ['string', 'number', 'boolean'].includes(typeof v))).toBe(true)
  })

  test('a freshly loaded card is not dirty, and an edit is detected', () => {
    const loaded = section({ file: { level: 'debug' } })
    const draft = ConfigSectionDraft.of(loaded)
    expect(ConfigSectionDraft.changed(draft, loaded)).toBe(false)
    expect(ConfigSectionDraft.changed({ ...draft, level: 'info' }, loaded)).toBe(true)
  })

  describe('payload', () => {
    test('an empty field is left out, not sent as an empty string', () => {
      // An absent key means "the file does not decide this", which is what
      // keeps an unset [log] file meaning the console.
      const body = ConfigSectionDraft.payload(ConfigSectionDraft.of(section()), section())
      expect(body).toEqual({ requests: false })
    })

    test('values that were set are sent with their types intact', () => {
      const loaded = section({ file: { level: 'debug', max_files: 5, file: '/a.log' } })
      expect(ConfigSectionDraft.payload(ConfigSectionDraft.of(loaded), loaded)).toEqual({
        level: 'debug',
        file: '/a.log',
        requests: false,
        max_files: 5,
      })
    })

    test('a read-only field is never sent, since the server refuses it', () => {
      const readOnly = section({
        fields: [{ key: 'path', type: 'string', readOnly: true, label: 'Path' }],
        file: { path: '/srv/data' },
      })
      expect(ConfigSectionDraft.payload(ConfigSectionDraft.of(readOnly), readOnly)).toEqual({})
    })
  })

  describe('inUse', () => {
    test('a field the file decides, with nothing overriding it, has nothing to say', () => {
      expect(ConfigSectionDraft.inUse(section({ file: { level: 'info' } }), level)).toBeNull()
    })

    test('an override names the variable and the value in force', () => {
      const found = ConfigSectionDraft.inUse(
        section({ overrides: [{ field: 'level', env: 'SILO_LOG_LEVEL' }] }),
        level,
      )
      expect(found).toEqual({ value: 'info', env: 'SILO_LOG_LEVEL' })
    })

    test('a pending restart reports what is still running, not what was saved', () => {
      // The file now says /new.log and the process is still writing elsewhere.
      // Reporting the saved value as in force is the one lie this page cannot
      // afford, since it is the reason somebody would go looking for the log.
      const found = ConfigSectionDraft.inUse(
        section({ file: { file: '/new.log' }, restart_pending: ['file'] }),
        file,
      )
      expect(found).toEqual({ value: 'nothing', restart: true })
    })

    test('a boolean reads as on or off, and empty counts as a value', () => {
      expect(
        ConfigSectionDraft.inUse(section({ overrides: [{ field: 'requests' }] }), requests),
      ).toEqual({ value: 'off' })
      expect(
        ConfigSectionDraft.inUse(
          section({ in_force: {}, overrides: [{ field: 'level' }] }),
          level,
        ),
      ).toEqual({ value: 'nothing' })
    })
  })
})
