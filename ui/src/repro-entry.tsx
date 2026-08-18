import { createRoot } from 'react-dom/client'
import Form from '@rjsf/core'
import validator from '@rjsf/validator-ajv8'
import { slateTemplates, slateWidgets, slateFields } from './forms/theme'
import { buildUiSchema } from './forms/build-ui-schema'
import { SiloRefs } from './schema/silo-refs'

const collections = [
  {
    name: 'posts',
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        title: { type: 'string' },
        authors: { type: 'array', items: { $ref: 'silo://collections/authors' } },
      },
    },
  },
  {
    name: 'authors',
    schema: {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      title: 'Author',
      type: 'object',
      properties: {
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
      },
    },
  },
]

const root = collections.find((c) => c.name === 'posts')!
const schema = SiloRefs.resolveForForm(root.name, root.schema, collections as any)
const uiSchema = buildUiSchema(schema)

const container = document.getElementById('root')!
createRoot(container).render(
  <div style={{ padding: 40, maxWidth: 720 }}>
    <Form
      schema={schema}
      uiSchema={uiSchema}
      validator={validator}
      templates={slateTemplates as any}
      widgets={slateWidgets as any}
      fields={slateFields as any}
      formData={{ authors: [{ name: 'Ada', email: 'ada@example.com' }] }}
      onChange={() => {}}
    >
      <></>
    </Form>
  </div>,
)
